import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient } from '../database.types';
import type { INotificationRepository } from '../../../domain/repositories/notification.repository.interface';
import type { Notification } from '../../../domain/entities/notification.entity';

@Injectable()
export class SupabaseNotificationRepository implements INotificationRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async create(data: Partial<Notification>): Promise<Notification> {
    const { data: created, error } = await this.supabase
      .from('notifications')
      .insert({
        chapter_id: data.chapter_id,
        user_id: data.user_id,
        title: data.title,
        body: data.body,
        data: data.data ?? {},
      } as never)
      .select()
      .single();

    if (error) throw error;
    return created as Notification;
  }

  async findByUser(
    userId: string,
    options?: { limit?: number },
  ): Promise<Notification[]> {
    let query = this.supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data as Notification[]) ?? [];
  }

  async findById(id: string): Promise<Notification | null> {
    const { data, error } = await this.supabase
      .from('notifications')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    return data as Notification | null;
  }

  async markRead(id: string, userId: string): Promise<Notification> {
    const { data, error } = await this.supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() } as never)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;
    return data as Notification;
  }
}
