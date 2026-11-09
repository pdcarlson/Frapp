"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { signOutCurrentSession } from "@/lib/auth/session";

/**
 * `/new-account`'s two ways out (#3786).
 *
 * Sign out is first and primary: the page only shows after the member chose
 * *sign in*, so the likelier story is a member who picked the wrong provider.
 * It ends the session and lands on `/sign-in` with `next` kept, because
 * `proxy.ts` sends a signed-in visitor off the auth routes. Continuing goes on
 * to `next` as the callback would have, by full navigation so the dashboard
 * mounts fresh on the new session.
 */
export function NewAccountActions({ next }: { next: string }) {
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOutCurrentSession();
      window.location.assign(
        `/sign-in?${new URLSearchParams({ redirectTo: next })}`,
      );
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Button
        type="button"
        className="w-full"
        disabled={signingOut}
        onClick={() => void handleSignOut()}
      >
        Sign out
      </Button>
      <Button
        type="button"
        variant="secondary"
        className="w-full"
        disabled={signingOut}
        onClick={() => window.location.assign(next)}
      >
        Continue with the new account
      </Button>
    </div>
  );
}
