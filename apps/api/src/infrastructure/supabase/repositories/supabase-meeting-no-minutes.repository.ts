import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient } from '../database.types';
import type { MeetingNoMinutes } from '#domain/entities/meeting-no-minutes.entity';
import type { IMeetingNoMinutesRepository } from '#domain/repositories/meeting-no-minutes.repository.interface';
import { SupabaseQueryError } from '../supabase-query-error';

@Injectable()
export class SupabaseMeetingNoMinutesRepository implements IMeetingNoMinutesRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async list(chapterId: string): Promise<MeetingNoMinutes[]> {
    const { data, error } = await this.supabase
      .from('meeting_no_minutes')
      .select('event_id, chapter_id, marked_by, created_at')
      .eq('chapter_id', chapterId);
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async mark(chapterId: string, eventId: string, userId: string): Promise<void> {
    const { error } = await this.supabase
      .from('meeting_no_minutes')
      .upsert(
        { event_id: eventId, chapter_id: chapterId, marked_by: userId },
        { onConflict: 'event_id', ignoreDuplicates: true },
      );
    if (error) throw new SupabaseQueryError(error);
  }

  async unmark(chapterId: string, eventId: string): Promise<void> {
    const { error } = await this.supabase
      .from('meeting_no_minutes')
      .delete()
      .eq('chapter_id', chapterId)
      .eq('event_id', eventId);
    if (error) throw new SupabaseQueryError(error);
  }
}
