import type {
  DiscordConnection,
  DiscordOAuthState,
} from '../entities/discord-connection.entity';

export const DISCORD_CONNECTION_REPOSITORY = 'DISCORD_CONNECTION_REPOSITORY';

export interface UpsertDiscordConnectionInput {
  chapter_id: string;
  guild_id: string;
  guild_name: string | null;
  guild_icon: string | null;
  connected_by: string | null;
  connected_discord_user_id: string | null;
  connected_discord_username: string | null;
  authorizer_permissions: string | null;
  granted_scopes: string | null;
}

/**
 * Persistence for the chapter ↔ Discord guild link and its OAuth handshake.
 *
 * Every read binds `chapter_id`, per the multi-tenancy invariant — scope the
 * query, do not read-then-check. That matters more here than almost anywhere
 * else in the product: the row this returns is what decides which Discord
 * server one shared bot is about to read, so a method that could return
 * another chapter's connection is a cross-tenant data leak with no second line
 * of defence behind it.
 *
 * `consumeState` is the one method that does not take a chapter id, and cannot:
 * Discord's callback arrives with no session and no `x-chapter-id`, so the
 * state row is what *establishes* the chapter rather than something checked
 * against it. It is a uuid primary key minted server-side, it is single-use,
 * and it expires — see the entity.
 */
export interface IDiscordConnectionRepository {
  findByChapter(chapterId: string): Promise<DiscordConnection | null>;

  /**
   * Create or replace this chapter's connection.
   *
   * Upsert on `chapter_id`, because reconnecting is the ordinary repair for
   * every way a connection goes stale — the bot was kicked, the server was
   * migrated, the admin who authorized left. A second row would make "the
   * chapter's guild" ambiguous, and `discord_connections_chapter_unique`
   * rejects one anyway.
   */
  upsert(input: UpsertDiscordConnectionInput): Promise<DiscordConnection>;

  /** Forget this chapter's connection. Returns false when there was none. */
  deleteByChapter(chapterId: string): Promise<boolean>;

  // ── the OAuth handshake ───────────────────────────────────────────────────
  createState(input: {
    chapter_id: string;
    created_by: string | null;
    return_path: string | null;
    expires_at: string;
  }): Promise<DiscordOAuthState>;

  /**
   * Spend a state, or return null.
   *
   * A conditional UPDATE, not a read followed by a write: `consumed_at is null`
   * has to be part of the statement that sets it, or two callbacks racing the
   * same state both see it unspent and both bind a guild. The loser updates
   * zero rows and gets null.
   */
  consumeState(id: string, now: Date): Promise<DiscordOAuthState | null>;

  /** Reap spent and expired handshakes. Returns how many went. */
  deleteExpiredStates(before: Date): Promise<number>;
}
