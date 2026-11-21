import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient } from '../database.types';
import type { ChapterDriveConnection } from '#domain/entities/chapter-drive-connection.entity';
import type {
  ChapterDriveSyncResult,
  IChapterDriveRepository,
} from '#domain/repositories/chapter-drive.repository.interface';
import { SupabaseQueryError } from '../supabase-query-error';
import { fetchAllPages } from '../supabase.utils';

/**
 * A chapter's connected Google Drive folder (#5157).
 *
 * Officer-facing reads and writes filter on `chapter_id`. The unscoped ones
 * are the worker's, which act on rows the claim handed them, and the two
 * "elsewhere" reads, which return only whether a folder is taken (or the
 * taken folder ids), never another chapter's rows. The table
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

  async findAny(chapterId: string): Promise<ChapterDriveConnection | null> {
    const { data, error } = await this.supabase
      .from('chapter_drive_connections')
      .select('*')
      .eq('chapter_id', chapterId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async create(data: {
    chapter_id: string;
    folder_id: string;
    folder_name: string;
    connected_by: string;
    who_can_see: string[] | null;
  }): Promise<ChapterDriveConnection> {
    const { data: created, error } = await this.supabase
      .from('chapter_drive_connections')
      .insert(data)
      .select()
      .single();
    if (error) throw new SupabaseQueryError(error);
    return created;
  }

  async folderTakenElsewhere(
    chapterId: string,
    folderIds: string[],
  ): Promise<boolean> {
    if (folderIds.length === 0) return false;
    const connected = await this.supabase
      .from('chapter_drive_connections')
      .select('id')
      .in('folder_id', folderIds)
      .neq('chapter_id', chapterId)
      .neq('status', 'disconnecting')
      .limit(1);
    if (connected.error) throw new SupabaseQueryError(connected.error);
    if ((connected.data ?? []).length > 0) return true;
    // A synced folder counts only while its chapter's connection is live: a
    // disconnecting chapter's folders are on their way out within the minute.
    const synced = await this.supabase
      .from('chapter_document_folders')
      .select('chapter_id')
      .in('drive_folder_id', folderIds)
      .neq('chapter_id', chapterId);
    if (synced.error) throw new SupabaseQueryError(synced.error);
    const chapters = [...new Set((synced.data ?? []).map((r) => r.chapter_id))];
    if (chapters.length === 0) return false;
    const live = await this.supabase
      .from('chapter_drive_connections')
      .select('id')
      .in('chapter_id', chapters)
      .neq('status', 'disconnecting')
      .limit(1);
    if (live.error) throw new SupabaseQueryError(live.error);
    return (live.data ?? []).length > 0;
  }

  async folderIdsConnectedEarlierElsewhere(
    chapterId: string,
    connectedAt: string,
  ): Promise<Set<string>> {
    // Paged: a short read past PostgREST's `max_rows` would let a pass read
    // another chapter's folder in without an error. (id) orders it totally.
    const rows = await fetchAllPages(
      (from, to) =>
        this.supabase
          .from('chapter_drive_connections')
          .select('id, folder_id')
          .neq('chapter_id', chapterId)
          .neq('status', 'disconnecting')
          .lt('created_at', connectedAt)
          .order('id', { ascending: true })
          .range(from, to),
      { pageSize: 1000 },
    );
    return new Set(rows.map((row) => row.folder_id));
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

  async restoreAccess(chapterId: string, now: Date): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('chapter_drive_connections')
      .update({
        status: 'active',
        last_error: null,
        sync_due_at: now.toISOString(),
      })
      .eq('chapter_id', chapterId)
      .eq('status', 'no_access')
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
