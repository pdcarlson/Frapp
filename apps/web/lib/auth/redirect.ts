// No "use client" directive: this module has no browser dependency and is
// imported by the `/auth/callback` route handler as well as by the sign-in and
// sign-up client pages. A client-marked module imported from server code
// arrives as a client reference, not as callable functions.

const DEFAULT_DASHBOARD_PATH = "/chat";

/** The path Supabase sends the member back to after an email link. */
export const AUTH_CALLBACK_PATH = "/auth/callback";

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
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
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
export function buildAuthCallbackUrl(origin: string, redirectTo: string): string {
  const url = new URL(AUTH_CALLBACK_PATH, origin);
  url.searchParams.set("next", resolveRedirectPath(redirectTo));
  return url.toString();
}

/**
 * Member-facing wording for the `authError` `/auth/callback` hands to
 * `/sign-in`. GoTrue's `error_code` values are the first three; the last two
 * are this app's own.
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
    case "missing_code":
      return "The link was incomplete. Request a new one below.";
    default:
      return "Request a new link below, or sign in with your password.";
  }
}
