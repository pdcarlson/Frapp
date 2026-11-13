// No "use client" directive: this module has no browser dependency and is
// imported by the `/auth/callback` route handler as well as by the sign-in and
// sign-up client pages. A client-marked module imported from server code
// arrives as a client reference, not as callable functions.

const DEFAULT_DASHBOARD_PATH = "/chat";
const AUTH_ROUTE_PREFIXES = ["/sign-in", "/sign-up"];

function isAuthRoutePath(pathname: string): boolean {
  return AUTH_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** The path Supabase sends the member back to after an email link. */
export const AUTH_CALLBACK_PATH = "/auth/callback";

/**
 * `verifyOtp` email types GoTrue will accept on `/auth/callback?token_hash=…`.
 * Anything else is rejected before the client call so a crafted `type` cannot
 * be forwarded.
 */
const EMAIL_OTP_TYPES = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
] as const;

export type EmailOtpType = (typeof EMAIL_OTP_TYPES)[number];

export function isEmailOtpType(value: string): value is EmailOtpType {
  return (EMAIL_OTP_TYPES as readonly string[]).includes(value);
}

/**
 * A host that no real URL resolves against; the guard's only use for it is
 * detecting when a candidate path escaped it.
 */
const GUARD_ORIGIN = "https://redirect-guard.invalid";

/**
 * The open-redirect guard the proxy applies, applied again wherever a
 * `redirectTo` value is consumed: anything that is not a same-origin path
 * falls back to the dashboard default.
 *
 * Decided by the URL parser, not by string prefixes. `startsWith("/")` admits
 * `//evil.example` (protocol-relative) and `/\evil.example` (the WHATWG parser
 * treats `\` as `/` in https URLs), and both leave the origin the moment
 * something does `new URL(value, origin)` — which `/auth/callback` must, to
 * build its redirect. Resolving the candidate against a sentinel origin and
 * checking the origin survived catches every such shape at once, and the
 * value handed back is the parser's own normalised path + query + fragment.
 */
export function resolveRedirectPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/")) {
    return DEFAULT_DASHBOARD_PATH;
  }
  let parsed: URL;
  try {
    parsed = new URL(value, GUARD_ORIGIN);
  } catch {
    return DEFAULT_DASHBOARD_PATH;
  }
  if (parsed.origin !== GUARD_ORIGIN) {
    return DEFAULT_DASHBOARD_PATH;
  }
  const returned = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  // A first parse of `/.//evil.example` stays on GUARD_ORIGIN with pathname
  // `//evil.example`. The next `new URL(returned, origin)` treats that as
  // protocol-relative and leaves the origin — which is how `/auth/callback`
  // and `router.replace` would send a member off-site. Refuse it here.
  try {
    const again = new URL(returned, GUARD_ORIGIN);
    if (again.origin !== GUARD_ORIGIN) {
      return DEFAULT_DASHBOARD_PATH;
    }
  } catch {
    return DEFAULT_DASHBOARD_PATH;
  }
  return returned;
}

/**
 * Write a guarded `redirectTo` onto a URL the way the WHATWG parser needs:
 * pathname, search, and hash as separate fields.
 *
 * Assigning `/join?token=…` to `pathname` encodes the `?` (`/join%3Ftoken=…`)
 * and drops the invite. The proxy used to do that on the signed-in bounce off
 * `/sign-in` / `/sign-up`, which is how a member who already has a session
 * (another tab, a just-exchanged magic link that then re-requests `/sign-in`)
 * never reached `/join`. `startsWith("/")` also admitted protocol-relative
 * values the rest of the auth surface already refuses via
 * {@link resolveRedirectPath}.
 */
export function assignResolvedRedirect(
  url: URL,
  redirectTo: string | null | undefined,
): void {
  const parsed = new URL(resolveRedirectPath(redirectTo), GUARD_ORIGIN);
  url.pathname = parsed.pathname;
  url.search = parsed.search;
  url.hash = parsed.hash;
  // The caller is the signed-in bounce off `/sign-in` / `/sign-up`. Sending
  // them back to an auth route loops (`ERR_TOO_MANY_REDIRECTS`). The old
  // pathname-stuffing accidentally broke that loop when `redirectTo` had a
  // query (`/sign-in%3F…` is not an auth route); keep the invite query and
  // still refuse the loop.
  if (isAuthRoutePath(url.pathname)) {
    url.pathname = DEFAULT_DASHBOARD_PATH;
    url.search = "";
    url.hash = "";
  }
}

/**
 * Where an email link — sign-up confirmation or magic link — should land.
 *
 * Not `${origin}${redirectTo}` directly: `@supabase/ssr`'s browser client runs
 * the PKCE flow, so GoTrue answers a verified link with `?code=…` appended to
 * the redirect URL, and that code has to be exchanged for a session by whoever
 * receives it. Every dashboard path is behind `proxy.ts`, which sees no
 * session and bounces the request to `/sign-in?redirectTo=<path?code=…>` —
 * burying the code inside a query parameter where no client ever exchanges
 * it. The member who asked for a magic link is then shown a password form.
 *
 * So the link lands on `/auth/callback`, which is outside the proxy's
 * matcher, exchanges the code server-side against the cookie-held verifier,
 * and only then redirects to `next`. `next` is re-validated there with
 * `resolveRedirectPath`, so the guard holds even if this URL is tampered with
 * in transit.
 */
