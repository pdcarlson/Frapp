"use client";

import { useState } from "react";
import { useConfirmDropBulkUploads } from "@/components/backwork/bulk/use-confirm-drop-bulk-uploads";
import { signOutCurrentSession } from "@/lib/auth/session";
import { resolveRedirectPath } from "@/lib/auth/redirect";

/**
 * Sign out and land on `/sign-in`, for the screens an account with no chapter
 * can reach (`/join`, `/no-access`, the setup wizard). A full navigation, as
 * the account menu does, so every in-memory cache leaves with the page.
 * Bulk upload's confirm runs first, since signing out ends it.
 *
 * `returnTo` is where the next sign-in should land: `/join` passes itself with
 * its invite, so switching to the right account doesn't lose the link.
 */
export function useSignOutToSignIn(returnTo?: string) {
  const [signingOut, setSigningOut] = useState(false);
  const { confirmDrop, confirmDropDialog } = useConfirmDropBulkUploads();

  async function signOut() {
    if (!(await confirmDrop("sign-out"))) return;
    setSigningOut(true);
    try {
      await signOutCurrentSession();
      const url = new URL("/sign-in", window.location.origin);
      if (returnTo) {
        url.searchParams.set("redirectTo", resolveRedirectPath(returnTo));
      }
      window.location.assign(url.pathname + url.search);
    } finally {
      setSigningOut(false);
    }
  }

  return { signOut, signingOut, confirmDropDialog };
}
