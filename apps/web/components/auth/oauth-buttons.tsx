"use client";

import { Loader2 } from "lucide-react";
import { AppleMark, GoogleMark } from "@/components/auth/oauth-brand-icons";
import { Button } from "@/components/ui/button";
import { OAUTH_MEMBERSHIP_HINT, type OAuthProvider } from "@/lib/auth/oauth";

const LABELS: Record<OAuthProvider, string> = {
  apple: "Continue with Apple",
  google: "Continue with Google",
};

/**
 * Equal-prominence OAuth methods for the pre-auth column.
 *
 * Canvas s01 draws one second method after the password primary. App Store
 * Guideline 4.8 requires Apple once Google is offered, so this stack is two
 * Secondary buttons of the same size, Apple first (the drawing's order), then
 * Google. Each carries the official brand mark at 20px (`[&_svg]:size-5`)
 * beside the label — trademarks, not Signet duotone.
 */
export function OAuthButtons({
  onSelect,
  pending = null,
  disabled = false,
}: {
  onSelect: (provider: OAuthProvider) => void;
  pending?: OAuthProvider | null;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      {(["apple", "google"] as const).map((provider) => {
        const busy = pending === provider;
        return (
          <Button
            key={provider}
            type="button"
            variant="secondary"
            className="w-full [&_svg]:size-5"
            disabled={disabled || pending !== null}
            aria-busy={busy}
            onClick={() => onSelect(provider)}
          >
            {busy ? (
              <Loader2 className="animate-spin" />
            ) : provider === "apple" ? (
              <AppleMark />
            ) : (
              <GoogleMark />
            )}
            {LABELS[provider]}
          </Button>
        );
      })}
      <p className="text-center text-sm leading-5 text-muted-foreground">
        {OAUTH_MEMBERSHIP_HINT}
      </p>
    </div>
  );
}
