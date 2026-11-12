import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import type { IEventCheckInScreenRepository } from '#domain/repositories/event-check-in-screen.repository.interface';
import type { EventCheckInScreen } from '#domain/entities/event-check-in-screen.entity';
import { SupabaseQueryError } from '../supabase-query-error';

@Injectable()
export class SupabaseEventCheckInScreenRepository implements IEventCheckInScreenRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findLive(
    eventId: string,
    chapterId: string,
    nowIso: string,
  ): Promise<EventCheckInScreen | null> {
    const { data, error } = await this.supabase
      .from('event_check_in_screens')
      .select('*')
      .eq('event_id', eventId)
      .eq('chapter_id', chapterId)
      .gt('expires_at', nowIso)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async recordShown(input: {
    eventId: string;
    chapterId: string;
    nowIso: string;
    expiresAt: string;
    location: { lat: number; lng: number; accuracy_m: number } | null;
  }): Promise<EventCheckInScreen> {
    // An upsert writes only the columns it is given, so a screen with no
    // location leaves a stored one in place (see the interface).
    const row: TablesInsert<'event_check_in_screens'> = {
      event_id: input.eventId,
      chapter_id: input.chapterId,
      shown_at: input.nowIso,
      expires_at: input.expiresAt,
      ...(input.location
        ? {
            lat: input.location.lat,
            lng: input.location.lng,
            accuracy_m: input.location.accuracy_m,
            located_at: input.nowIso,
          }
        : {}),
    };
    const { data, error } = await this.supabase
      .from('event_check_in_screens')
      .upsert(row, { onConflict: 'event_id' })
      .select('*')
      .single();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async deleteExpired(nowIso: string): Promise<number> {
    const { data, error } = await this.supabase
      .from('event_check_in_screens')
      .delete()
      .lte('expires_at', nowIso)
      .select('event_id');
    if (error) throw new SupabaseQueryError(error);
    return data?.length ?? 0;
  }
}
