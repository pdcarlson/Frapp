"use client";

import { useState } from "react";
import { useDeleteAccount } from "@repo/hooks";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import { signOutCurrentSession } from "@/lib/auth/session";

/** What both callers say when a deletion didn't finish. */
export const DELETE_ACCOUNT_FAILED = {
  title: "Deletion didn't finish",
  description:
    "Part of it may already have gone through, and running it again is safe. Try once more in a moment.",
} as const;

/**
 * Account deletion on web: confirm, delete, sign out, leave. Shared by
 * `/profile` (`profile-panel.tsx`) and the Terms prompt (`terms-prompt.tsx`),
 * which covers the dashboard and so has to offer it itself
 * (`spec/behavior/data-retention.md` § Individual Account Deletion). One flow,
 * so the confirm and failure copy and the post-delete navigation can't drift
 * apart, as mobile's `lib/account/delete-account-prompt.ts` does for its three
 * screens.
 *
 * `onFailed` reports a deletion that didn't finish; each caller shows
 * `DELETE_ACCOUNT_FAILED` in its own surface. Render `confirmDialog` wherever
 * the caller renders.
 */
export function useDeleteAccountFlow({ onFailed }: { onFailed: () => void }) {
  const deleteAccount = useDeleteAccount();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [isDeleting, setIsDeleting] = useState(false);

  async function start() {
    const confirmed = await confirm({
      title: "Delete your account?",
      description:
        'This cannot be undone. Your profile and contact details are erased; chapter history you took part in stays, anonymized as "Deleted User". See the Privacy Policy for what is kept and for how long.',
      confirmLabel: "Delete account",
      tone: "destructive",
    });
    if (!confirmed) return;
    setIsDeleting(true);
    try {
      await deleteAccount.mutateAsync();
    } catch {
      setIsDeleting(false);
      onFailed();
      return;
    }
    // The account is gone at this point, so nothing past here should block on
    // — or be undone by — its own failure. `signOutCurrentSession` is
    // best-effort: whether or not it succeeds, the hard navigation below is
    // what actually satisfies `useDeleteAccount`'s "the caller must clear the
    // query cache on success" contract (a full document load discards the
    // in-memory QueryClient; web has no persister), and a signed-out-looking
    // page beats leaving the member on a screen for an account that no longer
    // exists. Deliberately not a caller's own sign-out handler: those swallow
    // their errors and only navigate on success, which would strand the
    // member here — cache intact, no redirect — on a sign-out hiccup
    // immediately after a successful deletion.
    try {
      await signOutCurrentSession();
    } catch {
      // Ignored — see above.
    }
    window.location.assign("/sign-in");
  }

  return { start, isDeleting, confirmDialog };
}
