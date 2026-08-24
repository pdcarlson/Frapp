/**
 * What the API needs from Discord, stated as a port.
 *
 * Two separate interfaces because they authenticate as two different
 * principals and must never be confused for one another:
 *
 *  * {@link IDiscordBotGateway} acts as the **bot**, with the one global
 *    Signet token. It reads history and it is the thing that touches every
 *    connected chapter's data, so every method on it takes an explicitly
 *    authorized guild id and the implementation re-derives the guild from
 *    Discord's own response rather than trusting the caller.
 *  * {@link IDiscordOAuthClient} acts as **the admin who is connecting**, with
 *    a short-lived user access token minted during the handshake. It exists
 *    only to answer "does this human actually run this server?" — a question
 *    the bot token cannot answer about a human.
 *
 * Both live in `domain/` as interfaces so the services stay testable without a
 * network, and both are implemented in `infrastructure/discord/`.
 */

export const DISCORD_BOT_GATEWAY = 'DISCORD_BOT_GATEWAY';
export const DISCORD_OAUTH_CLIENT = 'DISCORD_OAUTH_CLIENT';

/**
 * The permissions the install asks for, as a Discord bitfield.
 *
 * `View Channels` (1 << 10) + `Read Message History` (1 << 16). Nothing else —
 * this bot reads an archive and has no reason to hold a permission that can
 * change anything in a chapter's server. Kept here rather than only in the
 * Developer Portal so the authorize URL and the documented value cannot drift
 * apart silently.
 *
 * **This deliberately omits `Manage Threads` (1 << 34), and that has a visible
 * consequence.** Discord gates `GET /channels/{id}/threads/archived/private`
 * on Manage Threads, so a read-only bot cannot enumerate *private* archived
 * threads and gets a 403 there. The export treats that as a loud, recorded
 * warning naming what was skipped — never as a silent omission — because the
 * alternative is asking every chapter to hand a migration tool a permission
 * that can delete their threads. See `DiscordExportWorkerService`.
 */
export const DISCORD_BOT_PERMISSIONS = '66560';

/** The OAuth scopes the install asks for. */
export const DISCORD_OAUTH_SCOPES = ['bot', 'identify', 'guilds'] as const;

/** Discord's own cap on one `GET /channels/{id}/messages` page. */
export const DISCORD_MESSAGE_PAGE_LIMIT = 100;

/** Thrown when Discord is reachable but refuses what we asked for. */
export class DiscordApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'DiscordApiError';
  }
}

/** Thrown when the integration is not configured in this environment. */
export class DiscordNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiscordNotConfiguredError';
  }
}

/**
 * One channel the bot can read, as Discord reported it.
 *
 * `guildId` is carried explicitly and is **always** the value from Discord's
 * response, never one the caller passed in. It is what the import path
 * compares against the chapter's connection before reading a single message.
 */
export interface DiscordChannelRef {
  id: string;
  name: string;
  guildId: string | null;
  /** Category name for a top-level channel; the parent channel for a thread. */
  categoryName: string | null;
  /** Set only for threads — the channel the thread lives in. */
  parentChannelId: string | null;
  isThread: boolean;
  /**
   * The channel holds no messages of its own, only threads.
   *
   * A forum is the case: every post in it is a thread, and
   * `GET /channels/{id}/messages` answers 400 (`50024`) on the forum itself. It
   * is still offered as a mappable destination — `#questions` is what an admin
   * recognises, and its posts inherit whatever they choose for it — so the
   * export must map it and then skip its own message walk rather than skipping
   * the channel and silently dropping every post inside it.
   */
  holdsOnlyThreads: boolean;
}

/** A role as the guild defines it, for the role worksheet. */
export interface DiscordRoleRef {
  id: string;
  name: string;
}

/**
 * A guild's readable channels, plus whatever could not be enumerated.
 *
 * `warnings` is not decoration: a chapter whose private archived threads were
 * refused has to be told, in the wizard, before it decides the migration is
 * complete.
 */
export interface DiscordChannelDiscovery {
  channels: DiscordChannelRef[];
  warnings: string[];
}

/** An attachment being streamed out of Discord's CDN. */
export interface DiscordAttachmentStream {
  body: ReadableStream<Uint8Array>;
  contentType: string | null;
  /** From the CDN's `Content-Length`, when it sent one. */
  contentLength: number | null;
}

/**
 * The bot's read-only view of a guild.
 *
 * Every method takes `guildId` because every method must be able to prove what
 * it read belongs to the guild the caller was authorized for. The
 * implementation compares Discord's answer against it and throws rather than
 * returning data from elsewhere — one bot process holds read access to every
 * connected chapter at once, so "it returned what I asked for" is not something
 * this layer gets to assume.
 */
