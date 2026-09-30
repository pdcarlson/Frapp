import type { ConfigService } from '@nestjs/config';
import { DiscordOAuthClientService } from './discord-oauth-client.service';

/**
 * The authorize URL is the consent a human sees on Discord's screen, so what
 * it asks for is a product promise, not an implementation detail: the bot
 * install asks for the bot and the server list, and a member proving which
 * account is theirs (#2878) asks for their identity and nothing else.
 */
function client(): DiscordOAuthClientService {
  const settings: Record<string, string> = {
    DISCORD_CLIENT_ID: '1541430523090698250',
    DISCORD_CLIENT_SECRET: 'secret',
  };
  return new DiscordOAuthClientService({
    get: (key: string) => settings[key],
  } as unknown as ConfigService);
}

const REDIRECT = 'https://api.example.test/v1/discord/connect/callback';

describe('DiscordOAuthClientService.buildAuthorizeUrl', () => {
  it('asks a member linking their account for identify only: no bot, no permissions, no servers', () => {
    const url = new URL(
      client().buildAuthorizeUrl({
        state: 'state-1',
        redirectUri: REDIRECT,
        grant: 'identify',
      }),
    );

    expect(url.searchParams.get('scope')).toBe('identify');
    expect(url.searchParams.has('permissions')).toBe(false);
    expect(url.searchParams.has('integration_type')).toBe(false);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(url.searchParams.get('state')).toBe('state-1');
    // The account is shown every time, so a member signed in to the wrong
    // one sees it before approving.
    expect(url.searchParams.get('prompt')).toBe('consent');
  });

  it('keeps the bot install unchanged when no grant is named', () => {
    const url = new URL(
      client().buildAuthorizeUrl({ state: 'state-1', redirectUri: REDIRECT }),
    );

    expect(url.searchParams.get('scope')).toBe('bot identify guilds');
    expect(url.searchParams.get('permissions')).toBe('66560');
  });
});
