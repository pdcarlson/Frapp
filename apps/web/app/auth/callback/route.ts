import { NextResponse } from "next/server";
import { resolveRedirectPath } from "@/lib/auth/redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Where every Supabase email link lands: sign-up confirmation and magic link.
 *
 * `@supabase/ssr`'s browser client runs the PKCE flow, so a verified link
 * arrives here as `/auth/callback?code=…&next=<path>`. The code is exchanged
 * for a session against the PKCE verifier the browser client stored in a
 * cookie when it started the flow; `createSupabaseServerClient` writes the
 * resulting session cookies onto the response, and the member is sent on to
 * `next` already signed in. This route is deliberately outside `proxy.ts`'s
 * matcher — the proxy would otherwise see no session and bounce the request
 * to `/sign-in?redirectTo=<path?code=…>`, hiding the code inside a query
 * parameter where nothing exchanges it. That was the state before this route
 * existed: a magic-link member got a password form.
 *
 * Failure — an expired link (`?error=access_denied&error_code=otp_expired`),
 * a code whose verifier cookie is gone because the link was opened in a
 * different browser, a replayed code — lands on `/sign-in` with `next`
 * preserved as `redirectTo` and `authError` set so the page can say what
 * happened. Nothing is signed in on failure.
 *
 * `next` is re-validated with the same open-redirect guard the proxy applies
 * (a same-origin path or `/chat`), so tampering with the link cannot send a
 * freshly signed-in session to another host.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const next = resolveRedirectPath(url.searchParams.get("next"));
  const code = url.searchParams.get("code");
  const linkError = url.searchParams.get("error_code") ?? url.searchParams.get("error");

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
