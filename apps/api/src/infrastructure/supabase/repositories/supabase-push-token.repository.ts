import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import type { IPushTokenRepository } from '../../../domain/repositories/notification.repository.interface';
import type { PushToken } from '../../../domain/entities/notification.entity';

@Injectable()
export class SupabasePushTokenRepository implements IPushTokenRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async create(data: TablesInsert<'push_tokens'>): Promise<PushToken> {
    const row: TablesInsert<'push_tokens'> = {
      user_id: data.user_id,
      token: data.token,
      device_name: data.device_name ?? null,
    };
    const { data: created, error } = await this.supabase
      .from('push_tokens')
      .insert(row)
      .select()
      .single();

    if (error) throw error;
    return created;
  }

  async findByUser(userId: string): Promise<PushToken[]> {
    const { data, error } = await this.supabase
      .from('push_tokens')
      .select('*')
      .eq('user_id', userId);

    if (error) throw error;
    return data ?? [];
  }

  async findById(id: string): Promise<PushToken | null> {
    const { data, error } = await this.supabase
      .from('push_tokens')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async findByToken(token: string): Promise<PushToken | null> {
    const { data, error } = await this.supabase
      .from('push_tokens')
      .select('*')
      .eq('token', token)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async delete(id: string, userId: string): Promise<void> {
    const { error } = await this.supabase
      .from('push_tokens')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) throw error;
  }

  async deleteByToken(token: string): Promise<void> {
    const { error } = await this.supabase
      .from('push_tokens')
      .delete()
      .eq('token', token);

    if (error) throw error;
  }
}
