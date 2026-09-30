import type { DiscordAuthorLink } from '../entities/discord-connection.entity';

export const DISCORD_AUTHOR_LINK_REPOSITORY = 'DISCORD_AUTHOR_LINK_REPOSITORY';

/**
 * Thrown by {@link IDiscordAuthorLinkRepository.link} when the Discord account
 * is already linked to a different member of the chapter
 * (`discord_author_links_chapter_discord_unique`, raised as `23505` by
 * `link_discord_author`). One Discord author is one member.
 */
export class DiscordAuthorLinkConflictError extends Error {
  constructor() {
    super('This Discord account is linked to another member of the chapter.');
    this.name = 'DiscordAuthorLinkConflictError';
  }
}

/**
 * Thrown by {@link IDiscordAuthorLinkRepository.link} when the user is not a
 * member of the chapter (`42501` from `link_discord_author`). The API only
 * links a member whose request is scoped to the chapter, so this means the
 * membership went away between the guard and the write.
 */
export class DiscordAuthorLinkNotMemberError extends Error {
  constructor() {
    super('Only a member of the chapter can link a Discord account in it.');
    this.name = 'DiscordAuthorLinkNotMemberError';
  }
}

export interface LinkedDiscordAuthor {
  discord_user_id: string;
  discord_username: string | null;
  linked_at: string;
  /** How many imported messages the link attached to the member. */
  messages_linked: number;
}

/**
 * Members' own Discord accounts, per chapter (#2878). Every method takes the
 * chapter first and is scoped by it: a link in one chapter must never be
 * readable from, or attach history in, another.
 */
export interface IDiscordAuthorLinkRepository {
  findByChapterAndUser(
    chapterId: string,
    userId: string,
  ): Promise<DiscordAuthorLink | null>;

  /**
   * Link the account and attach the chapter's imported rows by that author, in
   * one transaction (`link_discord_author`). Linking a different account
   * replaces the member's previous link and detaches what it attached.
   */
  link(
    chapterId: string,
    userId: string,
    discordUserId: string,
    discordUsername: string | null,
  ): Promise<LinkedDiscordAuthor>;

  /**
   * Remove the member's link and return their imported rows to the Discord
   * name (`unlink_discord_author`). Resolves to how many rows went back, or
   * null when the member had no link in the chapter.
   */
  unlink(chapterId: string, userId: string): Promise<number | null>;
}
