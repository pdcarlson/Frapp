import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { INotificationPreferenceRepository } from '../../../domain/repositories/notification.repository.interface';
import type { NotificationPreference } from '../../../domain/entities/notification.entity';

@Injectable()
export class SupabaseNotificationPreferenceRepository implements INotificationPreferenceRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
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
    return (data as NotificationPreference[]) ?? [];
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
    return data as NotificationPreference | null;
  }

  async upsert(
    data: Partial<NotificationPreference>,
  ): Promise<NotificationPreference> {
    const { data: result, error } = await this.supabase
      .from('notification_preferences')
      .upsert(
        {
          user_id: data.user_id,
          chapter_id: data.chapter_id,
          category: data.category,
          is_enabled: data.is_enabled ?? true,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'user_id,chapter_id,category',
          ignoreDuplicates: false,
        },
      )
      .select()
      .single();

    if (error) throw error;
    return result as NotificationPreference;
  }
}
