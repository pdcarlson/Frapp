import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import {
  useClearActivityLinkState,
  useMyPermissions,
  useRemoveActivityLink,
  useRestoreActivityLink,
  useSetActivityLinkState,
  type ActivityRow,
} from "@repo/hooks";
import { can } from "@repo/validation";
import type { LinkSheetActions } from "@/components/activity/activity-sheet";
import { UNDO_WINDOW_MS } from "@/components/tasks/undo-bar";
import { openMessageLink } from "@/lib/chat/open-link";
import { alertFailure } from "@/lib/failure-alert";

type LinkRow = Extract<ActivityRow, { kind: "link" }>;

/** The Undo bar a link write leaves, while its window runs. */
interface LinkUndo {
  message: string;
  run: () => void;
  /** A new key per action, so the bar is announced again. */
  key: number;
}

/**
 * The sign-up link writes (`spec/behavior/activity.md` § Links), for the
 * sheet a link row opens (`LinkSheetActions`): Open, Done, Hide, Open in chat
 * and, for `channels:manage`, Remove for everyone, as in chat. A channel's
 * Links list holds the rows since #5779 (`components/chat/message-list-sheet.tsx`);
 * Activity held them before.
 *
 * Owned by the screen, not the sheet: each write takes the row off the list
 * at once, which closes its sheet, and the "Undo" bar that follows (the task
 * board's, for the same few seconds) has to outlive the sheet. The screen
 * draws `undo` as an `UndoBar` while it is set. A write that fails puts the
 * row back and says so; each re-reads Activity itself as it settles
 * (`useLinkWrite`).
 *
 * `openInChat` replaces the default, which pushes the channel (its thread,
 * for a reply): a screen already in that channel jumps to the message.
 */
export function useLinkActions(
  options: { openInChat?: (row: LinkRow) => void } = {},
): { linkActions: LinkSheetActions; undo: LinkUndo | null } {
  const router = useRouter();
  const permissions = useMyPermissions();
  const markDone = useSetActivityLinkState("done");
  const hide = useSetActivityLinkState("hidden");
  const clearState = useClearActivityLinkState();
  const remove = useRemoveActivityLink();
  const restore = useRestoreActivityLink();
  const [undo, setUndo] = useState<LinkUndo | null>(null);
  useEffect(() => {
    if (!undo) return undefined;
    const timer = setTimeout(() => setUndo(null), UNDO_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [undo]);

  // Each write's own promise, not `mutate`'s per-call callbacks, which a
  // second Done before the first answers would cancel (`useLinkWrite`).
  type Write = { mutateAsync: (id: string) => Promise<unknown> };
  const failed = (title: string, retry: () => void) => (error: unknown) =>
    alertFailure({ title, error, retry });
  // Try again from the alert repeats only the write that failed.
  function act(
    write: Write,
    message: string,
    takeBack: Write,
    failure: string,
  ): (row: LinkRow) => void {
    const send = (row: LinkRow) => {
      const undoWrite = () => {
        takeBack
          .mutateAsync(row.link.id)
          .catch(failed("Couldn't undo", undoWrite));
      };
      write.mutateAsync(row.link.id).then(
        () =>
          setUndo((open) => ({
            message,
            key: (open?.key ?? 0) + 1,
            run: () => {
              setUndo(null);
              undoWrite();
            },
          })),
        failed(failure, () => send(row)),
      );
    };
    return send;
  }

  const linkActions: LinkSheetActions = {
    canRemove: can("channels:manage", permissions.data?.permissions ?? []),
    open: (row) => void openMessageLink(row.link.url),
    done: act(markDone, "Marked done", clearState, "Couldn't mark it done"),
    hide: act(hide, "Hidden", clearState, "Couldn't hide it"),
    remove: act(
      remove,
      "Removed for everyone",
      restore,
      "Couldn't remove it",
    ),
    openInChat:
      options.openInChat ??
      ((row) =>
        // A thread reply isn't on the channel's timeline: open its thread.
        router.push({
          pathname: "/chat-thread",
          params: row.link.thread_root_id
            ? {
                channelId: row.link.channel_id,
                threadRootId: row.link.thread_root_id,
              }
            : { channelId: row.link.channel_id },
        })),
  };
  return { linkActions, undo };
}