export function buildAuthCallbackUrl(
  origin: string,
  redirectTo: string,
  options: { intent?: AuthCallbackIntent } = {},
): string {
  const url = new URL(AUTH_CALLBACK_PATH, origin);
  url.searchParams.set("next", resolveRedirectPath(redirectTo));
  if (options.intent) {
    url.searchParams.set(AUTH_CALLBACK_INTENT_PARAM, options.intent);
  }
  return url.toString();
}

/**
 * Where the sign-in screen's magic link lands: `/auth/callback` tagged
 * `sign-in-link`, so the callback can tell a member who typed an email they
 * never joined with that it created a new account (#3801), while still treating
 * a failed Confirm-signup code as good news ({@link isEmailLinkIntent}).
 */
export function magicLinkRedirectUrl(origin: string, redirectTo: string): string {
  return buildAuthCallbackUrl(origin, redirectTo, { intent: "sign-in-link" });
}

/**
 * Which screen started the round trip. The value only decides which notice is
 * shown, so a tampered one can't do more than show or skip it.
 *
 * - `sign-in`, on an OAuth start from the sign-in screen: a brand-new account
 *   on return was not what the member asked for (#3786). The sign-up screen's
 *   OAuth buttons send none, because creating an account there is the point.
 * - `confirm`, on the sign-up confirmation and its Resend. If such a link's
 *   PKCE code can't be exchanged, GoTrue has already verified it, because it
 *   only hands out a code after verifying (a dead link comes back as
 *   `error_code` instead), and verifying an email link confirms the address.
 *   So the member is told their email is confirmed and to sign in, not that the
 *   link failed ({@link EMAIL_CONFIRMED_AUTH_ERROR}).
 * - `sign-in-link`, on the sign-in screen's magic link. It is an email link, so
 *   it keeps `confirm`'s good-news handling: GoTrue answers an unconfirmed
 *   address with the Confirm signup email, whose `?code=` can't be exchanged in
 *   another browser, and that still means the address is confirmed. It is also
 *   a sign-in attempt, so on success the callback checks whether the link just
 *   created a brand-new, chapterless account and, if so, sends the member to
 *   `/new-account` the way the OAuth `sign-in` path does (#3801). A plain magic
 *   link on the hosted `token_hash` template never takes the code path at all;
 *   the new-account check runs on both paths.
 */
export type AuthCallbackIntent = "sign-in" | "confirm" | "sign-in-link";
export const AUTH_CALLBACK_INTENT_PARAM = "intent";

/**
 * The intents that mark an email link rather than an OAuth return: a `?code=`
 * that fails to exchange means the address was confirmed, so the member hears
 * {@link EMAIL_CONFIRMED_AUTH_ERROR} instead of a generic failure. OAuth's
 * `sign-in` is not here — a provider code that won't exchange is a real
 * failure, and the email-confirmed copy would be wrong for it.
 */
export function isEmailLinkIntent(intent: string | null): boolean {
  return intent === "confirm" || intent === "sign-in-link";
}

/**
 * The intents the sign-in screen sends so the callback runs the new-account
 * check (#3786 for OAuth, #3801 for the magic link). The sign-up screen sends
 * neither: creating an account there is the point.
 */
export function isSignInIntent(intent: string | null): boolean {
  return intent === "sign-in" || intent === "sign-in-link";
}

/**
 * The `authError` `/auth/callback` sends when a sign-up confirmation link
 * confirmed the address but couldn't sign this browser in: the code's PKCE
 * verifier lives in the browser that signed up, and only the newest email
 * flow's survives (a magic link asked for afterwards replaces it, or deletes
 * it when the send is refused). The sign-in screen reads it as good news.
 */
export const EMAIL_CONFIRMED_AUTH_ERROR = "email_confirmed";

/**
 * The notice a brand-new account sees after choosing sign-in: a Google or Apple
 * account (#3786) or a magic-link email account (#3801).
 */
export const NEW_ACCOUNT_PATH = "/new-account";

/**
 * Member-facing wording for the `authError` `/auth/callback` hands to
 * `/sign-in`. `otp_expired`, `access_denied`, `otp_disabled` and the three
 * identity-collision codes are GoTrue's `error_code` values; `exchange_failed`,
 * `verify_failed`, `missing_code` and `email_confirmed` are this app's own.
 */
export function describeAuthError(code: string): string {
  switch (code) {
    case "otp_expired":
      return "The link has expired. Request a new one below.";
    case "access_denied":
      return "The link was already used or is no longer valid. Request a new one below.";
    case "otp_disabled":
      return "Email links are switched off for this project. Sign in with your password.";
    case "exchange_failed":
      return "The link has to be opened in the browser you requested it from. Request a new one here, or sign in with your password.";
    case "verify_failed":
      return "The link could not be used. Request a new one below, or sign in with your password.";
    case "missing_code":
      return "The link was incomplete. Request a new one below.";
    case EMAIL_CONFIRMED_AUTH_ERROR:
      // Under the toast title "Email confirmed". Says the link didn't sign
      // this browser in, because the same lands for an address confirmed long
      // ago (a magic link on a `ConfirmationURL` template opened elsewhere).
      // Not "with your password" alone: a magic-link account has none.
      return "This link couldn't sign this browser in. Sign in with your password, or ask for a new magic link.";
    case "identity_already_exists":
    case "user_already_exists":
    case "email_exists":
      return "An account with this email already exists. Sign in with your password or a magic link. Google or Apple can attach to that same account on later visits.";
    default:
      return "Request a new link below, or sign in with your password.";
  }
}
