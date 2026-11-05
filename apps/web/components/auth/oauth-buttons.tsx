"use client";

import { Loader2 } from "lucide-react";
import { AppleMark, GoogleMark } from "@/components/auth/oauth-brand-icons";
import { Button } from "@/components/ui/button";
import { OAUTH_MEMBERSHIP_HINT, type OAuthProvider } from "@/lib/auth/oauth";

const NAMES: Record<OAuthProvider, string> = {
  apple: "Apple",
  google: "Google",
};

/**
 * Equal-prominence OAuth methods for the pre-auth column.
 *
 * Canvas s01 draws one second method after the password primary. App Store
 * Guideline 4.8 requires Apple once Google is offered, so these are two
 * Secondary buttons of the same size, Apple first (the drawing's order), then
 * Google. Each carries the official brand mark at 20px (`[&_svg]:size-5`)
 * beside the label — trademarks, not Signet duotone.
 *
 * Side by side since 2026-11-05, when the column had to fit a laptop screen
 * without scrolling. Half the column is too narrow for "Continue with Google",
 * so each shows the provider's name and carries the full phrase as its
 * accessible name, which still contains the visible word (WCAG 2.5.3).
 *
 * `hint` is the membership caption; sign-up passes it, sign-in leaves it out
 * so the shorter form fits (Paul: not every note needs to be on screen).
 */
export function OAuthButtons({
  onSelect,
  pending = null,
  disabled = false,
  hint = false,
}: {
  onSelect: (provider: OAuthProvider) => void;
  pending?: OAuthProvider | null;
  disabled?: boolean;
  hint?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
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
              aria-label={`Continue with ${NAMES[provider]}`}
              onClick={() => onSelect(provider)}
            >
              {busy ? (
                <Loader2 className="animate-spin" />
              ) : provider === "apple" ? (
                <AppleMark />
              ) : (
                <GoogleMark />
              )}
              {NAMES[provider]}
            </Button>
          );
        })}
      </div>
      {hint ? (
        <p className="text-center text-caption text-muted-foreground">
          {OAUTH_MEMBERSHIP_HINT}
        </p>
      ) : null}
    </div>
  );
}
