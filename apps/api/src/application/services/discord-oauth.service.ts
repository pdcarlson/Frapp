import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import { randomUUID } from 'node:crypto';
import { logSafe } from '../../infrastructure/observability/log-safe';
import {
  DISCORD_BOT_GATEWAY,
  DISCORD_OAUTH_CLIENT,
  DiscordApiError,
  DiscordNotConfiguredError,
  type IDiscordBotGateway,
  type IDiscordOAuthClient,
} from '#domain/adapters/discord.interface';
import {
  DISCORD_CONNECTION_REPOSITORY,
  type IDiscordConnectionRepository,
} from '#domain/repositories/discord-connection.repository.interface';
import type { DiscordOAuthState } from '#domain/entities/discord-connection.entity';
import { toReportableError } from '../../infrastructure/observability/reportable-error';

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
 * How long the browser has to activate what the callback parked.
 *
 * Far shorter than the handshake's 15 minutes, because it covers a redirect the
 * browser follows immediately rather than a human reading a consent screen.
 * Anything longer leaves a pending guild activatable for no reason.
 */
export const CONFIRM_TOKEN_TTL_MS = 5 * 60_000;

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

/**
 * What to hand `Logger.error` as its second argument.
 *
 * The reasoning that put a helper here was right and is preserved in
 * `toReportableError`: `error instanceof Error ? error.stack : undefined` is
 * silently `undefined` for **every** error PostgREST actually produces, because
 * postgrest-js only builds a real `PostgrestError` under `shouldThrowOnError`
 * — which nothing here sets — so the client hands back the parsed body and the
 * repositories rethrow that plain object verbatim. `String(error)` is no better:
 * on a plain object it prints `[object Object]`.
 *
 * It delegates now because the same defect blinds every 5xx the API raises, not
 * just this route, so the fix belongs at the reporting seam rather than in one
 * service. `hint` — the field that says *"Perhaps you meant the table
 * public.discord_oauth_states"*, i.e. the answer — still survives.
 *
 * The one behavior that changed in moving: `details` is no longer included.
 * That is the field Postgres fills with the offending ROW VALUES, and it was
 * reaching Sentry through `captureSwallowed` below. See `reportable-error.ts`
 * for why the free-text scrubber is not a sufficient answer for it.
 */
function describeError(error: unknown): string {
  const reportable = toReportableError(error);
  return reportable.stack ?? reportable.message;
}

/**
 * Report a failure this method deliberately swallows.
 *
 * Every `Sentry.captureException` in the API today sits in
 * `AllExceptionsFilter`, gated on `status >= 500` — so alerting is coupled to
 * the user seeing an error page. That coupling is exactly what broke here:
 * turning the raw 500 into a redirect is right for the admin and, on its own,
 * silently deletes the only signal an operator had. The 5xx rate goes flat and
 * Sentry stays empty while 100% of Discord connects fail.
 *
 * So a swallowed failure has to report itself. `new Error(String(error))` would
 * not do — on the plain object PostgREST throws, `String` yields
 * `[object Object]` — hence the shared normalizer here too, which is the same
 * one `AllExceptionsFilter` reports every other 5xx through.
 */
