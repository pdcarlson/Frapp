import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GOOGLE_CALENDAR_SCOPE,
  GoogleCalendarApiError,
  type GoogleCalendarEventInput,
  type GoogleCalendarEventRef,
  type GoogleCalendarGrant,
  type IGoogleCalendarApi,
} from '#domain/adapters/google-calendar.interface';

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
/** Every call to Google gives up after this long. */
const TIMEOUT_MS = 10_000;
/** Google's own page size cap for events.list. */
const LIST_PAGE_SIZE = 2500;
/** Pages read at most: 50,000 events, far past any member's calendar. */
const LIST_MAX_PAGES = 20;
/** The private extended property each event Frapp writes carries. */
const HASH_PROPERTY = 'frapp_hash';
/** Set on a task's event, which a sync deletes however long ago it was due. */
const TASK_PROPERTY = 'frapp_task';
const RATE_LIMIT_REASONS = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'quotaExceeded',
  'dailyLimitExceeded',
]);

/**
 * Google OAuth and the Calendar API over `fetch` (#3322, step 2). No Google
 * SDK: the ten calls Frapp makes are plain JSON, and the SDK is a large
 * dependency for them.
 *
 * Reads `GOOGLE_CALENDAR_CLIENT_ID` and `GOOGLE_CALENDAR_CLIENT_SECRET`, an
 * OAuth client of type Web application in the `signet-frapp` Google Cloud
 * project, separate from the sign-in client Supabase holds
 * (`docs/ops/deployment/integrations.md` § 7B. Google Calendar). Errors carry
 * Google's short reason and status, never a token or a response body.
 */
@Injectable()
export class GoogleCalendarApiClient implements IGoogleCalendarApi {
  private readonly clientId: string | null;
  private readonly clientSecret: string | null;

  constructor(config: ConfigService) {
    this.clientId =
      config.get<string>('GOOGLE_CALENDAR_CLIENT_ID')?.trim() || null;
    this.clientSecret =
      config.get<string>('GOOGLE_CALENDAR_CLIENT_SECRET')?.trim() || null;
  }

  isConfigured(): boolean {
    return this.clientId !== null && this.clientSecret !== null;
  }

  authorizeUrl(params: {
    state: string;
    redirectUri: string;
    codeChallenge: string;
  }): string {
    const query = new URLSearchParams({
      client_id: this.requireClientId(),
      redirect_uri: params.redirectUri,
      response_type: 'code',
      scope: `openid email ${GOOGLE_CALENDAR_SCOPE}`,
      state: params.state,
      // PKCE: Google trades the code only with the sign-in's own verifier, so
      // a code that leaks on its way back is useless to whoever took it.
      code_challenge: params.codeChallenge,
      code_challenge_method: 'S256',
      // A refresh token, every time: without `prompt=consent` Google hands
      // one out only on the account's first grant, so a member who connects
      // again (after disconnecting, or in a second chapter) would get none.
      access_type: 'offline',
      prompt: 'consent',
    });
    return `${AUTHORIZE_URL}?${query.toString()}`;
  }

  async exchangeCode(
    code: string,
    redirectUri: string,
    codeVerifier: string,
  ): Promise<GoogleCalendarGrant> {
    const body = await this.token({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    });
    const refreshToken = stringField(body, 'refresh_token');
    if (!refreshToken) {
      throw new GoogleCalendarApiError('failed', null, 'no_refresh_token');
    }
    const scope = stringField(body, 'scope') ?? '';
    return {
      refreshToken,
      email: emailFromIdToken(stringField(body, 'id_token')),
      scopes: scope.split(/\s+/).filter(Boolean),
    };
  }

