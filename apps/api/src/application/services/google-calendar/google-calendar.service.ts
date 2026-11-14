import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { isProductionSupabaseUrl } from '@repo/validation';
import {
  GOOGLE_CALENDAR_API,
  GOOGLE_CALENDAR_SCOPE,
  type IGoogleCalendarApi,
} from '#domain/adapters/google-calendar.interface';
import {
  GOOGLE_CALENDAR_REPOSITORY,
  type IGoogleCalendarRepository,
} from '#domain/repositories/google-calendar.repository.interface';
import type { GoogleCalendarConnection } from '#domain/entities/google-calendar-connection.entity';
import type { AiTextKeyRing } from '#domain/utils/ai-text-cipher';
import { googleCalendarTokenKeyRing } from '../../../config/google-calendar-config';
import { resolveAppOrigin } from '../../../infrastructure/email/invite-link.util';
import { toReportableError } from '../../../infrastructure/observability/reportable-error';
import { apiBaseUrl, isUuid } from '../discord-oauth.service';
import { sealRefreshToken } from './google-calendar-token';
import { GoogleCalendarSyncService } from './google-calendar-sync.service';

/** Google's redirect back to the API. Registered on the OAuth client. */
export const GOOGLE_CALENDAR_CALLBACK_PATH = '/v1/google-calendar/callback';
/** Where the web app finishes a sign-in: the Events page holds the menu. */
const WEB_RETURN_PATH = '/events';
/** How long a started sign-in stays good. */
const STATE_TTL_MS = 10 * 60 * 1000;

export type GoogleCalendarClient = 'web' | 'mobile';

export interface GoogleCalendarStatus {
  /** Whether this server offers Google Calendar at all. */
  available: boolean;
  connected: boolean;
  /** `active`, or `needs_reconnect` once Google refused the sign-in. */
  status: 'active' | 'needs_reconnect' | null;
  google_email: string | null;
  last_synced_at: string | null;
}

/**
 * A member's Google Calendar connection (#3322, step 2;
 * `spec/behavior/events.md` § Google Calendar): starting and finishing the
 * Google sign-in, reading the connection's state, and disconnecting. The
 * writing to Google is `GoogleCalendarSyncService`.
 *
 * The sign-in finishes in two requests, so it can only ever connect the
 * member who started it. Google redirects the browser to the API's callback,
 * which only sends it on, with Google's code, to where the sign-in started
 * (the Events page on web, the app on a phone; checked when the sign-in was
 * made, never taken from the redirect). That client then posts the code here
 * as the signed-in member, and the sign-in is spent only for the member and
 * chapter that started it. Someone who sends a member their own sign-in link
 * therefore gets nothing: the member's browser lands in the member's own
 * session, which is refused. The sign-in also holds a PKCE verifier that
 * Google demands when the code is traded, so a code that leaks on its way
 * back (another app claiming `frapp://`, a browser history) is useless.
 */
@Injectable()
export class GoogleCalendarService {
  private readonly logger = new Logger(GoogleCalendarService.name);
  private readonly apiBase: string | null;
  private readonly appOrigin: string;
  private readonly keyRing: AiTextKeyRing | null;
  private readonly allowExpoGo: boolean;

  constructor(
    @Inject(GOOGLE_CALENDAR_REPOSITORY)
    private readonly repo: IGoogleCalendarRepository,
    @Inject(GOOGLE_CALENDAR_API)
    private readonly google: IGoogleCalendarApi,
    private readonly sync: GoogleCalendarSyncService,
    config: ConfigService,
  ) {
    this.apiBase = apiBaseUrl(config.get<string>('API_URL'));
    this.appOrigin = resolveAppOrigin(config);
    this.keyRing = googleCalendarTokenKeyRing({
      GOOGLE_CALENDAR_TOKEN_KEY: config.get<string>(
        'GOOGLE_CALENDAR_TOKEN_KEY',
      ),
    });
    // Expo Go's `exp://` return address exists only on a developer's
    // machine. Production accepts the app's own scheme alone.
    const supabaseUrl = config.get<string>('SUPABASE_URL');
    this.allowExpoGo = !(supabaseUrl && isProductionSupabaseUrl(supabaseUrl));
  }

