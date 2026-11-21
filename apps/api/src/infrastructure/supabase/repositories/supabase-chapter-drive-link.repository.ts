import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient } from '../database.types';
import type { IChapterDriveLinkRepository } from '#domain/repositories/chapter-drive-link.repository.interface';
import type { ChapterDriveLink } from '#domain/entities/chapter-drive-link.entity';
import { SupabaseQueryError } from '../supabase-query-error';

@Injectable()
export class SupabaseChapterDriveLinkRepository implements IChapterDriveLinkRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async create(data: {
    chapter_id: string;
    document_id: string;
    file_id: string;
    resource_key: string | null;
    linked_by: string;
    proven: boolean;
  }): Promise<ChapterDriveLink> {
    const { data: row, error } = await this.supabase
      .from('chapter_drive_links')
      .insert(data)
      .select()
      .single();
    if (error) throw new SupabaseQueryError(error);
    return row;
  }

  async findByDocument(
    documentId: string,
    chapterId: string,
  ): Promise<ChapterDriveLink | null> {
    const { data, error } = await this.supabase
      .from('chapter_drive_links')
      .select('*')
      .eq('document_id', documentId)
      .eq('chapter_id', chapterId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async markDue(
    documentId: string,
    chapterId: string,
    now: Date,
  ): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('chapter_drive_links')
      .update({ sync_due_at: now.toISOString() })
      .eq('document_id', documentId)
      .eq('chapter_id', chapterId)
      .select('id');
    if (error) throw new SupabaseQueryError(error);
    return (data ?? []).length > 0;
  }

  async claim(
    now: Date,
    limit: number,
    leaseSeconds: number,
  ): Promise<ChapterDriveLink[]> {
    const { data, error } = await this.supabase.rpc(
      'claim_chapter_drive_links',
      {
        p_now: now.toISOString(),
        p_limit: limit,
        p_lease_seconds: leaseSeconds,
      },
    );
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async finish(
    id: string,
    result: { last_error: string | null; sync_due_at?: string },
  ): Promise<void> {
    const { error } = await this.supabase
      .from('chapter_drive_links')
      .update({ ...result, sync_lease_until: null })
      .eq('id', id);
    if (error) throw new SupabaseQueryError(error);
  }
}
