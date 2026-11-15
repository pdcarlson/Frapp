import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient } from '../database.types';
import type { IActivityRecapPushRepository } from '#domain/repositories/activity-recap-push.repository.interface';
import { SupabaseQueryError } from '../supabase-query-error';

@Injectable()
export class SupabaseActivityRecapPushRepository implements IActivityRecapPushRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async claim(
    chapterId: string,
    userId: string,
    weekFirstDay: string,
  ): Promise<boolean> {
    // `on conflict do nothing` with the row returned, as the birthday post's
    // claim: a row back means this insert landed; none means another sweep's
    // did.
    const { data, error } = await this.supabase
      .from('activity_recap_pushes')
      .upsert(
        {
          chapter_id: chapterId,
          user_id: userId,
          week_first_day: weekFirstDay,
        },
        {
          onConflict: 'chapter_id,user_id,week_first_day',
          ignoreDuplicates: true,
        },
      )
      .select('chapter_id');
    if (error) throw new SupabaseQueryError(error);
    return (data ?? []).length > 0;
  }

  async release(
    chapterId: string,
    userId: string,
    weekFirstDay: string,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('activity_recap_pushes')
      .delete()
      .eq('chapter_id', chapterId)
      .eq('user_id', userId)
      .eq('week_first_day', weekFirstDay);
    if (error) throw new SupabaseQueryError(error);
  }
}
