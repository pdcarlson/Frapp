import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
  TablesUpdate,
} from '../database.types';
import type { INotificationRepository } from '#domain/repositories/notification.repository.interface';
import type { Notification } from '#domain/entities/notification.entity';

@Injectable()
export class SupabaseNotificationRepository implements INotificationRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async create(data: TablesInsert<'notifications'>): Promise<Notification> {
    const row: TablesInsert<'notifications'> = {
      chapter_id: data.chapter_id,
      user_id: data.user_id,
      title: data.title,
      body: data.body,
      data: data.data ?? {},
    };
    const { data: created, error } = await this.supabase
      .from('notifications')
      .insert(row)
      .select()
      .single();

    if (error) throw error;
    return created;
  }

  async createMany(
    data: TablesInsert<'notifications'>[],
  ): Promise<Notification[]> {
    // An empty insert is a no-op, not a query. PostgREST answers `insert([])`
    // with a 200 and no rows, so this only saves a round trip — but it also
    // keeps "the caller sent no recipients" from looking like a write in the
    // repository's call log, which is what the tenant-scope harness reads.
    if (data.length === 0) return [];

    const rows: TablesInsert<'notifications'>[] = data.map((item) => ({
      chapter_id: item.chapter_id,
      user_id: item.user_id,
      title: item.title,
      body: item.body,
      data: item.data ?? {},
    }));
    const { data: created, error } = await this.supabase
      .from('notifications')
      .insert(rows)
      .select();

    if (error) throw error;
    return created ?? [];
  }

  async findByUser(
    userId: string,
    chapterId: string,
    options?: { limit?: number },
  ): Promise<Notification[]> {
    let query = this.supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .eq('chapter_id', chapterId)
      .order('created_at', { ascending: false });

    if (
      typeof options?.limit === 'number' &&
      Number.isFinite(options.limit) &&
      options.limit > 0
    ) {
      query = query.limit(options.limit);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  }

  async findById(id: string, chapterId: string): Promise<Notification | null> {
    const { data, error } = await this.supabase
      .from('notifications')
      .select('*')
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async markRead(
    id: string,
    userId: string,
    chapterId: string,
  ): Promise<Notification> {
    const patch: TablesUpdate<'notifications'> = {
      read_at: new Date().toISOString(),
    };
    const { data, error } = await this.supabase
      .from('notifications')
      .update(patch)
      .eq('id', id)
      .eq('user_id', userId)
      .eq('chapter_id', chapterId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }
}
