import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient } from '../database.types';
import type { IPushTokenRepository } from '../../../domain/repositories/notification.repository.interface';
import type { PushToken } from '../../../domain/entities/notification.entity';

@Injectable()
export class SupabasePushTokenRepository implements IPushTokenRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async create(data: Partial<PushToken>): Promise<PushToken> {
    const { data: created, error } = await this.supabase
      .from('push_tokens')
      .insert({
        user_id: data.user_id,
        token: data.token,
        device_name: data.device_name ?? null,
      } as never)
      .select()
      .single();

    if (error) throw error;
    return created as PushToken;
  }

  async findByUser(userId: string): Promise<PushToken[]> {
    const { data, error } = await this.supabase
      .from('push_tokens')
      .select('*')
      .eq('user_id', userId);

    if (error) throw error;
    return (data as PushToken[]) ?? [];
  }

  async findById(id: string): Promise<PushToken | null> {
    const { data, error } = await this.supabase
      .from('push_tokens')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    return data as PushToken | null;
  }

  async findByToken(token: string): Promise<PushToken | null> {
    const { data, error } = await this.supabase
      .from('push_tokens')
      .select('*')
      .eq('token', token)
      .maybeSingle();

    if (error) throw error;
    return data as PushToken | null;
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
