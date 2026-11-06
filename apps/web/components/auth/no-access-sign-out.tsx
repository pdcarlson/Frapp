"use client";

import { useState } from "react";
import { useConfirmDropBulkUploads } from "@/components/backwork/bulk/use-confirm-drop-bulk-uploads";
import { Button } from "@/components/ui/button";
import { signOutCurrentSession } from "@/lib/auth/session";

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
  const [signingOut, setSigningOut] = useState(false);
  const { confirmDrop, confirmDropDialog } = useConfirmDropBulkUploads();

  async function handleSignOut() {
    if (!(await confirmDrop("sign-out"))) return;
    setSigningOut(true);
    try {
      await signOutCurrentSession();
      window.location.assign("/sign-in");
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        className="w-full"
        disabled={signingOut}
        onClick={() => void handleSignOut()}
      >
        Sign in to a different account
      </Button>
      {confirmDropDialog}
    </>
  );
}