  async accessToken(refreshToken: string): Promise<string> {
    const body = await this.token({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    const token = stringField(body, 'access_token');
    if (!token)
      throw new GoogleCalendarApiError('failed', null, 'no_access_token');
    return token;
  }

  async revoke(refreshToken: string): Promise<void> {
    const response = await this.send(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refreshToken }).toString(),
    });
    // 400 `invalid_token`: Google no longer knows it, which is the goal.
    if (response.ok || response.status === 400) return;
    throw await apiError(response);
  }

  async createCalendar(
    accessToken: string,
    calendar: { summary: string; description: string },
  ): Promise<string> {
    const body = await this.calendarCall(
      accessToken,
      'POST',
      '/calendars',
      calendar,
    );
    const id = stringField(body, 'id');
    if (!id) throw new GoogleCalendarApiError('failed', null, 'no_calendar_id');
    return id;
  }

  async deleteCalendar(accessToken: string, calendarId: string): Promise<void> {
    await this.calendarCall(
      accessToken,
      'DELETE',
      `/calendars/${encodeURIComponent(calendarId)}`,
    );
  }

  async listEvents(
    accessToken: string,
    calendarId: string,
  ): Promise<GoogleCalendarEventRef[]> {
    const events: GoogleCalendarEventRef[] = [];
    let pageToken: string | null = null;
    for (let page = 0; page < LIST_MAX_PAGES; page += 1) {
      const query = new URLSearchParams({
        maxResults: String(LIST_PAGE_SIZE),
        showDeleted: 'false',
        fields: 'items(id,end,extendedProperties/private),nextPageToken',
      });
      if (pageToken) query.set('pageToken', pageToken);
      const body = await this.calendarCall(
        accessToken,
        'GET',
        `/calendars/${encodeURIComponent(calendarId)}/events?${query.toString()}`,
      );
      const items = Array.isArray(body?.items) ? body.items : [];
      for (const item of items as unknown[]) {
        const id = stringField(item, 'id');
        if (!id) continue;
        const props = (item as { extendedProperties?: { private?: unknown } })
          .extendedProperties?.private;
        const end = (item as { end?: { dateTime?: unknown; date?: unknown } })
          .end;
        const endsAt =
          typeof end?.dateTime === 'string'
            ? end.dateTime
            : typeof end?.date === 'string'
              ? end.date
              : null;
        events.push({
          id,
          hash: stringField(props, HASH_PROPERTY),
          endsAt,
          task: stringField(props, TASK_PROPERTY) === '1',
        });
      }
      pageToken = stringField(body, 'nextPageToken');
      if (!pageToken) return events;
    }
    return events;
  }

  async insertEvent(
    accessToken: string,
    calendarId: string,
    event: GoogleCalendarEventInput,
  ): Promise<void> {
    await this.calendarCall(
      accessToken,
      'POST',
      `/calendars/${encodeURIComponent(calendarId)}/events`,
      eventBody(event),
    );
  }

  async updateEvent(
    accessToken: string,
    calendarId: string,
    event: GoogleCalendarEventInput,
  ): Promise<void> {
    await this.calendarCall(
      accessToken,
      'PUT',
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(event.id)}`,
      // `status` brings back an event the member deleted by hand: Google
      // keeps a deleted event as cancelled, under the same id.
      { ...eventBody(event), status: 'confirmed' },
    );
  }

  async deleteEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
  ): Promise<void> {
    await this.calendarCall(
      accessToken,
      'DELETE',
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    );
  }

  private async token(
    params: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const response = await this.send(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        ...params,
        client_id: this.requireClientId(),
        client_secret: this.requireClientSecret(),
      }).toString(),
    });
    if (!response.ok) throw await apiError(response);
    return (await response.json()) as Record<string, unknown>;
  }

  private async calendarCall(
    accessToken: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<Record<string, unknown> | null> {
    const response = await this.send(`${CALENDAR_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw await apiError(response);
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? (JSON.parse(text) as Record<string, unknown>) : null;
  }

  private async send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      const reason =
        error instanceof Error && error.name === 'TimeoutError'
          ? 'timeout'
          : 'network';
      throw new GoogleCalendarApiError('failed', null, reason);
    }
  }

  private requireClientId(): string {
    if (!this.clientId) {
      throw new GoogleCalendarApiError('failed', null, 'not_configured');
    }
    return this.clientId;
  }

  private requireClientSecret(): string {
    if (!this.clientSecret) {
      throw new GoogleCalendarApiError('failed', null, 'not_configured');
    }
    return this.clientSecret;
  }
}

function eventBody(event: GoogleCalendarEventInput): Record<string, unknown> {
  return {
    id: event.id,
    summary: event.summary,
    description: event.description,
    location: event.location ?? undefined,
    start: event.start,
    end: event.end,
    source: { title: 'Frapp', url: event.sourceUrl },
    transparency: event.transparent ? 'transparent' : 'opaque',
    extendedProperties: {
      private: {
        [HASH_PROPERTY]: event.hash,
        ...(event.transparent ? { [TASK_PROPERTY]: '1' } : {}),
      },
    },
  };
}

/** Google's error, by kind, with its short reason and nothing else. */
async function apiError(response: Response): Promise<GoogleCalendarApiError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON: the status alone says what happened.
  }
  const status = response.status;
  // OAuth endpoints answer `{ error: 'invalid_grant' }`; the Calendar API
  // answers `{ error: { errors: [{ reason }] } }`.
  const oauthError = stringField(body, 'error');
  const apiReason = (
    body as { error?: { errors?: { reason?: unknown }[] } } | null
  )?.error?.errors?.[0]?.reason;
  const reason =
    oauthError ??
    (typeof apiReason === 'string' ? apiReason : `http_${status}`);

  if (oauthError === 'invalid_grant') {
    return new GoogleCalendarApiError('invalid_grant', status, reason);
  }
  if (status === 404 || status === 410) {
    return new GoogleCalendarApiError('not_found', status, reason);
  }
  if (status === 409) {
    return new GoogleCalendarApiError('conflict', status, reason);
  }
  if (status === 429 || (status === 403 && RATE_LIMIT_REASONS.has(reason))) {
    return new GoogleCalendarApiError('rate_limited', status, reason);
  }
  return new GoogleCalendarApiError('failed', status, reason);
}

function stringField(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object') return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'string' && field.length > 0 ? field : null;
}

/**
 * The account's email from the ID token in Google's token response. Read
 * without checking the signature, which OpenID Connect allows for an ID token
 * received straight from the token endpoint over TLS (Core 1.0 § 3.1.3.7),
 * and used only to label the connection.
 */
export function emailFromIdToken(idToken: string | null): string | null {
  const payload = idToken?.split('.')[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as { email?: unknown; email_verified?: unknown };
    return typeof claims.email === 'string' && claims.email_verified !== false
      ? claims.email
      : null;
  } catch {
    return null;
  }
}
