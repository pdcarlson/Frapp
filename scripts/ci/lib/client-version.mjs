// The API's client-version rule, for the deploy's checks (#3123).
//
// A copy of `parseVersionWithBuild`, `parseClientVersionHeader` and
// `isBelowMinimum` from `apps/api/src/domain/constants/client-version.ts`. It
// is a copy, not an import, because the deploy runs `scripts/ci` from a trusted
// copy that has no install and resolves nothing outside it
// (`deploy-production-fence.test.mjs`). `__tests__/client-version.test.mjs`
// loads the API's own module through Node's type stripping and holds the two to
// the same answers over a table of cases, so a change to the API's rule fails
// that test until this copy follows.

/** Nine digits per part, as the API's: every value an exact integer. */
const PART = "(0|[1-9]\\d{0,8})";
const VERSION_WITH_BUILD = new RegExp(
  `^${PART}(?:\\.${PART})?(?:\\.${PART})?(?:\\+${PART})?$`,
);

/** Longer than any header the API's parser accepts; checked before the regex runs. */
const MAX_HEADER_LENGTH = 64;

export const CLIENT_PLATFORMS = ["ios", "android"];

/** `0.9.0` or `0.9.0+14` → `{ version: [major, minor, patch], build }`, or null. */
export function parseVersionWithBuild(raw) {
  const match = VERSION_WITH_BUILD.exec(String(raw).trim());
  if (!match) return null;
  const [, major, minor, patch, build] = match;
  return {
    version: [Number(major), Number(minor ?? 0), Number(patch ?? 0)],
    build: build === undefined ? null : Number(build),
  };
}

/** `ios/0.9.0+12` → `{ platform, version, build }`, or null for anything the API would not parse. */
export function parseClientVersionHeader(raw) {
  if (typeof raw !== "string" || raw.length > MAX_HEADER_LENGTH) return null;
  const slash = raw.indexOf("/");
  if (slash === -1) return null;
  const platform = raw.slice(0, slash).trim().toLowerCase();
  if (!CLIENT_PLATFORMS.includes(platform)) return null;
  const parsed = parseVersionWithBuild(raw.slice(slash + 1));
  return parsed ? { platform, ...parsed } : null;
}

/**
 * Is `client` older than `minimum`? Part by part; on an equal version a
 * minimum's build is compared only when the client reported one, because the
 * API's gate fails open.
 */
export function isBelowMinimum(client, minimum) {
  for (let i = 0; i < 3; i += 1) {
    if (client.version[i] !== minimum.version[i])
      return client.version[i] < minimum.version[i];
  }
  if (minimum.build === null || client.build === null) return false;
  return client.build < minimum.build;
}

/**
 * What `GET /v1/client-policy` answers `header` under a minimum of `rawMinimum`
 * (the variable's value, possibly unset), as `resolveClientPolicy` decides it:
 * every doubt is "supported".
 */
export function wouldRequireUpdate(header, rawMinimum) {
  const client = parseClientVersionHeader(header);
  if (!client) return false;
  const trimmed = typeof rawMinimum === "string" ? rawMinimum.trim() : "";
  if (trimmed === "") return false;
  const minimum = parseVersionWithBuild(trimmed);
  return minimum !== null && isBelowMinimum(client, minimum);
}
