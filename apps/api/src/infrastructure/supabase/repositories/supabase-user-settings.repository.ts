import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import type { IUserSettingsRepository } from '#domain/repositories/notification.repository.interface';
import type { UserSettings } from '#domain/entities/notification.entity';

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
