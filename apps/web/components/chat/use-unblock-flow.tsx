"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  BLOCK_FAILURE_BODY,
  MASKED_RELOAD_FAILED_BODY,
  MASKED_RELOAD_FAILED_TITLE,
  UNBLOCK_CONFIRM_BODY,
  UNNAMED_MEMBER,
  unblockConfirmTitle,
  unblockFailedTitle,
} from "@repo/chat-core/block-copy";
import { refreshMaskedCopies } from "@repo/chat-core/blocks";
import { useFrappClient, useUnblockMember } from "@repo/hooks";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import { useToast } from "@/hooks/use-toast";

export interface UnblockFlow {
  /**
   * Asks, then unblocks and brings the member's masked messages back
   * (`refreshMaskedCopies`). `name` is the display name, or `null` when the
   * roster cannot resolve one. Resolves once the flow is over, whatever the
   * outcome; a failure has already been toasted.
   */
  requestUnblock: (userId: string, name: string | null) => Promise<void>;
  /**
   * A stale tombstone's Reload: re-runs one member's post-unblock re-read, and
   * says so when it fails again rather than leaving a tap that did nothing.
   */
  reloadMaskedCopies: (userId: string) => Promise<void>;
  /** Whether an unblock is in flight. */
  isPending: boolean;
  /** The confirmation's portal; render it once, anywhere in the caller. */
  confirmDialog: React.ReactNode;
}

/**
 * Unblock for every web surface that offers it — the timeline's tombstone and
 * `/profile`'s Blocked members list — so the question, the copy and the cache
 * choreography exist once (#2313). Web offers no Block: only mobile does, from
 * a message or the directory.
 *
 * The one refresh `@repo/hooks` cannot do itself is here: the chat caches'
 * key lives in `@repo/chat-core`, which that leaf package must not import, so
 * `refreshMaskedCopies` runs after the mutation, as it does on mobile.
 */
export function useUnblockFlow(): UnblockFlow {
  const queryClient = useQueryClient();
  const client = useFrappClient();
  const { mutateAsync: unblockAsync, isPending } = useUnblockMember();
  const { confirm, confirmDialog } = useConfirmDialog();
  const { toast } = useToast();

  const requestUnblock = useCallback(
    async (userId: string, name: string | null) => {
      const label = name ?? UNNAMED_MEMBER;
      const confirmed = await confirm({
        title: unblockConfirmTitle(label),
        description: UNBLOCK_CONFIRM_BODY,
        confirmLabel: "Unblock",
      });
      if (!confirmed) return;
      try {
        await unblockAsync(userId);
      } catch {
        toast({
          title: unblockFailedTitle(label),
          description: BLOCK_FAILURE_BODY,
          variant: "destructive",
        });
        return;
      }
      void refreshMaskedCopies(queryClient, client, userId);
    },
    [client, confirm, queryClient, toast, unblockAsync],
  );

  const reloadMaskedCopies = useCallback(
    async (userId: string) => {
      const landed = await refreshMaskedCopies(queryClient, client, userId);
      if (!landed) {
        toast({
          title: MASKED_RELOAD_FAILED_TITLE,
          description: MASKED_RELOAD_FAILED_BODY,
        });
      }
    },
    [client, queryClient, toast],
  );

  return { requestUnblock, reloadMaskedCopies, isPending, confirmDialog };
}
