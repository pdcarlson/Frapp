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
 * sign-in form carries both of its other exits in its footer ("Create an
 * account", "Join your chapter").
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
export default async function Home() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  redirect(session ? "/chat" : "/sign-in");
}
