import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DISCORD_BOT_GATEWAY,
  DISCORD_OAUTH_CLIENT,
  DiscordApiError,
  DiscordNotConfiguredError,
  type IDiscordBotGateway,
  type IDiscordOAuthClient,
} from '../../domain/adapters/discord.interface';
import {
  DISCORD_CONNECTION_REPOSITORY,
  type IDiscordConnectionRepository,
} from '../../domain/repositories/discord-connection.repository.interface';
import type { DiscordConnection } from '../../domain/entities/discord-connection.entity';

/**
 * The callback path, fixed in code.
 *
 * Discord matches `redirect_uri` against the Developer Portal's registered list
 * **exactly**, so this string has to be identical in three places: the
 * authorize URL, the token exchange, and the portal. Two of the three are
 * derived from this constant; the third is a human copying `API_URL` + this
 * path once. Anything more configurable turns a one-time paste into a
 * `redirect_uri mismatch` nobody can debug from the error alone.
 */
export const DISCORD_CALLBACK_PATH = '/v1/discord/connect/callback';

/**
 * How long an admin has to finish the Discord consent screen.
 *
 * Long enough to read it, pick a server, and get through 2FA; short enough that
 * a state left in a closed tab is not a standing capability to bind a guild
 * onto a chapter.
 */
export const OAUTH_STATE_TTL_MS = 15 * 60_000;

/** Where the browser lands when the flow ends and nothing said otherwise. */
export const DEFAULT_RETURN_PATH = '/discord-import';

/**
 * Guild permissions that count as "runs this server".
 *
 * `Manage Server` (1 << 5) or `Administrator` (1 << 3). BigInt throughout,
 * never Number: Discord's bitfield exceeds 2^53 (the newest flags are past bit
 * 53), so `parseInt` on it silently drops the high bits — and a permission
 * check decided by a rounded float is not a permission check.
 */
const MANAGE_GUILD = 1n << 5n;
const ADMINISTRATOR = 1n << 3n;

export interface DiscordConnectionView {
  connected: boolean;
  guild_id: string | null;
  guild_name: string | null;
  connected_at: string | null;
  connected_discord_username: string | null;
}

/**
 * Why a connect attempt ended the way it did, as a closed set of codes.
 *
 * The callback redirects the browser to the dashboard with one of these on the
 * query string, and the dashboard owns the sentence for each. Deliberately NOT
 * the error text: `error_description` is a string Discord (or anyone who can
 * aim a browser at the callback) chooses, and a dashboard that renders
 * arbitrary supplied text in its own chrome is a phishing surface even when
 * the framework escapes it. A code cannot say anything we did not write.
 */
export type DiscordConnectCode =
  | 'connected'
  /** State missing, malformed, expired, or already spent. */
  | 'expired'
  /** The admin pressed Cancel on Discord's consent screen. */
  | 'declined'
  /** Discord came back without a usable authorization code. */
  | 'invalid'
  /** Authorized, but no server was chosen, so the bot joined nothing. */
  | 'no_guild'
  /** The authorizing account is not in the server the bot joined. */
  | 'not_member'
  /** The authorizing account lacks Manage Server there. */
  | 'no_permission'
  /** Anything else — logged in full, reported generically. */
  | 'failed';

/** What the callback tells the browser, plus what we log about it. */
export interface DiscordCallbackOutcome {
  ok: boolean;
  code: DiscordConnectCode;
  returnUrl: string;
  /** Operator-facing detail. Never placed on the redirect URL. */
  reason: string;
}

/**
 * A connect failure with a code attached.
 *
 * Not a `BadRequestException`: nothing here is answering an HTTP request that
 * wants a 400. The callback always ends in a redirect, so a failure has to
 * carry the code that decides which sentence the wizard shows.
 */
class DiscordConnectFailure extends Error {
  constructor(
    readonly code: DiscordConnectCode,
    message: string,
  ) {
    super(message);
    this.name = 'DiscordConnectFailure';
  }
}

