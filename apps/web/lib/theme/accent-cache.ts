/**
 * The last-known chapter accent, remembered so the **first paint** of a cold
 * load is the chapter's colour rather than Signet's house gold.
 *
 * ## The defect this exists for
 *
 * `signet.css` bakes the house default into the accent slot — `--primary:
 * #DDB844` and its six siblings, the `#DDB844` seed run through
 * `deriveSignetPalette` exactly as a chapter with no accent of its own resolves
 * (`spec/ui/design-system/accent-engine.md` §3). Those values are in the
 * stylesheet, so they paint the instant the `<head>` CSS lands. A chapter that
 * *has* an accent only gets it from `use-chapter-theme.ts`, which reads
 * `useCurrentChapter` — a `GET /v1/chapters/current`. Between those two
 * moments the shell is painted in another chapter's gold: hydrate, resolve the
 * Supabase session, resolve the chapter store, issue the request, wait for the
 * round trip. House gold is not a neutral skeleton colour, it is a **different
 * chapter's brand**, and `accent-engine.md` §3 is explicit that a no-accent
 * chapter resolves to exactly that palette — so the flash is not "loading", it
 * is a wrong answer displayed confidently.
 *
 * ## Why a cookie, and not IndexedDB
 *
 * The obvious shape is the one [#2227](https://github.com/pdcarlson/Frapp/issues/2227)
 * built for chat: a keyed Dexie database read on mount. It cannot work here,
 * for two independent reasons.
 *
 * 1. **IndexedDB is asynchronous, and this has to beat first paint.** A Dexie
 *    read resolves some frames *after* the stylesheet has already painted the
 *    house default — it would shorten the flash, not remove it. The repo has
 *    already made this exact call once and written down why:
 *    `components/layout/nav-collapse.ts` keeps the nav's collapsed state in a
 *    cookie precisely because "the server would render 220px, the client would
 *    correct to 56px after hydration, and every route would open with a visible
 *    jump". Swap the widths for colours and it is this defect. A cookie is
 *    readable by the `(dashboard)` layout, which is already an async server
 *    component, so the value is in the markup **before the browser paints at
 *    all** — zero async hops, not fewer.
 * 2. **Dexie must not reach the shell path.** `lib/chat/first-chunk-wipe.ts`
 *    exists as a separate module for exactly this: Dexie lives in the chat
 *    chunk, and a static import from a shell-path module would move it onto the
 *    floor `spec/ui/resilience/performance-budgets.md` measures for `/settings`,
 *    `/points` and every other route. The accent applies shell-wide, so a
 *    Dexie-backed accent cache would be that regression.
 *
 * So this is a cookie, carrying seven hex strings and the scope they belong to.
 * Measured on the wire, with two UUID ids: **187 bytes of JSON, 295
 * URL-encoded, 317 including the cookie name** — the encoded figure is the one
 * that matters, because that is what rides on every request to the Next origin
 * (the API is a different origin and never sees it). It buys a
 * `GET /v1/chapters/current` round trip's worth of wrong-coloured paint per
 * cold load. An eighth token would add ~30 encoded bytes, and a chapter name or
 * crest URL far more — which is the budget this stays inside by caching the
 * accent slot and nothing else.
 *
 * ## Keying is the boundary, not the clearing
 *
 * `spec/ui/resilience/caching.md` settles the argument the first-chunk cache
 * had to make, and this row is built to the same rule: it carries the
 * **Supabase auth uid + chapter id it was written under**, and the server reads
 * it as a lookup at the scope the request's own access token names
 * (`lib/theme/server-accent.ts`). A row written for another member or another
 * chapter is not merely ignored — there is no scope under which it is returned.
 * {@link clearCachedAccent} runs beside `wipeFirstChunkCache()` on the same two
 * identity events, and that is hygiene on top of the key, not the guarantee.
 *
 * `userId` is the auth uid (the JWT subject), not `users.id`, for the reason
 * `first-chunk-cache.ts` gives: `multi-tenancy.md` keys the account-swap drop
 * on the auth uid, and the uid is readable from the local session where
 * `users.id` is a `GET /v1/users/me` round trip — a first-paint cache that had
 * to wait on the network for its own key would have nothing left to win.
 *
 * ## One scope, not a map of them
 *
 * Only the current scope is kept. A member who alternates between two chapters
 * therefore pays one flash per switch — which is the trade
 * `spec/behavior/multi-tenancy.md` already asks for ("a chapter switch drops
 * the outgoing chapter's data") and the same conservative side the chat read
 * cache takes. It also keeps the cookie at one entry, which matters when every
 * request to the origin carries it.
 */

