/**
 * A chapter's link to the Discord server it imports from.
 *
 * This row is the **entire** per-chapter side of the bot integration, and it
 * holds no secret. The bot token is one global Signet value in Infisical
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
}
