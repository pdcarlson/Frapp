"use client";

import { useReviewServiceEntry } from "@repo/hooks";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import { toastFailure } from "@/lib/failure-toast";
import { useToast } from "@/lib/hooks/use-toast";
import { getErrorMessage } from "@/lib/utils";

/** What a review needs of an entry: its id, and its description for the prompt. */
export interface ReviewableServiceEntry {
  id: string;
  description: string | null;
}

/**
 * Approve or reject a pending service entry: the one review flow, shared by
 * the Service hours queue and the Activity page (#3897), so the prompt, the
 * optional comment and the toasts are the same wherever an approver acts.
 *
 * Each resolves `true` when the review was recorded, `false` when it was
 * cancelled or refused (the refusal has already been toasted). Render
 * `confirmDialog` once: Reject asks through it.
 */
export function useServiceReview() {
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirmDialog();
  const reviewEntry = useReviewServiceEntry();

  async function approve(entry: ReviewableServiceEntry): Promise<boolean> {
    try {
      await reviewEntry.mutateAsync({
        id: entry.id,
        body: { status: "APPROVED" },
      });
      toast({
        title: "Entry approved",
        description: "Points will be awarded per the chapter rate.",
      });
      return true;
    } catch (error) {
      toastFailure({
        title: "Couldn't approve entry",
        error,
        fallback:
          "Only a pending entry someone else submitted can be approved.",
        // No Try again here: the callers (the Service queue, the Activity row
        // and sheet) act on this function's answer, and a retry from the
        // toast would land with none of them told. Their Approve button is
        // back and is the retry.
      });
      return false;
    }
  }

  async function reject(entry: ReviewableServiceEntry): Promise<boolean> {
    const result = await confirm({
      title: `Reject "${entry.description || "this entry"}"?`,
      description:
        "The member is notified, and the hours are not credited. They can submit the entry again.",
      confirmLabel: "Reject entry",
      tone: "destructive",
      comment: {
        label: "Comment for the member",
        placeholder: "Optional. Why was this rejected?",
      },
    });
    // `null` is cancel; a confirmed empty box is still a rejection.
    if (result === null) return false;
    try {
      await reviewEntry.mutateAsync({
        id: entry.id,
        body: {
          status: "REJECTED",
          review_comment: result.comment || undefined,
        },
      });
      toast({
        title: "Entry rejected",
        description: "The member was notified with your comment.",
      });
      return true;
    } catch (error) {
      toast({
        title: "Couldn't reject entry",
        description: getErrorMessage(error, "Try again in a moment."),
        variant: "destructive",
      });
      return false;
    }
  }

  return {
    approve,
    reject,
    isPending: reviewEntry.isPending,
    confirmDialog,
  };
}
