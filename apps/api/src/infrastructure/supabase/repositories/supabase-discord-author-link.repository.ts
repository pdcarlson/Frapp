import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient } from '../database.types';
import {
  DiscordAuthorLinkConflictError,
  DiscordAuthorLinkNotMemberError,
  type IDiscordAuthorLinkRepository,
  type LinkedDiscordAuthor,
} from '#domain/repositories/discord-author-link.repository.interface';
import type { DiscordAuthorLink } from '#domain/entities/discord-connection.entity';
import { PG_UNIQUE_VIOLATION } from '#domain/constants/postgres-error-codes';
import { SupabaseQueryError } from '../supabase-query-error';

/**
 * `discord_author_links` (#2878). RLS is on with no policies, so this service-
 * role client is the only reader; every query here carries the chapter.
 *
 * The writes are RPCs rather than table writes because each one changes the
 * link and the `chat_messages` rows it attributes together: a link without its
 * history attached, or history attached to a link that failed, must never be
 * visible. See `20260929230000_discord_author_links.sql`.
 */
@Injectable()
export class SupabaseDiscordAuthorLinkRepository implements IDiscordAuthorLinkRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findByChapterAndUser(
    chapterId: string,
    userId: string,
  ): Promise<DiscordAuthorLink | null> {
    const { data, error } = await this.supabase
      .from('discord_author_links')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data ?? null;
  }

  async link(
    chapterId: string,
    userId: string,
    discordUserId: string,
    discordUsername: string | null,
  ): Promise<LinkedDiscordAuthor> {
    const { data, error } = await this.supabase.rpc('link_discord_author', {
      p_chapter_id: chapterId,
      p_user_id: userId,
      p_discord_user_id: discordUserId,
      p_discord_username: discordUsername,
    });
    if (error) {
      // Only the function's own refusals, which it prefixes with its name. A
      // bare 42501 is also what a missing EXECUTE grant raises, and that is a
      // deployment fault to surface as a 500, not a member-facing 403.
      const ours =
        typeof error.message === 'string' &&
        error.message.startsWith('link_discord_author:');
      if (ours && error.code === PG_UNIQUE_VIOLATION) {
        throw new DiscordAuthorLinkConflictError();
      }
      if (ours && error.code === '42501') {
        throw new DiscordAuthorLinkNotMemberError();
      }
      throw new SupabaseQueryError(error);
    }
    const row = (data ?? [])[0];
    if (!row) {
      // `returns table` with one `return query` row: an empty answer is a
      // function that did not run to the end, not a link that half-happened.
      throw new Error('link_discord_author returned no row.');
    }
    return row;
  }

  async unlink(chapterId: string, userId: string): Promise<number | null> {
    const { data, error } = await this.supabase.rpc('unlink_discord_author', {
      p_chapter_id: chapterId,
      p_user_id: userId,
    });
    if (error) throw new SupabaseQueryError(error);
    return data ?? null;
  }
}
