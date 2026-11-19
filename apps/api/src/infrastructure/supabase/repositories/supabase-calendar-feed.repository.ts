import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import type { CalendarFeed } from '#domain/entities/calendar-feed.entity';
import type { ICalendarFeedRepository } from '#domain/repositories/calendar-feed.repository.interface';
import { SupabaseQueryError } from '../supabase-query-error';

/**
 * Members' calendar subscription links (#3322).
 *
 * Every query but `findByTokenHash` and `sealLegacy` filters on `chapter_id`
 * and `user_id`; `sealLegacy` names one row by id. The
 * table enables RLS with no policies, so only the API (service role) reaches
 * it, and a link is served only through `CalendarFeedService`.
 */
@Injectable()
export class SupabaseCalendarFeedRepository implements ICalendarFeedRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findByTokenHash(tokenHash: string): Promise<CalendarFeed | null> {
    const { data, error } = await this.supabase
      .from('calendar_feeds')
      .select('*')
      .eq('token_hash', tokenHash)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async findLive(
    chapterId: string,
    userId: string,
  ): Promise<CalendarFeed | null> {
    const { data, error } = await this.supabase
      .from('calendar_feeds')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('user_id', userId)
      .is('revoked_at', null)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async create(data: {
    chapter_id: string;
    user_id: string;
    token_hash: string;
    token_sealed: string;
  }): Promise<CalendarFeed> {
    const row: TablesInsert<'calendar_feeds'> = {
      chapter_id: data.chapter_id,
      user_id: data.user_id,
      token_hash: data.token_hash,
      token_sealed: data.token_sealed,
    };
    const { data: created, error } = await this.supabase
      .from('calendar_feeds')
      .insert(row)
      .select('*')
      .single();
    if (error) throw new SupabaseQueryError(error);
    return created;
  }

  async sealLegacy(id: string, tokenSealed: string): Promise<void> {
    const { error } = await this.supabase
      .from('calendar_feeds')
      .update({ token_sealed: tokenSealed, token: null })
      .eq('id', id)
      .not('token', 'is', null);
    if (error) throw new SupabaseQueryError(error);
  }

  async revokeLive(chapterId: string, userId: string): Promise<void> {
    const { error } = await this.supabase
      .from('calendar_feeds')
      .update({ revoked_at: new Date().toISOString() })
      .eq('chapter_id', chapterId)
      .eq('user_id', userId)
      .is('revoked_at', null);
    if (error) throw new SupabaseQueryError(error);
  }
}
