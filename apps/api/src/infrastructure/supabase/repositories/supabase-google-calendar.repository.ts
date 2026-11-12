import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import type {
  GoogleCalendarConnection,
  GoogleCalendarOAuthState,
} from '#domain/entities/google-calendar-connection.entity';
import type {
  GoogleCalendarSyncResult,
  IGoogleCalendarRepository,
} from '#domain/repositories/google-calendar.repository.interface';
import { SupabaseQueryError } from '../supabase-query-error';

/**
 * Google Calendar connections and the sign-ins that make them (#3322).
 *
 * Member-facing reads and writes filter on `chapter_id` and `user_id`. The
 * unscoped ones are `findState` (Google's redirect carries no sign-in, so the
 * state id is the boundary) and the worker's, which act on rows the claim
 * handed them. Both tables enable RLS with no policies, so only the API
 * (service role) reaches them.
 */
@Injectable()
export class SupabaseGoogleCalendarRepository implements IGoogleCalendarRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async createState(data: {
    chapter_id: string;
    user_id: string;
    return_to: string;
    expires_at: string;
  }): Promise<GoogleCalendarOAuthState> {
    const row: TablesInsert<'google_calendar_oauth_states'> = {
      chapter_id: data.chapter_id,
      user_id: data.user_id,
      return_to: data.return_to,
      expires_at: data.expires_at,
    };
    const { data: created, error } = await this.supabase
      .from('google_calendar_oauth_states')
      .insert(row)
      .select('*')
      .single();
    if (error) throw new SupabaseQueryError(error);
    return created;
  }

  async findState(id: string): Promise<GoogleCalendarOAuthState | null> {
    const { data, error } = await this.supabase
      .from('google_calendar_oauth_states')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async consumeState(
    id: string,
    chapterId: string,
    userId: string,
    now: Date,
  ): Promise<GoogleCalendarOAuthState | null> {
    const { data, error } = await this.supabase
      .from('google_calendar_oauth_states')
      .update({ consumed_at: now.toISOString() })
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .eq('user_id', userId)
      .is('consumed_at', null)
      .gt('expires_at', now.toISOString())
      .select('*')
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async deleteExpiredStates(before: Date): Promise<number> {
    const { data, error } = await this.supabase
      .from('google_calendar_oauth_states')
      .delete()
      .lt('expires_at', before.toISOString())
      .select('id');
    if (error) throw new SupabaseQueryError(error);
    return data?.length ?? 0;
  }

  async findLive(
    chapterId: string,
    userId: string,
  ): Promise<GoogleCalendarConnection | null> {
    const { data, error } = await this.supabase
      .from('google_calendar_connections')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('user_id', userId)
      .neq('status', 'disconnecting')
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async create(data: {
    chapter_id: string;
    user_id: string;
    google_email: string | null;
    refresh_token_sealed: string;
  }): Promise<GoogleCalendarConnection> {
    const row: TablesInsert<'google_calendar_connections'> = {
      chapter_id: data.chapter_id,
      user_id: data.user_id,
      google_email: data.google_email,
      refresh_token_sealed: data.refresh_token_sealed,
    };
    const { data: created, error } = await this.supabase
      .from('google_calendar_connections')
      .insert(row)
      .select('*')
      .single();
    if (error) throw new SupabaseQueryError(error);
    return created;
  }

  async replaceToken(
    id: string,
    data: { google_email: string | null; refresh_token_sealed: string },
  ): Promise<void> {
    const { error } = await this.supabase
      .from('google_calendar_connections')
      .update({
        google_email: data.google_email,
        refresh_token_sealed: data.refresh_token_sealed,
        status: 'active',
        last_error: null,
        sync_due_at: new Date().toISOString(),
      })
      .eq('id', id)
      .neq('status', 'disconnecting');
    if (error) throw new SupabaseQueryError(error);
  }

  async markDisconnecting(id: string): Promise<void> {
    const { error } = await this.supabase
      .from('google_calendar_connections')
      .update({
        status: 'disconnecting',
        sync_due_at: new Date().toISOString(),
        sync_lease_until: null,
      })
      .eq('id', id);
    if (error) throw new SupabaseQueryError(error);
  }

  async claim(
    now: Date,
    limit: number,
    leaseSeconds: number,
  ): Promise<GoogleCalendarConnection[]> {
    const { data, error } = await this.supabase.rpc(
      'claim_google_calendar_syncs',
      {
        p_now: now.toISOString(),
        p_limit: limit,
        p_lease_seconds: leaseSeconds,
      },
    );
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async setCalendarId(id: string, calendarId: string): Promise<void> {
    const { error } = await this.supabase
      .from('google_calendar_connections')
      .update({ calendar_id: calendarId })
      .eq('id', id);
    if (error) throw new SupabaseQueryError(error);
  }

  async finishSync(
    id: string,
    result: GoogleCalendarSyncResult,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('google_calendar_connections')
      .update({ ...result, sync_lease_until: null })
      .eq('id', id)
      // A member who disconnected mid-sync stays disconnecting.
      .neq('status', 'disconnecting');
    if (error) throw new SupabaseQueryError(error);
  }

  async deferCleanup(id: string, until: Date, error: string): Promise<void> {
    const { error: queryError } = await this.supabase
      .from('google_calendar_connections')
      .update({ sync_lease_until: until.toISOString(), last_error: error })
      .eq('id', id)
      .eq('status', 'disconnecting');
    if (queryError) throw new SupabaseQueryError(queryError);
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase
      .from('google_calendar_connections')
      .delete()
      .eq('id', id);
    if (error) throw new SupabaseQueryError(error);
  }
}
