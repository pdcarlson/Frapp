/**
 * A chapter's link to the Discord server it imports from.
 *
 * This row is the **entire** per-chapter side of the bot integration, and it
 * holds no secret. The bot token is one global Frapp value in Infisical
 * (`DISCORD_BOT_TOKEN`, same shape as the Stripe keys — one per environment,
 * not one per tenant); what a chapter contributes is a guild id, which is a
 * public snowflake and does nothing on its own, because the bot only answers
 * for a guild it was actually installed into.
 *
 * **It is written in exactly one place** — the OAuth callback — and only after
 * Discord itself has confirmed two independent facts:
 *
 *  1. the bot was installed into that guild (the `guild` object arrives on the
 *     token exchange, not from the redirect's query string), and
 *  2. the human who authorized holds Manage Server or Administrator on it,
 *     read from `GET /users/@me/guilds` under their own access token.
 *
 * Neither fact is taken from the browser. See `DiscordOAuthService`.
 */
export interface DiscordConnection {
  id: string;
  chapter_id: string;
  /**
   * Always text, never a number. Snowflakes run to 20 digits, exceed 2^53, and
   * a JSON round trip through a JavaScript number silently rewrites the low
   * bits — which for a guild id means a *different guild*.
   */
  guild_id: string;
  guild_name: string | null;
  guild_icon: string | null;
  connected_by: string | null;
  connected_discord_user_id: string | null;
  connected_discord_username: string | null;
  /**
   * The guild permission bitfield the authorizing user held at connect time,
   * as a decimal string.
   *
   * Audit trail only. **Never re-read as an authorization** — permission was
   * checked once, at connect, against Discord's own answer, and a stored copy
   * of a bitfield is a record of a past check, not a current one.
   */
  authorizer_permissions: string | null;
  granted_scopes: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * `connect`: an officer installing the bot into the chapter's server.
 * `author_link`: a member proving which Discord account is theirs (#2878).
 */
export type DiscordOAuthPurpose = 'connect' | 'author_link';

/**
 * A pending OAuth handshake.
 *
 * Discord's callback is an unauthenticated top-level browser redirect — no
 * session, no bearer token, no `x-chapter-id` — so the `state` parameter is the
 * only thing that can name the chapter, and therefore the only thing standing
 * between a stray callback and a guild landing on the wrong chapter.
 *
 * Consumed with a conditional UPDATE, which is what makes it single-use: the
 * loser of a replay updates zero rows and is refused.
 */
export interface DiscordOAuthState {
  /** The state value itself — a server-minted v4 uuid, never caller-derived. */
  id: string;
  chapter_id: string;
  /**
   * Which flow minted the handshake. Both share the one callback URL, because
   * Discord only redirects to URIs registered by hand in its Developer Portal;
   * the callback dispatches on this, and each confirm consumes only its own
   * purpose, so a member's link handshake can never activate a guild
   * connection or the other way round (`20260929230000_discord_author_links.sql`).
   */
  purpose: DiscordOAuthPurpose;
  created_by: string | null;
  /**
   * Where to send the browser afterwards.
   *
   * Reduced to a site-relative path before it is stored (`safeReturnPath` —
   * a leading single slash, no `//` or `/\\`, no control characters), and then
   * resolved against the CONFIGURED app origin at redirect time. Both halves
   * matter and neither is "validation against the origin": the stored value is
   * never compared to `APP_URL`, it is simply incapable of naming another one.
   */
  return_path: string | null;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;

  // ── the pending connection ────────────────────────────────────────────────
  //
  // Written by the callback from Discord's own answers, never from the browser.
  // The callback does NOT create `discord_connections`; it parks what it learned
  // here and hands the browser a confirm token, because the two facts Discord
  // proves ("a Manage Server human installed the bot into guild G") do not
  // include the one that matters ("that human meant chapter X to read it").
  // See the migration `20260824150000_discord_connect_confirm.sql`.
  pending_guild_id: string | null;
  pending_guild_name: string | null;
  pending_guild_icon: string | null;
  pending_discord_user_id: string | null;
  pending_discord_username: string | null;
  pending_permissions: string | null;
  pending_scopes: string | null;

  /**
   * The one-time secret that activates the pending connection.
   *
   * A **second** secret, not the state re-used. The state is known to whoever
   * started the flow — which, in the attack this closes, is the attacker. This
   * one is minted after the callback and delivered to exactly one place: the
   * query string of the redirect the browser that completed OAuth follows.
   */
  confirm_token: string | null;
  /** Much shorter than the handshake's — the browser follows the redirect at once. */
  confirm_expires_at: string | null;
  /** Set when activated. Non-null means spent; a replayed confirm gets nothing. */
  confirmed_at: string | null;
}

/**
 * A member's own Discord account, linked in one chapter (#2878).
 *
 * The member proved the account with Discord OAuth (`identify`), so no officer
 * ever asserts it. Linking sets `chat_messages.sender_id` to `user_id` on the
 * chapter's imported rows whose `author_external_id` is `discord_user_id`, and
 * unlinking clears it again; both run in `link_discord_author` /
 * `unlink_discord_author`, and rows imported later attach through a trigger.
 *
 * Unique on `(chapter_id, discord_user_id)` and `(chapter_id, user_id)`, and
 * never global: a link in one chapter says nothing to another.
 */
export interface DiscordAuthorLink {
  id: string;
  chapter_id: string;
  /** Snowflake as text: it exceeds 2^53. */
  discord_user_id: string;
  user_id: string;
  /** What Discord called the account when it was linked. Display only. */
  discord_username: string | null;
  linked_at: string;
}
