"use client";

import { useState } from "react";
import { useUpdateOnboarding } from "@repo/hooks";
import { Button } from "@/components/ui/button";
import { useToast } from "@/lib/hooks/use-toast";
import { ProfileSection } from "@/components/profile/profile-section";
import {
  DELETE_ACCOUNT_FAILED,
  useDeleteAccountFlow,
} from "@/components/profile/use-delete-account-flow";
import { denseListClassName } from "@/components/shared/table-controls";
import { signOutCurrentSession } from "@/lib/auth/session";
import { useConfirmDropBulkUploads } from "@/components/backwork/bulk/use-confirm-drop-bulk-uploads";
import { getErrorMessage } from "@/lib/utils";

/**
 * Settings → Account: replay the tutorial, sign out, delete the account.
 * Moved here from `/profile` (#3856), which keeps the profile itself.
 */
export function AccountSection() {
  const { toast } = useToast();
  const updateOnboarding = useUpdateOnboarding();
  const deleteFlow = useDeleteAccountFlow({
    onFailed: () => toast({ ...DELETE_ACCOUNT_FAILED, variant: "destructive" }),
  });
  const isDeletingAccount = deleteFlow.isDeleting;
  const { confirmDrop, confirmDropDialog } = useConfirmDropBulkUploads();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut() {
    if (!(await confirmDrop("sign-out"))) return;
    setIsSigningOut(true);
    try {
      await signOutCurrentSession();
      // Deliberately not in a `finally`: on the success path this line never
      // returns, and resetting the flag after it would only ever run on the
      // failure path — where the member does need the control back.
      window.location.assign("/sign-in");
    } catch (error) {
      setIsSigningOut(false);
      toast({
        title: "Couldn't sign out",
        description: getErrorMessage(
          error,
          "Retry in a moment, or close this tab to end the session locally.",
        ),
        variant: "destructive",
      });
    }
  }

  return (
    <>
      {/*
        Tutorial, session and deletion were three cards with a paragraph each.
        They are one list of rows now: what the row does on the left, its one
        control on the right, the way the notification switches above read.
      */}
      <ProfileSection id="account" title="Account">
        <ul className={denseListClassName}>
          <li className="flex items-center justify-between gap-4 py-3">
            <div className="grid min-w-0 gap-1">
              <p className="text-sm font-semibold">Tutorial</p>
              <p className="text-sm text-muted-foreground">
                The onboarding tour reopens on your next dashboard visit.
              </p>
            </div>
            <Button
              variant="secondary"
              size="toolbar"
              className="shrink-0"
              disabled={updateOnboarding.isPending}
              onClick={async () => {
                try {
                  await updateOnboarding.mutateAsync({
                    has_completed_onboarding: false,
                  });
                  toast({
                    title: "Tutorial queued",
                    description:
                      "The onboarding tour will reappear the next time you open the dashboard.",
                  });
                } catch (error) {
                  toast({
                    title: "Couldn't reset onboarding",
                    description: getErrorMessage(
                      error,
                      "Retry in a moment. Your permissions may need refreshing.",
                    ),
                    variant: "destructive",
                  });
                }
              }}
            >
              Replay tutorial
            </Button>
          </li>
          <li className="flex items-center justify-between gap-4 py-3">
            <div className="grid min-w-0 gap-1">
              <p className="text-sm font-semibold">Session</p>
              <p className="text-sm text-muted-foreground">
                Signing in again refreshes your permissions.
              </p>
            </div>
            <Button
              variant="secondary"
              size="toolbar"
              className="shrink-0"
              onClick={handleSignOut}
              disabled={isSigningOut || isDeletingAccount}
            >
              {isSigningOut ? "Signing out..." : "Sign out"}
            </Button>
          </li>
          <li className="flex items-center justify-between gap-4 py-3">
            <div className="grid min-w-0 gap-1">
              <p className="text-sm font-semibold">Delete account</p>
              <p className="text-sm text-muted-foreground">
                Permanently deletes your account. You&apos;ll be asked to
                confirm.
              </p>
            </div>
            <Button
              variant="destructive"
              size="toolbar"
              className="shrink-0"
              onClick={() => void deleteFlow.start()}
              disabled={isDeletingAccount || isSigningOut}
            >
              {isDeletingAccount ? "Deleting account…" : "Delete account…"}
            </Button>
          </li>
        </ul>
      </ProfileSection>
      {deleteFlow.confirmDialog}
      {confirmDropDialog}
    </>
  );
}
