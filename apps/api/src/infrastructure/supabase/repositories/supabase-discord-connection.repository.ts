import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import type {
  IDiscordConnectionRepository,
  UpsertDiscordConnectionInput,
} from '../../../domain/repositories/discord-connection.repository.interface';
import type {
  DiscordConnection,
  DiscordOAuthState,
} from '../../../domain/entities/discord-connection.entity';

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
    if (error) throw error;
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
    if (error) throw error;
    return data;
  }

  async deleteByChapter(chapterId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('discord_connections')
      .delete()
      .eq('chapter_id', chapterId)
      .select('id');
    if (error) throw error;
    return (data ?? []).length > 0;
  }

  async createState(input: {
    chapter_id: string;
    created_by: string | null;
    return_path: string | null;
    expires_at: string;
  }): Promise<DiscordOAuthState> {
    const row: TablesInsert<'discord_oauth_states'> = {
      chapter_id: input.chapter_id,
      created_by: input.created_by,
      return_path: input.return_path,
      expires_at: input.expires_at,
    };
    const { data, error } = await this.supabase
      .from('discord_oauth_states')
      .insert(row)
      .select()
      .single();
    if (error) throw error;
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
    if (error) throw error;
    return data ?? null;
  }

  async deleteExpiredStates(before: Date): Promise<number> {
    const { data, error } = await this.supabase
      .from('discord_oauth_states')
      .delete()
      .lt('expires_at', before.toISOString())
      .select('id');
    if (error) throw error;
    return (data ?? []).length;
  }
}
