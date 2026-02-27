import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { IUserSettingsRepository } from '../../../domain/repositories/notification.repository.interface';
import type { UserSettings } from '../../../domain/entities/notification.entity';

@Injectable()
export class SupabaseUserSettingsRepository implements IUserSettingsRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async findByUser(userId: string): Promise<UserSettings | null> {
    const { data, error } = await this.supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;
    return data as UserSettings | null;
  }

  async upsert(data: Partial<UserSettings>): Promise<UserSettings> {
    const { data: result, error } = await this.supabase
      .from('user_settings')
      .upsert(
        {
          user_id: data.user_id,
          quiet_hours_start: data.quiet_hours_start ?? null,
          quiet_hours_end: data.quiet_hours_end ?? null,
          quiet_hours_tz: data.quiet_hours_tz ?? null,
          theme: data.theme ?? 'system',
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'user_id',
          ignoreDuplicates: false,
        },
      )
      .select()
      .single();

    if (error) throw error;
    return result as UserSettings;
  }
}
