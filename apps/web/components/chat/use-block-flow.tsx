"use client";

import { useCallback } from "react";
import {
  BLOCK_FAILURE_BODY,
  BLOCK_NOT_A_MEMBER_BODY,
  UNNAMED_MEMBER,
  blockConfirmBody,
  blockConfirmTitle,
  blockFailedTitle,
  isMemberNotFound,
} from "@repo/chat-core/block-copy";
import { useBlockMember } from "@repo/hooks";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import { useToast } from "@/lib/hooks/use-toast";

export interface BlockRequest {
  userId: string;
  /** Display name, or `null` when the roster cannot resolve one. */
  name: string | null;
  /** Whether the roster lists them (`blockConfirmBody`). */
  inDirectory: boolean;
}

export interface BlockFlow {
  /**
   * Asks, then blocks. Resolves once the flow is over, whatever the outcome; a
   * failure has already been toasted. Resolves `"not-a-member"` when the API
   * answered 404 `Member not found` (`isMemberNotFound`), the one positive
   * evidence a member left, so the caller can stop offering Block for them.
   */
  requestBlock: (
    request: BlockRequest,
  ) => Promise<"blocked" | "cancelled" | "failed" | "not-a-member">;
  isPending: boolean;
  /** The confirmation's portal; render it once, anywhere in the caller. */
  confirmDialog: React.ReactNode;
}

/**
 * Block from a message's action bar (#2687), the web half of what mobile's
 * `confirmBlockMember` asks. The question, the copy and the failure wording are
 * `@repo/chat-core/block-copy`'s, so both clients explain one control one way;
 * only where the member undoes it differs ("from your profile", where web's
 * Blocked members list lives).
 *
 * Nothing to refresh by hand afterwards: `useBlockMember` applies the
 * confirmed block to the cached list, and the timeline re-classifies the
 * sender's rows into tombstones from that.
 */
export function useBlockFlow(): BlockFlow {
  const { mutateAsync: blockAsync, isPending } = useBlockMember();
  const { confirm, confirmDialog } = useConfirmDialog();
  const { toast } = useToast();

  const requestBlock = useCallback(
    async ({ userId, name, inDirectory }: BlockRequest) => {
      const label = name ?? UNNAMED_MEMBER;
      const confirmed = await confirm({
        title: blockConfirmTitle(label),
        description: blockConfirmBody(inDirectory, "from your profile"),
        confirmLabel: "Block",
      });
      if (!confirmed) return "cancelled" as const;
      try {
        await blockAsync(userId);
        return "blocked" as const;
      } catch (error) {
        const notAMember = isMemberNotFound(error);
        toast({
          title: blockFailedTitle(label),
          description: notAMember
            ? BLOCK_NOT_A_MEMBER_BODY
            : BLOCK_FAILURE_BODY,
          variant: "destructive",
        });
        return notAMember ? ("not-a-member" as const) : ("failed" as const);
      }
    },
    [blockAsync, confirm, toast],
  );

  return { requestBlock, isPending, confirmDialog };
}