function captureSwallowed(
  error: unknown,
  sweptUnder: DiscordConnectCode,
): void {
  Sentry.captureException(toReportableError(error), {
    tags: {
      route: 'discord/connect/callback',
      swallowed_as: sweptUnder,
    },
  });
}

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
  /**
   * The callback succeeded and parked a guild; the dashboard must now confirm
   * it from an authenticated session scoped to the right chapter.
   */
  | 'pending'
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
    //
    // Wrapped, because this method's whole contract is that it RETURNS where to
    // send the browser rather than throwing — the caller is a top-level
    // redirect from Discord, and an admin mid-connect must land back in the
    // wizard with a sentence, never on a JSON 500. Before this, the very first
    // thing the method did could throw straight past that contract: any
    // repository failure here — a transient PostgREST error, an exhausted pool,
    // or a migration not yet promoted to the environment — escaped as a raw
    // 500 to a browser that had just completed an OAuth handshake.
    //
    // Found on deployed staging, not in a test: every spec here mocks the
    // repository, and a mock that resolves never exercises the path where it
    // rejects.
    const stateId = typeof query.state === 'string' ? query.state : '';
    let consumed: DiscordOAuthState | null = null;
    if (isUuid(stateId)) {
      try {
        consumed = await this.connectionRepo.consumeState(stateId, new Date());
      } catch (error) {
        // `failed`, NOT `expired`, and the distinction is the admin's whole
        // afternoon. `expired` renders as "that link had expired or was already
        // used — start the connection again", which is false twice over: the
        // consuming UPDATE never committed, so the state is neither spent nor
        // out of time, and starting again is the one recovery that cannot work
        // while the store is down. `failed` says "could not complete the
        // Discord connection, please try again", which is true, and is already
        // what an unexpected rejection from `attachPendingConnection` — the
        // same table, forty lines down — returns. This was the odd one out.
        //
        // Both the code and the `buildReturnUrl` argument have to change: the
        // controller returns only `returnUrl`, so the query-string code that
        // the dashboard actually reads is the one stamped here.
        //
        // No state-existence oracle is opened by telling the two apart.
        // `consumeState` is a primary-key conditional UPDATE read with
        // `maybeSingle()`: a zero-row match is a SUCCESS returning null, never
        // a rejection. So this branch is a function of store health alone and
        // fires identically for every state id — live, spent, expired or
        // fabricated. The collapse that does matter (nonexistent vs. spent vs.
        // expired, all answering `expired`) lives inside `consumeState` and is
        // untouched.
        // The state id is deliberately NOT in this message (#1260). It is the
        // CSRF token itself, and on this branch it is *live*: the conditional
        // UPDATE never committed, so the row stays `consumed_at IS NULL` for
        // the balance of its TTL. Logging it here would put an unspent
        // handshake id into the application log stream — the same stream, at
        // the same `error` level, that this issue's request-path fix drains.
        //
        // It costs nothing diagnostically. As the comment above says, this
        // branch is a function of store health alone and fires identically for
        // every state id; `describeError` plus the request id already identify
        // the event, and the id would only distinguish handshakes in an
        // outage that by construction affects all of them.
        this.logger.error(
          'Could not consume Discord OAuth state',
          describeError(error),
        );
        captureSwallowed(error, 'failed');
        return {
          ok: false,
          code: 'failed',
          returnUrl: this.buildReturnUrl(null, 'failed'),
          reason: 'The handshake store could not be reached.',
        };
      }
    }

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
      //
      // Both values come off the callback's query string, which is public and
      // unauthenticated, so they are attacker-chosen. A record is one line, so
      // an unescaped newline here would let a caller write an extra line of
      // their choosing into the stream an incident investigation reads
      // (#1260). `logSafe` strips control characters and caps length.
      this.logger.log(
        `Discord connect declined for chapter ${consumed.chapter_id}: ${logSafe(query.error)} ${logSafe(query.error_description)}`.trim(),
      );
      // Express's query parser yields an ARRAY for a repeated key, so
      // `?error=a&error=b` arrives as `['a','b']` despite the `string`
      // annotation, and comparing that to a string is silently `false`. A
      // cancelled connect then reported `failed`, and the wizard showed "could
      // not complete the Discord connection" instead of the cancel sentence.
      // First value wins, which is what a single-valued parameter means.
      const errorCode: string = Array.isArray(query.error)
        ? String(query.error[0])
        : query.error;
      return finish(
        errorCode === 'access_denied' ? 'declined' : 'failed',
        `Discord returned error=${query.error}`,
      );
    }

    if (typeof query.code !== 'string' || query.code.length === 0) {
      return finish('invalid', 'Discord sent no authorization code.');
    }

    try {
      const confirmToken = await this.parkConnection(consumed.id, query.code);
      this.logger.log(
        `Chapter ${consumed.chapter_id} has a Discord guild awaiting confirmation.`,
      );
      // `pending`, not `connected`. Nothing is bound yet — the dashboard has to
      // present the confirm token from a session whose chapter matches, which
      // is the whole control.
      return {
        ok: true,
        code: 'pending',
        returnUrl: this.buildReturnUrl(
          consumed.return_path ?? null,
          'pending',
          confirmToken,
        ),
        reason: 'Awaiting confirmation.',
      };
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
        describeError(error),
      );
      // Same gap, pre-dating the one above: this arm already swallowed an
      // unexpected failure into a redirect, so it already had no alerting.
      captureSwallowed(error, 'failed');
      return finish('failed', 'Unexpected error.');
    }
  }

  /**
   * Everything between "we have a valid code for a known handshake" and "a
   * pending guild is parked", with the two authorization facts read from
   * Discord in between.
   *
   * **Deliberately does not write `discord_connections`.** What Discord proves
   * here is that a human with Manage Server installed the bot into a guild — not
   * that they meant THIS chapter to read it, and the chapter came from a state
   * that any `channels:manage` holder in any tenant can mint. Binding on those
   * two facts alone let an attacker send their own authorize URL to somebody
   * else's Discord admin and read that server into their own chapter. See
   * `confirmConnection`.
   */
  private async parkConnection(stateId: string, code: string): Promise<string> {
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

      const confirmToken = randomUUID();
      const parked = await this.connectionRepo.attachPendingConnection(
        stateId,
        {
          guild_id: guild.id,
          guild_name: guild.name ?? membership.name,
          guild_icon: guild.icon,
          discord_user_id: authorizingUser.id,
          discord_username: authorizingUser.username,
          permissions: membership.permissions,
          scopes: token.scope,
          confirm_token: confirmToken,
          confirm_expires_at: new Date(
            Date.now() + CONFIRM_TOKEN_TTL_MS,
          ).toISOString(),
        },
      );
      if (!parked) {
        // No state id in this message: it is caught below and interpolated
        // into a `logger.log` line, so an id here reaches the application log
        // stream by a second route (#1260). The chapter id in that line is
        // what identifies the event; the handshake id is the credential.
        throw new DiscordConnectFailure(
          'expired',
          'Handshake could not be parked; it already carries a pending connection.',
        );
      }
      return confirmToken;
    } finally {
      // The user token bought two reads and is never needed again. Not stored,
      // so this is hygiene rather than the control — but a token that outlives
      // its purpose is a token somebody eventually finds a use for.
      await this.oauth.revokeToken(token.accessToken).catch(() => undefined);
    }
  }

  /**
   * Activate what the callback parked — the step that makes the flow safe.
   *
   * Three things must line up, and the third is the one that closes the hole:
   *
   *  1. the confirm token, which went to exactly one place — the query string
   *     of the redirect the browser that completed the OAuth followed;
   *  2. an authenticated caller with `channels:manage`, enforced by the guard
   *     chain on the route; and
   *  3. **that caller's active chapter matching the chapter the pending row
   *     names**, enforced inside the conditional UPDATE.
   *
   * Replay the attack against it. The attacker mints a state for their own
   * chapter and sends the authorize URL to an admin of somebody else's Discord
   * server. That admin authorizes; the callback parks (attacker's chapter,
   * victim's guild) and hands the confirm token to the VICTIM's browser. The
   * attacker never sees it and cannot guess it. The victim's browser does
   * present it — against the victim's own session, whose chapter is not the
   * attacker's — so condition 3 fails and nothing is written.
   *
   * For a legitimate admin nothing is asked: they started the flow in their own
   * chapter, so their session and the pending row agree, and the dashboard
   * confirms on arrival.
   */
  async confirmConnection(
    chapterId: string,
    userId: string,
    handshake: string,
  ): Promise<DiscordConnectionView> {
    this.assertAvailable();

    if (!isUuid(handshake)) {
      throw new BadRequestException(
        'That Discord confirmation link is not valid. Start the connection again.',
      );
    }

    const pending = await this.connectionRepo.consumeConfirmToken(
      handshake,
      chapterId,
      new Date(),
    );
    if (!pending?.pending_guild_id) {
      // One message for every way this fails — wrong chapter, expired, already
      // spent, never parked. Distinguishing them would tell a caller which of
      // those it was, and "wrong chapter" is precisely the answer an attacker
      // probing with a stolen token wants.
      throw new BadRequestException(
        'That Discord confirmation has expired or does not belong to this chapter. Start the connection again.',
      );
    }

    const connection = await this.connectionRepo.upsert({
      chapter_id: chapterId,
      guild_id: pending.pending_guild_id,
      guild_name: pending.pending_guild_name,
      guild_icon: pending.pending_guild_icon,
      // The Signet user who CONFIRMED, which is the one we can actually
      // attribute: `created_by` on the state is whoever started the handshake,
      // and this step exists precisely because those need not be the same
      // person.
      connected_by: userId,
      connected_discord_user_id: pending.pending_discord_user_id,
      connected_discord_username: pending.pending_discord_username,
      authorizer_permissions: pending.pending_permissions,
      granted_scopes: pending.pending_scopes,
    });

    this.logger.log(
      `Chapter ${chapterId} confirmed Discord guild ${connection.guild_id}.`,
    );
    return {
      connected: true,
      guild_id: connection.guild_id,
      guild_name: connection.guild_name,
      connected_at: connection.created_at,
      connected_discord_username: connection.connected_discord_username,
    };
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
    confirmToken?: string,
  ): string {
    const origin = this.appUrl ?? 'http://localhost';
    const url = new URL(safeReturnPath(returnPath), origin);
    url.searchParams.set('discord', code);
    // The confirm token rides the redirect, which is the ONLY place it is ever
    // delivered — to the browser that completed the OAuth, and to nothing else.
    // It is safe on a URL for the same reason an OAuth code is: single-use,
    // short-lived, and useless without a session whose chapter matches.
    if (confirmToken) url.searchParams.set('handshake', confirmToken);
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
