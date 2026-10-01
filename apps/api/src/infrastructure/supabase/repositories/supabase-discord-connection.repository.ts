import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import type {
  IDiscordConnectionRepository,
  PendingDiscordAuthorLinkInput,
  PendingDiscordConnectionInput,
  UpsertDiscordConnectionInput,
} from '#domain/repositories/discord-connection.repository.interface';
import type {
  DiscordConnection,
  DiscordOAuthPurpose,
  DiscordOAuthState,
} from '#domain/entities/discord-connection.entity';
import { SupabaseQueryError } from '../supabase-query-error';

@Injectable()
export class SupabaseDiscordConnectionRepository implements IDiscordConnectionRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findByChapter(chapterId: string): Promise<DiscordConnection | null> {
    const { data, error } = await this.supabase
      .from('discord_connections')
      .select('*')
      .eq('chapter_id', chapterId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data ?? null;
  }

  async upsert(
    input: UpsertDiscordConnectionInput,
  ): Promise<DiscordConnection> {
    const row: TablesInsert<'discord_connections'> = {
      chapter_id: input.chapter_id,
      guild_id: input.guild_id,
      guild_name: input.guild_name,
      guild_icon: input.guild_icon,
      connected_by: input.connected_by,
      connected_discord_user_id: input.connected_discord_user_id,
      connected_discord_username: input.connected_discord_username,
      authorizer_permissions: input.authorizer_permissions,
      granted_scopes: input.granted_scopes,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await this.supabase
      .from('discord_connections')
      // `chapter_id` carries a UNIQUE CONSTRAINT (not a partial index), so
      // PostgREST can name it as the ON CONFLICT arbiter — unlike the partial
      // dedupe index on `chat_messages`, which it cannot. Reconnecting is the
      // ordinary repair path, so this has to be an upsert rather than an
      // insert that 409s the admin.
      .upsert(row, { onConflict: 'chapter_id' })
      .select()
      .single();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async deleteByChapter(chapterId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('discord_connections')
      .delete()
      .eq('chapter_id', chapterId)
      .select('id');
    if (error) throw new SupabaseQueryError(error);
    return (data ?? []).length > 0;
  }

  async createState(input: {
    chapter_id: string;
    purpose: DiscordOAuthPurpose;
    created_by: string | null;
    return_path: string | null;
    expires_at: string;
  }): Promise<DiscordOAuthState> {
    const row: TablesInsert<'discord_oauth_states'> = {
      chapter_id: input.chapter_id,
      purpose: input.purpose,
      created_by: input.created_by,
      return_path: input.return_path,
      expires_at: input.expires_at,
    };
    const { data, error } = await this.supabase
      .from('discord_oauth_states')
      .insert(row)
      .select()
      .single();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async consumeState(id: string, now: Date): Promise<DiscordOAuthState | null> {
    const nowIso = now.toISOString();
    // Both conditions live in the UPDATE, not in a read before it. A
    // read-then-write here would let two callbacks replaying one state each see
    // it unspent and each bind a guild onto a chapter; as written, the second
    // matches zero rows and gets null. `expires_at` is compared server-side
    // against our clock rather than `now()` so a test can drive it.
    const { data, error } = await this.supabase
      .from('discord_oauth_states')
      .update({ consumed_at: nowIso })
      .eq('id', id)
      .is('consumed_at', null)
      .gt('expires_at', nowIso)
      .select()
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data ?? null;
  }

  async findStateReturnPath(id: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('discord_oauth_states')
      .select('return_path')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data?.return_path ?? null;
  }

  async attachPendingConnection(
    stateId: string,
    input: PendingDiscordConnectionInput,
  ): Promise<DiscordOAuthState | null> {
    const { data, error } = await this.supabase
      .from('discord_oauth_states')
      .update({
        pending_guild_id: input.guild_id,
        pending_guild_name: input.guild_name,
        pending_guild_icon: input.guild_icon,
        pending_discord_user_id: input.discord_user_id,
        pending_discord_username: input.discord_username,
        pending_permissions: input.permissions,
        pending_scopes: input.scopes,
        confirm_token: input.confirm_token,
        confirm_expires_at: input.confirm_expires_at,
      })
      .eq('id', stateId)
      // A member's link handshake never parks a guild (#2878).
      .eq('purpose', 'connect')
      // Only ever onto a handshake the callback just spent, and only once. A
      // row that already carries a pending guild is one a second callback is
      // trying to overwrite, which is not a thing that legitimately happens.
      .is('confirm_token', null)
      .select()
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data ?? null;
  }

  async consumeConfirmToken(
    token: string,
    chapterId: string,
    now: Date,
  ): Promise<DiscordOAuthState | null> {
    const nowIso = now.toISOString();
    // All four conditions live in the UPDATE. The chapter predicate is the one
    // that closes the confused-deputy hole: a token presented against a session
    // scoped to a different chapter matches zero rows, so somebody else's admin
    // completing an attacker's authorize URL activates nothing.
    const { data, error } = await this.supabase
      .from('discord_oauth_states')
      .update({ confirmed_at: nowIso })
      .eq('confirm_token', token)
      .eq('chapter_id', chapterId)
      // A link handshake's token never activates a guild (#2878).
      .eq('purpose', 'connect')
      .is('confirmed_at', null)
      .gt('confirm_expires_at', nowIso)
      .select()
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data ?? null;
  }

  async attachPendingAuthorLink(
    stateId: string,
    input: PendingDiscordAuthorLinkInput,
  ): Promise<DiscordOAuthState | null> {
    const { data, error } = await this.supabase
      .from('discord_oauth_states')
      .update({
        pending_discord_user_id: input.discord_user_id,
        pending_discord_username: input.discord_username,
        pending_scopes: input.scopes,
        confirm_token: input.confirm_token,
        confirm_expires_at: input.confirm_expires_at,
      })
      .eq('id', stateId)
      .eq('purpose', 'author_link')
      .is('confirm_token', null)
      .select()
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data ?? null;
  }

  async consumeAuthorLinkConfirmToken(
    token: string,
    chapterId: string,
    userId: string,
    now: Date,
  ): Promise<DiscordOAuthState | null> {
    const nowIso = now.toISOString();
    // Every condition in the UPDATE, as `consumeConfirmToken` does, plus the
    // one that closes this flow's confused deputy: `created_by`. A member who
    // sends their authorize URL to somebody else gets that person's consent
    // parked on their handshake, but the token lands in the OTHER person's
    // browser, whose session is not `created_by`, so nothing binds.
    const { data, error } = await this.supabase
      .from('discord_oauth_states')
      .update({ confirmed_at: nowIso })
      .eq('confirm_token', token)
      .eq('purpose', 'author_link')
      .eq('chapter_id', chapterId)
      .eq('created_by', userId)
      .is('confirmed_at', null)
      .gt('confirm_expires_at', nowIso)
      .select()
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data ?? null;
  }

  async deleteExpiredStates(before: Date): Promise<number> {
    const { data, error } = await this.supabase
      .from('discord_oauth_states')
      .delete()
      .lt('expires_at', before.toISOString())
      .select('id');
    if (error) throw new SupabaseQueryError(error);
    return (data ?? []).length;
  }
}
