import { cookies } from "next/headers";

import {
  readActiveChapterClaim,
  readAuthSubjectClaim,
} from "@/lib/auth/active-chapter-claim";
import { readAccessTokenFromCookies } from "@/lib/auth/access-token-cookie";
import {
  ACCENT_COOKIE,
  accentTokensForScope,
  parseAccentCookie,
  type CachedAccentPaint,
} from "./accent-cache";

/**
 * The cached chapter accent for **this request**, or `null`.
 *
 * Server-only: the `(dashboard)` layout calls it so the accent is in the markup
 * the browser paints, rather than in an effect that runs after it has already
 * painted house gold. `accent-cache.ts` has the argument for why a cookie and
 * not IndexedDB.
 *
 * ## The scope is taken from the request, never from the row
 *
 * This is the half that makes the cache safe, and it is why the read happens
 * here rather than in an inline script (which is the other way to beat first
 * paint, and the one Next's own "preventing flash before hydration" guide
 * reaches for). A script in the browser can only read the accent cookie and
 * trust what it says about itself. This can read the request's **own access
 * token** and ask the row a different question: not "who do you claim to be
 * for", but "are you for the member and chapter this request is authenticated
 * as". A row written by another member, or for another chapter, is then not
 * rejected so much as unreachable — there is no scope under which it is
 * returned, which is the same property `spec/ui/resilience/caching.md` credits
 * for the chat first-chunk cache.
 *
 * That closes the one case the client-side clears cannot: member A's browser is
 * closed without signing out, member B signs in on it, and the redirect into
 * the dashboard is a full document load. `dropCacheWhenIdentityChanges` has not
 * run in that document yet — it cannot have, nothing is hydrated — so a cookie
 * trusted on its own word would paint A's chapter colour at B. Here it simply
 * does not match B's token and nothing is painted.
 *
 * ## Cost
 *
 * One `cookies()` await, two regex passes and a `JSON.parse` — no network, no
 * database, no auth round trip (`access-token-cookie.ts` says why that matters).
 * The layout is already dynamic because it reads the nav-collapse cookie, so
 * this adds no prerendering constraint that was not already there.
 */
export async function readCachedAccentPaint(): Promise<CachedAccentPaint | null> {
  let store: Awaited<ReturnType<typeof cookies>>;
  try {
    store = await cookies();
  } catch {
    // Rendered somewhere `cookies()` is not available. No accent, no error.
    return null;
  }

  const token = readAccessTokenFromCookies(store.getAll());
  const userId = readAuthSubjectClaim(token);
  const chapterId = readActiveChapterClaim(token);
  /*
    No session, or a session with no chapter, means there is no scope to look
    up — a signed-out visitor, or a member who has not picked a chapter yet.
    `spec/ui/web-dashboard/README.md` already puts those on the house default
    ("a pre-auth screen has no tenant, so the accent slot holds the house
    default there"), so this agrees with the surface rather than inventing a
    colour for it.
  */
  if (!userId || !chapterId) return null;

  const row = parseAccentCookie(store.get(ACCENT_COOKIE)?.value, Date.now());
  const tokens = accentTokensForScope(row, { userId, chapterId });
  return tokens ? { chapterId, tokens } : null;
}