/**
 * The semantic tokens a cached row holds, in the order it stores them.
 *
 * Exactly `signetAccentSemanticVars`' output keys, and deliberately a **fixed
 * order stored as an array** rather than an object: the names are a third of
 * the payload and they never vary, so spelling them once here rather than once
 * per cookie is most of the difference between a row that is worth sending on
 * every request and one that is not.
 *
 * **Reordering or resizing this list is a format change.** The palette is
 * stored positionally, so an old row read through a new order paints each role
 * with its neighbour's colour — a wrong answer that looks like a working
 * cache. Any edit here must bump {@link ACCENT_CACHE_VERSION} in the same
 * commit; that constant is what makes the old rows drop instead of decode.
 *
 * That this list *is* the bridge's output is the whole of the no-retint
 * guarantee on this path. `--gold-house`, `--gold-ask-*` and `--scrollbar-*`
 * are absent here for the same reason they are absent from the bridge
 * (`spec/ui/brand-identity.md` §2; `settings-accent.spec.tsx`), so a cached
 * paint cannot retint the mark, the Ask pill or the scrollbars even in
 * principle — it has no value for them to write. `accent-cache.spec.ts`
 * asserts both halves against the real engine rather than trusting this
 * comment.
 */
export const ACCENT_TOKEN_ORDER = [
  "--primary",
  "--primary-hover",
  "--primary-foreground",
  "--ring",
  "--accent-subtle",
  "--accent-border",
  "--accent-text",
] as const;

export type AccentTokenName = (typeof ACCENT_TOKEN_ORDER)[number];

/** Not `httpOnly`: the client writes it, and it carries no secret — see below. */
export const ACCENT_COOKIE = "signet_chapter_accent";

/**
 * Thirty days.
 *
 * Not a staleness rule — the reconciling fetch makes any age correct within a
 * few hundred milliseconds, and an accent is the slowest-changing thing a
 * chapter owns, so a month-old value is very nearly always still right. It is
 * a retention bound: an abandoned profile should stop carrying a chapter's
 * branding eventually, and a row that outlives every plausible membership is a
 * row nobody meant to keep.
 */
export const ACCENT_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * Bumped when the stored shape changes.
 *
 * A row at another version is dropped, never coerced: the array is positional,
 * so a reordered or resized {@link ACCENT_TOKEN_ORDER} read through an old row
 * would paint each role with its neighbour's colour — a wrong answer that
 * looks like a working cache.
 */
export const ACCENT_CACHE_VERSION = 1;

/**
 * A cached accent and the tenant it belongs to.
 *
 * Single-letter keys because this is a cookie: the payload rides on every
 * request to the origin, and `{"v":1,"u":…,"c":…,"t":…,"p":[…]}` is a third
 * shorter than the spelled-out form for a shape that is read in exactly two
 * places, both in this file.
 */
export interface CachedAccent {
  /** {@link ACCENT_CACHE_VERSION} at the time of writing. */
  v: number;
  /** Supabase auth uid. */
  u: string;
  /** Chapter id. */
  c: string;
  /** Written at, epoch ms — retention only; see {@link ACCENT_MAX_AGE_SECONDS}. */
  t: number;
  /** Token values, positionally aligned to {@link ACCENT_TOKEN_ORDER}. */
  p: string[];
}

