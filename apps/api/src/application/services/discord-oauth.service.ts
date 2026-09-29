import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
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
import { errorFingerprint } from '../../infrastructure/observability/error-fingerprint';
import {
  classifyApplicationFetchFailure,
  evaluateDiscordApplication,
  sameApplicationCheck,
  type DiscordApplicationCheck,
} from './discord-application-check';

/**
 * The callback path, fixed in code.
 *
 * Discord matches `redirect_uri` against the Developer Portal's registered list
 * **exactly**, so this string has to be identical in three places: the
 * authorize URL, the token exchange, and the portal. Two of the three are
 * derived from this constant; the third is a human pasting it into the portal,
 * which `DiscordApplicationCheck` compares against Discord's own record rather
 * than trusting the paste. Anything more configurable turns a one-time paste
 * into a `redirect_uri mismatch` nobody can debug from the error alone.
 */
export const DISCORD_CALLBACK_PATH = '/v1/discord/connect/callback';

/**
 * How long a verdict on the Discord application is reused.
 *
 * A settled answer (verified, or Discord not listing its redirects at all,
 * which no re-read changes) for ten minutes. A withdrawal or an unreachable
 * Discord for one, so a Redirects row added in the portal, or Discord coming
 * back, shows within a minute rather than at the next deploy.
 */
const SETTLED_CHECK_TTL_MS = 10 * 60_000;
const UNSETTLED_CHECK_TTL_MS = 60_000;

function checkTtlMs(check: DiscordApplicationCheck): number {
  if (check.status === 'verified') return SETTLED_CHECK_TTL_MS;
  if (
    check.status === 'unverified' &&
    check.kind === 'redirects_not_reported'
  ) {
    return SETTLED_CHECK_TTL_MS;
  }
  return UNSETTLED_CHECK_TTL_MS;
}

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
 * Where a member's link handshake returns (#2878): the profile page that
 * started it, which confirms the parked account from the member's own session.
 */
