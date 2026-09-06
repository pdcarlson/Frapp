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

    // Each filter applies only when supplied, so an empty set degrades to the
    // same query an unfiltered read runs.
    if (options.actorUserId) {
      q = q.eq('actor_user_id', options.actorUserId);
    }
    if (options.action) {
      q = q.eq('action', options.action);
    }
    // Bounds are inclusive and compare against `created_at`; `before` is the
    // exclusive cursor and is applied alongside them, not instead of them.
    if (options.startDate) {
      q = q.gte('created_at', options.startDate);
    }
    if (options.endDate) {
      q = q.lte('created_at', options.endDate);
    }
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
