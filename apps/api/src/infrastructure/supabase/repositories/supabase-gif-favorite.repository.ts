import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient } from '../database.types';
import type { GifFavorite } from '#domain/entities';
import type {
  GifFavoriteInput,
  IGifFavoriteRepository,
} from '#domain/repositories/gif-favorite.repository.interface';
import { SupabaseQueryError } from '../supabase-query-error';

const COLUMNS =
  'id, user_id, provider, gif_id, title, full_url, full_width, full_height, preview_url, preview_width, preview_height, created_at';

/**
 * GIF favorites (#5772). Every query filters on `user_id`: that is the
 * privacy boundary, since the service-role client bypasses RLS and the table
 * has no policies.
 */
@Injectable()
export class SupabaseGifFavoriteRepository implements IGifFavoriteRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async listByUser(userId: string, provider: string): Promise<GifFavorite[]> {
    const { data, error } = await this.supabase
      .from('gif_favorites')
      .select(COLUMNS)
      .eq('user_id', userId)
      .eq('provider', provider)
      .order('created_at', { ascending: false });
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async countByUser(userId: string, provider: string): Promise<number> {
    const { count, error } = await this.supabase
      .from('gif_favorites')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('provider', provider);
    if (error) throw new SupabaseQueryError(error);
    return count ?? 0;
  }

  async has(userId: string, provider: string, gifId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('gif_favorites')
      .select('id')
      .eq('user_id', userId)
      .eq('provider', provider)
      .eq('gif_id', gifId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data !== null;
  }

  async add(userId: string, input: GifFavoriteInput): Promise<void> {
    const { error } = await this.supabase
      .from('gif_favorites')
      .upsert(
        { ...input, user_id: userId },
        { onConflict: 'user_id,provider,gif_id', ignoreDuplicates: true },
      );
    if (error) throw new SupabaseQueryError(error);
  }

  async remove(userId: string, provider: string, gifId: string): Promise<void> {
    const { error } = await this.supabase
      .from('gif_favorites')
      .delete()
      .eq('user_id', userId)
      .eq('provider', provider)
      .eq('gif_id', gifId);
    if (error) throw new SupabaseQueryError(error);
  }
}
