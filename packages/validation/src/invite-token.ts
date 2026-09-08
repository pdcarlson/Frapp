/**
 * Invite tokens arrive as a pasted secret, a `?token=` query on `/join`, or a
 * full web/app URL (`app.frapp.live/join?token=…`, `frapp://join?token=…`).
 *
 * Officers copy the join URL (`buildJoinUrl` / first-officer wizard) or the
 * Members "Copy link" payload, which wraps that URL in role and expiry lines.
 * Mobile already pulled the query off a paste; web `/join` used to POST the
 * whole clipboard as the token, which the API treated as unknown (**410 Gone**).
 * Both surfaces call this before `POST /v1/invites/redeem`. The API still
 * requires the opaque token.
 *
 * The drawn s02 six-cell code is a Canvas shorthand. Joining is single-use
 * invite tokens (`spec/behavior/onboarding.md`), not a shared 6-character
 * chapter code.
 */

const TOKEN_QUERY_KEYS = ["token", "invite", "code"] as const;

/**
 * Invite tokens travel in the query string of a join URL. A public `http:`
 * origin would put them on the wire in the clear. Loopback `http:` is local
 * Infisical `APP_URL` (`http://localhost:3000`) and never leaves the machine.
 *
 * Call this before attaching `token`. Returns the same URL so callers can
 * chain. Does not mutate.
 */
export function assertHttpsJoinOrigin(url: URL): URL {
  if (url.protocol === "https:") return url;
  if (url.protocol === "http:" && isLoopbackHostname(url.hostname)) return url;
  throw new Error(
    `Join URL origin must use https: (got ${url.protocol}//${url.host}). ` +
      `An http: origin would put the invite token on the wire in the clear.`,
  );
}

/**
 * Dashboard origin first users redeem invites against. Shared so API
 * `APP_URL`, landing `NEXT_PUBLIC_APP_URL`, and mobile `EXPO_PUBLIC_APP_URL`
 * cannot drift from the fallback they already used.
 */
export const PRODUCTION_APP_ORIGIN = "https://app.frapp.live";

/**
 * Dashboard SDK origin first users call. Shared so web
 * `NEXT_PUBLIC_API_URL` and EAS `EXPO_PUBLIC_API_URL` cannot drift from
 * the production host in `apps/mobile/eas.json`.
 */
export const PRODUCTION_API_ORIGIN = "https://api.frapp.live";

/**
 * Same value as `.github/environments.json`
 * `environments.production.supabaseProjectRef`. Duplicated here because the
 * API Docker image does not copy `.github/` (`apps/api/Dockerfile`), and boot
 * still has to know which Supabase host is production. The invite-token spec
 * pins the two together.
 */
export const PRODUCTION_SUPABASE_PROJECT_REF = "unttyvyfezddlyafcydh";

/**
 * True only for the production project's HTTPS origin. A substring match on
 * the raw URL would let a query or a suffix-host spoof the fence.
 */
export function isProductionSupabaseUrl(supabaseUrl: string): boolean {
  try {
    const url = new URL(supabaseUrl.trim());
    if (url.protocol !== "https:") return false;
    return url.hostname === `${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`;
  } catch {
    return false;
  }
}

/**
 * Production invite/join/CTAs must land on `app.frapp.live`. `https:` alone
 * still allows `https://app.staging.frapp.live`. Call only after the caller
 * knows this process is production (production Supabase, `VERCEL_ENV`, or
 * `EAS_BUILD_PROFILE=production`). Error interpolates `protocol` + `host`,
 * never userinfo or a query.
 *
 * Unset `APP_URL` is not this function's job — callers skip it when the
 * value is empty so the production-origin fallback still applies.
 */
export function assertProductionAppOrigin(raw: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(
      `${label} must be ${PRODUCTION_APP_ORIGIN} in production (got unparseable).`,
    );
  }
  url.username = "";
  url.password = "";
  if (url.origin !== PRODUCTION_APP_ORIGIN) {
    throw new Error(
      `${label} must be ${PRODUCTION_APP_ORIGIN} in production (got ${url.protocol}//${url.host}).`,
    );
  }
  return url;
}

/**
 * Production web/mobile API calls must land on `api.frapp.live`. `https:`
 * alone still allows `https://api-staging.frapp.live`. Call only after the
 * caller knows this process is production (`VERCEL_ENV` or
 * `EAS_BUILD_PROFILE=production`). Unlike `APP_URL`, there is no safe
 * unset fallback — `FrappProvider` would otherwise use localhost.
 *
 * Error interpolates `protocol` + `host`, never userinfo or a query.
 */
