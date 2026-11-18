import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { invalidateChannelSummaries } from "./use-chat";
import { useUpdateUserSettings, useUserSettings } from "./use-notifications";

/**
 * The Read receipts switch (#5519, Paul, 2026-11-18), the same on the phone's
 * Settings › Chat and web's Appearance and chat.
 *
 * Two-way, as WhatsApp's is: off, the member's reads of a direct message are
 * not reported to anyone, and they are told about no one's, so their own
 * messages show one check. The server decides both halves
 * (`get_channel_latest_messages`), so a client never filters a status itself.
 */
export const READ_RECEIPTS_COPY = {
  label: "Read receipts",
  description:
    "Show people when you've read their direct messages. Turned off, you won't see when they've read yours.",
  saveFailed: "Couldn't change read receipts. Try again.",
} as const;

/**
 * The member's switch and how to flip it. `enabled` is `true` until the
 * settings read answers, which is the server's default, and `ready` says
 * whether it has. A change is optimistic (`useUpdateUserSettings`), and once it
 * settles the Messages previews are read again, so the checks follow the
 * switch without waiting for the next message.
 */
export function useReadReceiptsSetting() {
  const settings = useUserSettings();
  const update = useUpdateUserSettings();
  const queryClient = useQueryClient();
  // `mutateAsync`, not a per-call `onSettled`: TanStack skips per-call
  // callbacks once the calling screen unmounts, and a member often leaves
  // Settings before the save answers. The promise settles either way, so the
  // previews are always re-read. A failure is reported through `failed`.
  const { mutateAsync } = update;
  const setEnabled = useCallback(
    (next: boolean) => {
      void mutateAsync({ read_receipts: next })
        .catch(() => undefined)
        .finally(() => invalidateChannelSummaries(queryClient));
    },
    [mutateAsync, queryClient],
  );
  return {
    enabled: settings.data?.read_receipts ?? true,
    ready: settings.data !== undefined,
    setEnabled,
    pending: update.isPending,
    failed: update.isError,
  };
}
