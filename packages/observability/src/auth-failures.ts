import { createKeyedRateLimiter } from "./rate-limit";

/**
 * What web and mobile report when a signed-out auth flow fails (#3832).
 * `spec/behavior/observability.md` § Error Tracking ("Signed-out auth
 * failures") owns the rules; this module is the one place they are written
 * down in code. Each app binds it once, in `lib/sentry/auth-failures.ts`, with
 * its own Sentry SDK's `captureException`.
 *
 * **Why Sentry, and only Sentry.** On launch day a member failed to sign in
 * six times and neither tool saw it: PostHog stays opted out until a chapter
 * read proves the chapter allows analytics (#2957), and a signed-out screen
 * never gets that answer. Sending a PostHog event before that proof is what
 * #2957 forbids, because nothing on the server stands behind what the SDK
 * sends directly. Sentry runs on every screen, signed out or not, and every
 * event already passes the shared scrubber. So both kinds go to Sentry, split
 * by level:
 * - **an expected refusal** (a wrong password, an unconfirmed address, an
 *   expired link, a rate limit) at `info`. It is counted, never paged: the
 *   production alert rule pages on `error` and above
 *   (`docs/ops/alert-routing.md` § Signed-out auth failures);
 * - **anything else** at `error`: a 5xx, a dead request while online, a
 *   failure with no code at all, the project's hourly email cap
 *   ({@link EMAIL_SEND_CAPPED_CODE}), or a code this list doesn't know (a
 *   disabled provider, a broken template). Its first event is a new `error`
 *   issue, which pages. An expected code failing for everyone at once (every
 *   link refused as `bad_code_verifier`) stays `info`; Beta Watch reads the
 *   daily counts for that.
 *
 * **What the event carries.** Identifiers only, never the error the SDK
 * returned. GoTrue's sentences can name the address (`Email address
 * "a@b.co" is invalid`), and a callback's query holds the code or token, so
 * the event is an `Error` this module builds from:
 * - `auth_flow`: which flow failed ({@link AuthFailureFlow});
 * - `auth_screen`: the route the member was on, as the caller names it. Kept
 *   only when it is a path of screen-shaped segments (no query, no id);
 * - `auth_error_code`: GoTrue's `error_code` or the app's own `authError`
 *   code, kept only when it is a short snake_case identifier;
 * - `auth_failure_kind`: `refusal`, `server`, `network` or `unknown`;
 * - `http.status_code`, when the SDK had one;
 * - `auth_expected`: `true` or `false`.
 * The platform and build are the event's own `release`, `environment` and
 * the project it lands in (`frapp-web`, `frapp-mobile`). No email, password,
 * token, OTP or URL is ever read from the input, so none can be sent.
 *
 * **Grouping.** `['signed-out-auth', <flow>, <code or kind>]`: one issue per
 * flow and failure, so a day's count of `email_not_confirmed` on password
 * sign-in is that issue's event count for the day.
 *
 * **Rate limit.** One report per fingerprint per
 * {@link AUTH_FAILURE_REPORT_INTERVAL_MS} for each reporter, so a double
 * submit or a retry loop counts once. A member who retries a minute later
 * counts again, which is what a daily count should see.
 *
 * **It never throws.** It runs inside a sign-in handler; a failed report must
 * not turn into a second failure on the screen.
 */

/** One report per fingerprint per this long, per reporter. */
export const AUTH_FAILURE_REPORT_INTERVAL_MS = 60_000;

/** How many fingerprints one reporter remembers for its rate limit. */
const MAX_REMEMBERED_FINGERPRINTS = 200;

/** Every signed-out flow that can fail. */
export type AuthFailureFlow =
  /** Email and password. */
  | "password_sign_in"
  /** Web's sign-up form. Mobile has none: its first sign-in creates the account. */
  | "sign_up"
  /** Asking for a magic link or email code. */
  | "magic_link_send"
  /** Resending the sign-up confirmation email. */
  | "confirmation_resend"
  /** Starting Google or Apple, in the browser or natively. */
  | "oauth_start"
  /** A link or provider return that didn't become a session: web's `/auth/callback`, mobile's deep link. */
  | "auth_callback"
  /** A session the API stopped accepting, read back from Auth before signing out. */
  | "session_check";

