/**
 * When `/join` steps aside for a member who is already in a chapter (#3850).
 *
 * Only one way onto the page means "take me to my chapter": the sign-in
 * footer's Join your chapter link, which marks its visit with
 * `from=sign-in`. A member who signs in that way, with no invite in hand,
 * goes straight to `/chat`.
 *
 * Every other entry keeps the page, because it is deliberate or would loop:
 * an invite link may be for a second chapter, the chapter switcher's Join
 * another chapter is exactly that, and `/no-access` sends a member with no
 * role here. Sending that member to `/chat` would return them to
 * `/no-access`.
 */
const JOIN_FROM_SIGN_IN = "sign-in";

/**
 * A phone visit to `/join` that chose Continue in the browser over the app
 * (#4002), marked in the URL as `web=1` so the choice survives what it starts:
 * the sign-in or sign-up round trip (whose `redirectTo` carries the query), an
 * OAuth or email-confirm return, Sign in as someone else, and a refresh.
 * Without it, the page would offer the app again right after the member
 * signed in on the web.
 */
export const JOIN_IN_BROWSER_KEY = "web";
export const JOIN_IN_BROWSER_VALUE = "1";

/** The sign-in footer's destination: `/join`, marked as coming from sign-in. */
export const JOIN_FROM_SIGN_IN_PATH = `/join?from=${JOIN_FROM_SIGN_IN}`;

/**
 * `/join`'s **Create a chapter**: `/chat`, marked so the chapter wizard gate
 * opens setup without first sending an account with an emailed invite back
 * to `/join` (#5077), which would loop.
 */
const CREATE_CHAPTER_KEY = "setup";
const CREATE_CHAPTER_VALUE = "chapter";
export const CREATE_CHAPTER_PATH = `/chat?${CREATE_CHAPTER_KEY}=${CREATE_CHAPTER_VALUE}`;

/** Whether a dashboard visit came from `/join`'s Create a chapter. */
export function isCreateChapterVisit(search: string): boolean {
  return (
    new URLSearchParams(search).get(CREATE_CHAPTER_KEY) === CREATE_CHAPTER_VALUE
  );
}

/**
 * Whether this visit could skip the page at all: the footer's marked visit.
 * A visit with an invite in the URL never reaches this rule, because the page
 * shows that invite's card instead (`JoinWithInvite`). The page waits on the
 * reads below only for such a visit, so the rule lives here and nowhere else.
 */
export function isJoinSkipCandidate({
  from,
}: {
  from: string | null;
}): boolean {
  return from === JOIN_FROM_SIGN_IN;
}

/**
 * Whether a candidate visit goes to `/chat`, decided once on arrival. It
 * stays on the page when the account has no chapter, when an invite was
 * emailed to it (the footer asked "Have an invite?", so its offers are why
 * the member came), or when it has no access in its chapter (a member with
 * no role, whom `/chat` would send to `/no-access`).
 */
export function shouldSkipJoinForMember({
  from,
  membershipCount,
  offerCount,
  hasAccess,
}: {
  from: string | null;
  membershipCount: number;
  offerCount: number;
  hasAccess: boolean;
}): boolean {
  return (
    isJoinSkipCandidate({ from }) &&
    membershipCount > 0 &&
    offerCount === 0 &&
    hasAccess
  );
}

/**
 * What a sign-in started from the invite card goes on to do when it lands back
 * on `/join` (#5625): `join` the chapter, or `ask` the sender for a new link.
 * The card's Continue buttons put it on their return path, so one tap is
 * sign-in and join together.
 *
 * The URL alone is not enough, because anyone can write `then=join` into a
 * link. The card also leaves a mark in this browser when a way in is tapped
 * ({@link rememberJoinMark}), for that token and for 30 minutes, and the page
 * acts only when the two agree ({@link joinThenFor}). So a visit without that
 * tap never acts on its own: an existing member who opens a crafted link is
 * shown the card, not joined or announced behind their back. The phone keeps
 * the same mark beside its remembered invite
 * (`apps/mobile/lib/onboarding/invite-token.ts`).
 */
export const JOIN_THEN_KEY = "then";
export type JoinThen = "join" | "ask";

export const JOIN_MARK_STORAGE_KEY = "frapp.join-then";
/** How long a tap on the card stays good for: a sign-in round trip, not a day. */
export const JOIN_MARK_MS = 30 * 60 * 1000;

export function readJoinThen(search: URLSearchParams): JoinThen | null {
  const value = search.get(JOIN_THEN_KEY);
  return value === "join" || value === "ask" ? value : null;
}

/** Notes that this browser tapped a way in on `token`'s card, to then do `then`. */
export function rememberJoinMark(
  token: string,
  then: JoinThen,
  now: number = Date.now(),
): void {
  try {
    window.localStorage.setItem(
      JOIN_MARK_STORAGE_KEY,
      JSON.stringify({ token, then, at: now }),
    );
  } catch {
    // Storage off (a private window): the card shows, and Join is one more tap.
  }
}

/** Forgets the mark, once it has been acted on. */
export function clearJoinMark(): void {
  try {
    window.localStorage.removeItem(JOIN_MARK_STORAGE_KEY);
  } catch {
    // Nothing stored to clear.
  }
}

/**
 * What this visit should carry on with: the URL's `then`, only when this
 * browser's own mark names the same token and the same `then` and is under
 * {@link JOIN_MARK_MS} old. Otherwise nothing.
 */
export function joinThenFor(
  token: string,
  search: URLSearchParams,
  now: number = Date.now(),
): JoinThen | null {
  const fromUrl = readJoinThen(search);
  if (fromUrl === null) return null;
  try {
    const raw = window.localStorage.getItem(JOIN_MARK_STORAGE_KEY);
    if (!raw) return null;
    const mark = JSON.parse(raw) as {
      token?: unknown;
      then?: unknown;
      at?: unknown;
    };
    const fresh =
      typeof mark.at === "number" &&
      now - mark.at >= 0 &&
      now - mark.at < JOIN_MARK_MS;
    return mark.token === token && mark.then === fromUrl && fresh
      ? fromUrl
      : null;
  } catch {
    return null;
  }
}

/** `/join` with this visit's query, marked to finish with `then`. */
export function joinReturnPath(
  search: URLSearchParams,
  then: JoinThen,
): string {
  const next = new URLSearchParams(search.toString());
  next.set(JOIN_THEN_KEY, then);
  return `/join?${next.toString()}`;
}

/** `/join` with this visit's query and no `then`, once it has been acted on. */
export function joinPathWithoutThen(search: URLSearchParams): string {
  const next = new URLSearchParams(search.toString());
  next.delete(JOIN_THEN_KEY);
  const query = next.toString();
  return query ? `/join?${query}` : "/join";
}
