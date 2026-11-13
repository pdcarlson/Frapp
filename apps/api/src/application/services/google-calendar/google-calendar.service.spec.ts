import { createHash, randomBytes } from 'node:crypto';
import {
  BadGatewayException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { GoogleCalendarService } from './google-calendar.service';
import type { GoogleCalendarSyncService } from './google-calendar-sync.service';
import { openRefreshToken } from './google-calendar-token';
import { googleCalendarTokenKeyRing } from '../../../config/google-calendar-config';
import {
  GOOGLE_CALENDAR_SCOPE,
  GoogleCalendarApiError,
  type IGoogleCalendarApi,
} from '#domain/adapters/google-calendar.interface';
import type { IGoogleCalendarRepository } from '#domain/repositories/google-calendar.repository.interface';
import type {
  GoogleCalendarConnection,
  GoogleCalendarOAuthState,
} from '#domain/entities/google-calendar-connection.entity';

const CHAPTER = '11111111-1111-4111-8111-111111111111';
const USER = '33333333-3333-4333-8333-333333333333';
const STATE = '0a000000-0000-4000-8000-000000000400';
const TOKEN_KEY = `test:${randomBytes(32).toString('base64')}`;
const PROD_SUPABASE = 'https://unttyvyfezddlyafcydh.supabase.co';

function stateRow(
  overrides: Partial<GoogleCalendarOAuthState> = {},
): GoogleCalendarOAuthState {
  return {
    id: STATE,
    chapter_id: CHAPTER,
    user_id: USER,
    return_to: 'https://app.frapp.live/events',
    code_verifier: 'verifier-1',
    created_at: '2026-11-12T00:00:00.000Z',
    expires_at: '2026-11-12T00:10:00.000Z',
    consumed_at: null,
    ...overrides,
  };
}

function connectionRow(
  overrides: Partial<GoogleCalendarConnection> = {},
): GoogleCalendarConnection {
  return {
    id: 'conn-1',
    chapter_id: CHAPTER,
    user_id: USER,
    google_email: 'member@gmail.com',
    refresh_token_sealed: 'sealed',
    calendar_id: 'cal-1',
    status: 'active',
    sync_due_at: '2026-11-12T00:00:00.000Z',
    sync_lease_until: null,
    last_synced_at: '2026-11-12T00:01:00.000Z',
    last_error: null,
    created_at: '2026-11-12T00:00:00.000Z',
    ...overrides,
  };
}

interface SetupOptions {
  env?: Record<string, string | undefined>;
  configured?: boolean;
}

function setup(options: SetupOptions = {}) {
  const env: Record<string, string | undefined> = {
    API_URL: 'https://api.frapp.live',
    APP_URL: 'https://app.frapp.live',
    GOOGLE_CALENDAR_TOKEN_KEY: TOKEN_KEY,
    SUPABASE_URL: PROD_SUPABASE,
    ...options.env,
  };
  const config = {
    get: jest.fn((key: string) => env[key]),
  } as unknown as ConfigService;
  const repo = {
    createState: jest.fn(async (data: Partial<GoogleCalendarOAuthState>) =>
      stateRow(data),
    ),
    findState: jest.fn(async () => stateRow()),
    consumeState: jest.fn(async () => stateRow()),
    findLive: jest.fn(
      async (): Promise<GoogleCalendarConnection | null> => null,
    ),
    create: jest.fn(async () => connectionRow()),
    replaceToken: jest.fn(async () => undefined),
    markDisconnecting: jest.fn(
      async (id: string): Promise<GoogleCalendarConnection | null> =>
        connectionRow({
          id,
          status: 'disconnecting',
          sync_due_at: '2026-11-12T01:00:00.000Z',
        }),
    ),
    countForAccount: jest.fn(async () => 0),
  };
  const google = {
    isConfigured: jest.fn(() => options.configured ?? true),
    authorizeUrl: jest.fn(
      ({ state }: { state: string }) =>
        `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`,
    ),
    exchangeCode: jest.fn(async () => ({
      refreshToken: 'refresh-1',
      email: 'member@gmail.com',
      scopes: ['openid', 'email', GOOGLE_CALENDAR_SCOPE],
    })),
    revoke: jest.fn(async () => undefined),
  };
  const sync = {
    cleanUp: jest.fn(async () => undefined),
    isAvailable: jest.fn(() => true),
  };
  const service = new GoogleCalendarService(
    repo as unknown as IGoogleCalendarRepository,
    google as unknown as IGoogleCalendarApi,
    sync as unknown as GoogleCalendarSyncService,
    config,
  );
  return { service, repo, google, sync };
}

describe('GoogleCalendarService', () => {
  describe('availability', () => {
    it('is offered only with the Google client, the token key and API_URL', () => {
      expect(setup().service.isAvailable()).toBe(true);
      expect(setup({ configured: false }).service.isAvailable()).toBe(false);
      expect(
        setup({
          env: { GOOGLE_CALENDAR_TOKEN_KEY: undefined },
        }).service.isAvailable(),
      ).toBe(false);
      expect(setup({ env: { API_URL: undefined } }).service.isAvailable()).toBe(
        false,
      );
    });

    it('refuses to start a sign-in when not offered', async () => {
      const { service } = setup({ configured: false });

      await expect(
        service.connect(CHAPTER, USER, 'web', null),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe('connect', () => {
    it('on web, returns to the Events page and redirects Google to the API', async () => {
      const { service, repo, google } = setup();

      const result = await service.connect(
        CHAPTER,
        USER,
        'web',
        'https://evil.example',
      );

      expect(repo.createState).toHaveBeenCalledWith(
        expect.objectContaining({
          chapter_id: CHAPTER,
          user_id: USER,
          return_to: 'https://app.frapp.live/events',
        }),
      );
      // PKCE: the challenge Google gets is the S256 of the verifier kept on
      // the sign-in, which only the confirm sends back.
      const { code_verifier } = (
        repo.createState.mock.calls[0] as unknown[]
      )[0] as { code_verifier: string };
      expect(code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(google.authorizeUrl).toHaveBeenCalledWith({
        state: STATE,
        redirectUri: 'https://api.frapp.live/v1/google-calendar/callback',
        codeChallenge: createHash('sha256')
          .update(code_verifier)
          .digest('base64url'),
      });
      expect(result.authorize_url).toContain(STATE);
    });

    it('on a phone, returns to the app’s own scheme', async () => {
      const { service, repo } = setup();

      await service.connect(CHAPTER, USER, 'mobile', 'frapp://google-calendar');

      expect(repo.createState).toHaveBeenCalledWith(
        expect.objectContaining({ return_to: 'frapp://google-calendar' }),
      );
    });

    it.each([
      ['a web page', 'https://evil.example/steal'],
      ['Expo Go, in production', 'exp://192.168.1.5:8081/--/google-calendar'],
      ['the staging app, in production', 'frapp-staging://google-calendar'],
      ['nothing', null],
      ['Expo Go on a public server', 'exp://evil.example:80/--/x'],
      ['Expo Go on a lookalike host', 'exps://192.168.1.5.evil.example/--/x'],
      ['a control character', 'frapp://google-calendar\n'],
    ])('refuses %s as a phone return address', async (label, url) => {
      const { service, repo } = setup(
        label.includes('server') || label.includes('lookalike')
          ? { env: { SUPABASE_URL: 'http://localhost:54321' } }
          : {},
      );

      await expect(
        service.connect(CHAPTER, USER, 'mobile', url),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.createState).not.toHaveBeenCalled();
    });

    it('accepts the staging app outside production', async () => {
      const { service, repo } = setup({
        env: { SUPABASE_URL: 'http://localhost:54321' },
      });

      await service.connect(
        CHAPTER,
        USER,
        'mobile',
        'frapp-staging://google-calendar',
      );

      expect(repo.createState).toHaveBeenCalledWith(
        expect.objectContaining({
          return_to: 'frapp-staging://google-calendar',
        }),
      );
    });

    it('accepts Expo Go outside production', async () => {
      const { service, repo } = setup({
        env: { SUPABASE_URL: 'http://localhost:54321' },
      });

      await service.connect(
        CHAPTER,
        USER,
        'mobile',
        'exp://192.168.1.5:8081/--/google-calendar',
      );

      expect(repo.createState).toHaveBeenCalled();
    });
  });

  describe('callback', () => {
    it('sends the browser back where the sign-in started, with Google’s code', async () => {
      const { service, repo } = setup();
      repo.findState.mockResolvedValue(
        stateRow({ return_to: 'frapp://google-calendar' }),
      );

      const url = await service.callback({ code: 'code-1', state: STATE });

      expect(url).toBe(
        `frapp://google-calendar?gcal=confirm&gcal_code=code-1&gcal_state=${STATE}`,
      );
      // It spends nothing: the member's own client finishes.
      expect(repo.consumeState).not.toHaveBeenCalled();
    });

    it('says the member cancelled when Google reports access_denied', async () => {
      const { service } = setup();

      const url = await service.callback({
        state: STATE,
        error: 'access_denied',
      });

      expect(url).toBe('https://app.frapp.live/events?gcal=denied');
    });

    it.each([
      ['no state', {}],
      ['a state that is not an id', { state: 'nope', code: 'c' }],
    ])('lands on the Events page as expired with %s', async (_label, query) => {
      const { service, repo } = setup();

      const url = await service.callback(query);

      expect(url).toBe('https://app.frapp.live/events?gcal=expired');
      expect(repo.findState).not.toHaveBeenCalled();
    });

    it('lands as expired, never throwing, when the sign-in can’t be read', async () => {
      const { service, repo } = setup();
      repo.findState.mockRejectedValue(new Error('pool exhausted'));

      const url = await service.callback({ state: STATE, code: 'c' });

      expect(url).toBe('https://app.frapp.live/events?gcal=expired');
    });
  });

  describe('confirm', () => {
    it('keeps the sealed token on a new connection, bound to the member', async () => {
      const { service, repo, google } = setup();

      await service.confirm(CHAPTER, USER, STATE, 'code-1');

      expect(repo.consumeState).toHaveBeenCalledWith(
        STATE,
        CHAPTER,
        USER,
        expect.any(Date),
      );
      expect(google.exchangeCode).toHaveBeenCalledWith(
        'code-1',
        'https://api.frapp.live/v1/google-calendar/callback',
        'verifier-1',
      );
      const created = (repo.create.mock.calls[0] as unknown[])[0] as {
        refresh_token_sealed: string;
      };
      expect(created).toMatchObject({
        chapter_id: CHAPTER,
        user_id: USER,
        google_email: 'member@gmail.com',
      });
      expect(created.refresh_token_sealed).not.toContain('refresh-1');
      const ring = googleCalendarTokenKeyRing({
        GOOGLE_CALENDAR_TOKEN_KEY: TOKEN_KEY,
      });
      expect(
        openRefreshToken(ring, created.refresh_token_sealed, CHAPTER, USER),
      ).toBe('refresh-1');
      // Bound to its member: it does not open as anyone else's.
      expect(() =>
        openRefreshToken(ring, created.refresh_token_sealed, CHAPTER, 'other'),
      ).toThrow();
    });

    it('refuses a sign-in that is not this member’s, or is spent or expired', async () => {
      const { service, repo, google } = setup();
      repo.consumeState.mockResolvedValue(null as never);

      await expect(
        service.confirm(CHAPTER, USER, STATE, 'code-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(google.exchangeCode).not.toHaveBeenCalled();
    });

    it('says Google did not finish when the code exchange fails', async () => {
      const { service, google, repo } = setup();
      google.exchangeCode.mockRejectedValue(
        new GoogleCalendarApiError('failed', 400, 'invalid_request'),
      );

      await expect(
        service.confirm(CHAPTER, USER, STATE, 'code-1'),
      ).rejects.toBeInstanceOf(BadGatewayException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('hands the token back when the member unticked the calendar permission', async () => {
      const { service, google, repo } = setup();
      google.exchangeCode.mockResolvedValue({
        refreshToken: 'refresh-1',
        email: 'member@gmail.com',
        scopes: ['openid', 'email'],
      });

      await expect(
        service.confirm(CHAPTER, USER, STATE, 'code-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(google.revoke).toHaveBeenCalledWith('refresh-1');
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('keeps the grant when the unticked account is connected elsewhere', async () => {
      const { service, google, repo } = setup();
      google.exchangeCode.mockResolvedValue({
        refreshToken: 'refresh-1',
        email: 'member@gmail.com',
        scopes: ['openid', 'email'],
      });
      repo.countForAccount.mockResolvedValue(1);

      await expect(
        service.confirm(CHAPTER, USER, STATE, 'code-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(google.revoke).not.toHaveBeenCalled();
    });

    it('connecting again on the same account keeps the calendar Frapp made', async () => {
      const { service, repo } = setup();
      repo.findLive.mockResolvedValue(
        connectionRow({
          status: 'needs_reconnect',
          google_email: 'Member@Gmail.com',
        }),
      );

      await service.confirm(CHAPTER, USER, STATE, 'code-1');

      expect(repo.replaceToken).toHaveBeenCalledWith(
        'conn-1',
        expect.objectContaining({ google_email: 'member@gmail.com' }),
      );
      expect(repo.create).not.toHaveBeenCalled();
      expect(repo.markDisconnecting).not.toHaveBeenCalled();
    });

    it('a different account replaces the old connection, which is cleaned up', async () => {
      const { service, repo } = setup();
      repo.findLive.mockResolvedValue(
        connectionRow({ google_email: 'old@gmail.com' }),
      );

      await service.confirm(CHAPTER, USER, STATE, 'code-1');

      expect(repo.markDisconnecting).toHaveBeenCalledWith('conn-1');
      expect(repo.create).toHaveBeenCalled();
    });
  });

  describe('status', () => {
    it('reports not connected, and whether it is offered', async () => {
      const { service } = setup({ configured: false });

      await expect(service.status(CHAPTER, USER)).resolves.toEqual({
        available: false,
        connected: false,
        status: null,
        google_email: null,
        last_synced_at: null,
      });
    });

    it('reports the account and the last sync, and a refused sign-in', async () => {
      const { service, repo } = setup();
      repo.findLive.mockResolvedValue(
        connectionRow({ status: 'needs_reconnect' }),
      );

      await expect(service.status(CHAPTER, USER)).resolves.toEqual({
        available: true,
        connected: true,
        status: 'needs_reconnect',
        google_email: 'member@gmail.com',
        last_synced_at: '2026-11-12T00:01:00.000Z',
      });
    });
  });

  describe('disconnect', () => {
    it('ends the connection for the member at once and cleans up at Google', async () => {
      const { service, repo, sync } = setup();
      repo.findLive.mockResolvedValue(connectionRow());

      await service.disconnect(CHAPTER, USER);

      expect(repo.markDisconnecting).toHaveBeenCalledWith('conn-1');
      // The row as it now stands: its clock starts at the disconnect.
      expect(sync.cleanUp).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'conn-1',
          status: 'disconnecting',
          sync_due_at: '2026-11-12T01:00:00.000Z',
        }),
      );
    });

    it('leaves the cleanup to the worker while a sync is in flight', async () => {
      // That sync may be making the calendar this very moment; cleaning up
      // now would miss it and leave it in the member's Google account.
      const { service, repo, sync } = setup();
      repo.findLive.mockResolvedValue(connectionRow());
      repo.markDisconnecting.mockResolvedValue(
        connectionRow({
          status: 'disconnecting',
          calendar_id: null,
          sync_lease_until: new Date(Date.now() + 60_000).toISOString(),
        }),
      );

      await service.disconnect(CHAPTER, USER);

      expect(repo.markDisconnecting).toHaveBeenCalledWith('conn-1');
      expect(sync.cleanUp).not.toHaveBeenCalled();
    });

    it('leaves the cleanup to the worker while Google Calendar is off', async () => {
      const { service, repo, sync } = setup();
      repo.findLive.mockResolvedValue(connectionRow());
      sync.isAvailable.mockReturnValue(false);

      await service.disconnect(CHAPTER, USER);

      expect(repo.markDisconnecting).toHaveBeenCalledWith('conn-1');
      expect(sync.cleanUp).not.toHaveBeenCalled();
    });

    it('does nothing when not connected', async () => {
      const { service, repo, sync } = setup();

      await service.disconnect(CHAPTER, USER);

      expect(repo.markDisconnecting).not.toHaveBeenCalled();
      expect(sync.cleanUp).not.toHaveBeenCalled();
    });
  });
});