  isAvailable(): boolean {
    return (
      this.google.isConfigured() &&
      this.keyRing !== null &&
      this.apiBase !== null
    );
  }

  async status(
    chapterId: string,
    userId: string,
  ): Promise<GoogleCalendarStatus> {
    const available = this.isAvailable();
    const live = await this.repo.findLive(chapterId, userId);
    if (!live) {
      return {
        available,
        connected: false,
        status: null,
        google_email: null,
        last_synced_at: null,
      };
    }
    return {
      available,
      connected: true,
      status: live.status === 'needs_reconnect' ? 'needs_reconnect' : 'active',
      google_email: live.google_email,
      last_synced_at: live.last_synced_at,
    };
  }

  /** Start a sign-in: a single-use state, and Google's consent page. */
  async connect(
    chapterId: string,
    userId: string,
    client: GoogleCalendarClient,
    returnUrl: string | null,
  ): Promise<{ authorize_url: string }> {
    this.requireAvailable();
    const returnTo =
      client === 'mobile'
        ? this.appReturnUrl(returnUrl)
        : `${this.appOrigin}${WEB_RETURN_PATH}`;
    const codeVerifier = randomBytes(32).toString('base64url');
    const state = await this.repo.createState({
      chapter_id: chapterId,
      user_id: userId,
      return_to: returnTo,
      code_verifier: codeVerifier,
      expires_at: new Date(Date.now() + STATE_TTL_MS).toISOString(),
    });
    return {
      authorize_url: this.google.authorizeUrl({
        state: state.id,
        redirectUri: this.redirectUri(),
        codeChallenge: createHash('sha256')
          .update(codeVerifier)
          .digest('base64url'),
      }),
    };
  }

  /**
   * Google's redirect: where to send the browser, with Google's answer. Never
   * throws, because the caller is a browser mid-sign-in that must land in the
   * app with a sentence, not on a JSON error. Spends nothing: finishing is
   * `confirm`, as the member.
   */
  async callback(query: {
    code?: string;
    state?: string;
    error?: string;
  }): Promise<string> {
    const fallback = `${this.appOrigin}${WEB_RETURN_PATH}`;
    const stateId = typeof query.state === 'string' ? query.state : '';
    let returnTo: string | null = null;
    if (isUuid(stateId)) {
      try {
        returnTo = (await this.repo.findState(stateId))?.return_to ?? null;
      } catch (error) {
        this.logger.warn(
          `Google Calendar callback could not read its sign-in: ${toReportableError(error).message}`,
        );
      }
    }
    if (!returnTo) return withParams(fallback, { gcal: 'expired' });
    if (query.error) {
      // `access_denied` is the member pressing Cancel on Google's page.
      return withParams(returnTo, {
        gcal: query.error === 'access_denied' ? 'denied' : 'failed',
      });
    }
    if (typeof query.code !== 'string' || query.code.length === 0) {
      return withParams(returnTo, { gcal: 'failed' });
    }
    return withParams(returnTo, {
      gcal: 'confirm',
      gcal_code: query.code,
      gcal_state: stateId,
    });
  }

  /**
   * Finish a sign-in as the member who started it: exchange Google's code,
   * keep the sealed token, and leave the connection due, so the worker makes
   * the calendar and fills it within a minute.
   */
  async confirm(
    chapterId: string,
    userId: string,
    stateId: string,
    code: string,
  ): Promise<GoogleCalendarStatus> {
    this.requireAvailable();
    const state = isUuid(stateId)
      ? await this.repo.consumeState(stateId, chapterId, userId, new Date())
      : null;
    if (!state) {
      throw new BadRequestException(
        'That Google sign-in expired. Connect Google Calendar again.',
      );
    }

    let grant;
    try {
      grant = await this.google.exchangeCode(
        code,
        this.redirectUri(),
        state.code_verifier,
      );
    } catch (error) {
      this.logger.warn(
        `Google Calendar sign-in failed: ${toReportableError(error).message}`,
      );
      throw new BadGatewayException(
        "Google didn't finish the sign-in. Connect Google Calendar again.",
        { cause: toReportableError(error) },
      );
    }

    if (!grant.scopes.includes(GOOGLE_CALENDAR_SCOPE)) {
      // Google lets a member untick a permission. Without this one there is
      // nothing to sync, so the token is handed back rather than kept, unless
      // another connection uses the account: Google revokes a whole
      // account's access at once.
      const shared =
        grant.email !== null &&
        (await this.repo.countForAccount(grant.email, null)) > 0;
      if (!shared) {
        await this.google.revoke(grant.refreshToken).catch(() => undefined);
      }
      throw new BadRequestException(
        'Frapp needs permission to make its own calendar. Connect again and leave that box ticked on Google’s page.',
      );
    }

    const sealed = sealRefreshToken(
      this.keyRing,
      grant.refreshToken,
      chapterId,
      userId,
    );
    const live = await this.repo.findLive(chapterId, userId);
    if (live && sameAccount(live, grant.email)) {
      // Connecting again on the same account (after Google refused the old
      // sign-in) keeps the calendar Frapp already made there.
      await this.repo.replaceToken(live.id, {
        google_email: grant.email,
        refresh_token_sealed: sealed,
      });
    } else {
      if (live) await this.repo.markDisconnecting(live.id);
      await this.repo.create({
        chapter_id: chapterId,
        user_id: userId,
        google_email: grant.email,
        refresh_token_sealed: sealed,
      });
    }
    return this.status(chapterId, userId);
  }