export interface IDiscordBotGateway {
  /** False when `DISCORD_BOT_TOKEN` is unset, so callers can 503 cleanly. */
  isConfigured(): boolean;

  /**
   * Every text channel and thread the bot can read in this guild.
   *
   * Threads come back as their own entries with `parentChannelId` set —
   * archived ones included, which is where a chapter's real decisions usually
   * are. Anything Discord refuses is reported in `warnings`, never dropped.
   */
  discoverChannels(guildId: string): Promise<DiscordChannelDiscovery>;

  /** The guild's roles, for the (informational) role worksheet. */
  listRoles(guildId: string): Promise<DiscordRoleRef[]>;

  /**
   * Re-read one channel and confirm it lives in `guildId`.
   *
   * Returns null when the channel is gone or the bot lost access. Throws
   * `DiscordApiError` when the channel exists but belongs to a **different**
   * guild — that is not a missing channel, it is the shared bot being pointed
   * at another tenant, and it must never degrade to a skip.
   */
  verifyChannelInGuild(
    channelId: string,
    guildId: string,
  ): Promise<DiscordChannelRef | null>;

  /**
   * One page of messages, newest first, strictly older than `before`.
   *
   * `before` null starts at the newest message. A page shorter than
   * `DISCORD_MESSAGE_PAGE_LIMIT` means the channel ran out — that is the
   * termination condition, and it is the only reliable one Discord offers.
   *
   * Returns the raw Discord payloads. Mapping them into the shape the importer
   * already speaks is a pure function elsewhere (`discord-api-message.ts`), so
   * that this layer stays "what the network said" and nothing more.
   */
  fetchMessagePage(args: {
    channelId: string;
    guildId: string;
    before: string | null;
    limit?: number;
  }): Promise<unknown[]>;

  /**
   * Open an attachment for streaming out of Discord's CDN.
   *
   * Returns a stream, never bytes: an import runs inside the API process
   * alongside live traffic, and a 100 MB video buffered whole is 100 MB the
   * request path no longer has. Returns null when the object is gone (a
   * deleted attachment is a warning, not a failed import).
   */
  openAttachment(url: string): Promise<DiscordAttachmentStream | null>;
}

/** The guild object Discord returns on a `bot`-scope token exchange. */
export interface DiscordInstalledGuild {
  id: string;
  name: string | null;
  icon: string | null;
}

export interface DiscordTokenExchangeResult {
  accessToken: string;
  scope: string;
  /**
   * The guild the bot was installed into.
   *
   * **This is the authoritative guild id for the whole flow.** Discord also
   * puts `guild_id` on the redirect query string, but that is a value the
   * browser hands us and a caller can write anything there; this one comes
   * back from the token endpoint over a server-to-server call keyed by the
   * one-time code. Null when the user completed an authorize that did not
   * install the bot.
   */
  guild: DiscordInstalledGuild | null;
}

export interface DiscordAuthorizingUser {
  id: string;
  username: string | null;
}

/** One guild from `GET /users/@me/guilds`, under the user's own token. */
export interface DiscordUserGuild {
  id: string;
  name: string | null;
  /** The user's permission bitfield in this guild, as a decimal string. */
  permissions: string;
  owner: boolean;
}

/**
 * The connecting admin's half of the handshake.
 *
 * Exists to answer one question the bot token cannot: *does this human
 * actually run this server?* The answer is read from Discord under the human's
 * own access token, so it cannot be asserted by our client.
 */
export interface IDiscordOAuthClient {
  /** False when the client id/secret are unset in this environment. */
  isConfigured(): boolean;

  /** The `https://discord.com/oauth2/authorize?...` URL to send the admin to. */
  buildAuthorizeUrl(args: { state: string; redirectUri: string }): string;

  /** Trade the one-time code for a user access token and the installed guild. */
  exchangeCode(args: {
    code: string;
    redirectUri: string;
  }): Promise<DiscordTokenExchangeResult>;

  /** Who authorized, under their own token (`identify`). */
  fetchAuthorizingUser(accessToken: string): Promise<DiscordAuthorizingUser>;

  /** The guilds that user is in, with their permissions there (`guilds`). */
  fetchUserGuilds(accessToken: string): Promise<DiscordUserGuild[]>;

  /**
   * Best-effort revoke of the user access token once the handshake is done.
   *
   * The token is needed for two reads and then never again; it is not stored,
   * so this is belt-and-braces rather than the control. Failures are ignored.
   */
  revokeToken(accessToken: string): Promise<void>;
}
