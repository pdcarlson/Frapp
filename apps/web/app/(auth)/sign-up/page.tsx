"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { AuthModeToggle } from "@/components/auth/auth-mode-toggle";
import { AuthDivider, AuthScreen } from "@/components/auth/auth-screen";
import { FloatingField } from "@/components/auth/floating-field";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { Button } from "@/components/ui/button";
import { SkeletonText } from "@/components/shared/async-states";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { getErrorMessage } from "@/lib/utils";
import { useToast } from "@/lib/hooks/use-toast";

import { buildAuthCallbackUrl, resolveRedirectPath } from "@/lib/auth/redirect";
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
 * Both post-submit branches are unchanged: a session in the response means
 * Supabase is not confirming email, so the member goes straight to
 * `redirectTo`; otherwise they are told to check their inbox and bounced to
 * sign-in with `redirectTo` intact. The confirmation email's link lands on
 * `/auth/callback?next=<redirectTo>` (`buildAuthCallbackUrl`), which exchanges
 * the PKCE code and then delivers the member to `redirectTo` signed in — for an
 * invited member that is `/join?token=…`, token intact.
 */
function SignUpPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingOAuth, setPendingOAuth] = useState<OAuthProvider | null>(null);
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
          emailRedirectTo: buildAuthCallbackUrl(window.location.origin, redirectTo),
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
