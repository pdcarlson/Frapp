import { Injectable } from '@nestjs/common';
import {
  CLIENT_PLATFORMS,
  type ClientPlatform,
  isBelowMinimum,
  parseClientVersionHeader,
  parseVersionWithBuild,
} from '#domain/constants/client-version';

/**
 * The minimum mobile build this deployment serves, per platform (#2526).
 *
 * Optional, like `EVENT_CHECK_IN_TOKEN_SECRET`: unset means no minimum, so
 * every binary is supported and local dev, tests and CI need nothing. Set one
 * in Infisical for the environment, and Render restarts the API with it. The
 * format is `<version>[+<build>]` (`0.9.1`, or `0.9.0+14` to retire earlier
 * builds of one version); `validateClientPolicyEnv` refuses anything else at
 * boot, because a typo that parsed as "no minimum" would switch the gate off
 * without a sound.
 */
export const MINIMUM_VERSION_ENV: Readonly<Record<ClientPlatform, string>> = {
  ios: 'MOBILE_MIN_VERSION_IOS',
  android: 'MOBILE_MIN_VERSION_ANDROID',
};

/**
 * Where the blocking update screen sends the member. Optional overrides for
 * {@link DEFAULT_UPDATE_URLS}: during the beta the right place may be a
 * TestFlight link rather than the App Store listing, and the binary cannot
 * learn a new link any other way, which is why it is never baked into it.
 */
export const UPDATE_URL_ENV: Readonly<Record<ClientPlatform, string>> = {
  ios: 'MOBILE_UPDATE_URL_IOS',
  android: 'MOBILE_UPDATE_URL_ANDROID',
};

/**
 * The store listings. The App Store id is App Store Connect's Apple ID for
 * `live.frapp.mobile` (`apps/mobile/store/README.md`); the Play URL keys on
 * the package name, which is permanent from the first upload.
 */
export const DEFAULT_UPDATE_URLS: Readonly<Record<ClientPlatform, string>> = {
  ios: 'https://apps.apple.com/app/id6812025642',
  android: 'https://play.google.com/store/apps/details?id=live.frapp.mobile',
};

export interface ClientPolicy {
  updateRequired: boolean;
  updateUrl: string | null;
}

type Env = Record<string, unknown>;

function envValue(env: Env, name: string): string | undefined {
  const value = env[name];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Boot-time check for the four optional variables, called from
 * `validateEnv`. Returns one message per bad value, so a single deploy
 * attempt names everything that is wrong.
 */
export function validateClientPolicyEnv(env: Env): string[] {
  const problems: string[] = [];
  for (const platform of CLIENT_PLATFORMS) {
    const minName = MINIMUM_VERSION_ENV[platform];
    const minimum = envValue(env, minName);
    if (minimum !== undefined && parseVersionWithBuild(minimum) === null) {
      problems.push(
        `${minName} must be a version like 0.9.1 or 0.9.0+14, or unset for no minimum.`,
      );
    }
    const urlName = UPDATE_URL_ENV[platform];
    const url = envValue(env, urlName);
    if (url !== undefined && !isHttpsUrl(url)) {
      problems.push(
        `${urlName} must be an https:// URL, or unset for the store listing.`,
      );
    }
  }
  return problems;
}

/**
 * The policy for one request. Pure over `env` so the spec needs no process
 * state; the service reads `process.env` at call time.
 *
 * Every doubt resolves to "supported": a missing or malformed header, an
 * unknown platform, an unset or (past boot, impossible) malformed minimum. A
 * wrong "update required" strands a member on a screen they cannot leave;
 * a wrong "supported" costs one more session on an old build.
 */
export function resolveClientPolicy(
  header: string | string[] | undefined,
  env: Env,
): ClientPolicy {
  const client = parseClientVersionHeader(header);
  if (!client) return { updateRequired: false, updateUrl: null };

  const configuredUrl = envValue(env, UPDATE_URL_ENV[client.platform]);
  const updateUrl =
    configuredUrl !== undefined && isHttpsUrl(configuredUrl)
      ? configuredUrl
      : DEFAULT_UPDATE_URLS[client.platform];

  const rawMinimum = envValue(env, MINIMUM_VERSION_ENV[client.platform]);
  const minimum =
    rawMinimum === undefined ? null : parseVersionWithBuild(rawMinimum);

  return {
    updateRequired: minimum !== null && isBelowMinimum(client, minimum),
    updateUrl,
  };
}

@Injectable()
export class ClientPolicyService {
  resolve(header: string | string[] | undefined): ClientPolicy {
    return resolveClientPolicy(header, process.env);
  }
}
