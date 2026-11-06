"use client";

import { useCallback } from "react";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import { bulkDropNotice, type BulkDropAction } from "@/lib/backwork-bulk/session";

const CONFIRM_LABEL: Record<Exclude<BulkDropAction, "delete-account">, string> = {
  switch: "Switch chapters",
  "sign-out": "Sign out",
};

/**
 * Asks, in the app's own confirm dialog, before a chapter switch or sign-out
 * drops Bulk upload documents that aren't uploaded yet (#3499). `confirmDrop`
 * resolves true when nothing would be lost or the person agrees. Render
 * `confirmDropDialog` wherever the caller renders.
 *
 * Account deletion has its own confirm, which adds `bulkDropNotice` to its
 * description instead of asking twice.
 */
export function useConfirmDropBulkUploads() {
  const { confirm, confirmDialog } = useConfirmDialog();
  const confirmDrop = useCallback(
    async (action: Exclude<BulkDropAction, "delete-account">) => {
      const description = bulkDropNotice(action);
      if (!description) return true;
      const answer = await confirm({
        title: "Drop documents that aren't uploaded?",
        description,
        confirmLabel: CONFIRM_LABEL[action],
        tone: "destructive",
      });
      return answer !== null;
    },
    [confirm],
  );
  return { confirmDrop, confirmDropDialog: confirmDialog };
}
