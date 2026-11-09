"use client";

import { useState } from "react";
import { useConfirmDropBulkUploads } from "@/components/backwork/bulk/use-confirm-drop-bulk-uploads";
import { signOutCurrentSession } from "@/lib/auth/session";

/**
 * Sign out and land on `/sign-in`, for the screens an account with no chapter
 * can reach (`/join`, `/no-access`, the setup wizard). A full navigation, as
 * the account menu does, so every in-memory cache leaves with the page.
 * Bulk upload's confirm runs first, since signing out ends it.
 */
export function useSignOutToSignIn() {
  const [signingOut, setSigningOut] = useState(false);
  const { confirmDrop, confirmDropDialog } = useConfirmDropBulkUploads();

  async function signOut() {
    if (!(await confirmDrop("sign-out"))) return;
    setSigningOut(true);
    try {
      await signOutCurrentSession();
      window.location.assign("/sign-in");
    } finally {
      setSigningOut(false);
    }
  }

  return { signOut, signingOut, confirmDropDialog };
}
