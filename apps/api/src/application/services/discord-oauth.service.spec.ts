import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  DEFAULT_RETURN_PATH,
  DiscordOAuthService,
  safeReturnPath,
} from './discord-oauth.service';
import {
  DISCORD_BOT_GATEWAY,
  DISCORD_OAUTH_CLIENT,
} from '../../domain/adapters/discord.interface';
import { DISCORD_CONNECTION_REPOSITORY } from '../../domain/repositories/discord-connection.repository.interface';
import type { DiscordOAuthState } from '../../domain/entities/discord-connection.entity';

const CHAPTER = 'chapter-1';
const OTHER_CHAPTER = 'chapter-2';
const USER = 'user-1';
const GUILD = '800000000000000001';
const STATE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOW = new Date('2026-08-24T12:00:00Z');

/** Manage Server (1 << 5). */
const MANAGE_GUILD = String(1n << 5n);
/** Administrator (1 << 3). */
const ADMINISTRATOR = String(1n << 3n);
/** Send Messages (1 << 11) — a real permission that is not enough. */
const SEND_MESSAGES = String(1n << 11n);

function stateRow(
  overrides: Partial<DiscordOAuthState> = {},
): DiscordOAuthState {
  return {
    id: STATE,
    chapter_id: CHAPTER,
    created_by: USER,
    return_path: DEFAULT_RETURN_PATH,
    expires_at: new Date(NOW.getTime() + 60_000).toISOString(),
    consumed_at: null,
    created_at: NOW.toISOString(),
    ...overrides,
  };
}

let repo: Record<string, jest.Mock>;
let oauth: Record<string, jest.Mock>;
let bot: Record<string, jest.Mock>;

async function build(config: Record<string, string | undefined> = {}) {
  repo = {
    findByChapter: jest.fn(async () => null),
    upsert: jest.fn(async (input: Record<string, unknown>) => ({
      id: 'conn-1',
      created_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
      ...input,
    })),
    deleteByChapter: jest.fn(async () => true),
    createState: jest.fn(async () => stateRow()),
    consumeState: jest.fn(async () => stateRow()),
    deleteExpiredStates: jest.fn(async () => 0),
  };
  oauth = {
    isConfigured: jest.fn(() => true),
    buildAuthorizeUrl: jest.fn(
      ({ state, redirectUri }: { state: string; redirectUri: string }) =>
        `https://discord.com/oauth2/authorize?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`,
    ),
    exchangeCode: jest.fn(async () => ({
      accessToken: 'user-token',
      scope: 'bot identify guilds',
      guild: { id: GUILD, name: 'Tau Nu', icon: null },
    })),
    fetchAuthorizingUser: jest.fn(async () => ({
      id: '2000000000000000002',
      username: 'Paul',
    })),
    fetchUserGuilds: jest.fn(async () => [
      { id: GUILD, name: 'Tau Nu', permissions: MANAGE_GUILD, owner: false },
    ]),
    revokeToken: jest.fn(async () => undefined),
  };
  bot = { isConfigured: jest.fn(() => true) };

  const settings: Record<string, string | undefined> = {
    API_URL: 'https://api.example.test',
    APP_URL: 'https://app.example.test',
    ...config,
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      DiscordOAuthService,
      { provide: DISCORD_CONNECTION_REPOSITORY, useValue: repo },
      { provide: DISCORD_OAUTH_CLIENT, useValue: oauth },
      { provide: DISCORD_BOT_GATEWAY, useValue: bot },
      {
        provide: ConfigService,
        useValue: { get: (key: string) => settings[key] },
      },
    ],
  }).compile();
  return moduleRef.get(DiscordOAuthService);
}

describe('DiscordOAuthService — availability', () => {
  it('is unavailable when any one of the four settings is missing', async () => {
    // Three of four is not a degraded mode, it is a flow that strands the admin
    // on a Discord page with nowhere to come back to.
    for (const missing of ['API_URL', 'APP_URL'] as const) {
      const service = await build({ [missing]: undefined });
      expect(service.isAvailable()).toBe(false);
    }

    const noClient = await build();
    oauth.isConfigured.mockReturnValue(false);
    expect(noClient.isAvailable()).toBe(false);

    const noBot = await build();
    bot.isConfigured.mockReturnValue(false);
    expect(noBot.isAvailable()).toBe(false);
  });

  it('refuses to begin a connect it cannot finish', async () => {
    const service = await build({ APP_URL: undefined });
    await expect(
      service.beginConnect(CHAPTER, USER, null),
    ).rejects.toMatchObject({ status: 503 });
    expect(repo.createState).not.toHaveBeenCalled();
  });
});

