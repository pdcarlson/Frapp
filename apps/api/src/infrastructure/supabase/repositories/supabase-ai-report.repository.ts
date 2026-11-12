import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import { SupabaseQueryError } from '../supabase-query-error';
import type {
  IAiReportRepository,
  InsertAiReportInput,
} from '#domain/repositories/ai-report.repository.interface';

/** Postgres `unique_violation`: this member already reported this thing. */
const UNIQUE_VIOLATION = '23505';

/**
 * `ai_reports` through the service role (#4315,
 * `20261112220000_ai_reports.sql`).
 *
 * Writes are keyed by chapter. Two deletes are not, on purpose: a person's
 * answer on the AI sheet covers every chapter, so a No deletes reports
 * quoting them everywhere (`deleteQuoting`), and the sweep deletes whatever
 * has run out wherever it is (`deleteExpired`). There is no method that
 * reads a report.
 */
@Injectable()
export class SupabaseAiReportRepository implements IAiReportRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: FrappSupabaseClient,
  ) {}

  async insert(input: InsertAiReportInput): Promise<boolean> {
    const row: TablesInsert<'ai_reports'> = {
      reported_by: input.reportedBy,
      subject_type: input.subjectType,
      subject_id: input.subjectId,
      reason: input.reason,
      note: input.note,
      sealed: input.sealed,
      quoted_user_ids: [...input.quotedUserIds],
      model: input.model,
      prompt_version: input.promptVersion,
      created_at: input.createdAt.toISOString(),
      expires_at: input.expiresAt.toISOString(),
      chapter_id: input.chapterId,
    };
    const { error } = await this.supabase.from('ai_reports').insert(row);
    if (error) {
      if (error.code === UNIQUE_VIOLATION) return false;
      throw new SupabaseQueryError(error);
    }
    return true;
  }

  async deleteQuoting(userId: string): Promise<number> {
    const { data, error } = await this.supabase
      .from('ai_reports')
      .delete()
      .contains('quoted_user_ids', [userId])
      .select('id');
    if (error) throw new SupabaseQueryError(error);
    return data?.length ?? 0;
  }

  async deleteExpired(now: Date): Promise<number> {
    const { data, error } = await this.supabase
      .from('ai_reports')
      .delete()
      .lte('expires_at', now.toISOString())
      .select('id');
    if (error) throw new SupabaseQueryError(error);
    return data?.length ?? 0;
  }
}