/**
 * The "Connect Discord" handshake.
 *
 * This is the file that decides which Discord server one shared bot may read on
 * a chapter's behalf, so the rule it is built around is worth stating up front:
 * **nothing the browser sends is trusted except the opaque `code` and
 * `state`.**
 *
 * Discord puts `guild_id` on the callback query string. It is ignored. The
 * guild this flow binds comes back on the **token exchange** — a
 * server-to-server call keyed by a one-time code — and the authorizing human's
 * permission on it is read from `GET /users/@me/guilds` under that human's own
 * access token. A caller who forges a callback controls neither.
 *
 * That is the same class of bug #1242's review caught on `target_channel_id`:
 * a client-supplied id that reaches a write without being resolved through
 * something the server already trusts. Here the trusted thing is Discord's own
 * answer, and the chapter comes from a single-use state row rather than from a
 * header the callback does not even carry.
 */
@Injectable()
export class DiscordOAuthService {
  private readonly logger = new Logger(DiscordOAuthService.name);
  private readonly apiUrl: string | null;
  private readonly appUrl: string | null;

  constructor(
    @Inject(DISCORD_CONNECTION_REPOSITORY)
    private readonly connectionRepo: IDiscordConnectionRepository,
    @Inject(DISCORD_OAUTH_CLIENT)
    private readonly oauth: IDiscordOAuthClient,
    @Inject(DISCORD_BOT_GATEWAY)
    private readonly bot: IDiscordBotGateway,
    config: ConfigService,
  ) {
    this.apiUrl = normaliseOrigin(config.get<string>('API_URL'));
    this.appUrl = normaliseOrigin(config.get<string>('APP_URL'));
  }

  /**
   * Whether this environment can run the flow at all.
   *
   * All four are required and none is optional-with-a-degraded-mode: without
   * `API_URL` there is no redirect URI to register, and without `APP_URL` the
   * callback has nowhere to send the browser back to. Reporting that as
   * "unavailable" is honest; half-running it would strand an admin on a blank
   * page at Discord.
   */
  isAvailable(): boolean {
    return (
      this.oauth.isConfigured() &&
      this.bot.isConfigured() &&
      this.apiUrl !== null &&
      this.appUrl !== null
    );
  }

  private assertAvailable(): void {
    if (!this.isAvailable()) {
      throw new ServiceUnavailableException(
        'Connecting Discord is not configured in this environment. The DiscordChatExporter upload flow still works.',
      );
    }
  }

  private redirectUri(): string {
    return `${this.apiUrl as string}${DISCORD_CALLBACK_PATH}`;
  }

  async getConnection(chapterId: string): Promise<DiscordConnectionView> {
    const connection = await this.connectionRepo.findByChapter(chapterId);
    if (!connection) {
      return {
        connected: false,
        guild_id: null,
        guild_name: null,
        connected_at: null,
        connected_discord_username: null,
      };
    }
    return {
      connected: true,
      guild_id: connection.guild_id,
      guild_name: connection.guild_name,
      connected_at: connection.created_at,
      connected_discord_username: connection.connected_discord_username,
    };
  }

  /**
   * Start the handshake: mint a single-use state and hand back the URL.
   *
   * The state row is created *before* the URL is returned, so a callback can
   * never arrive for a handshake the database has not heard of.
   */
  async beginConnect(
    chapterId: string,
    userId: string,
    returnPath: string | null,
  ): Promise<{ authorize_url: string; expires_at: string }> {
    this.assertAvailable();

    const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MS);
    const state = await this.connectionRepo.createState({
      chapter_id: chapterId,
      created_by: userId,
      // Sanitised here rather than on the way out. The callback has no session
      // to re-authorise against, so whatever is stored is what the browser will
      // be sent to — validating at write time is the only place it can be done
      // once and be true forever after.
      return_path: safeReturnPath(returnPath),
      expires_at: expiresAt.toISOString(),
    });