describe('DiscordOAuthService — beginConnect', () => {
  it('mints the state before handing out the URL', async () => {
    const service = await build();
    const result = await service.beginConnect(CHAPTER, USER, null);

    expect(repo.createState).toHaveBeenCalledWith(
      expect.objectContaining({ chapter_id: CHAPTER, created_by: USER }),
    );
    expect(result.authorize_url).toContain(`state=${STATE}`);
    // The redirect URI is derived from API_URL plus the fixed path, because
    // Discord matches it against the Developer Portal entry exactly.
    expect(result.authorize_url).toContain(
      encodeURIComponent(
        'https://api.example.test/v1/discord/connect/callback',
      ),
    );
  });

  it('stores a sanitised return path, not whatever the caller sent', async () => {
    const service = await build();
    await service.beginConnect(CHAPTER, USER, '//evil.example.com/phish');
    expect(repo.createState).toHaveBeenCalledWith(
      expect.objectContaining({ return_path: DEFAULT_RETURN_PATH }),
    );
  });
});

describe('DiscordOAuthService — the callback’s trust boundary', () => {
  it('takes the guild from the token exchange, never from the query string', async () => {
    const service = await build();
    // The browser claims a different guild. It must be ignored entirely: the
    // callback reads `guild` off the server-to-server token response.
    const outcome = await service.handleCallback({
      code: 'one-time-code',
      state: STATE,
      // A forged `guild_id` is not even a parameter this method accepts —
      // that is the point. Assert the stored value came from the exchange.
    });

    expect(outcome.ok).toBe(true);
    expect(repo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ guild_id: GUILD, chapter_id: CHAPTER }),
    );
  });

  it('takes the chapter from the state row, which the callback cannot supply', async () => {
    const service = await build();
    repo.consumeState.mockResolvedValue(
      stateRow({ chapter_id: OTHER_CHAPTER }),
    );

    await service.handleCallback({ code: 'c', state: STATE });

    // No header, no session, no body — the chapter can only come from here.
    expect(repo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ chapter_id: OTHER_CHAPTER }),
    );
  });

  it('refuses a state the repository would not spend', async () => {
    const service = await build();
    repo.consumeState.mockResolvedValue(null);

    const outcome = await service.handleCallback({ code: 'c', state: STATE });

    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('expired');
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('does not even ask the repository about a non-uuid state', async () => {
    const service = await build();
    const outcome = await service.handleCallback({
      code: 'c',
      state: "' or 1=1--",
    });
    expect(outcome.code).toBe('expired');
    expect(repo.consumeState).not.toHaveBeenCalled();
  });

  it('spends the state even when Discord reports a denial', async () => {
    // Otherwise a cancelled attempt leaves a live state that could be replayed
    // later with a code obtained some other way.
    const service = await build();
    const outcome = await service.handleCallback({
      state: STATE,
      error: 'access_denied',
    });

    expect(repo.consumeState).toHaveBeenCalledWith(STATE, expect.any(Date));
    expect(outcome.code).toBe('declined');
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('rejects an authorization that installed the bot nowhere', async () => {
    const service = await build();
    oauth.exchangeCode.mockResolvedValue({
      accessToken: 't',
      scope: 'identify guilds',
      guild: null,
    });

    const outcome = await service.handleCallback({ code: 'c', state: STATE });

    expect(outcome.code).toBe('no_guild');
    expect(repo.upsert).not.toHaveBeenCalled();
  });
});

describe('DiscordOAuthService — proving the human runs the server', () => {
  it('accepts Manage Server', async () => {
    const service = await build();
    const outcome = await service.handleCallback({ code: 'c', state: STATE });
    expect(outcome.ok).toBe(true);
  });

  it('accepts Administrator', async () => {
    const service = await build();
    oauth.fetchUserGuilds.mockResolvedValue([
      { id: GUILD, name: 'Tau Nu', permissions: ADMINISTRATOR, owner: false },
    ]);
    const outcome = await service.handleCallback({ code: 'c', state: STATE });
    expect(outcome.ok).toBe(true);
  });

  it('accepts the guild owner, whose bitfield can omit the flags', async () => {
    const service = await build();
    oauth.fetchUserGuilds.mockResolvedValue([
      { id: GUILD, name: 'Tau Nu', permissions: '0', owner: true },
    ]);
    const outcome = await service.handleCallback({ code: 'c', state: STATE });
    expect(outcome.ok).toBe(true);
  });

  it('REFUSES an ordinary member of the server', async () => {
    // The core of the whole flow: being in a server is not administering it.
    // Without this, anyone who could reach a chapter's authorize URL could
    // attach a Discord community that never agreed to be read.
    const service = await build();
    oauth.fetchUserGuilds.mockResolvedValue([
      { id: GUILD, name: 'Tau Nu', permissions: SEND_MESSAGES, owner: false },
    ]);

    const outcome = await service.handleCallback({ code: 'c', state: STATE });

    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('no_permission');
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('REFUSES when the authorizer administers a DIFFERENT server', async () => {
    // Manage Server somewhere else is not Manage Server here. The membership
    // has to be matched by guild id, not merely be present in the list.
    const service = await build();
    oauth.fetchUserGuilds.mockResolvedValue([
      {
        id: '999999999',
        name: 'Other',
        permissions: ADMINISTRATOR,
        owner: true,
      },
    ]);

    const outcome = await service.handleCallback({ code: 'c', state: STATE });

    expect(outcome.code).toBe('not_member');
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('reads the bitfield as BigInt, so a past-2^53 flag is not rounded away', async () => {
    const service = await build();
    // Manage Server set alongside a very high bit. Number() would lose the
    // low bits entirely and decide this user has no permissions.
    const huge = String((1n << 5n) | (1n << 60n));
    oauth.fetchUserGuilds.mockResolvedValue([
      { id: GUILD, name: 'Tau Nu', permissions: huge, owner: false },
    ]);

    const outcome = await service.handleCallback({ code: 'c', state: STATE });
    expect(outcome.ok).toBe(true);
  });

  it('treats an unparseable bitfield as no permission', async () => {
    const service = await build();
    oauth.fetchUserGuilds.mockResolvedValue([
      { id: GUILD, name: 'Tau Nu', permissions: 'not-a-number', owner: false },
    ]);

    const outcome = await service.handleCallback({ code: 'c', state: STATE });
    expect(outcome.code).toBe('no_permission');
  });

  it('revokes the user token once the two reads are done', async () => {
    const service = await build();
    await service.handleCallback({ code: 'c', state: STATE });
    expect(oauth.revokeToken).toHaveBeenCalledWith('user-token');
  });

  it('revokes the token even when the permission check refuses', async () => {
    const service = await build();
    oauth.fetchUserGuilds.mockResolvedValue([
      { id: GUILD, name: 'Tau Nu', permissions: SEND_MESSAGES, owner: false },
    ]);
    await service.handleCallback({ code: 'c', state: STATE });
    expect(oauth.revokeToken).toHaveBeenCalledWith('user-token');
  });
});

describe('DiscordOAuthService — the redirect back', () => {
  it('sends the browser to the configured app origin, never elsewhere', async () => {
    const service = await build();
    // Even a stored path that somehow got past validation is resolved against
    // APP_URL, so it cannot leave the origin.
    repo.consumeState.mockResolvedValue(
      stateRow({ return_path: 'https://evil.example.com/phish' }),
    );

    const outcome = await service.handleCallback({ code: 'c', state: STATE });

    expect(new URL(outcome.returnUrl).origin).toBe('https://app.example.test');
  });

  it('carries only an enumerated code, never supplied error text', async () => {
    const service = await build();
    const outcome = await service.handleCallback({
      state: STATE,
      error: 'server_error',
      error_description: '<script>alert(1)</script> contact evil.example.com',
    });

    const url = new URL(outcome.returnUrl);
    expect(url.searchParams.get('discord')).toBe('failed');
    // Nothing an outside party wrote reaches the dashboard's own chrome.
    expect(outcome.returnUrl).not.toContain('evil.example.com');
    expect(outcome.returnUrl).not.toContain('script');
  });
});

describe('DiscordOAuthService — requireGuildId is the only way in', () => {
  it('resolves the guild through the chapter, and refuses without a connection', async () => {
    const service = await build();
    await expect(service.requireGuildId(CHAPTER)).rejects.toMatchObject({
      status: 400,
    });

    repo.findByChapter.mockResolvedValue({ guild_id: GUILD });
    await expect(service.requireGuildId(CHAPTER)).resolves.toBe(GUILD);
    expect(repo.findByChapter).toHaveBeenCalledWith(CHAPTER);
  });
});

describe('safeReturnPath', () => {
  it('keeps an ordinary site-relative path', () => {
    expect(safeReturnPath('/discord-import?tab=bot')).toBe(
      '/discord-import?tab=bot',
    );
  });

  it('rejects every shape that leaves the origin', () => {
    for (const hostile of [
      'https://evil.example.com',
      '//evil.example.com',
      // Browsers read a backslash as a separator on special-scheme URLs.
      '/\\evil.example.com',
      'javascript:alert(1)',
      'discord-import',
      '',
    ]) {
      expect(safeReturnPath(hostile)).toBe(DEFAULT_RETURN_PATH);
    }
  });

  it('rejects control characters the URL parser would delete mid-parse', () => {
    // `/\t/evil.com` is not the string that was checked by the time the
    // browser resolves it — the parser strips tab, LF and CR first.
    for (const hostile of [
      '/\t/evil.example.com',
      '/\n//evil.example.com',
      '/\r\n/x',
    ]) {
      expect(safeReturnPath(hostile)).toBe(DEFAULT_RETURN_PATH);
    }
  });

  it('falls back for null and undefined', () => {
    expect(safeReturnPath(null)).toBe(DEFAULT_RETURN_PATH);
    expect(safeReturnPath(undefined)).toBe(DEFAULT_RETURN_PATH);
  });
});
