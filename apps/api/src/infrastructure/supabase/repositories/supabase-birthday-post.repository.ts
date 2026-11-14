import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient } from '../database.types';
import type { IBirthdayPostRepository } from '#domain/repositories/birthday-post.repository.interface';
import { SupabaseQueryError } from '../supabase-query-error';

@Injectable()
export class SupabaseBirthdayPostRepository implements IBirthdayPostRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async claim(
    chapterId: string,
    userId: string,
    localDate: string,
  ): Promise<boolean> {
    // `on conflict do nothing` with the row returned: a row back means this
    // insert landed; none means another sweep's did. No error either way, so
    // the ticks after a post cost no failed write.
    const { data, error } = await this.supabase
      .from('birthday_posts')
      .upsert(
        { chapter_id: chapterId, user_id: userId, local_date: localDate },
        {
          onConflict: 'chapter_id,user_id,local_date',
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
    localDate: string,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('birthday_posts')
      .delete()
      .eq('chapter_id', chapterId)
      .eq('user_id', userId)
      .eq('local_date', localDate);
    if (error) throw new SupabaseQueryError(error);
  }
}