/**
 * Codes a member meets in normal use. Each is GoTrue's `error_code`
 * (https://supabase.com/docs/guides/auth/debugging/error-codes) or the web
 * `authError` code for the same condition (`apps/web/lib/auth/redirect.ts`).
 * Anything not here is treated as unexpected, so a new failure surfaces
 * rather than hides.
 */
export const EXPECTED_AUTH_ERROR_CODES: ReadonlySet<string> = new Set([
  // Credentials and the account's own state.
  "invalid_credentials",
  "email_not_confirmed",
  "phone_not_confirmed",
  "user_banned",
  "weak_password",
  "same_password",
  "email_address_invalid",
  "validation_failed",
  // An address or identity that already has an account.
  "user_already_exists",
  "email_exists",
  "identity_already_exists",
  // Rate limits.
  "over_email_send_rate_limit",
  "over_request_rate_limit",
  "over_sms_send_rate_limit",
  // A link or code that is spent, expired or wrong.
  "otp_expired",
  "access_denied",
  "missing_code",
  "verify_failed",
  "email_confirmed",
  "flow_state_expired",
  "flow_state_not_found",
  // A PKCE link opened in another browser than the one that asked for it.
  // Web's callback names it `exchange_failed`. A spike of it (every link
  // failing, not a few) is what Beta Watch reads the daily count for.
  "bad_code_verifier",
  "exchange_failed",
  // A refresh token that was revoked or already rotated: a signed-out
  // device, not a fault.
  "refresh_token_not_found",
  "refresh_token_already_used",
  "session_not_found",
  "session_expired",
  // An account deleted on another device.
  "user_not_found",
]);

export type AuthFailureKind = "refusal" | "server" | "network" | "unknown";

export interface AuthFailureInput {
  readonly flow: AuthFailureFlow;
  /** The route the member was on, as a template (`/sign-in`). */
  readonly screen: string;
  /** What the SDK returned or threw. Read for `code`, `status` and `name` only. */
  readonly error?: unknown;
  /**
   * A code the caller already has without an error object: the `authError`
   * a callback redirected with, or one the app names itself. Wins over the
   * error's own code.
   */
  readonly code?: string;
}

/** What each app's binding passes to `captureException`. */
export interface AuthFailureReport {
  readonly error: Error;
  readonly level: "info" | "error";
  readonly fingerprint: string[];
  readonly tags: Record<string, string>;
}

export interface AuthFailureReporterOptions {
  /** The app's `Sentry.captureException(report.error, { level, fingerprint, tags })`. */
  readonly capture: (report: AuthFailureReport) => void;
  /** Whether the device reads online. A dead request offline is the member's network. */
  readonly isOnline?: () => boolean;
  readonly now?: () => number;
}

export type AuthFailureReporter = (input: AuthFailureInput) => void;

const CODE_RE = /^[a-z][a-z0-9_]{1,63}$/;
/** `/sign-in`, `/(auth)/sign-up`, `/auth/callback`, `/join`. No ids, no query. */
const SCREEN_SEGMENT_RE = /^(?:[a-z]+(?:-[a-z]+)*|\([a-z]+(?:-[a-z]+)*\))$/;
const UNKNOWN_SCREEN = "unknown";

/**
 * supabase-js's name for a request that got no answer (it wraps the runtime's
 * `TypeError: Failed to fetch`), and a timed-out one. A bare `TypeError` is
 * not here: supabase-js never lets one out, so one reaching the reporter is a
 * bug in the calling code, and it is reported as `unknown`.
 */
const NETWORK_ERROR_NAMES: ReadonlySet<string> = new Set([
  "AuthRetryableFetchError",
  "AbortError",
]);

/**
 * GoTrue refuses both the one-email-a-minute cooldown for an address and the
 * project's hourly email cap with `429 over_email_send_rate_limit`; only the
 * cooldown's sentence names seconds (`packages/hooks/src/auth-error-copy.ts`).
 * The cap means no auth email goes out to anyone, so it is reported under its
 * own code, which is not expected and so arrives at `error`. The sentence is
 * read for this one test and never sent.
 */
