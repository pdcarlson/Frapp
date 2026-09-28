import type { ConfigService } from '@nestjs/config';
import { REST } from '@discordjs/rest';
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

  it('refuses an answer with no application id', async () => {
    get.mockResolvedValue({ redirect_uris: [] });
    await expect(gateway().fetchApplication()).rejects.toBeInstanceOf(
      DiscordApiError,
    );
  });
});
