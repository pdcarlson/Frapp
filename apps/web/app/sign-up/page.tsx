"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { AuthScreen } from "@/components/auth/auth-screen";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SkeletonText } from "@/components/shared/async-states";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { getErrorMessage } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

import { resolveRedirectPath } from "@/lib/auth/redirect";

/**
 * Create an account — s01's grammar, one step along.
 *
 * The reference draws no sign-up screen, so this is s01's column applied rather
 * than a transcription. It carries **no mark**, for s02's reason: the mark
 * belongs to the entry screen, and this is reached from one.
 *
 * The #920 Profile & pre-auth slice replaced a two-card grid whose eyebrow read
 * "Frapp account setup", whose heading promised "live staging walkthroughs",
 * and whose supporting card listed four internal milestones ("Activate billing
 * in test mode to unlock invite workflows").
 *
 * Both post-submit branches are unchanged: a session in the response means
 * Supabase is not confirming email, so the member goes straight to
 * `redirectTo`; otherwise they are told to check their inbox and bounced to
 * sign-in with `redirectTo` intact.
 */
function SignUpPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const redirectTo = resolveRedirectPath(searchParams.get("redirectTo"));

  async function handleSignUp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}${redirectTo}`,
        },
      });
      if (error) throw error;

      if (data.session) {
        toast({
          title: "Account created",
          description: "You are signed in and ready to continue.",
        });
        router.replace(redirectTo);
        router.refresh();
        return;
      }

      toast({
        title: "Check your inbox",
        description: "Confirm your email to finish setting up your account.",
      });
      router.replace(`/sign-in?redirectTo=${encodeURIComponent(redirectTo)}`);
    } catch (error) {
      toast({
        title: "Unable to create account",
        description: getErrorMessage(error, "Something went wrong. Please try again."),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthScreen
      back={{ href: `/sign-in?redirectTo=${encodeURIComponent(redirectTo)}`, label: "Back" }}
      title="Create your account"
      subtitle="One account, then join your chapter or start one."
      footer={
        <>
          Already have an account?{" "}
          <Link
            href={`/sign-in?redirectTo=${encodeURIComponent(redirectTo)}`}
            className="font-semibold text-accent-text hover:underline"
          >
            Sign in
          </Link>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={handleSignUp}>
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
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Create a password"
            required
          />
        </div>
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? <Loader2 className="animate-spin" /> : null}
          Create account
        </Button>
      </form>
    </AuthScreen>
  );
}

export default function SignUpPage() {
  return (
    <Suspense
      fallback={
        <AuthScreen
          title="Create your account"
          subtitle="One account, then join your chapter or start one."
        >
          <div role="status" aria-busy="true" aria-live="polite">
            <span className="sr-only">Loading the sign-up form…</span>
            <SkeletonText lines={4} />
          </div>
        </AuthScreen>
      }
    >
      <SignUpPageContent />
    </Suspense>
  );
}
