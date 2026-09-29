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
    if (error) throw error;
    return data ?? null;
  }

  async listByChapter(
    chapterId: string,
  ): Promise<Pick<DiscordAuthorLink, 'discord_user_id' | 'user_id'>[]> {
    const { data, error } = await this.supabase
      .from('discord_author_links')
      .select('discord_user_id, user_id')
      .eq('chapter_id', chapterId);
    if (error) throw error;
    return data ?? [];
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
      if (error.code === '23505') throw new DiscordAuthorLinkConflictError();
      if (error.code === '42501') throw new DiscordAuthorLinkNotMemberError();
      throw error;
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
    if (error) throw error;
    return data ?? null;
  }
}
