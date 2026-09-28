import type { ConfigService } from '@nestjs/config';
import { REST, RESTEvents } from '@discordjs/rest';
import { DiscordApiError } from '#domain/adapters/discord.interface';
import { DiscordBotGatewayService } from './discord-bot-gateway.service';

function gateway(token: string | undefined = 'bot-token') {
  return new DiscordBotGatewayService({
    get: (key: string) => (key === 'DISCORD_BOT_TOKEN' ? token : undefined),
  } as unknown as ConfigService);
}

describe('DiscordBotGatewayService.fetchApplication', () => {
  let get: jest.SpyInstance;

  beforeEach(() => {
    get = jest.spyOn(REST.prototype, 'get');
  });

  afterEach(() => {
    get.mockRestore();
  });

  it('reads GET /applications/@me, bounded by a timeout', async () => {
    get.mockResolvedValue({
      id: '1541430523090698250',
      redirect_uris: ['https://api.example.test/v1/discord/connect/callback'],
    });

    await expect(gateway().fetchApplication()).resolves.toEqual({
      id: '1541430523090698250',
      redirectUris: ['https://api.example.test/v1/discord/connect/callback'],
    });
    expect(get).toHaveBeenCalledWith(
      '/applications/@me',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('reports an absent redirect_uris as null, never as an empty list', async () => {
    // Empty would read as "nothing registered" and withdraw a working flow.
    get.mockResolvedValue({ id: '1541430523090698250' });
    await expect(gateway().fetchApplication()).resolves.toEqual({
      id: '1541430523090698250',
      redirectUris: null,
    });
  });

  it('drops non-string entries rather than trusting the shape', async () => {
    get.mockResolvedValue({
      id: '1541430523090698250',
      redirect_uris: ['https://a.example.test/cb', 7, null],
    });
    await expect(gateway().fetchApplication()).resolves.toMatchObject({
      redirectUris: ['https://a.example.test/cb'],
    });
  });

  it('carries Discord’s status on a refusal, so a dead token reads as 401', async () => {
    get.mockRejectedValue(
      Object.assign(new Error('401: Unauthorized'), { status: 401 }),
    );
    const failure = gateway().fetchApplication();
    await expect(failure).rejects.toBeInstanceOf(DiscordApiError);
    await expect(failure).rejects.toMatchObject({ status: 401 });
  });

  it('remembers a 401 from any bot call, because the client discards the token', async () => {
    // @discordjs/rest clears its token on an authenticated 401, after which
    // every request fails with a status-less "Expected token to be set". An
    // import slice is as likely to meet the 401 first as the setup check is.
    const gw = gateway();
    get.mockImplementationOnce(function (this: REST) {
      this.emit(
        RESTEvents.Response,
        { data: { auth: true } } as never,
        { status: 401 } as never,
      );
      return Promise.reject(
        Object.assign(new Error('401: Unauthorized'), { status: 401 }),
      );
    });
    await expect(gw.fetchApplication()).rejects.toMatchObject({ status: 401 });

    // Every later check still reads 401, without asking Discord again.
    get.mockRejectedValue(
      new Error(
        'Expected token to be set for this request, but none was present',
      ),
    );
    await expect(gw.fetchApplication()).rejects.toMatchObject({ status: 401 });
    await expect(gw.fetchApplication()).rejects.toBeInstanceOf(DiscordApiError);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('reads the status-less "no token" error as 401 when the 401 landed mid-call', async () => {
    // A concurrent import slice's 401 clears the shared client's token while
    // this check is queued; the check then fails with no status of its own.
    const gw = gateway();
    get.mockImplementationOnce(function (this: REST) {
      this.emit(
        RESTEvents.Response,
        { data: { auth: true } } as never,
        { status: 401 } as never,
      );
      return Promise.reject(
        new Error(
          'Expected token to be set for this request, but none was present',
        ),
      );
    });
    await expect(gw.fetchApplication()).rejects.toMatchObject({ status: 401 });
    expect(gw.hasRejectedToken()).toBe(true);
  });

  it('ignores a 401 on an unauthenticated request', async () => {
    const gw = gateway();
    get.mockImplementationOnce(function (this: REST) {
      this.emit(
        RESTEvents.Response,
        { data: { auth: false } } as never,
        { status: 401 } as never,
      );
      return Promise.resolve({ id: '1541430523090698250', redirect_uris: [] });
    });
    await gw.fetchApplication();
    get.mockResolvedValue({ id: '1541430523090698250', redirect_uris: [] });
    await expect(gw.fetchApplication()).resolves.toBeDefined();
  });

  it('gives up after its own deadline even while the client is still waiting', async () => {
    // The client honours `signal` in its queue and fetch, but not in its
    // rate-limit sleeps, so a request stuck behind a 429 never settles.
    jest.useFakeTimers();
    try {
      get.mockReturnValue(new Promise(() => undefined));
      const pending = gateway().fetchApplication();
      const settled = expect(pending).rejects.toMatchObject({
        name: 'DiscordApiError',
        status: null,
      });
      await jest.advanceTimersByTimeAsync(5_000);
      await settled;
    } finally {
      jest.useRealTimers();
    }
  });

  it('refuses an answer with no application id', async () => {
    get.mockResolvedValue({ redirect_uris: [] });
    await expect(gateway().fetchApplication()).rejects.toBeInstanceOf(
      DiscordApiError,
    );
  });
});

describe('DiscordBotGatewayService.discoverChannels: who can read what', () => {
  const GUILD = '100000000000000001';
  const BOT = '500000000000000005';
  const FRAPP_ROLE = '400000000000000004';
  const BROTHER = '200000000000000002';
  const READ = String((1n << 10n) | (1n << 16n));
  const VIEW = String(1n << 10n);

  let get: jest.SpyInstance;
  let calls: string[];

  function serve(overrides: Record<string, unknown> = {}) {
    calls = [];
    const routes: Record<string, unknown> = {
      [`/guilds/${GUILD}/channels`]: [
        { id: '10', type: 4, name: 'Brothers' },
        // Open to everyone.
        { id: '11', type: 0, name: 'anyone', parent_id: null },
        // @everyone denied, Brother allowed: the Tau Nu shape.
        {
          id: '12',
          type: 0,
          name: 'brothers',
          parent_id: '10',
          permission_overwrites: [
            { id: GUILD, type: 0, allow: '0', deny: VIEW },
            { id: BROTHER, type: 0, allow: READ, deny: '0' },
          ],
        },
      ],
      [`/guilds/${GUILD}/roles`]: [
        { id: GUILD, name: '@everyone', permissions: READ },
        { id: FRAPP_ROLE, name: 'Frapp', permissions: READ },
        { id: BROTHER, name: 'Brother', permissions: '0' },
      ],
      '/users/@me': { id: BOT },
      [`/guilds/${GUILD}/members/${BOT}`]: { roles: [FRAPP_ROLE] },
      [`/guilds/${GUILD}/threads/active`]: {
        threads: [
          {
            id: '21',
            type: 11,
            name: 'open thread',
            parent_id: '11',
            guild_id: GUILD,
          },
          {
            id: '22',
            type: 12,
            name: 'bids',
            parent_id: '11',
            guild_id: GUILD,
          },
        ],
      },
      '/channels/11/threads/archived/public': { threads: [], has_more: false },
      '/channels/11/threads/archived/private': Object.assign(
        new Error('Missing Permissions'),
        { status: 403 },
      ),
      ...overrides,
    };
    get = jest
      .spyOn(REST.prototype, 'get')
      .mockImplementation((route: string) => {
        calls.push(route);
        if (!(route in routes)) {
          return Promise.reject(
            Object.assign(new Error(`unmocked ${route}`), { status: 404 }),
          );
        }
        const answer = routes[route];
        return answer instanceof Error
          ? Promise.reject(answer)
          : Promise.resolve(answer);
      });
  }

  afterEach(() => get.mockRestore());

  it('marks the channels the bot cannot read, and says so once instead of probing each', async () => {
    serve();
    const { channels, warnings, roles } =
      await gateway().discoverChannels(GUILD);

    // The worksheet's role names come from the same read, not a second one.
    expect(roles.map((role) => role.name)).toEqual([
      '@everyone',
      'Frapp',
      'Brother',
    ]);
    expect(
      calls.filter((route) => route === `/guilds/${GUILD}/roles`),
    ).toHaveLength(1);

    const byId = new Map(channels.map((channel) => [channel.id, channel]));
    expect(byId.get('11')).toMatchObject({
      readable: true,
      privateInDiscord: false,
    });
    expect(byId.get('12')).toMatchObject({
      readable: false,
      privateInDiscord: true,
      categoryName: 'Brothers',
    });
    // A thread carries its parent's answers...
    expect(byId.get('21')).toMatchObject({
      readable: true,
      privateInDiscord: false,
    });
    // ...except that a private thread stays private under a public parent.
    expect(byId.get('22')).toMatchObject({
      readable: true,
      privateInDiscord: true,
    });

    // No 403-earning thread probe for a channel already known unreadable.
    expect(calls).not.toContain('/channels/12/threads/archived/public');
    expect(
      warnings.filter((warning) => warning.includes('Frapp cannot read')),
    ).toEqual([expect.stringContaining('1 channel(s) (#brothers)')]);
    expect(warnings.join(' ')).not.toMatch(/were not imported|was imported/);
  });

  it('reads it once the bot holds the role the channel allows', async () => {
    serve({
      [`/guilds/${GUILD}/members/${BOT}`]: { roles: [FRAPP_ROLE, BROTHER] },
    });
    const { channels, warnings } = await gateway().discoverChannels(GUILD);
    expect(channels.find((channel) => channel.id === '12')).toMatchObject({
      readable: true,
      privateInDiscord: true,
    });
    expect(warnings.join(' ')).not.toContain('Frapp cannot read');
  });

  const forbidden = () =>
    Object.assign(new Error('Missing Access'), { status: 403 });

  it("falls back to probing when the bot's own membership cannot be read, and lets Discord's answer settle it", async () => {
    serve({
      [`/guilds/${GUILD}/members/${BOT}`]: Object.assign(new Error('nope'), {
        status: 500,
      }),
      '/channels/12/threads/archived/public': forbidden(),
    });
    const { channels, warnings } = await gateway().discoverChannels(GUILD);
    const byId = new Map(channels.map((channel) => [channel.id, channel]));
    expect(calls).toContain('/channels/12/threads/archived/public');
    // Privacy is an @everyone question, so it is still known.
    expect(byId.get('12')).toMatchObject({
      readable: false,
      privateInDiscord: true,
    });
    expect(byId.get('11')).toMatchObject({ readable: true });
    // The 403 joins the one "cannot read" line; no warning per channel.
    expect(warnings).toEqual([
      expect.stringContaining('Frapp cannot read 1 channel(s) (#brothers)'),
      expect.stringContaining('Private archived threads cannot be read'),
    ]);
  });

  it('knows neither when the roles cannot be read, and tells the admin privacy is unknown', async () => {
    serve({
      [`/guilds/${GUILD}/roles`]: Object.assign(new Error('nope'), {
        status: 500,
      }),
    });
    const { channels, warnings, roles } =
      await gateway().discoverChannels(GUILD);
    expect(channels.find((channel) => channel.id === '12')).toMatchObject({
      readable: null,
      privateInDiscord: null,
    });
    // Nothing throws: the scan still returns, with no roles to map.
    expect(roles).toEqual([]);
    expect(warnings).toContainEqual(
      expect.stringContaining(
        'cannot tell which channels are private in Discord',
      ),
    );
  });
});
