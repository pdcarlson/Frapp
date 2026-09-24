/**
 * The mobile binary's version, as it reports itself, and the minimum a
 * deployment will still serve (#2526).
 *
 * Every store install stays exactly as shipped until its owner updates it, so
 * the first binary carries the only lever the server will ever have over old
 * builds: it sends `X-Client-Version` on every request and asks
 * `GET /v1/client-policy` at launch whether it is still supported. The binary
 * holds no comparison logic of its own. Everything that decides "too old"
 * lives here, server-side, so the rule can change without a store update.
 *
 * Header shape: `<platform>/<version>[+<build>]`, e.g. `ios/0.9.0+12` or
 * `android/0.9.0+7`. `version` is the store version (`expo.version`: iOS
 * `CFBundleShortVersionString`, Android `versionName`); `build` is the native
 * build number (iOS `CFBundleVersion`, Android `versionCode`), which EAS
 * increments per build. Minimum shape: `<version>[+<build>]`, e.g. `0.9.1` or
 * `0.9.0+14`. The build half is what lets a deployment retire one beta build
 * of `0.9.0` in favour of a later one without bumping the store version.
 */

/** Lower-case, as Node exposes request headers. */
export const CLIENT_VERSION_HEADER = 'x-client-version';

export const CLIENT_PLATFORMS = ['ios', 'android'] as const;
export type ClientPlatform = (typeof CLIENT_PLATFORMS)[number];

export interface VersionWithBuild {
  /** Major, minor, patch. A shorter version is padded with zeros. */
  version: readonly [number, number, number];
  /** The native build number, or null when the string carried none. */
  build: number | null;
}

export interface ClientVersion extends VersionWithBuild {
  platform: ClientPlatform;
}

/**
 * Nine digits per part keeps every value an exact integer and bounds the work
 * a hostile header can cause. A real build number is far below it.
 */
const PART = '(0|[1-9]\\d{0,8})';
const VERSION_WITH_BUILD = new RegExp(
  `^${PART}(?:\\.${PART})?(?:\\.${PART})?(?:\\+${PART})?$`,
);

/** Longer than any header this parser could accept; checked before the regex runs. */
const MAX_HEADER_LENGTH = 64;

/**
 * `0.9.0` or `0.9.0+14` → parts, or null when the string is anything else.
 * Leading zeros, pre-release tags (`-beta.1`), and more than three version
 * parts are all refused: none is a shape `expo.version` or a build number
 * takes, and a lenient parse would turn a typo into a silently wrong minimum.
 */
export function parseVersionWithBuild(raw: string): VersionWithBuild | null {
  const match = VERSION_WITH_BUILD.exec(raw.trim());
  if (!match) return null;
  const [, major, minor, patch, build] = match;
  return {
    version: [Number(major), Number(minor ?? 0), Number(patch ?? 0)],
    build: build === undefined ? null : Number(build),
  };
}

/** `ios/0.9.0+12` → parts, or null for a missing, unknown or malformed value. */
export function parseClientVersionHeader(
  raw: string | string[] | undefined,
): ClientVersion | null {
  if (typeof raw !== 'string' || raw.length > MAX_HEADER_LENGTH) return null;
  const slash = raw.indexOf('/');
  if (slash === -1) return null;
  const platform = raw.slice(0, slash).trim().toLowerCase();
  if (!isClientPlatform(platform)) return null;
  const parsed = parseVersionWithBuild(raw.slice(slash + 1));
  return parsed ? { platform, ...parsed } : null;
}

export function isClientPlatform(value: string): value is ClientPlatform {
  return (CLIENT_PLATFORMS as readonly string[]).includes(value);
}

/**
 * Is `client` older than `minimum`?
 *
 * Versions compare part by part. On an equal version, a minimum with a build
 * number also compares builds, and a client that reported no build is let
 * through: it can't be shown to be older, and this check fails open by design.
 */
export function isBelowMinimum(
  client: VersionWithBuild,
  minimum: VersionWithBuild,
): boolean {
  for (let i = 0; i < 3; i += 1) {
    if (client.version[i] !== minimum.version[i]) {
      return client.version[i] < minimum.version[i];
    }
  }
  if (minimum.build === null || client.build === null) return false;
  return client.build < minimum.build;
}
