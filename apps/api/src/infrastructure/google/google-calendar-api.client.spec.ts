import type { ConfigService } from '@nestjs/config';
import {
  GoogleCalendarApiClient,
  emailFromIdToken,
} from './google-calendar-api.client';
import {
  GOOGLE_CALENDAR_SCOPE,
  GoogleCalendarApiError,
} from '#domain/adapters/google-calendar.interface';

function client(env: Record<string, string> = {}) {
  const values: Record<string, string> = {
    GOOGLE_CALENDAR_CLIENT_ID: 'client-id',
    GOOGLE_CALENDAR_CLIENT_SECRET: 'client-secret',
    ...env,
  };
  return new GoogleCalendarApiClient({
    get: (key: string) => values[key],
  } as unknown as ConfigService);
}

function reply(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function idToken(claims: Record<string, unknown>): string {
  const part = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'RS256' })}.${part(claims)}.signature`;
}

describe('GoogleCalendarApiClient', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  it('is configured only with both the client id and the secret', () => {
    expect(client().isConfigured()).toBe(true);
    expect(client({ GOOGLE_CALENDAR_CLIENT_SECRET: '' }).isConfigured()).toBe(
      false,
    );
  });

  it('asks for the narrow calendar scope, offline, with consent every time', () => {
    const url = new URL(
      client().authorizeUrl({
        state: 'state-1',
        redirectUri: 'https://api.frapp.live/v1/google-calendar/callback',
      }),
    );

    expect(url.origin + url.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'client-id',
      redirect_uri: 'https://api.frapp.live/v1/google-calendar/callback',
      response_type: 'code',
      scope: `openid email ${GOOGLE_CALENDAR_SCOPE}`,
      state: 'state-1',
      access_type: 'offline',
      prompt: 'consent',
    });
  });

  it('exchanges a code for the refresh token, the granted scopes and the email', async () => {
    fetchMock.mockResolvedValue(
      reply(200, {
        access_token: 'access',
        refresh_token: 'refresh',
        scope: `openid ${GOOGLE_CALENDAR_SCOPE}`,
        id_token: idToken({ email: 'member@gmail.com', email_verified: true }),
      }),
    );

    await expect(
      client().exchangeCode('code-1', 'https://api/cb'),
    ).resolves.toEqual({
      refreshToken: 'refresh',
      email: 'member@gmail.com',
      scopes: ['openid', GOOGLE_CALENDAR_SCOPE],
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(
      Object.fromEntries(new URLSearchParams(init.body as string)),
    ).toEqual({
      grant_type: 'authorization_code',
      code: 'code-1',
      redirect_uri: 'https://api/cb',
      client_id: 'client-id',
      client_secret: 'client-secret',
    });
  });

  it('reads a refused refresh token as invalid_grant', async () => {
    fetchMock.mockResolvedValue(reply(400, { error: 'invalid_grant' }));

    await expect(client().accessToken('refresh')).rejects.toMatchObject({
      kind: 'invalid_grant',
    });
  });

  it.each([
    [404, { error: { errors: [{ reason: 'notFound' }] } }, 'not_found'],
    [410, { error: { errors: [{ reason: 'deleted' }] } }, 'not_found'],
    [409, { error: { errors: [{ reason: 'duplicate' }] } }, 'conflict'],
    [
      429,
      { error: { errors: [{ reason: 'rateLimitExceeded' }] } },
      'rate_limited',
    ],
    [
      403,
      { error: { errors: [{ reason: 'userRateLimitExceeded' }] } },
      'rate_limited',
    ],
    [403, { error: { errors: [{ reason: 'forbidden' }] } }, 'failed'],
    [503, undefined, 'failed'],
  ])('reads a %s from the Calendar API as %s', async (status, body, kind) => {
    fetchMock.mockResolvedValue(reply(status, body));

    const error = await client()
      .deleteEvent('access', 'cal', 'event')
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GoogleCalendarApiError);
    expect((error as GoogleCalendarApiError).kind).toBe(kind);
    // Never a token in the message.
    expect((error as Error).message).not.toContain('access');
  });

  it('reads every page of events, with each event’s hash and end', async () => {
    fetchMock
      .mockResolvedValueOnce(
        reply(200, {
          items: [
            {
              id: 'a',
              end: { dateTime: '2026-11-20T01:00:00Z' },
              extendedProperties: { private: { frapp_hash: 'h1' } },
            },
          ],
          nextPageToken: 'p2',
        }),
      )
      .mockResolvedValueOnce(
        reply(200, { items: [{ id: 'b', end: { date: '2026-11-21' } }] }),
      );

    await expect(client().listEvents('access', 'cal@x')).resolves.toEqual([
      { id: 'a', hash: 'h1', endsAt: '2026-11-20T01:00:00Z' },
      { id: 'b', hash: null, endsAt: '2026-11-21' },
    ]);
    const second = new URL(fetchMock.mock.calls[1][0] as string);
    expect(second.pathname).toBe('/calendar/v3/calendars/cal%40x/events');
    expect(second.searchParams.get('pageToken')).toBe('p2');
  });

  it('treats a token Google no longer knows as revoked', async () => {
    fetchMock.mockResolvedValue(reply(400, { error: 'invalid_token' }));

    await expect(client().revoke('refresh')).resolves.toBeUndefined();
  });

  it('reports a network failure without its details', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(client().accessToken('refresh')).rejects.toMatchObject({
      kind: 'failed',
      reason: 'network',
    });
  });
});

describe('emailFromIdToken', () => {
  it('reads a verified email and nothing else', () => {
    expect(
      emailFromIdToken(idToken({ email: 'a@b.c', email_verified: true })),
    ).toBe('a@b.c');
    expect(
      emailFromIdToken(idToken({ email: 'a@b.c', email_verified: false })),
    ).toBeNull();
    expect(emailFromIdToken(null)).toBeNull();
    expect(emailFromIdToken('not-a-token')).toBeNull();
  });
});
