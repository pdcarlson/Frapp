import { NextResponse } from "next/server";
import { isEmailOtpType, resolveRedirectPath } from "@/lib/auth/redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
 * the page can say what happened. Nothing is signed in on failure.
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
    if (!error) {
      return NextResponse.redirect(new URL(next, url.origin));
    }
    const signIn = new URL("/sign-in", url.origin);
    signIn.searchParams.set("redirectTo", next);
    signIn.searchParams.set("authError", "verify_failed");
    return NextResponse.redirect(signIn);
  }

  if (code && !linkError) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, url.origin));
    }
  }

  const signIn = new URL("/sign-in", url.origin);
  signIn.searchParams.set("redirectTo", next);
  signIn.searchParams.set("authError", linkError ?? (code ? "exchange_failed" : "missing_code"));
  return NextResponse.redirect(signIn);
}
