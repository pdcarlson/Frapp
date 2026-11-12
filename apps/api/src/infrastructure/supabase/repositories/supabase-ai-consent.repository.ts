import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import { SupabaseQueryError } from '../supabase-query-error';
import type {
  ChapterAiSettings,
  UserAiConsent,
} from '#domain/entities/ai-consent.entity';
import type {
  ChapterAiSettingsPatch,
  IAiConsentRepository,
} from '#domain/repositories/ai-consent.repository.interface';

const SETTINGS_SELECT =
  'chapter_id, ask_enabled, meeting_notes_enabled, chat_source_enabled, updated_by, updated_at';
const CONSENT_SELECT = 'user_id, sheet_version, accepted, answered_at';
const ID_BATCH = 200;

/**
 * `chapter_ai_settings` and `user_ai_consents` through the service role
 * (#4308, `20261112031000_ai_consent.sql`).
 *
 * The settings are per chapter and every read and write is keyed by it. The
 * consents are per person, not per chapter: one answer covers every chapter
 * the person is in, so those reads are keyed by the person.
 */
@Injectable()
export class SupabaseAiConsentRepository implements IAiConsentRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: FrappSupabaseClient,
  ) {}

  async findChapterSettings(
    chapterId: string,
  ): Promise<ChapterAiSettings | null> {
    const { data, error } = await this.supabase
      .from('chapter_ai_settings')
      .select(SETTINGS_SELECT)
      .eq('chapter_id', chapterId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data ?? null;
  }

  async saveChapterSettings(
    chapterId: string,
    patch: ChapterAiSettingsPatch,
    updatedBy: string,
    now: Date,
  ): Promise<ChapterAiSettings> {
    // `chapter_id` last, so nothing spread from the patch can point the
    // upsert at another chapter's row. A column the patch leaves out keeps
    // its stored value on update, and its default (off) on the first write.
    const row: TablesInsert<'chapter_ai_settings'> = {
      ...patch,
      updated_by: updatedBy,
      updated_at: now.toISOString(),
      chapter_id: chapterId,
    };
    const { data, error } = await this.supabase
      .from('chapter_ai_settings')
      .upsert(row, { onConflict: 'chapter_id' })
      .select(SETTINGS_SELECT)
      .single();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async findConsent(
    userId: string,
    sheetVersion: number,
  ): Promise<UserAiConsent | null> {
    const { data, error } = await this.supabase
      .from('user_ai_consents')
      .select(CONSENT_SELECT)
      .eq('user_id', userId)
      .eq('sheet_version', sheetVersion)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data ?? null;
  }

  async findLatestConsent(userId: string): Promise<UserAiConsent | null> {
    const { data, error } = await this.supabase
      .from('user_ai_consents')
      .select(CONSENT_SELECT)
      .eq('user_id', userId)
      .order('sheet_version', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data ?? null;
  }

  async saveConsent(
    userId: string,
    sheetVersion: number,
    accepted: boolean,
    now: Date,
  ): Promise<UserAiConsent> {
    const row: TablesInsert<'user_ai_consents'> = {
      user_id: userId,
      sheet_version: sheetVersion,
      accepted,
      answered_at: now.toISOString(),
    };
    const { data, error } = await this.supabase
      .from('user_ai_consents')
      .upsert(row, { onConflict: 'user_id,sheet_version' })
      .select(CONSENT_SELECT)
      .single();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async findAcceptedUserIds(
    userIds: readonly string[],
    sheetVersion: number,
  ): Promise<string[]> {
    const unique = [...new Set(userIds)];
    const accepted: string[] = [];
    // In batches, so a channel with hundreds of authors never builds a
    // request URL PostgREST or a proxy refuses.
    for (let start = 0; start < unique.length; start += ID_BATCH) {
      const { data, error } = await this.supabase
        .from('user_ai_consents')
        .select('user_id')
        .eq('sheet_version', sheetVersion)
        .eq('accepted', true)
        .in('user_id', unique.slice(start, start + ID_BATCH));
      if (error) throw new SupabaseQueryError(error);
      for (const row of data ?? []) accepted.push(row.user_id);
    }
    return accepted;
  }
}
