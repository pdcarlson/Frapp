"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { AuthModeToggle } from "@/components/auth/auth-mode-toggle";
import { AuthDivider, AuthScreen } from "@/components/auth/auth-screen";
import { FloatingField } from "@/components/auth/floating-field";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { Button } from "@/components/ui/button";
import { SkeletonText } from "@/components/shared/async-states";
import {
  CheckEmail,
  RESEND_COOLDOWN_SECONDS,
  confirmationRedirectUrl,
} from "@/components/auth/check-email";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useToast } from "@/lib/hooks/use-toast";

import { resolveRedirectPath } from "@/lib/auth/redirect";
import {
  EXISTING_ACCOUNT_COPY,
  describeSignUpError,
  emailCooldownSeconds,
  isExistingAccountSignUp,
} from "@/lib/auth/email-auth-errors";
import {
  describeOAuthKickoffError,
  startWebOAuth,
  type OAuthProvider,
} from "@/lib/auth/oauth";

/**
 * Create an account — the sign-in screen with different fields.
 *
 * The reference draws no sign-up screen, so this is s01's column applied rather
 * than a transcription. Since 2026-11-05 it sits in the same signed-out frame
 * as sign-in (`app/(auth)/layout.tsx`), so the hop between them swaps only the
 * form and the product panel keeps running. It draws no "‹ Back" for the same
 * reason: the two are one page, and the mode toggle above the title
 * (`auth-mode-toggle.tsx`) is the way across. Compressed with sign-in on
 * 2026-11-05 (floating labels, no subtitle, side-by-side providers) so the
 * column fits a laptop screen. It has no footer: the toggle covers sign-in
 * and carries `redirectTo`, so an invited member who crosses over keeps the
 * `/join` they arrived for.
 *
 * The #920 Profile & pre-auth slice replaced a two-card grid whose eyebrow read
 * "Frapp account setup", whose heading promised "live staging walkthroughs",
 * and whose supporting card listed four internal milestones ("Activate billing
 * in test mode to unlock invite workflows").
 *
 * After submit, four branches. A session in the response means Supabase is
 * not confirming email (the local stack), so the member goes straight to
 * `redirectTo`. A user with no identities is GoTrue's stand-in for an address
 * that already has an account: no email goes out, so the member is told to
 * sign in instead. Otherwise the form gives way to "Check your email"
 * (`check-email.tsx`) for that address, which is what every hosted sign-up
 * sees (#3776). Until 2026-11-09 that branch was a toast and a bounce to
 * `/sign-in`, where the member typed the new password into a form that could
 * only refuse it. A refusal inside GoTrue's email minute (the same address
 * resubmitted) returns to "Check your email" too, counting down GoTrue's
 * seconds.
 *
 * The confirmation email's link lands on
 * `/auth/callback?next=<redirectTo>&intent=confirm`
 * (`confirmationRedirectUrl`), which signs the member in and delivers them to
 * `redirectTo` (for an invited member, `/join?token=…`, token intact).
 */
function SignUpPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingOAuth, setPendingOAuth] = useState<OAuthProvider | null>(null);
  const [sent, setSent] = useState<{ email: string; cooldown: number } | null>(null);
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
          emailRedirectTo: confirmationRedirectUrl(window.location.origin, redirectTo),
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

      if (isExistingAccountSignUp(data.user)) {
        toast({
          title: "You already have an account",
          description: EXISTING_ACCOUNT_COPY,
        });
        return;
      }

      setPassword("");
      setSent({ email, cooldown: RESEND_COOLDOWN_SECONDS });
    } catch (error) {
      // Refused inside GoTrue's minute: this address already has an
      // unconfirmed account whose email went out moments ago (a resubmit
      // after "Use a different email", a double tap). That email is the one
      // to open, so this is "Check your email" again, counting down.
      const cooldown = emailCooldownSeconds(error);
      if (cooldown !== undefined) {
        setPassword("");
        setSent({ email, cooldown: Math.max(cooldown, 1) });
        return;
      }
      toast({
        title: "Unable to create account",
        description: describeSignUpError(error),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleOAuth(provider: OAuthProvider) {
    setPendingOAuth(provider);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await startWebOAuth(
        supabase,
        provider,
        window.location.origin,
        redirectTo,
      );
      if (error) throw error;
    } catch (error) {
      toast({
        title: "Unable to create account",
        description: describeOAuthKickoffError(error),
        variant: "destructive",
      });
    } finally {
      setPendingOAuth(null);
    }
  }

  const oauthBusy = pendingOAuth !== null;

  if (sent) {
    return (
      <AuthScreen
        title="Check your email"
        footer={
          <p>
            Opened it on another device?{" "}
            <Link
              href={`/sign-in?redirectTo=${encodeURIComponent(redirectTo)}`}
              className="font-semibold text-accent-text hover:underline"
            >
              Sign in here
            </Link>
          </p>
        }
      >
        <CheckEmail
          email={sent.email}
          redirectTo={redirectTo}
          initialCooldownSeconds={sent.cooldown}
          backLabel="Use a different email"
          onBack={() => setSent(null)}
        />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen
      title="Create your account"
      toggle={<AuthModeToggle current="sign-up" redirectTo={redirectTo} />}
    >
      <form className="flex flex-col gap-3" onSubmit={handleSignUp}>
        <FloatingField
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <FloatingField
          id="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        <Button type="submit" className="w-full" disabled={isSubmitting || oauthBusy}>
          {isSubmitting ? <Loader2 className="animate-spin" /> : null}
          Create account
        </Button>
      </form>

      <AuthDivider label="or" />

      <OAuthButtons
        onSelect={(provider) => {
          void handleOAuth(provider);
        }}
        pending={pendingOAuth}
        disabled={isSubmitting}
      />
    </AuthScreen>
  );
}

export default function SignUpPage() {
  return (
    <Suspense
      fallback={
        <AuthScreen
          title="Create your account"
          toggle={
            <AuthModeToggle current="sign-up" redirectTo={resolveRedirectPath(null)} />
          }
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