  /**
   * Remove Frapp's calendar from the member's Google account and revoke the
   * sign-in. The connection is gone for the member at once; the cleanup at
   * Google runs now when it can, and otherwise in the worker: when Google
   * can't be reached, when a sync of this connection is in flight (it may be
   * making the calendar this very moment, so the cleanup waits for it), or
   * while Google Calendar is switched off on this server.
   */
  async disconnect(chapterId: string, userId: string): Promise<void> {
    const live = await this.repo.findLive(chapterId, userId);
    if (!live) return;
    const row = await this.repo.markDisconnecting(live.id);
    if (!row || !this.sync.isAvailable()) return;
    const leased =
      row.sync_lease_until !== null &&
      Date.parse(row.sync_lease_until) > Date.now();
    if (leased) return;
    await this.sync.cleanUp(row);
  }

  private requireAvailable(): void {
    if (!this.isAvailable()) {
      throw new ServiceUnavailableException(
        'Google Calendar is not set up on this server.',
      );
    }
  }

  private redirectUri(): string {
    return `${this.apiBase as string}${GOOGLE_CALENDAR_CALLBACK_PATH}`;
  }

  /**
   * The phone app's return address: its own `frapp://` scheme, or, outside
   * production, the staging variant's `frapp-staging://` (Frapp Staging,
   * `apps/mobile/app.config.js`) or Expo Go's on this computer or the local
   * network. Production takes neither: a staging app must not finish a
   * production member's sign-in. Anything
   * else would hand Google's code to a page the member's own app doesn't
   * control: Expo Go runs whatever server an `exp://` address names.
   */
  private appReturnUrl(value: string | null): string {
    const url = value ?? '';
    const allowed =
      url.startsWith('frapp://') ||
      (this.allowExpoGo &&
        (url.startsWith('frapp-staging://') || isLocalExpoGoUrl(url)));
    // eslint-disable-next-line no-control-regex
    if (!allowed || /[\u0000-\u001F\u007F\s]/.test(url) || url.length > 512) {
      throw new BadRequestException(
        'return_url must be the app’s own address.',
      );
    }
    return url;
  }
}

function sameAccount(
  connection: GoogleCalendarConnection,
  email: string | null,
): boolean {
  return (
    connection.google_email !== null &&
    email !== null &&
    connection.google_email.toLowerCase() === email.toLowerCase()
  );
}

/**
 * An Expo Go address served from this computer or the local network: the
 * only place a developer's Expo Go points.
 */
function isLocalExpoGoUrl(url: string): boolean {
  if (!url.startsWith('exp://') && !url.startsWith('exps://')) return false;
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  return (
    host === 'localhost' ||
    /^127\.\d+\.\d+\.\d+$/.test(host) ||
    /^10\.\d+\.\d+\.\d+$/.test(host) ||
    /^192\.168\.\d+\.\d+$/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(host)
  );
}

/** `url` with `params` added to its query, kept if it already has one. */
function withParams(url: string, params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString();
  return `${url}${url.includes('?') ? '&' : '?'}${query}`;
}
