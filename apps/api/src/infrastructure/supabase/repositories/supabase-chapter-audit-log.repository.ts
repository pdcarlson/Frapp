import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import {
  IChapterAuditLogRepository,
  type ListChapterAuditLogOptions,
} from '#domain/repositories/chapter-audit-log.repository.interface';
import { ChapterAuditLog } from '#domain/entities/chapter-audit-log.entity';

@Injectable()
export class SupabaseChapterAuditLogRepository implements IChapterAuditLogRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: FrappSupabaseClient,
  ) {}

  async create(
    data: TablesInsert<'chapter_audit_log'>,
  ): Promise<ChapterAuditLog> {
    const { data: created, error } = await this.supabase
      .from('chapter_audit_log')
      .insert(data)
      .select()
      .single();
    if (error) throw error;
    return created;
  }

  async findByChapter(
    chapterId: string,
    options: ListChapterAuditLogOptions,
  ): Promise<ChapterAuditLog[]> {
    let q = this.supabase
      .from('chapter_audit_log')
      .select('*')
      .eq('chapter_id', chapterId);

    if (options.before) {
      q = q.lt('created_at', options.before);
    }

    const { data, error } = await q
      .order('created_at', { ascending: false })
      .limit(options.limit);
    if (error) throw error;
    return data ?? [];
  }
}
