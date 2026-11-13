import { Inject, Injectable } from '@nestjs/common';
import type { MemberNudgeDismissReason } from '@repo/validation';
import { isUniqueViolation } from '#domain/constants/postgres-error-codes';
import type {
  MemberNudge,
  MemberNudgeSettings,
  MemberNudgeStatus,
} from '#domain/entities/member-nudge.entity';
import type {
  IMemberNudgeRepository,
  MemberNudgeDraft,
} from '#domain/repositories/member-nudge.repository.interface';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import { SUPABASE_CLIENT } from '../supabase.provider';
import { SupabaseQueryError } from '../supabase-query-error';

/**
 * The upsert target, the primary key of `member_nudge_settings` in
 * `20261113181721_member_nudges.sql`. The repository's spec checks it against
 * the migration, because a target that names no unique constraint fails every
 * write with 42P10 and no mocked client notices.
 */
export const MEMBER_NUDGE_SETTINGS_CONFLICT = 'user_id,chapter_id';

/**
 * `member_nudges` and `member_nudge_settings` (#4781). RLS on and no
 * policies: the API's service role is the only reader, and every query here
 * filters on `chapter_id` and `user_id` because nothing else would.
 */
@Injectable()
export class SupabaseMemberNudgeRepository implements IMemberNudgeRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findShowing(
    chapterId: string,
    userId: string,
  ): Promise<MemberNudge | null> {
    const { data, error } = await this.supabase
      .from('member_nudges')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('user_id', userId)
      .eq('status', 'showing')
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async findRecent(
    chapterId: string,
    userId: string,
    since: string,
  ): Promise<MemberNudge[]> {
    const { data, error } = await this.supabase
      .from('member_nudges')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('user_id', userId)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async findRaised(
    chapterId: string,
    userId: string,
  ): Promise<Pick<MemberNudge, 'task_id' | 'kind'>[]> {
    // Newest first and capped: a member's open tasks are recent ones, and a
    // card is at most a couple a week, so the cap is years of cards.
    const { data, error } = await this.supabase
      .from('member_nudges')
      .select('task_id, kind')
      .eq('chapter_id', chapterId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async create(draft: MemberNudgeDraft): Promise<MemberNudge | null> {
    const row: TablesInsert<'member_nudges'> = { ...draft, status: 'showing' };
    const { data, error } = await this.supabase
      .from('member_nudges')
      .insert(row)
      .select('*')
      .single();
    if (error) {
      // One showing card per member, one card per task and kind: another
      // device's check won the race, and its card is the one to show.
      if (isUniqueViolation(error)) return null;
      throw new SupabaseQueryError(error);
    }
    return data;
  }

  async markSeen(
    chapterId: string,
    userId: string,
    id: string,
    seenAt: string,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('member_nudges')
      .update({ seen_at: seenAt })
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .eq('user_id', userId)
      .eq('status', 'showing')
      .is('seen_at', null);
    if (error) throw new SupabaseQueryError(error);
  }

  async close(
    chapterId: string,
    userId: string,
    id: string,
    change: {
      status: Exclude<MemberNudgeStatus, 'showing'>;
      dismiss_reason?: MemberNudgeDismissReason;
      closed_at: string;
    },
  ): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('member_nudges')
      .update({
        status: change.status,
        dismiss_reason: change.dismiss_reason ?? null,
        closed_at: change.closed_at,
        // The words go with the card (the table's check requires it).
        title: null,
        body: null,
        start_here: null,
      })
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .eq('user_id', userId)
      .eq('status', 'showing')
      .select('id');
    if (error) throw new SupabaseQueryError(error);
    return data.length > 0;
  }

  async deleteByUser(userId: string): Promise<void> {
    const { error } = await this.supabase
      .from('member_nudges')
      .delete()
      .eq('user_id', userId);
    if (error) throw new SupabaseQueryError(error);
  }

  async closeExpired(chapterId: string, now: string): Promise<void> {
    const { error } = await this.supabase
      .from('member_nudges')
      .update({
        status: 'expired',
        closed_at: now,
        title: null,
        body: null,
        start_here: null,
      })
      .eq('chapter_id', chapterId)
      .eq('status', 'showing')
      .lte('expires_at', now);
    if (error) throw new SupabaseQueryError(error);
  }

  async findSettings(
    chapterId: string,
    userId: string,
  ): Promise<MemberNudgeSettings | null> {
    const { data, error } = await this.supabase
      .from('member_nudge_settings')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async saveSettings(
    chapterId: string,
    userId: string,
    change: Partial<Pick<MemberNudgeSettings, 'enabled' | 'quiet_until'>>,
    now: string,
  ): Promise<MemberNudgeSettings> {
    const row: TablesInsert<'member_nudge_settings'> = {
      user_id: userId,
      chapter_id: chapterId,
      ...change,
      updated_at: now,
    };
    const { data, error } = await this.supabase
      .from('member_nudge_settings')
      .upsert(row, { onConflict: MEMBER_NUDGE_SETTINGS_CONFLICT })
      .select('*')
      .single();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }
}
