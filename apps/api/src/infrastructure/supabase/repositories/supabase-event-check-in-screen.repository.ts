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
  ): Promise<EventCheckInScreen[]> {
    const { data, error } = await this.supabase
      .from('event_check_in_screens')
      .select('*')
      .eq('event_id', eventId)
      .eq('chapter_id', chapterId)
      .gt('expires_at', nowIso);
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async recordShown(input: {
    eventId: string;
    reportedBy: string;
    chapterId: string;
    nowIso: string;
    expiresAt: string;
    location: { lat: number; lng: number; accuracy_m: number } | null;
  }): Promise<EventCheckInScreen> {
    // Every location column is written, nulls included, so a report without
    // a fix clears this officer's old one (see the interface).
    const { location } = input;
    const row: TablesInsert<'event_check_in_screens'> = {
      event_id: input.eventId,
      reported_by: input.reportedBy,
      chapter_id: input.chapterId,
      shown_at: input.nowIso,
      expires_at: input.expiresAt,
      lat: location?.lat ?? null,
      lng: location?.lng ?? null,
      accuracy_m: location?.accuracy_m ?? null,
      located_at: location ? input.nowIso : null,
    };
    const { data, error } = await this.supabase
      .from('event_check_in_screens')
      .upsert(row, { onConflict: 'event_id,reported_by' })
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
