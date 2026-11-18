import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import type {
  ActivityLayoutLists,
  IActivityLayoutRepository,
} from '#domain/repositories/activity-layout.repository.interface';
import type { ActivityLayout } from '#domain/entities/activity-layout.entity';
import { SupabaseQueryError } from '../supabase-query-error';

/**
 * A member's own Activity card arrangement (#5520).
 *
 * Every query filters on `chapter_id` and `user_id`. The API reaches the table
 * with the service-role client, which bypasses RLS (the table enables it with
 * no policies), so these predicates are the whole of the boundary between one
 * member's arrangement and another's.
 */
@Injectable()
export class SupabaseActivityLayoutRepository implements IActivityLayoutRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async find(
    chapterId: string,
    userId: string,
  ): Promise<ActivityLayout | null> {
    const { data, error } = await this.supabase
      .from('activity_layouts')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  /**
   * Both lists are written whole: an order is one decision, so the last save
   * from any device wins outright rather than merging with an earlier one.
   * `updated_at` is set by the table's trigger on the conflict arm.
   */
  async upsert(
    chapterId: string,
    userId: string,
    lists: ActivityLayoutLists,
  ): Promise<ActivityLayout> {
    const payload: TablesInsert<'activity_layouts'> = {
      card_order: lists.card_order,
      hidden_cards: lists.hidden_cards,
      // Server-owned keys last, so nothing above can override them.
      chapter_id: chapterId,
      user_id: userId,
    };
    const { data, error } = await this.supabase
      .from('activity_layouts')
      .upsert(payload, { onConflict: 'user_id,chapter_id' })
      .select()
      .single();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async delete(chapterId: string, userId: string): Promise<void> {
    const { error } = await this.supabase
      .from('activity_layouts')
      .delete()
      .eq('chapter_id', chapterId)
      .eq('user_id', userId);
    if (error) throw new SupabaseQueryError(error);
  }
}