    return {
      authorize_url: this.oauth.buildAuthorizeUrl({
        state: state.id,
        redirectUri: this.redirectUri(),
      }),
      expires_at: state.expires_at,
    };
  }

  /**
   * Finish the handshake.
   *
   * Returns where to send the browser rather than throwing, because the caller
   * is a top-level redirect from Discord: an admin who denied consent, or whose
   * state expired in a forgotten tab, must land back in the wizard with a
   * sentence — not on a JSON error body.
   *
   * The order of checks is deliberate. State first (it names the chapter, and
   * nothing else can be scoped without it), then the exchange, then the guild,
   * then the human's permission on that guild. Every one of them can fail the
   * flow, and none of them is skippable by anything the browser sends.
   */
  async handleCallback(query: {
    code?: string;
    state?: string;
    error?: string;
    error_description?: string;
  }): Promise<DiscordCallbackOutcome> {
    // The state is spent even when Discord reports a denial, so a cancelled
    // attempt cannot be replayed later with a code obtained some other way.
    const stateId = typeof query.state === 'string' ? query.state : '';
    const consumed = isUuid(stateId)
      ? await this.connectionRepo.consumeState(stateId, new Date())
      : null;

    const finish = (
      code: DiscordConnectCode,
      reason: string,
    ): DiscordCallbackOutcome => ({
      ok: code === 'connected',
      code,
      returnUrl: this.buildReturnUrl(consumed?.return_path ?? null, code),
      reason,
    });

    if (!consumed) {
      return finish(
        'expired',
        'No live handshake matched the state on the callback.',
      );
    }

    if (query.error) {
      // `error_description` is logged and goes no further — see
      // `DiscordConnectCode`.
      this.logger.log(
        `Discord connect declined for chapter ${consumed.chapter_id}: ${query.error} ${query.error_description ?? ''}`.trim(),
      );
      return finish(
        query.error === 'access_denied' ? 'declined' : 'failed',
        `Discord returned error=${query.error}`,
      );
    }

    if (typeof query.code !== 'string' || query.code.length === 0) {
      return finish('invalid', 'Discord sent no authorization code.');
    }

    try {
      const connection = await this.completeConnection(
        consumed.chapter_id,
        consumed.created_by,
        query.code,
      );
      this.logger.log(
        `Chapter ${consumed.chapter_id} connected Discord guild ${connection.guild_id}.`,
      );
      return finish('connected', 'Connected.');
    } catch (error) {
      if (error instanceof DiscordConnectFailure) {
        this.logger.log(
          `Discord connect refused for chapter ${consumed.chapter_id}: ${error.code} — ${error.message}`,
        );
        return finish(error.code, error.message);
      }
      if (
        error instanceof DiscordApiError ||
        error instanceof DiscordNotConfiguredError
      ) {
        this.logger.warn(
          `Discord connect failed for chapter ${consumed.chapter_id}: ${error.message}`,
        );
        return finish('failed', error.message);
      }
      this.logger.error(
        `Discord connect failed for chapter ${consumed.chapter_id}`,
        error instanceof Error ? error.stack : undefined,
      );
      return finish('failed', 'Unexpected error.');
    }
  }

  /**
   * Everything between "we have a valid code for a known chapter" and "the row
   * exists", with the two authorization facts read from Discord in between.
   */
  private async completeConnection(
    chapterId: string,
    userId: string | null,
    code: string,
  ): Promise<DiscordConnection> {
    const token = await this.oauth.exchangeCode({
      code,
      redirectUri: this.redirectUri(),
    });

    try {
      // FACT 1: which guild the bot was actually installed into. From the token
      // response, not from `?guild_id=` on the redirect — the query string is
      // the browser's word for it and the browser is the untrusted party here.
      const guild = token.guild;
      if (!guild?.id) {
        throw new DiscordConnectFailure(
          'no_guild',
          'The token exchange carried no guild, so the bot was not installed anywhere.',
        );
      }

      // FACT 2: that the human who authorized actually runs that server, read
      // under their own access token. Without this, anyone who can reach the
      // authorize URL for a chapter could attach a server they merely belong
      // to — and from then on one shared bot would be reading a Discord
      // community that never agreed to be read.
      const authorizingUser = await this.oauth.fetchAuthorizingUser(
        token.accessToken,
      );
      const userGuilds = await this.oauth.fetchUserGuilds(token.accessToken);
      const membership = userGuilds.find((entry) => entry.id === guild.id);

      if (!membership) {
        throw new DiscordConnectFailure(
          'not_member',
          `Authorizing Discord user ${authorizingUser.id} is not a member of guild ${guild.id}.`,
        );
      }
      if (!hasManageGuild(membership)) {
        throw new DiscordConnectFailure(
          'no_permission',
          `Authorizing Discord user ${authorizingUser.id} holds permissions ${membership.permissions} in guild ${guild.id}, which does not include Manage Server or Administrator.`,
        );
      }

      return await this.connectionRepo.upsert({
        chapter_id: chapterId,
        guild_id: guild.id,
        guild_name: guild.name ?? membership.name,
        guild_icon: guild.icon,
        connected_by: userId,
        connected_discord_user_id: authorizingUser.id,
        connected_discord_username: authorizingUser.username,
        authorizer_permissions: membership.permissions,
        granted_scopes: token.scope,
      });
    } finally {
      // The user token bought two reads and is never needed again. Not stored,
      // so this is hygiene rather than the control — but a token that outlives
      // its purpose is a token somebody eventually finds a use for.
      await this.oauth.revokeToken(token.accessToken).catch(() => undefined);
    }
  }

  /** Forget a chapter's connection. Imports already run keep their history. */
  async disconnect(chapterId: string): Promise<{ disconnected: boolean }> {
    const disconnected = await this.connectionRepo.deleteByChapter(chapterId);
    return { disconnected };
  }

  /**
   * The chapter's guild id, or a refusal.
   *
   * **The only supported way to learn which guild a chapter may read.** Every
   * caller goes through here, scoped by `chapter_id`, so there is no path in
   * the product where a guild id supplied by a client reaches Discord.
   */
  async requireGuildId(chapterId: string): Promise<string> {
    const connection = await this.connectionRepo.findByChapter(chapterId);
    if (!connection) {
      throw new BadRequestException(
        'This chapter has not connected a Discord server yet.',
      );
    }
    return connection.guild_id;
  }

  /**
   * Where the browser goes next.
   *
   * `returnPath` was sanitised at write time (`safeReturnPath`), and it is
   * resolved against the CONFIGURED app origin rather than anything on the
   * request — so even a stored value that somehow got past validation cannot
   * send the browser off-origin.
   */
  private buildReturnUrl(
    returnPath: string | null,
    code: DiscordConnectCode,
  ): string {
    const origin = this.appUrl ?? 'http://localhost';
    const url = new URL(safeReturnPath(returnPath), origin);
    url.searchParams.set('discord', code);
    return url.toString();
  }
}

