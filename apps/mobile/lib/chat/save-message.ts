import { useCallback } from "react";
import { Alert } from "react-native";
import {
  useBookmarkMessage,
  useBookmarkedMessageIds,
  useUnbookmarkMessage,
} from "@repo/hooks";
import { errorCopy } from "@repo/hooks/error-copy";
import { selectionHaptic } from "@/lib/haptics";

/**
 * Save message / Remove from Saved (#3723), the viewer's private bookmark,
 * for both long-press sheets: the channel's (`app/(app)/chat-thread.tsx`) and
 * a message thread's (`message-thread-screen.tsx`), as web offers Save on a
 * channel's messages and on a thread's root and replies.
 *
 * `savedIds` is the viewer's bookmarks in the active chapter, so the row reads
 * "Remove from Saved" on a message already saved, on any device. A failed
 * write says so in an alert; the list itself refetches on success.
 */
export function useSaveMessage() {
  const savedIds = useBookmarkedMessageIds();
  const bookmarkMessage = useBookmarkMessage();
  const unbookmarkMessage = useUnbookmarkMessage();
  const setSaved = useCallback(
    (messageId: string, saved: boolean) => {
      selectionHaptic();
      const write = saved ? bookmarkMessage : unbookmarkMessage;
      write.mutateAsync(messageId).catch((error: unknown) => {
        Alert.alert(
          saved ? "Couldn't save message" : "Couldn't remove from Saved",
          errorCopy(error),
        );
      });
    },
    [bookmarkMessage, unbookmarkMessage],
  );
  return { savedIds, setSaved };
}
