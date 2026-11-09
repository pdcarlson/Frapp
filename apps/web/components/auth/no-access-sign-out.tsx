"use client";

import { Button } from "@/components/ui/button";
import { useSignOutToSignIn } from "./use-sign-out";

/**
 * `/no-access`'s "different account" action, which has to sign out first.
 *
 * It was a plain link to `/sign-in`. `proxy.ts` sends a signed-in visitor off
 * an auth route to `/chat`, and the dashboard shell sends a member with no
 * permissions from there back to `/no-access` (#3236), so the link went in a
 * circle. Ending the session is what makes `/sign-in` reachable, the same way
 * the account menu does it.
 */
export function NoAccessSignOut() {
  const { signOut, signingOut, confirmDropDialog } = useSignOutToSignIn();

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        className="w-full"
        disabled={signingOut}
        onClick={() => void signOut()}
      >
        Sign in to a different account
      </Button>
      {confirmDropDialog}
    </>
  );
}
