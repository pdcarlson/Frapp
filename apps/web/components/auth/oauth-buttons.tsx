"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { OAuthProvider } from "@/lib/auth/oauth";
import { OAUTH_MEMBERSHIP_HINT } from "@/lib/auth/oauth";

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
 * Google. Design polishes brand marks later; the slot geometry is the product
 * requirement now.
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
            className="w-full"
            disabled={disabled || pending !== null}
            aria-busy={busy}
            onClick={() => onSelect(provider)}
          >
            {busy ? <Loader2 className="animate-spin" /> : null}
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
