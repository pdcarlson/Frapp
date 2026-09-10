import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import type { IUserSettingsRepository } from '#domain/repositories/notification.repository.interface';
import type { UserSettings } from '#domain/entities/notification.entity';
import { chunkIds } from '#domain/utils/chunk-ids';
import { fetchAllPages } from '../supabase.utils';

/**
 * Request size for a batched settings read. One row per user, so a 100-id
 * chunk is well under a typical `max_rows` — paging is still required because
 * the hosted cap is a dashboard setting this code cannot read.
 */
const SETTINGS_PAGE_SIZE = 500;

@Injectable()
export class SupabaseUserSettingsRepository implements IUserSettingsRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findByUser(userId: string): Promise<UserSettings | null> {
    const { data, error } = await this.supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async findByUserIds(userIds: string[]): Promise<UserSettings[]> {
    if (userIds.length === 0) return [];

    const pages = await Promise.all(
      chunkIds(userIds).map((chunk) =>
        fetchAllPages<UserSettings>(
          (from, to) =>
            this.supabase
              .from('user_settings')
              .select('*')
              .in('user_id', chunk)
              .order('id', { ascending: true })
              .range(from, to),
          { pageSize: SETTINGS_PAGE_SIZE },
        ),
      ),
    );
    return pages.flat();
  }

  async upsert(data: TablesInsert<'user_settings'>): Promise<UserSettings> {
    const row: TablesInsert<'user_settings'> = {
      user_id: data.user_id,
      quiet_hours_start: data.quiet_hours_start ?? null,
      quiet_hours_end: data.quiet_hours_end ?? null,
      quiet_hours_tz: data.quiet_hours_tz ?? null,
      theme: data.theme ?? 'system',
      updated_at: new Date().toISOString(),
    };
    const { data: result, error } = await this.supabase
      .from('user_settings')
      .upsert(row, {
        onConflict: 'user_id',
        ignoreDuplicates: false,
      })
      .select()
      .single();

    if (error) throw error;
    return result;
  }
}
