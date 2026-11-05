import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * The signed-out entry point, which is now only a gate.
 *
 * With a session it redirects to `/chat` (`spec/ui/web-dashboard/README.md`
 * §Gating & routing semantics); without one it redirects to `/sign-in`.
 *
 * Until 2026-11-05 it was a screen of its own: mark, wordmark, tagline and two
 * buttons, "Sign in" and "Create an account", each leading to a second page.
 * That was the mobile entry screen's shape, where the form sits behind a tap;
 * on the web it cost every returning member a click before the form. The
 * sign-in form carries both of its other exits: the toggle above its title
 * ("Create account") and its footer ("Join your chapter").
 *
 * It redirects rather than rendering the form itself because it cannot join
 * the `(auth)` group that keeps the signed-out frame mounted across routes:
 * `app/(dashboard)/page.tsx` is that group's index and would resolve to the
 * same `/`. Rendering the frame here instead would remount it, and restart its
 * product panel, on the hop to `/sign-up`.
 *
 * The #920 Profile & pre-auth slice deleted what stood here before that: a
 * "Frapp staging" eyebrow over "Run live chapter admin workflows on the web",
 * three feature cards describing the API's scoping model, and a five-step
 * "What this milestone unlocks" walkthrough.
 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = toQuery(await searchParams);
  // GoTrue sends a link to the Site URL, which is `/`, whenever its redirect
  // target is not on the allow list (`docs/ops/deployment/supabase.md`). The
  // page this replaced mounted a browser client that could still pick such a
  // link up, so hand its `code` or `token_hash` to the route that exchanges
  // one rather than dropping it on the hop to `/sign-in`.
  if (AUTH_LINK_PARAMS.some((name) => query.has(name))) {
    redirect(`/auth/callback?${query}`);
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session) redirect("/chat");
  // Kept, so a `/?redirectTo=…` still reaches the form that reads it.
  redirect(query.size > 0 ? `/sign-in?${query}` : "/sign-in");
}

/** What `app/auth/callback/route.ts` reads to finish or report a sign-in link. */
const AUTH_LINK_PARAMS = ["code", "token_hash", "error_code", "error"] as const;

function toQuery(
  params: Record<string, string | string[] | undefined>,
): URLSearchParams {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined) query.append(name, item);
    }
  }
  return query;
}