export function assertProductionApiOrigin(raw: string, label: string): URL {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Error(
      `${label} must be ${PRODUCTION_API_ORIGIN} in production (got empty).`,
    );
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(
      `${label} must be ${PRODUCTION_API_ORIGIN} in production (got unparseable).`,
    );
  }
  url.username = "";
  url.password = "";
  if (url.origin !== PRODUCTION_API_ORIGIN) {
    throw new Error(
      `${label} must be ${PRODUCTION_API_ORIGIN} in production (got ${url.protocol}//${url.host}).`,
    );
  }
  return url;
}

/**
 * Production web/mobile must talk to the `frapp-prod` project. Call only
 * after the caller knows this process is production. Empty fails closed —
 * there is no localhost-shaped production Supabase.
 *
 * Error interpolates `protocol` + `host`, never userinfo or a query.
 */
export function assertProductionSupabaseUrl(raw: string, label: string): URL {
  const expected = `https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`;
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Error(
      `${label} must be ${expected} in production (got empty).`,
    );
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(
      `${label} must be ${expected} in production (got unparseable).`,
    );
  }
  url.username = "";
  url.password = "";
  if (!isProductionSupabaseUrl(raw)) {
    throw new Error(
      `${label} must be ${expected} in production (got ${url.protocol}//${url.host}).`,
    );
  }
  return url;
}

/**
 * Officers mint `${origin}/join?token=…`. Resolve the origin first, drop
 * userinfo / search / hash, then attach the token with `encodeURIComponent`
 * so a space stays `%20`. `URLSearchParams.set` would encode space as `+`,
 * which `extractInviteToken` still accepts but the minting tests pin `%20`.
 *
 * Throws before the token is attached when the origin is public `http:`.
 */
export function mintJoinUrl(origin: string, token: string): string {
  const url = new URL("/join", origin);
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  assertHttpsJoinOrigin(url);
  return `${url.origin}/join?token=${encodeURIComponent(token)}`;
}

function isLoopbackHostname(hostname: string): boolean {
  // Node's URL.hostname for IPv6 includes the brackets (`[::1]`).
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export function extractInviteToken(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  const fromWhole = tokenFromUrl(trimmed);
  if (fromWhole) return fromWhole;

  for (const part of trimmed.split(/\s+/)) {
    const cleaned = unwrapClipboardPart(part);
    if (!cleaned) continue;
    const fromPart = tokenFromUrl(cleaned);
    if (fromPart) return fromPart;
  }

  if (looksLikeBareToken(trimmed)) return trimmed;
  return null;
}

/**
 * Seed a join field from a URL query. Officers mint `?token=`; mobile and
 * older links also used `invite` and `code`. First non-empty key wins, same
 * order as `tokenFromUrl`. Web `/join` used to read only `token`, so a
 * direct `/join?invite=` or `/join?code=` left the field empty.
 */
export function extractInviteTokenFromQuery(
  get: (key: (typeof TOKEN_QUERY_KEYS)[number]) => string | null | undefined,
): string | null {
  for (const key of TOKEN_QUERY_KEYS) {
    const raw = get(key);
    if (typeof raw !== "string" || raw.trim().length === 0) continue;
    return extractInviteToken(raw) ?? raw.trim();
  }
  return null;
}

function unwrapClipboardPart(value: string): string {
  return value.replace(/^[<(["']+/, "").replace(/[.,);>'"]+$/, "");
}

function tokenFromUrl(value: string): string | null {
  const candidate = urlCandidate(value);
  if (!candidate) return null;

  try {
    const url = new URL(candidate);
    for (const key of TOKEN_QUERY_KEYS) {
      const found = cleanQueryToken(url.searchParams.get(key));
      if (found) return found;
    }
    if (url.hash.length > 1) {
      const hashParams = new URLSearchParams(url.hash.slice(1));
      for (const key of TOKEN_QUERY_KEYS) {
        const found = cleanQueryToken(hashParams.get(key));
        if (found) return found;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function urlCandidate(value: string): string | null {
  if (value.includes("://")) return value;
  if (value.startsWith("/") || value.startsWith("join?")) {
    return `https://placeholder.invalid${value.startsWith("/") ? value : `/${value}`}`;
  }
  if (/^(?:[\w-]+\.)+[\w-]+\/\S*[?&#](?:token|invite|code)=/.test(value)) {
    return `https://${value}`;
  }
  return null;
}

function cleanQueryToken(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = unwrapClipboardPart(raw.trim());
  return cleaned.length > 0 ? cleaned : null;
}

function looksLikeBareToken(value: string): boolean {
  if (/\s/.test(value)) return false;
  if (value.includes("://")) return false;
  return value.length >= 8;
}
