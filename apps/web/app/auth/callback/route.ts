import { NextResponse } from "next/server";
import {
  AUTH_CALLBACK_INTENT_PARAM,
  EMAIL_CONFIRMED_AUTH_ERROR,
  isEmailLinkIntent,
  isEmailOtpType,
  resolveRedirectPath,
} from "@/lib/auth/redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { reportServerAuthFailure } from "@/lib/sentry/auth-failures";

/**
 * Report a link or provider return that didn't become a session (#3832), with
 * GoTrue's own error where there is one, so an Auth 5xx arrives at `error`
 * rather than as the fixed `authError` the member is shown. Reported here, not
 * from `/sign-in`, which only sees that fixed code and would count a reload or
 * a hand-typed `?authError=` as another failure.
 */
function reportCallbackFailure(failure: { error?: unknown; code?: string }): void {
  reportServerAuthFailure({ flow: "auth_callback", screen: "/auth/callback", ...failure });
}

/**
 * Where every Supabase email link *and* OAuth return lands: sign-up
 * confirmation, magic link, Google, and Apple.
 *
 * Two arrivals, same route:
 *
 * 1. `?token_hash=…&type=magiclink` — the hosted Magic Link template points
 *    here with `{{ .TokenHash }}` so the href stays on `app.{staging.}frapp.live`
 *    instead of `*.supabase.co/auth/v1/verify`. `verifyOtp` does not need the
 *    PKCE cookie, so the link works in a different browser than the one that
 *    requested it.
 * 2. `?code=…&next=<path>` — `@supabase/ssr`'s PKCE flow after GoTrue's own
 *    verify hop. Kept so an un-rewritten ConfirmationURL still signs in.
 *
 * This route is deliberately outside `proxy.ts`'s matcher — the proxy would
 * otherwise see no session and bounce the request to
 * `/sign-in?redirectTo=<path?code=…>`, hiding the secret inside a query
 * parameter where nothing exchanges it.
 *
 * Failure — an expired link (`?error=access_denied&error_code=otp_expired`),
 * a bad hash, a code whose verifier cookie is gone, a replay — lands on
 * `/sign-in` with `next` preserved as `redirectTo` and `authError` set so
 * the page can say what happened. Nothing is signed in on failure. The one
 * failure that is good news is an email link (`intent=confirm` from sign-up
 * and Resend, or `intent=sign-in-link` from the sign-in magic link:
 * `isEmailLinkIntent`) whose code won't exchange: GoTrue verified it before
 * handing out the code, which confirms the address, so it lands with
 * `authError=email_confirmed` and the page says to sign in. A Google or Apple
 * code (`intent=sign-in`) that won't exchange is a real failure.
 *
 * `next` is re-validated with the same open-redirect guard the proxy applies
 * (a same-origin path or `/chat`), so tampering with the link cannot send a
 * freshly signed-in session to another host.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const next = resolveRedirectPath(url.searchParams.get("next"));
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const otpType = url.searchParams.get("type");
  const linkError = url.searchParams.get("error_code") ?? url.searchParams.get("error");

  if (!linkError && tokenHash) {
    if (!otpType || !isEmailOtpType(otpType)) {
      // The link's `type` is one GoTrue never sends: a template fault.
      reportCallbackFailure({ code: "otp_type_invalid" });
      const signIn = new URL("/sign-in", url.origin);
      signIn.searchParams.set("redirectTo", next);
      signIn.searchParams.set("authError", "verify_failed");
      return NextResponse.redirect(signIn);
    }
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: otpType,
    });
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
    reportCallbackFailure({ error });
    const signIn = new URL("/sign-in", url.origin);
    signIn.searchParams.set("redirectTo", next);
    signIn.searchParams.set("authError", "verify_failed");
    return NextResponse.redirect(signIn);
  }

  if (code && !linkError) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
    reportCallbackFailure({ error });
    // An email link that reached here with a code already confirmed the
    // address (GoTrue verifies before it hands out a code), so the only thing
    // that failed is signing *this* browser in. Say so, and let a sign-in do
    // it, rather than call a working link broken. OAuth's `sign-in` is excluded:
    // a provider code that won't exchange is a real failure, not a confirmation.
    if (isEmailLinkIntent(url.searchParams.get(AUTH_CALLBACK_INTENT_PARAM))) {
      const signIn = new URL("/sign-in", url.origin);
      signIn.searchParams.set("redirectTo", next);
      signIn.searchParams.set("authError", EMAIL_CONFIRMED_AUTH_ERROR);
      return NextResponse.redirect(signIn);
    }
  }

  // A failed exchange was reported above; what is left arrived failed.
  if (!code || linkError) reportCallbackFailure({ code: linkError ?? "missing_code" });
  const signIn = new URL("/sign-in", url.origin);
  signIn.searchParams.set("redirectTo", next);
  signIn.searchParams.set("authError", linkError ?? (code ? "exchange_failed" : "missing_code"));
  return NextResponse.redirect(signIn);
}
