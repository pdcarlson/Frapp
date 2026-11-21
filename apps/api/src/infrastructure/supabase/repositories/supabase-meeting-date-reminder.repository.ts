import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import type {
  IMeetingDateReminderRepository,
  MeetingDateReminder,
} from '#domain/repositories/meeting-date-reminder.repository.interface';
import { SupabaseQueryError } from '../supabase-query-error';

const REMINDER_COLUMNS =
  'id, user_id, chapter_id, meeting_id, day, text, remind_at, created_at, updated_at';

/**
 * Private reminders on Coming up dates in minutes (#5672 step 2). Every
 * member-facing query is scoped to the caller's `user_id` and chapter; the
 * table has RLS on with no policies, so this service-role client is the only
 * way in.
 */
@Injectable()
export class SupabaseMeetingDateReminderRepository implements IMeetingDateReminderRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async upsert(input: {
    userId: string;
    chapterId: string;
    meetingId: string;
    day: string;
    text: string;
    remindAt: string;
  }): Promise<MeetingDateReminder> {
    const payload: TablesInsert<'meeting_date_reminders'> = {
      user_id: input.userId,
      chapter_id: input.chapterId,
      meeting_id: input.meetingId,
      day: input.day,
      text: input.text,
      remind_at: input.remindAt,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await this.supabase
      .from('meeting_date_reminders')
      .upsert(payload, {
        // `text_md5` is generated from `text`, so the conflict target names
        // the date without putting its words in the index.
        onConflict: 'user_id,meeting_id,day,text_md5',
        ignoreDuplicates: false,
      })
      .select(REMINDER_COLUMNS)
      .single();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async delete(
    userId: string,
    chapterId: string,
    meetingId: string,
    reminderId: string,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('meeting_date_reminders')
      .delete()
      .eq('id', reminderId)
      .eq('user_id', userId)
      .eq('chapter_id', chapterId)
      .eq('meeting_id', meetingId);
    if (error) throw new SupabaseQueryError(error);
  }

  async findByUserAndMeeting(
    userId: string,
    chapterId: string,
    meetingId: string,
  ): Promise<MeetingDateReminder[]> {
    const { data, error } = await this.supabase
      .from('meeting_date_reminders')
      .select(REMINDER_COLUMNS)
      .eq('user_id', userId)
      .eq('chapter_id', chapterId)
      .eq('meeting_id', meetingId)
      .order('remind_at', { ascending: true });
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async findDue(now: string, limit: number): Promise<MeetingDateReminder[]> {
    const { data, error } = await this.supabase
      .from('meeting_date_reminders')
      .select(REMINDER_COLUMNS)
      .lte('remind_at', now)
      .order('remind_at', { ascending: true })
      .limit(limit);
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async claimDue(
    reminder: Pick<MeetingDateReminder, 'id' | 'remind_at'>,
  ): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('meeting_date_reminders')
      .delete()
      .eq('id', reminder.id)
      .eq('remind_at', reminder.remind_at)
      .select('id');
    if (error) throw new SupabaseQueryError(error);
    return (data ?? []).length > 0;
  }
}