export const EMAIL_SEND_CAPPED_CODE = "email_send_capped";
const EMAIL_COOLDOWN_RE = /after \d+ seconds?/i;

export function createAuthFailureReporter(
  options: AuthFailureReporterOptions,
): AuthFailureReporter {
  const allow = createKeyedRateLimiter({
    intervalMs: AUTH_FAILURE_REPORT_INTERVAL_MS,
    maxKeys: MAX_REMEMBERED_FINGERPRINTS,
    now: options.now ?? (() => Date.now()),
  });
  return (input) => {
    try {
      const report = buildAuthFailureReport(input, options.isOnline?.() ?? true);
      if (!report) return;
      if (!allow(report.fingerprint.join("\u0000"))) return;
      options.capture(report);
    } catch {
      // Reporting is a side channel; the screen already showed its copy.
    }
  };
}

/**
 * The report for one failure, or `null` when there is nothing to report (a
 * dead request while the device reads offline). Exported for tests.
 */
export function buildAuthFailureReport(
  input: AuthFailureInput,
  online = true,
): AuthFailureReport | null {
  const code = emailCapSplit(
    identifierOrUndefined(input.code) ?? identifierOrUndefined(fieldOf(input.error, "code")),
    input.error,
  );
  const status = statusOf(input.error);
  const kind = kindOf(input.error, code, status);
  // Nothing answered (a dead request, or a native SDK that gave out with no
  // code) while the device reads offline: the member's network, not a fault.
  if ((kind === "network" || kind === "unknown") && !online) return null;
  const expected = code !== undefined && EXPECTED_AUTH_ERROR_CODES.has(code) && kind === "refusal";
  const flow = input.flow;
  const screen = screenOf(input.screen);
  const label = code ?? kind;
  const tags: Record<string, string> = {
    auth_flow: flow,
    auth_screen: screen,
    auth_failure_kind: kind,
    auth_expected: String(expected),
  };
  if (code) tags.auth_error_code = code;
  if (status !== undefined) tags["http.status_code"] = String(status);
  const error = new Error(
    expected
      ? `${flow} refused (${label})`
      : `${flow} failed (${label}${status !== undefined ? `, ${status}` : ""})`,
  );
  error.name = expected ? "AuthRefusal" : "AuthFailure";
  return {
    error,
    level: expected ? "info" : "error",
    fingerprint: ["signed-out-auth", flow, label],
    tags,
  };
}

function kindOf(
  error: unknown,
  code: string | undefined,
  status: number | undefined,
): AuthFailureKind {
  if (status !== undefined && status >= 500) return "server";
  if (status !== undefined && status >= 400) return "refusal";
  const name = fieldOf(error, "name");
  if (status === 0 || (typeof name === "string" && NETWORK_ERROR_NAMES.has(name) && !code)) {
    return "network";
  }
  if (code) return "refusal";
  return "unknown";
}

function emailCapSplit(code: string | undefined, error: unknown): string | undefined {
  if (code !== "over_email_send_rate_limit") return code;
  const message = fieldOf(error, "message");
  if (typeof message !== "string") return code;
  return EMAIL_COOLDOWN_RE.test(message) ? code : EMAIL_SEND_CAPPED_CODE;
}

function screenOf(screen: string): string {
  if (typeof screen !== "string" || !screen.startsWith("/")) return UNKNOWN_SCREEN;
  if (screen === "/") return screen;
  const segments = screen.slice(1).split("/");
  if (segments.length > 4) return UNKNOWN_SCREEN;
  return segments.every((s) => s.length <= 24 && SCREEN_SEGMENT_RE.test(s))
    ? screen
    : UNKNOWN_SCREEN;
}

function identifierOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && CODE_RE.test(value) ? value : undefined;
}

function statusOf(error: unknown): number | undefined {
  const status = fieldOf(error, "status");
  return typeof status === "number" && Number.isInteger(status) && status >= 0 && status < 600
    ? status
    : undefined;
}

function fieldOf(value: unknown, field: string): unknown {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)[field]
    : undefined;
}