function hasManageGuild(membership: {
  permissions: string;
  owner: boolean;
}): boolean {
  if (membership.owner) return true;
  let bits: bigint;
  try {
    bits = BigInt(membership.permissions);
  } catch {
    // An unparseable bitfield is not "no permissions we can see"; it is an
    // answer we did not understand, and the safe reading of an answer we did
    // not understand is "no".
    return false;
  }
  return (bits & (MANAGE_GUILD | ADMINISTRATOR)) !== 0n;
}

/**
 * Reduce a caller-supplied return path to something that cannot leave the app.
 *
 * The callback redirects the browser to whatever this returned, with no session
 * in play, so an unchecked value is a textbook open redirect — and one hanging
 * off an OAuth callback is exactly the shape a phishing flow wants.
 *
 * Rejects anything that is not a single-slash-rooted relative path.
 * `//evil.com` and `/\evil.com` are the two that look relative and are not:
 * browsers read both as protocol-relative and follow them off-origin.
 */
export function safeReturnPath(input: string | null | undefined): string {
  if (typeof input !== 'string' || input.length === 0) {
    return DEFAULT_RETURN_PATH;
  }
  if (!input.startsWith('/')) return DEFAULT_RETURN_PATH;
  if (input.startsWith('//') || input.startsWith('/\\')) {
    return DEFAULT_RETURN_PATH;
  }
  // A control character can be DELETED by the URL parser mid-parse (it strips
  // tab, LF and CR before resolving), so the string the browser follows is not
  // the string that was checked. Same reasoning as `isUnsafeStoragePath`:
  // reject the characters rather than chase the spellings.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(input)) return DEFAULT_RETURN_PATH;
  return input;
}

function normaliseOrigin(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, '');
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
