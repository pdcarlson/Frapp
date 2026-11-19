"use client";

import Link from "next/link";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { AppleMark, GoogleMark } from "@/components/auth/oauth-brand-icons";
import { Button } from "@/components/ui/button";
import { useToast } from "@/lib/hooks/use-toast";
import {
  describeOAuthKickoffError,
  startWebOAuth,
  type OAuthProvider,
} from "@/lib/auth/oauth";
import { reportAuthFailure } from "@/lib/sentry/auth-failures";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { EmailCodeSignIn } from "./email-code-sign-in";

const PROVIDERS: { id: OAuthProvider; name: string }[] = [
  { id: "apple", name: "Apple" },
  { id: "google", name: "Google" },
];

/**
 * The invite card's way in (#5625): Continue with Apple, Google or email, and
 * that one tap is both the sign-in and the join. Each returns to `returnTo`,
 * the same `/join` marked to finish what the visitor started (join, or ask
 * for a new link), so there is no second Join button after it.
 *
 * Full width and stacked, unlike sign-in's side-by-side pair: this column has
 * room, and "Continue with Google" reads as one decision. Apple first, as
 * App Store Guideline 4.8 and sign-in both have it. An account with a
 * password keeps a quiet way through `/sign-in`.
 */
export function JoinSignIn({
  returnTo,
  onSignedIn,
  disabled = false,
}: {
  /** Where every way in lands once signed in (already open-redirect safe). */
  returnTo: string;
  /** The email code signed this tab in without leaving it. */
  onSignedIn: () => void;
  disabled?: boolean;
}) {
  const { toast } = useToast();
  const [pending, setPending] = useState<OAuthProvider | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);

  async function start(provider: OAuthProvider) {
    setPending(provider);
    try {
      const { error } = await startWebOAuth(
        createSupabaseBrowserClient(),
        provider,
        window.location.origin,
        returnTo,
      );
      if (error) throw error;
      // The browser is on its way to the provider; the spinner stays.
    } catch (error) {
      reportAuthFailure({ flow: "oauth_start", screen: "/join", error });
      toast({
        title: "Unable to continue",
        description: describeOAuthKickoffError(error),
        variant: "destructive",
      });
      setPending(null);
    }
  }

  if (emailOpen) {
    return (
      <EmailCodeSignIn
        redirectTo={returnTo}
        onSignedIn={onSignedIn}
        onBack={() => setEmailOpen(false)}
        disabled={disabled}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {PROVIDERS.map(({ id, name }) => (
        <Button
          key={id}
          type="button"
          variant="secondary"
          className="h-11 w-full [&_svg]:size-5"
          disabled={disabled || pending !== null}
          aria-busy={pending === id}
          onClick={() => void start(id)}
        >
          {pending === id ? (
            <Loader2 className="animate-spin" />
          ) : id === "apple" ? (
            <AppleMark />
          ) : (
            <GoogleMark />
          )}
          Continue with {name}
        </Button>
      ))}
      <Button
        type="button"
        variant="ghost"
        className="h-11 w-full"
        disabled={disabled || pending !== null}
        onClick={() => setEmailOpen(true)}
      >
        Continue with email
      </Button>
    </div>
  );
}

/** The footer for an account that signs in with a password. */
export function PasswordSignInLine({ returnTo }: { returnTo: string }) {
  return (
    <p>
      Have a password?{" "}
      <Link
        href={`/sign-in?redirectTo=${encodeURIComponent(returnTo)}`}
        className="font-semibold text-accent-text hover:underline"
      >
        Sign in
      </Link>
    </p>
  );
}
