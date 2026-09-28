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
