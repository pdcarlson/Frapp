"use client";

import { useCallback } from "react";
import {
  DELETE_CHANNEL_CONFIRM_BODY,
  DELETE_CHANNEL_LABEL,
  deleteChannelConfirmTitle,
  deleteChannelTypeLabel,
  useDeleteChannel,
} from "@repo/hooks";
import type { useConfirmDialog } from "@/components/shared/confirm-dialog";
import { useToast } from "@/lib/hooks/use-toast";
import { getErrorMessage } from "@/lib/utils";

/**
 * Delete channel, asked first, for every web surface that offers it: Chat
 * settings and the chat rail's right-click menu. One flow, so both ask with
 * the same words and report the same way.
 *
 * `confirm` is the caller's own `useConfirmDialog`, since each surface
 * renders its dialog. `onDeleted` runs only after the server has deleted the
 * channel, for the caller to drop its selection.
 */
export function useDeleteChannelFlow(
  confirm: ReturnType<typeof useConfirmDialog>["confirm"],
) {
  const { toast } = useToast();
  const { mutateAsync } = useDeleteChannel();
  return useCallback(
    async (channel: { id: string; name: string }, onDeleted?: () => void) => {
      const confirmed = await confirm({
        title: deleteChannelConfirmTitle(channel.name),
        description: DELETE_CHANNEL_CONFIRM_BODY,
        confirmLabel: DELETE_CHANNEL_LABEL,
        // Delete stays disabled until the name is typed exactly (#3838).
        typeToConfirm: {
          label: deleteChannelTypeLabel(channel.name),
          text: channel.name,
        },
      });
      if (!confirmed) return;
      try {
        await mutateAsync(channel.id);
        onDeleted?.();
        toast({ description: `#${channel.name} deleted.` });
      } catch (error) {
        toast({
          variant: "destructive",
          description: getErrorMessage(error, "Couldn't delete the channel."),
        });
      }
    },
    [confirm, mutateAsync, toast],
  );
}
