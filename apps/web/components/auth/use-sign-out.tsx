"use client";

import { useState } from "react";
import { useConfirmDropBulkUploads } from "@/components/backwork/bulk/use-confirm-drop-bulk-uploads";
import { signOutCurrentSession } from "@/lib/auth/session";
import { resolveRedirectPath } from "@/lib/auth/redirect";

/**
 * Sign out and land on `/sign-in`, for the screens an account with no chapter
 * can reach (`/join`, `/no-access`, `/new-account`, the setup wizard). A full
 * navigation, as the account menu does, so every in-memory cache leaves with
 * the page. Bulk upload's confirm runs first, since signing out ends it.
 *
 * `returnTo` is where the next sign-in should land: `/join` passes itself with
 * its invite, so switching to the right account doesn't lose the link.
 *
 * **Local scope.** Everyone using this is switching accounts in this browser,
 * so this browser's session is what has to end. The default global scope keeps
 * it when Auth's revoke call fails (network, 5xx, 429), and
 * `signOutCurrentSession` doesn't surface that `{ error }` (#2610); `proxy.ts`
 * would then bounce `/sign-in` straight back to `returnTo`, signed in as the
 * account being left. The local scope removes the session before it calls
 * Auth (#3786).
 *
 * `failed` is set when the sign-out throws, so a screen can say so; the button
 * re-enables only then; on success the page is already navigating away.
 */
export function useSignOutToSignIn(returnTo?: string) {
  const [signingOut, setSigningOut] = useState(false);
  const [failed, setFailed] = useState(false);
  const { confirmDrop, confirmDropDialog } = useConfirmDropBulkUploads();

  async function signOut() {
    if (!(await confirmDrop("sign-out"))) return;
    setSigningOut(true);
    setFailed(false);
    try {
      await signOutCurrentSession({ scope: "local" });
      const url = new URL("/sign-in", window.location.origin);
      if (returnTo) {
        url.searchParams.set("redirectTo", resolveRedirectPath(returnTo));
      }
      window.location.assign(url.pathname + url.search);
    } catch {
      setFailed(true);
      setSigningOut(false);
    }
  }

  return { signOut, signingOut, failed, confirmDropDialog };
}
