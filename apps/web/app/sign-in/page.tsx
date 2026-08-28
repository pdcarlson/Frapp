"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { AuthDivider, AuthScreen } from "@/components/auth/auth-screen";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SkeletonText } from "@/components/shared/async-states";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { getErrorMessage } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { resolveRedirectPath } from "@/lib/auth/redirect";

/**
 * s01 — Sign in (`spec/ui/design-system/reference/canvas-screens.dc.html`).
 *
 * Mark, wordmark, tagline, two fields, the primary, an "or" rule and the second
 * method. The #920 Profile & pre-auth slice replaced a three-card staging-demo
 * grid ("Frapp admin access" / "Sign in to manage your chapter in staging" /
 * "What this unlocks") whose copy described the milestone rather than the
 * product, and whose four bullets named database behaviour to a member.
 *
 * s01's second method is "Continue with Apple"; web ships the magic link it
 * already had. The slot is the same and the geometry is the drawing's — this is
 * a transcription of the screen, not of the identity providers on it.
 *
 * The redirect plumbing is unchanged and is a data contract
 * (`spec/ui/web-dashboard/README.md` §Gating & routing semantics):
 * `resolveRedirectPath` applies the open-redirect guard the proxy applies, the
 * value survives the sign-in ↔ sign-up hop, and it is reused verbatim as the
 * magic link's `emailRedirectTo`.
 */
function SignInPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isMagicLinkPending, setIsMagicLinkPending] = useState(false);
  const redirectTo = resolveRedirectPath(searchParams.get("redirectTo"));

  async function handlePasswordSignIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;

      toast({
        title: "Signed in",
        description: "Welcome back.",
      });
      router.replace(redirectTo);
      router.refresh();
    } catch (error) {
      toast({
        title: "Unable to sign in",
        description: getErrorMessage(error, "Something went wrong. Please try again."),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleMagicLink() {
    if (!email) {
      toast({
        title: "Email required",
        description: "Enter your email address to request a magic link.",
        variant: "destructive",
      });
      return;
    }

    setIsMagicLinkPending(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}${redirectTo}`,
        },
      });
      if (error) throw error;

      toast({
        title: "Magic link sent",
        description: "Check your inbox to continue signing in.",
      });
    } catch (error) {
      toast({
        title: "Unable to send magic link",
        description: getErrorMessage(error, "Something went wrong. Please try again."),
        variant: "destructive",
      });
    } finally {
      setIsMagicLinkPending(false);
    }
  }

  return (
    <AuthScreen
      mark
      title="Signet"
      subtitle="Ask your chapter anything."
      footer={
        <>
          New here?{" "}
          <Link
            href={`/sign-up?redirectTo=${encodeURIComponent(redirectTo)}`}
            className="font-semibold text-accent-text hover:underline"
          >
            Create an account
          </Link>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={handlePasswordSignIn}>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@university.edu"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Your password"
            required
          />
        </div>
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? <Loader2 className="animate-spin" /> : null}
          Continue
        </Button>
      </form>

      <AuthDivider label="or" />

      <Button
        type="button"
        variant="secondary"
        className="w-full"
        onClick={handleMagicLink}
        disabled={isMagicLinkPending}
      >
        {isMagicLinkPending ? <Loader2 className="animate-spin" /> : null}
        Email me a magic link
      </Button>
    </AuthScreen>
  );
}

/**
 * The boundary `useSearchParams` requires.
 *
 * It renders the column rather than a bare `<main className="min-h-screen">` —
 * the previous fallback was a blank dark screen with nothing announced, and the
 * mark and title do not depend on the search params, so they can be stable
 * across the hydration boundary instead of appearing after it.
 */
export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <AuthScreen mark title="Signet" subtitle="Ask your chapter anything.">
          <div role="status" aria-busy="true" aria-live="polite">
            <span className="sr-only">Loading the sign-in form…</span>
            <SkeletonText lines={4} />
          </div>
        </AuthScreen>
      }
    >
      <SignInPageContent />
    </Suspense>
  );
}
