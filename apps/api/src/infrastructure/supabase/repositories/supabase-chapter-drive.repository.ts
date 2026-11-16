import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient } from '../database.types';
import type { ChapterDriveConnection } from '#domain/entities/chapter-drive-connection.entity';
import type {
  ChapterDriveSyncResult,
  IChapterDriveRepository,
} from '#domain/repositories/chapter-drive.repository.interface';
import { SupabaseQueryError } from '../supabase-query-error';

/**
 * A chapter's connected Google Drive folder (#5157).
 *
 * Officer-facing reads and writes filter on `chapter_id`. The unscoped ones
 * are the worker's, which act on rows the claim handed them. The table
 * enables RLS with no policies, so only the API (service role) reaches it.
 */
@Injectable()
export class SupabaseChapterDriveRepository implements IChapterDriveRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findLive(chapterId: string): Promise<ChapterDriveConnection | null> {
    const { data, error } = await this.supabase
      .from('chapter_drive_connections')
      .select('*')
      .eq('chapter_id', chapterId)
      .neq('status', 'disconnecting')
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async create(data: {
    chapter_id: string;
    folder_id: string;
    folder_name: string;
    connected_by: string;
  }): Promise<ChapterDriveConnection> {
    const { data: created, error } = await this.supabase
      .from('chapter_drive_connections')
      .insert(data)
      .select()
      .single();
    if (error) throw new SupabaseQueryError(error);
    return created;
  }

  async markDue(chapterId: string, now: Date): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('chapter_drive_connections')
      .update({ sync_due_at: now.toISOString() })
      .eq('chapter_id', chapterId)
      .neq('status', 'disconnecting')
      .select('id');
    if (error) throw new SupabaseQueryError(error);
    return (data ?? []).length > 0;
  }

  async disconnect(chapterId: string, now: Date): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('chapter_drive_connections')
      .update({ status: 'disconnecting', sync_due_at: now.toISOString() })
      .eq('chapter_id', chapterId)
      .neq('status', 'disconnecting')
      .select('id');
    if (error) throw new SupabaseQueryError(error);
    return (data ?? []).length > 0;
  }

  async claim(
    now: Date,
    limit: number,
    leaseSeconds: number,
  ): Promise<ChapterDriveConnection[]> {
    const { data, error } = await this.supabase.rpc(
      'claim_chapter_drive_syncs',
      {
        p_now: now.toISOString(),
        p_limit: limit,
        p_lease_seconds: leaseSeconds,
      },
    );
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async finishSync(id: string, result: ChapterDriveSyncResult): Promise<void> {
    const { error } = await this.supabase
      .from('chapter_drive_connections')
      .update({ ...result, sync_lease_until: null })
      .eq('id', id)
      // An officer who disconnected mid-sync stays disconnecting.
      .neq('status', 'disconnecting');
    if (error) throw new SupabaseQueryError(error);
    await this.releaseLease(id);
  }

  async releaseLease(id: string): Promise<void> {
    const { error } = await this.supabase
      .from('chapter_drive_connections')
      .update({ sync_lease_until: null })
      .eq('id', id);
    if (error) throw new SupabaseQueryError(error);
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase
      .from('chapter_drive_connections')
      .delete()
      .eq('id', id)
      .eq('status', 'disconnecting');
    if (error) throw new SupabaseQueryError(error);
  }
}
