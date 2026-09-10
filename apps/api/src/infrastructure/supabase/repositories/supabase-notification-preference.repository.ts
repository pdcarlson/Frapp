import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import type { INotificationPreferenceRepository } from '#domain/repositories/notification.repository.interface';
import type { NotificationPreference } from '#domain/entities/notification.entity';
import { chunkIds } from '#domain/utils/chunk-ids';
import { fetchAllPages } from '../supabase.utils';

/**
 * Request size for a batched preference read. One row per (user, chapter,
 * category), so a 100-id chunk is well under a typical `max_rows` — paging
 * is still required because the hosted cap is a dashboard setting this
 * code cannot read. See `fetchAllPages`.
 */
const PREFERENCE_PAGE_SIZE = 500;

@Injectable()
export class SupabaseNotificationPreferenceRepository implements INotificationPreferenceRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findByUserAndChapter(
    userId: string,
    chapterId: string,
  ): Promise<NotificationPreference[]> {
    const { data, error } = await this.supabase
      .from('notification_preferences')
      .select('*')
      .eq('user_id', userId)
      .eq('chapter_id', chapterId);

    if (error) throw error;
    return data ?? [];
  }

  async findByUserChapterCategory(
    userId: string,
    chapterId: string,
    category: string,
  ): Promise<NotificationPreference | null> {
    const { data, error } = await this.supabase
      .from('notification_preferences')
      .select('*')
      .eq('user_id', userId)
      .eq('chapter_id', chapterId)
      .eq('category', category)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async findByUsersChapterCategory(
    userIds: string[],
    chapterId: string,
    category: string,
  ): Promise<NotificationPreference[]> {
    if (userIds.length === 0) return [];

    const pages = await Promise.all(
      chunkIds(userIds).map((chunk) =>
        fetchAllPages<NotificationPreference>(
          (from, to) =>
            this.supabase
              .from('notification_preferences')
              .select('*')
              .in('user_id', chunk)
              .eq('chapter_id', chapterId)
              .eq('category', category)
              .order('id', { ascending: true })
              .range(from, to),
          { pageSize: PREFERENCE_PAGE_SIZE },
        ),
      ),
    );
    return pages.flat();
  }

  async upsert(
    data: TablesInsert<'notification_preferences'>,
  ): Promise<NotificationPreference> {
    const row: TablesInsert<'notification_preferences'> = {
      user_id: data.user_id,
      chapter_id: data.chapter_id,
      category: data.category,
      is_enabled: data.is_enabled ?? true,
      updated_at: new Date().toISOString(),
    };
    const { data: result, error } = await this.supabase
      .from('notification_preferences')
      .upsert(row, {
        onConflict: 'user_id,chapter_id,category',
        ignoreDuplicates: false,
      })
      .select()
      .single();

    if (error) throw error;
    return result;
  }
}
