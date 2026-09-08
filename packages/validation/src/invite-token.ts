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
