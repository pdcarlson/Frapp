import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient } from '../database.types';
import type {
  IMeetingMinutesRequestRepository,
  MinutesRequestOutcome,
} from '#domain/repositories/meeting-minutes-request.repository.interface';
import { SupabaseQueryError } from '../supabase-query-error';

@Injectable()
export class SupabaseMeetingMinutesRequestRepository
  implements IMeetingMinutesRequestRepository
{
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async hasRequested(
    chapterId: string,
    meetingId: string,
    userId: string,
  ): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('meeting_minutes_requests')
      .select('meeting_id')
      .eq('chapter_id', chapterId)
      .eq('meeting_id', meetingId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data !== null;
  }

  /**
   * The spam guard lives in `request_meeting_minutes`, which locks the
   * meeting's row first, so two members asking at once can't both ping.
   */
  async request(
    chapterId: string,
    meetingId: string,
    userId: string,
    cooldownSeconds: number,
  ): Promise<MinutesRequestOutcome> {
    const { data, error } = await this.supabase.rpc(
      'request_meeting_minutes',
      {
        p_meeting_id: meetingId,
        p_chapter_id: chapterId,
        p_user_id: userId,
        p_cooldown_seconds: cooldownSeconds,
      },
    );
    if (error) throw new SupabaseQueryError(error);
    const row = (data ?? [])[0];
    return {
      requested: row?.requested ?? false,
      ping: row?.ping ?? false,
      asked: row?.asked ?? 0,
    };
  }
}