/**
 * The one value shape a cached token may have: a six-digit hex colour.
 *
 * `deriveSignetPalette` emits exactly this for all seven semantic roles (each
 * goes through `normalizeHex`), so it rejects nothing the engine can
 * legitimately write. The engine's other output — the `--signet-accent-*-alpha`
 * family — is **eight**-digit `#RRGGBBAA`, and the bridge does not map it, so
 * the six-digit bound is both what the roles are and a second reason an alpha
 * value could never arrive here by accident.
 *
 * It is also what makes the server-rendered `<style>` in
 * `chapter-accent-style.tsx` safe to build by string concatenation. A cookie is
 * attacker-controllable in the only sense that matters here — anyone who can
 * run script on the origin can set it — so a value reaching a stylesheet
 * unvalidated is a CSS injection: `#fff} :root{--x:` closes the rule and opens
 * another. There is no escaping step downstream and there deliberately is not
 * one; a value that is not six hex digits never becomes a row at all.
 */
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

/**
 * A scope id we are willing to round-trip.
 *
 * Both ids are UUIDs in practice, but this is deliberately a shape check rather
 * than a UUID check: its job is to keep delimiters and control characters out
 * of a value that is compared as a string and printed into a DOM attribute, not
 * to re-validate Supabase's identifiers.
 */
const SCOPE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The tenant a cached accent belongs to. */
export interface AccentScope {
  userId: string;
  chapterId: string;
}

/**
 * A cached accent resolved for one request, ready to render.
 *
 * Declared here rather than beside the server read that produces it, so the
 * client hook can share the DOM contract below without importing anything that
 * reaches `next/headers`. The same reason `first-chunk-wipe.ts` holds the
 * database name its Dexie module imports rather than the other way round: the
 * shared constant belongs to the side with the cheaper import graph.
 */
export interface CachedAccentPaint {
  /** The chapter these tokens belong to — the client's divergence check. */
  chapterId: string;
  tokens: Record<AccentTokenName, string>;
}

/** Lets the client find the server-rendered element to retire it. */
export const ACCENT_CACHE_STYLE_ID = "signet-accent-cache";

/** The attribute on that element the client compares against the live chapter. */
export const ACCENT_CACHE_CHAPTER_ATTR = "data-chapter";

/**
 * The stylesheet text for a cached paint.
 *
 * Safe to build by concatenation, and that is a property of the parse boundary
 * rather than of this function: token names come from {@link
 * ACCENT_TOKEN_ORDER}, a frozen literal, and values reach a
 * {@link CachedAccentPaint} only through {@link parseAccentCookie}, which
 * admits nothing but {@link HEX_COLOR}. A `}` can no more appear in one than a
 * quote can. That matters because the cookie is writable by anything that can
 * run script on this origin, and an unvalidated value interpolated into a
 * stylesheet is a CSS injection — `#fff} :root{--x:` closes the rule and opens
 * another. The validation *is* the escaping, done once at the boundary so
 * nothing downstream has to remember it.
 */
export function chapterAccentCss(
  tokens: Record<AccentTokenName, string>,
): string {
  const declarations = ACCENT_TOKEN_ORDER.map(
    (token) => `${token}:${tokens[token]}`,
  ).join(";");
  return `:root{${declarations}}`;
}

/**
 * Parse a cookie value into a row, or `null`.
 *
 * Fails closed on every error, and "closed" here means one ordinary cold load
 * with the house default — the behaviour before this cache existed. Nothing
 * downstream distinguishes an absent cookie from a malformed one, because
 * there is nothing useful either could do differently.
 */
export function parseAccentCookie(
  value: string | undefined | null,
  now: number,
): CachedAccent | null {
  if (!value) return null;
  let row: unknown;
  try {
    row = JSON.parse(decodeURIComponent(value));
  } catch {
    return null;
  }
  if (typeof row !== "object" || row === null) return null;
  const { v, u, c, t, p } = row as Record<string, unknown>;
  if (v !== ACCENT_CACHE_VERSION) return null;
  if (typeof u !== "string" || !SCOPE_ID.test(u)) return null;
  if (typeof c !== "string" || !SCOPE_ID.test(c)) return null;
  if (typeof t !== "number" || !Number.isFinite(t)) return null;
  if (!Array.isArray(p) || p.length !== ACCENT_TOKEN_ORDER.length) return null;
  if (!p.every((entry) => typeof entry === "string" && HEX_COLOR.test(entry))) {
    return null;
  }
  /*
    Age is re-checked here and not left to `Max-Age` alone. The browser drops an
    expired cookie, but the row is also read back through this function in tests
    and could be written by an older build, and a retention bound that only one
    of two readers enforces is a bound that quietly stops applying.

    `t` in the future is treated as fresh rather than rejected: a clock that
    moved backwards is not the row's fault, and refusing would turn a corrected
    clock into a flash.
  */
  if (now - t > ACCENT_MAX_AGE_SECONDS * 1000) return null;
  return { v, u, c, t, p: p as string[] };
}