export const AUTHOR_LINK_RETURN_PATH = '/profile';

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
 * one `AllExceptionsFilter` reports every other 5xx through. The fingerprint
 * is shared for the same reason: the normalizer's stack is identical for every
 * fault it builds, so without one a missing table and a statement timeout
 * swallowed here would be one Sentry issue (#2131).
 */
function captureSwallowed(
  error: unknown,
  sweptUnder: DiscordConnectCode,
): void {
  const reported = toReportableError(error);
  const fingerprint = errorFingerprint(reported);
  Sentry.captureException(reported, {
    tags: {
      route: 'discord/connect/callback',
      swallowed_as: sweptUnder,
    },
    ...(fingerprint ? { fingerprint } : {}),
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
export class DiscordOAuthService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DiscordOAuthService.name);
  private readonly apiUrl: string | null;
  private readonly appUrl: string | null;
  private applicationCheckResult: {
    check: DiscordApplicationCheck;
    at: number;
  } | null = null;
  private applicationCheckInFlight: Promise<DiscordApplicationCheck> | null =
    null;

  constructor(
    @Inject(DISCORD_CONNECTION_REPOSITORY)
    private readonly connectionRepo: IDiscordConnectionRepository,
    @Inject(DISCORD_OAUTH_CLIENT)
    private readonly oauth: IDiscordOAuthClient,
    @Inject(DISCORD_BOT_GATEWAY)
    private readonly bot: IDiscordBotGateway,
    config: ConfigService,
  ) {
    const rawApiUrl = config.get<string>('API_URL');
    this.apiUrl = apiBaseUrl(rawApiUrl);
    this.appUrl = normaliseOrigin(config.get<string>('APP_URL'));
    if (this.apiUrl !== null && this.apiUrl !== normaliseOrigin(rawApiUrl)) {
      // Harmless now, and said once per boot so the drift stays visible: the
      // documented value is the bare origin (ENV_REFERENCE.md), and a stray
      // `/v1` here is what built staging's `/v1/v1/...` redirect URI.
      this.logger.warn(
        `API_URL ends in /v1; the documented value is the bare origin. The Discord redirect URI is built from ${this.apiUrl}.`,
      );
    }
  }

  /**
   * Check the Discord application once at boot, so a deploy onto a broken
   * setup reports itself before any admin finds it.
   *
   * Not awaited: Discord is optional and its outage must not hold the API's
   * boot, or its health check, hostage.
   */
  onApplicationBootstrap(): void {
    if (!this.isConfigured()) return;
    void this.currentApplicationCheck().catch(() => undefined);
  }

  /**
   * Whether all five settings are present. Says nothing about Discord's side.
   *
   * None is optional-with-a-degraded-mode: without `API_URL` there is no
   * redirect URI to register, and without `APP_URL` the callback has nowhere
   * to send the browser back to. Half-running the flow would strand an admin
   * on a blank page at Discord.
   */
  isConfigured(): boolean {
    return (
      this.oauth.isConfigured() &&
      this.bot.isConfigured() &&
      this.apiUrl !== null &&
      this.appUrl !== null
    );
  }

  /**
   * Whether this environment can run the flow: configured, and not proven
   * broken by Discord's own record of the application.
   *
   * An `unverified` check still counts as available, on purpose: see
   * `DiscordApplicationCheck`.
   */
  async isAvailable(): Promise<boolean> {
    if (!this.isConfigured()) return false;
    const check = await this.currentApplicationCheck();
    return check.status !== 'misconfigured';
  }

  /**
   * Refuse to start what cannot finish.
   *
   * `fresh` re-reads Discord first. Starting a handshake is rare and is the one
   * moment a stale "verified" costs an admin a trip to Discord's error page, so
   * it pays for one extra request; the confirm step, which runs after Discord
   * already accepted the redirect, does not need to.
   */
  private async assertAvailable(opts: { fresh: boolean }): Promise<void> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'Connecting Discord is not configured in this environment. The DiscordChatExporter upload flow still works.',
      );
    }
    const check = opts.fresh
      ? await this.refreshApplicationCheck()
      : await this.currentApplicationCheck();
    if (check.status === 'misconfigured') {
      // The operator detail went to the log and Sentry; the admin gets a
      // sentence they can act on, which is not "edit the Developer Portal".
      throw new ServiceUnavailableException(
        'Connecting Discord is switched off in this environment because its Discord setup is incomplete, and Frapp has been alerted. The DiscordChatExporter upload flow still works.',
      );
    }
  }

  /**
   * The cached verdict, re-read from Discord once it has aged out.
   *
   * Only a withdrawal is re-read before answering. Serving a stale
   * "misconfigured" once more would keep the card greyed on the first reload
   * after someone fixes the portal, which is exactly when an operator is
   * watching. Every other verdict already leaves the flow offered, so it is
   * served as-is while a refresh runs behind it, and the wizard does not wait
   * on Discord to be told what it would be told anyway.
   *
   * One thing short-circuits the TTL: a 401 the gateway has seen since, most
   * likely from an import slice. That is news a cached "verified" does not
   * have, and it costs no Discord call to act on.
   */
  private currentApplicationCheck(): Promise<DiscordApplicationCheck> {
    const cached = this.applicationCheckResult;
    if (!cached) return this.refreshApplicationCheck();
    const withdrawn = cached.check.status === 'misconfigured';
    if (!withdrawn && this.bot.hasRejectedToken()) {
      return this.refreshApplicationCheck();
    }
    if (Date.now() - cached.at < checkTtlMs(cached.check)) {
      return Promise.resolve(cached.check);
    }
    if (withdrawn) return this.refreshApplicationCheck();
    // Never unhandled: a rejection here would take the process down.
    void this.refreshApplicationCheck().catch(() => undefined);
    return Promise.resolve(cached.check);
  }

  /** Ask Discord now. Concurrent callers share one request. */
  private refreshApplicationCheck(): Promise<DiscordApplicationCheck> {
    if (!this.applicationCheckInFlight) {
      this.applicationCheckInFlight = this.runApplicationCheck().finally(() => {
        this.applicationCheckInFlight = null;
      });
    }
    return this.applicationCheckInFlight;
  }

  private async runApplicationCheck(): Promise<DiscordApplicationCheck> {
    let check: DiscordApplicationCheck;
    try {
      const application = await this.bot.fetchApplication();
      check = evaluateDiscordApplication({
        application,
        expectedClientId: this.oauth.clientId(),
        redirectUri: this.redirectUri(),
      });
    } catch (error) {
      check = classifyApplicationFetchFailure(error);
    }
    this.recordApplicationCheck(check);
    return check;
  }

  /**
   * Keep the verdict, and say so when it changes.
   *
   * On change only: this runs every few minutes for the life of the process,
   * and a line per run would bury the one that matters. A misconfiguration
   * goes to Sentry as well as the log, because the failure it describes
   * otherwise leaves no trace on our side at all.
   */
  private recordApplicationCheck(check: DiscordApplicationCheck): void {
    const previous = this.applicationCheckResult?.check ?? null;
    this.applicationCheckResult = { check, at: Date.now() };
    if (sameApplicationCheck(previous, check)) return;

    switch (check.status) {
      case 'verified':
        this.logger.log(
          `Discord application setup verified: the redirect URI ${this.redirectUri()} is registered.`,
        );
        return;
      case 'unverified':
        this.logger.warn(
          `Discord application setup unchecked. ${check.reason}`,
        );
        return;
      case 'misconfigured':
        this.logger.error(`Connect Discord withdrawn. ${check.reason}`);
        try {
          Sentry.captureMessage(`Discord setup: ${check.kind}`, {
            level: 'error',
            tags: { integration: 'discord', discord_check: check.kind },
            extra: { reason: check.reason },
            fingerprint: ['discord-application-check', check.kind],
          });
        } catch (error) {
          // Reporting must not change the verdict: the flow is withdrawn
          // either way, and the log line above already carries the reason.
          this.logger.warn(
            `Sentry report failed for the Discord setup check: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
        return;
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
    await this.assertAvailable({ fresh: true });

    const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MS);
    const state = await this.connectionRepo.createState({
      chapter_id: chapterId,
      purpose: 'connect',
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
   * Start a member's link handshake (#2878): prove which Discord account is
   * theirs, so their imported history can be attached to them.
   *
   * The same single-use state and the same callback URL as `beginConnect`,
   * tagged `author_link` so the callback parks an account rather than a guild
   * and only the link confirm can spend it. The authorize URL asks for
   * `identify` alone. The chapter and the member come from the authenticated,
   * chapter-scoped request that calls this, never from the browser later.
   */
  async beginAuthorLink(
    chapterId: string,
    userId: string,
  ): Promise<{ authorize_url: string; expires_at: string }> {
    await this.assertAvailable({ fresh: true });

    const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MS);
    const state = await this.connectionRepo.createState({
      chapter_id: chapterId,
      purpose: 'author_link',
      created_by: userId,
      return_path: AUTHOR_LINK_RETURN_PATH,
      expires_at: expiresAt.toISOString(),
    });

    return {
      authorize_url: this.oauth.buildAuthorizeUrl({
        state: state.id,
        redirectUri: this.redirectUri(),
        grant: 'identify',
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
      const confirmToken =
        consumed.purpose === 'author_link'
          ? await this.parkAuthorLink(consumed.id, query.code)
          : await this.parkConnection(consumed.id, query.code);
      this.logger.log(
        consumed.purpose === 'author_link'
          ? `A member of chapter ${consumed.chapter_id} has a Discord account awaiting confirmation.`
          : `Chapter ${consumed.chapter_id} has a Discord guild awaiting confirmation.`,
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
   * A member's link handshake, between "valid code" and "account parked"
   * (#2878).
   *
   * Reads which Discord account approved the screen, under that account's own
   * token, and parks it. **Binds nothing**, for the same reason
   * `parkConnection` does not: the callback is an unauthenticated redirect,
   * so the person who approved on Discord need not be the member who started
   * the handshake. A member who sent their authorize URL to somebody else
   * would otherwise get that person's history attached to themselves. The
   * confirm step (`DiscordAuthorLinkService.confirm`) binds only for the
   * member who started it.
   */
  private async parkAuthorLink(stateId: string, code: string): Promise<string> {
    const token = await this.oauth.exchangeCode({
      code,
      redirectUri: this.redirectUri(),
    });

    try {
      const account = await this.oauth.fetchAuthorizingUser(token.accessToken);
      const confirmToken = randomUUID();
      const parked = await this.connectionRepo.attachPendingAuthorLink(
        stateId,
        {
          discord_user_id: account.id,
          discord_username: account.username,
          scopes: token.scope,
          confirm_token: confirmToken,
          confirm_expires_at: new Date(
            Date.now() + CONFIRM_TOKEN_TTL_MS,
          ).toISOString(),
        },
      );
      if (!parked) {
        throw new DiscordConnectFailure(
          'expired',
          'Link handshake could not be parked; it already carries a pending account.',
        );
      }
      return confirmToken;
    } finally {
      // One read, then the token is useless to us. Not stored.
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
    await this.assertAvailable({ fresh: false });

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
      // The Frapp user who CONFIRMED, which is the one we can actually
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

/**
 * `API_URL` as the base the versioned routes hang off: trailing slashes and a
 * trailing `/v1` removed.
 *
 * Every route here is versioned in its path (`/v1/...`), so a `/v1` left on
 * `API_URL` doubles it. The SDK already strips it (`normalizeApiBaseUrl` in
 * `packages/api-sdk/src/client.ts`, same rule), and the Stripe check reads only
 * the origin, so a stale `/v1` in Infisical broke nothing else, and this was
 * the one reader that turned it into `/v1/v1/discord/connect/callback`: a URI
 * no portal row matched. Staging carried exactly that value on 2026-09-28.
 *
 * Stripping only `/v1`, not the whole path, keeps an API genuinely mounted
 * under a prefix working, as the SDK does.
 */
export function apiBaseUrl(value: string | undefined): string | null {
  const trimmed = normaliseOrigin(value);
  if (trimmed === null) return null;
  const base = trimmed.endsWith('/v1')
    ? trimmed.slice(0, -'/v1'.length)
    : trimmed;
  return base.length > 0 ? base : null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
