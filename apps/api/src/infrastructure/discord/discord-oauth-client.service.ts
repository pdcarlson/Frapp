import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DISCORD_BOT_PERMISSIONS,
  DISCORD_OAUTH_SCOPES,
  DiscordApiError,
  DiscordNotConfiguredError,
  type DiscordAuthorizingUser,
  type DiscordTokenExchangeResult,
  type DiscordUserGuild,
  type IDiscordOAuthClient,
} from '#domain/adapters/discord.interface';
import { asRecord, asString } from '#domain/utils/json-guards';

const DISCORD_AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
const DISCORD_TOKEN_URL = 'https://discord.com/api/v10/oauth2/token';
const DISCORD_TOKEN_REVOKE_URL =
  'https://discord.com/api/v10/oauth2/token/revoke';
const DISCORD_API_BASE = 'https://discord.com/api/v10';

/** The handshake is interactive; a hung call is worse than a failed one. */
const OAUTH_TIMEOUT_MS = 10_000;

/**
 * The connecting admin's half of the Discord handshake.
 *
 * Written against `fetch` rather than `@discordjs/rest`, on purpose: every call
 * here authenticates as **the human**, with either HTTP Basic (the app's own
 * client credentials, for the token endpoint) or a short-lived user bearer
 * token. `@discordjs/rest` is configured with the BOT token and shares one
 * rate-limit queue across every chapter's import — putting a user-token call
 * through it would mean either leaking the bot token onto a user request or
 * fighting the client to suppress it. Two principals, two clients.
 *
 * Nothing here is stored. The user access token exists for exactly two reads
 * — who authorized, and what they can do in that guild — and is revoked
 * immediately afterwards.
 */
@Injectable()
export class DiscordOAuthClientService implements IDiscordOAuthClient {
  private readonly logger = new Logger(DiscordOAuthClientService.name);
  private readonly clientId: string | null;
  private readonly clientSecret: string | null;

  constructor(config: ConfigService) {
    this.clientId = config.get<string>('DISCORD_CLIENT_ID')?.trim() || null;
    this.clientSecret =
      config.get<string>('DISCORD_CLIENT_SECRET')?.trim() || null;
    if (!this.isConfigured()) {
      this.logger.log(
        'DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET are unset; the Discord connect flow is disabled.',
      );
    }
  }

  isConfigured(): boolean {
    return this.clientId !== null && this.clientSecret !== null;
  }

  private credentials(): { id: string; secret: string } {
    if (!this.clientId || !this.clientSecret) {
      throw new DiscordNotConfiguredError(
        'The Discord application is not configured in this environment.',
      );
    }
    return { id: this.clientId, secret: this.clientSecret };
  }

  buildAuthorizeUrl(args: { state: string; redirectUri: string }): string {
    const { id } = this.credentials();
    const url = new URL(DISCORD_AUTHORIZE_URL);
    url.searchParams.set('client_id', id);
    url.searchParams.set('scope', DISCORD_OAUTH_SCOPES.join(' '));
    url.searchParams.set('permissions', DISCORD_BOT_PERMISSIONS);
    // `code` rather than the bot-only `none`: `identify` and `guilds` are only
    // usable through a token, and the token is what proves the authorizing
    // human runs the server. A bot-only install would tell us a bot joined
    // something and nothing about who let it in.
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', args.redirectUri);
    url.searchParams.set('state', args.state);
    // Forces the server picker every time. Without it Discord may reuse a
    // previous grant, and an admin connecting a second chapter would silently
    // re-confirm the first chapter's guild.
    url.searchParams.set('prompt', 'consent');
    // Keeps the guild picker on the consent screen honest: the user chooses,
    // and a `guild_id` we pre-filled could not be mistaken for their choice.
    url.searchParams.set('integration_type', '0');
    return url.toString();
  }

  async exchangeCode(args: {
    code: string;
    redirectUri: string;
  }): Promise<DiscordTokenExchangeResult> {
    const { id, secret } = this.credentials();

    const response = await fetch(DISCORD_TOKEN_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        // HTTP Basic rather than client_secret in the body: both are accepted
        // by Discord, and Basic keeps the secret out of anything that logs a
        // request body.
        authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: args.code,
        redirect_uri: args.redirectUri,
      }),
      signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
    });

    const body = asRecord(await response.json().catch(() => null));
    if (!response.ok) {
      // Discord's error body names the cause (`invalid_grant` for a reused or
      // expired code, `invalid_client` for bad credentials). Worth surfacing:
      // the two failures need completely different fixes and the admin cannot
      // tell them apart from "connecting failed".
      throw new DiscordApiError(
        `Discord refused the authorization code: ${asString(body?.error) ?? response.statusText}`,
        response.status,
      );
    }

    const accessToken = asString(body?.access_token);
    if (!accessToken) {
      throw new DiscordApiError('Discord returned no access token.');
    }

    // The guild object rides on the token response for a `bot`-scope grant.
    // THIS is the guild the flow trusts — it came back over a server-to-server
    // call keyed by a one-time code, not off the redirect's query string.
    const guild = asRecord(body?.guild);
    const guildId = asString(guild?.id);

    return {
      accessToken,
      scope: asString(body?.scope) ?? '',
      guild: guildId
        ? {
            id: guildId,
            name: asString(guild?.name),
            icon: asString(guild?.icon),
          }
        : null,
    };
  }

  async fetchAuthorizingUser(
    accessToken: string,
  ): Promise<DiscordAuthorizingUser> {
    const body = asRecord(await this.getAsUser('/users/@me', accessToken));
    const id = asString(body?.id);
    if (!id) {
      throw new DiscordApiError('Discord returned no user for this token.');
    }
    return {
      id,
      username: asString(body?.global_name) ?? asString(body?.username),
    };
  }

  async fetchUserGuilds(accessToken: string): Promise<DiscordUserGuild[]> {
    const raw = await this.getAsUser('/users/@me/guilds', accessToken);
    if (!Array.isArray(raw)) return [];

    const guilds: DiscordUserGuild[] = [];
    for (const entry of raw) {
      const guild = asRecord(entry);
      const id = asString(guild?.id);
      if (!id) continue;
      guilds.push({
        id,
        name: asString(guild?.name),
        // Discord sends the bitfield as a decimal STRING because it exceeds
        // 2^53. Keeping it a string all the way to the BigInt comparison is
        // what stops a permission check from being decided by a rounded float.
        permissions: asString(guild?.permissions) ?? '0',
        owner: guild?.owner === true,
      });
    }
    return guilds;
  }

  async revokeToken(accessToken: string): Promise<void> {
    const { id, secret } = this.credentials();
    try {
      await fetch(DISCORD_TOKEN_REVOKE_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
        },
        body: new URLSearchParams({
          token: accessToken,
          token_type_hint: 'access_token',
        }),
        signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
      });
    } catch (error) {
      // Best-effort by design. The token is never stored and expires on its
      // own; failing the connection over a failed revoke would turn a hygiene
      // step into an outage.
      this.logger.warn(
        `Could not revoke the Discord user token: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async getAsUser(path: string, accessToken: string): Promise<unknown> {
    const response = await fetch(`${DISCORD_API_BASE}${path}`, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new DiscordApiError(
        `Discord refused ${path}: ${response.statusText}`,
        response.status,
      );
    }
    return response.json().catch(() => null);
  }
}
