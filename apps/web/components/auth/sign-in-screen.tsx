"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  SESSION_ENDED_PARAM,
  SESSION_ENDED_VALUE,
} from "@/lib/auth/rejected-session";
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
import {
  buildAuthCallbackUrl,
  describeAuthError,
  resolveRedirectPath,
} from "@/lib/auth/redirect";
import {
  describeOAuthKickoffError,
  startWebOAuth,
  type OAuthProvider,
} from "@/lib/auth/oauth";

/**
 * s01 — Sign in (`spec/ui/design-system/reference/canvas-screens.dc.html`).
 *
 * Two fields, the primary, an "or" rule and the second method, under a
 * "Welcome back" title. Since 2026-11-05 the mark and wordmark live in the
 * signed-out frame's lockup (`auth-frame.tsx`), and `/` redirects here instead
 * of drawing a two-button page that led here. The title no longer carries the
 * "Ask your chapter anything." tagline either: Ask is not built, and the
 * landing page holds that line back for the same reason
 * (`spec/ui/landing/README.md` D8). The #920 Profile & pre-auth slice replaced a three-card staging-demo
 * grid ("Frapp admin access" / "Sign in to manage your chapter in staging" /
 * "What this unlocks") whose copy described the milestone rather than the
 * product, and whose four bullets named database behaviour to a member.
 *
 * s01's second method is "Continue with Apple". Web now ships Apple and Google
 * as equal Secondary buttons in that slot (Guideline 4.8 once Google is
 * offered). The password form stays the primary.
 *
 * **Compressed on 2026-11-05** after Paul found the column scrolled on his
 * laptop: the labels float inside the fields (`floating-field.tsx`), the
 * subtitle and the "New here?" sentence gave way to the mode toggle above the
 * title (`auth-mode-toggle.tsx`), Apple and Google sit side by side, and the
 * magic link is a text link under Continue instead of a third full-width
 * button.
 *
 * The redirect plumbing is a data contract
 * (`spec/ui/web-dashboard/README.md` §Gating & routing semantics):
 * `resolveRedirectPath` applies the open-redirect guard the proxy applies, the
 * value survives the sign-in ↔ sign-up hop, and the magic link carries it as
 * the `next` of `/auth/callback` (`buildAuthCallbackUrl`) — the route that
 * exchanges the PKCE code the link comes back with. `/auth/callback` sends a
 * failed link back here with `authError` set; the toast below is the only
 * place that code is read.
 */
const SIGN_IN_TITLE = "Welcome back";

function SignInPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isMagicLinkPending, setIsMagicLinkPending] = useState(false);
  const [pendingOAuth, setPendingOAuth] = useState<OAuthProvider | null>(null);
  const redirectTo = resolveRedirectPath(searchParams.get("redirectTo"));
  const authError = searchParams.get("authError");
  const sessionEnded =
    searchParams.get(SESSION_ENDED_PARAM) === SESSION_ENDED_VALUE;

  // A link that could not be turned into a session lands here with the reason.
  // Shown once, on arrival; the parameter is not carried into the next hop.
  useEffect(() => {
    if (!authError) return;
    toast({
      title: "That link didn't sign you in",
      description: describeAuthError(authError),
      variant: "destructive",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- arrival only
  }, [authError]);

  // The one thing a member hears when the API stopped accepting their session,
  // usually because the account was deleted on another device
  // (`lib/auth/rejected-session.ts`). Every dashboard screen used to say
  // something different about it; now none of them renders and this does.
  useEffect(() => {
    if (!sessionEnded) return;
    toast({
      title: "You've been signed out",
      description:
        "This account no longer exists or its session ended. Sign in to continue.",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- arrival only
  }, [sessionEnded]);

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
          emailRedirectTo: buildAuthCallbackUrl(window.location.origin, redirectTo),
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
        title: "Unable to sign in",
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
      title={SIGN_IN_TITLE}
      toggle={<AuthModeToggle current="sign-in" redirectTo={redirectTo} />}
      footer={<SignInFooter />}
    >
      <form className="flex flex-col gap-3" onSubmit={handlePasswordSignIn}>
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
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        <Button type="submit" className="w-full" disabled={isSubmitting || oauthBusy}>
          {isSubmitting ? <Loader2 className="animate-spin" /> : null}
          Continue
        </Button>
        {/*
          After Continue, so Tab from the password reaches the submit first and
          a keyboard user can't send a link by accident.
        */}
        <Button
          type="button"
          variant="link"
          size="sm"
          // 36 to a mouse, 44 to a finger: components.md §2's compact carve-out.
          className="mx-auto h-9 pointer-coarse:h-11"
          onClick={handleMagicLink}
          disabled={isMagicLinkPending || oauthBusy}
        >
          {isMagicLinkPending ? <Loader2 className="animate-spin" /> : null}
          Email me a magic link instead
        </Button>
      </form>

      <AuthDivider label="or" />

      <OAuthButtons
        onSelect={(provider) => {
          void handleOAuth(provider);
        }}
        pending={pendingOAuth}
        disabled={isSubmitting || isMagicLinkPending}
      />
    </AuthScreen>
  );
}

/**
 * The form's one other exit (the toggle covers sign-up). A component so the
 * Suspense fallback draws the same footer and nothing shifts on hydration.
 */
function SignInFooter() {
  return (
    <p>
      Have an invite?{" "}
      <Link href="/join" className="font-semibold text-accent-text hover:underline">
        Join your chapter
      </Link>
    </p>
  );
}

/**
 * The boundary `useSearchParams` requires.
 *
 * It renders the column rather than nothing: the previous fallback was a blank
 * dark screen with nothing announced, and the title does not depend on the
 * search params, so it can be stable across the hydration boundary instead of
 * appearing after it.
 */
export function SignInScreen() {
  return (
    <Suspense
      fallback={
        <AuthScreen
          title={SIGN_IN_TITLE}
          toggle={
            <AuthModeToggle current="sign-in" redirectTo={resolveRedirectPath(null)} />
          }
          footer={<SignInFooter />}
        >
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
