import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthScreen } from "@/components/auth/auth-screen";
import { Button } from "@/components/ui/button";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * The signed-out entry point.
 *
 * A redirect gate first and a screen second: with a session it never renders at
 * all (`spec/ui/web-dashboard/README.md` §Gating & routing semantics — `/`
 * redirects to `/chat`), so its whole surface is the pre-auth column s01 draws.
 *
 * The #920 Profile & pre-auth slice deleted what stood here: a "Frapp staging"
 * eyebrow over "Run live chapter admin workflows on the web", three feature
 * cards describing the API's scoping model, and a five-step "What this
 * milestone unlocks" walkthrough. It also deleted two `border-border/70` washes
 * — §3 rule 4 bans one-offing a token value at the call site, and `--border` is
 * already `rgba(255,255,255,.08)`, so `/70` was diluting a hairline to 0.056.
 */
export default async function Home() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session) {
    redirect("/chat");
  }

  return (
    <AuthScreen
      mark
      title="Signet"
      subtitle="Ask your chapter anything."
      footer={
        <>
          Have an invite?{" "}
          <Link
            href="/join"
            className="font-semibold text-accent-text hover:underline"
          >
            Join your chapter
          </Link>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Button asChild className="w-full">
          <Link href="/sign-in">Sign in</Link>
        </Button>
        <Button asChild variant="secondary" className="w-full">
          <Link href="/sign-up">Create an account</Link>
        </Button>
      </div>
    </AuthScreen>
  );
}
