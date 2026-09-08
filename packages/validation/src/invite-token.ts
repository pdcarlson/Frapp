/**
 * Invite tokens arrive as a pasted secret, a `?token=` query on `/join`, or a
 * full web/app URL (`app.frapp.live/join?token=…`, `frapp://join?token=…`).
 *
 * Officers copy the join URL (`buildJoinUrl` / Members invite dialog). Mobile
 * already pulled the query off a paste; web `/join` used to POST the whole URL
 * as the token, which the API treated as unknown (**410 Gone**). Both surfaces
 * call this before `POST /v1/invites/redeem`. The API still requires the
 * opaque token.
 *
 * The drawn s02 six-cell code is a Canvas shorthand. Joining is single-use
 * invite tokens (`spec/behavior/onboarding.md`), not a shared 6-character
 * chapter code.
 */

const TOKEN_QUERY_KEYS = ["token", "invite", "code"] as const;

export function extractInviteToken(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  const fromUrl = tokenFromUrl(trimmed);
  if (fromUrl) return fromUrl;

  if (looksLikeBareToken(trimmed)) return trimmed;
  return null;
}

function tokenFromUrl(value: string): string | null {
  const candidate = value.includes("://")
    ? value
    : value.startsWith("/") || value.startsWith("join?")
      ? `https://placeholder.invalid${value.startsWith("/") ? value : `/${value}`}`
      : null;
  if (!candidate) return null;

  try {
    const url = new URL(candidate);
    for (const key of TOKEN_QUERY_KEYS) {
      const found = url.searchParams.get(key);
      if (found && found.trim().length > 0) return found.trim();
    }
    if (url.hash.length > 1) {
      const hashParams = new URLSearchParams(url.hash.slice(1));
      for (const key of TOKEN_QUERY_KEYS) {
        const found = hashParams.get(key);
        if (found && found.trim().length > 0) return found.trim();
      }
    }
  } catch {
    return null;
  }
  return null;
}

function looksLikeBareToken(value: string): boolean {
  if (/\s/.test(value)) return false;
  if (value.includes("://")) return false;
  return value.length >= 8;
}