/**
 * The tokens of a row, but only when it was written under `scope`.
 *
 * The scope comparison is the security boundary — see the header. Callers pass
 * the scope they independently established (the server from the request's own
 * access token, the client from `useTenantScope`), never one taken from the
 * row.
 */
export function accentTokensForScope(
  row: CachedAccent | null,
  scope: AccentScope,
): Record<AccentTokenName, string> | null {
  if (!row) return null;
  if (row.u !== scope.userId || row.c !== scope.chapterId) return null;
  const tokens = {} as Record<AccentTokenName, string>;
  ACCENT_TOKEN_ORDER.forEach((token, index) => {
    tokens[token] = row.p[index]!;
  });
  return tokens;
}

/**
 * Build the cookie value for a palette, or `null` when it is not cacheable.
 *
 * Every token must be present and a hex colour — the same all-or-nothing rule
 * `use-chapter-theme.ts` already applies to the engine map it reads. A partial
 * accent is worse than none: the stylesheet's house defaults are internally
 * consistent, one chapter's primary beside the house ring is not.
 */
export function serializeAccentCookie(
  scope: AccentScope,
  tokens: Partial<Record<AccentTokenName, string>>,
  now: number,
): string | null {
  if (!SCOPE_ID.test(scope.userId) || !SCOPE_ID.test(scope.chapterId)) {
    return null;
  }
  const values: string[] = [];
  for (const token of ACCENT_TOKEN_ORDER) {
    const value = tokens[token];
    if (typeof value !== "string" || !HEX_COLOR.test(value)) return null;
    values.push(value);
  }
  const row: CachedAccent = {
    v: ACCENT_CACHE_VERSION,
    u: scope.userId,
    c: scope.chapterId,
    t: now,
    p: values,
  };
  return encodeURIComponent(JSON.stringify(row));
}

/**
 * Write the row for `scope`, or do nothing.
 *
 * Client-only in effect — `document` is the store — but the module is shared
 * with the server read rather than split in two, exactly as
 * `components/layout/nav-collapse.ts` shares its cookie name and parser with
 * the layout that reads it. One file owning both directions of a format is how
 * the two stay in step.
 *
 * `SameSite=Lax` because this is a same-site preference with no cross-site
 * meaning, and `Secure` only off localhost so a dev server over plain HTTP can
 * still set it — both copied from `nav-collapse.ts`, which made the same call
 * for the same reasons.
 *
 * Not `httpOnly`, and it could not be: the client is the writer. Nothing
 * secret is in it. The chapter id and the accent are on screen; the auth uid is
 * already readable by any script on this origin, from the Supabase session
 * cookie and from `useAuthUserId`. It carries no token and grants nothing —
 * a request bearing only this cookie is an unauthenticated request.
 */
export function persistCachedAccent(
  scope: AccentScope,
  tokens: Partial<Record<AccentTokenName, string>>,
  now: number,
): void {
  if (typeof document === "undefined") return;
  const value = serializeAccentCookie(scope, tokens, now);
  if (!value) return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie =
    `${ACCENT_COOKIE}=${value}` +
    `; Path=/; Max-Age=${ACCENT_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

/**
 * Drop the row.
 *
 * Called beside `wipeFirstChunkCache()` on the two identity events that drop
 * every other cache (`lib/providers/frapp-client-provider.tsx`). Hygiene, not
 * the boundary: `server-accent.ts` will not serve a row to a scope it was not
 * written under whether or not this ran, which matters because the events that
 * call it are followed by a navigation moments later.
 *
 * Expiry rather than `document.cookie = ""`: a cookie has no delete verb, and
 * an empty value would still be *sent*, then parsed, then rejected — the same
 * outcome by a longer route, and a row that looks present to anything reading
 * the jar.
 */
export function clearCachedAccent(): void {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie =
    `${ACCENT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}
