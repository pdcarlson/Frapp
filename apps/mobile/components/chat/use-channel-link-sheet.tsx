import { useState, type ReactNode } from "react";
import type { ActivityRow } from "@repo/hooks";
import { ActivitySheet } from "@/components/activity/activity-sheet";
import { UndoBar } from "@/components/tasks/undo-bar";
import { useLinkActions } from "@/lib/activity/use-link-actions";

type LinkRow = Extract<ActivityRow, { kind: "link" }>;

const noop = () => {};

/**
 * The sheet a channel's Links row opens (#5779), and the Undo bar its writes
 * leave. Activity opened the same sheet for a link (`ActivitySheet`'s
 * `LinkSheet`) with the same actions (`useLinkActions`) until the links moved
 * to the channel, so a member keeps every one: Open link, Done, Hide, Open in
 * chat, and Remove for everyone for `channels:manage`, each with Undo where
 * it takes the link away.
 *
 * The sheet stacks over the Links list, so closing it goes back to the list.
 * What leaves the list for the thread closes the list too (`onLeaveList`):
 * Open in chat, which jumps to the message here (`onOpenInChat`), and Done,
 * Hide and Remove, whose Undo bar floats over the thread, where a sheet
 * would cover it. The bar outlives both sheets, as it outlived Activity's.
 *
 * A channel switch closes an open sheet, for the reason the thread's other
 * sheets close on one: the link belongs to the channel it was opened in.
 */
export function useChannelLinkSheet({
  channelId,
  viewerId,
  onOpenInChat,
  onLeaveList,
}: {
  channelId: string | null;
  viewerId: string | null;
  /** Show the link's message in this thread (or its own thread, for a reply). */
  onOpenInChat: (row: LinkRow) => void;
  /** Close the Links list under the sheet. */
  onLeaveList: () => void;
}): {
  openLink: (row: LinkRow) => void;
  sheet: ReactNode;
  undoBar: ReactNode;
} {
  const [opened, setOpened] = useState<{
    row: LinkRow;
    channelId: string | null;
  } | null>(null);
  // Adjusted while rendering, as React documents for state that follows a
  // prop: no frame draws another channel's link.
  if (opened !== null && opened.channelId !== channelId) setOpened(null);
  const { linkActions, undo } = useLinkActions({
    openInChat: (row) => {
      onLeaveList();
      onOpenInChat(row);
    },
  });
  const leaving =
    (action: (row: LinkRow) => void) =>
    (row: LinkRow): void => {
      onLeaveList();
      action(row);
    };
  const actions = {
    ...linkActions,
    done: leaving(linkActions.done),
    hide: leaving(linkActions.hide),
    remove: leaving(linkActions.remove),
  };

  return {
    openLink: (row) => setOpened({ row, channelId }),
    // Mounted only while a link is open: the sheet presents when it mounts
    // with a row, and unmounting it takes it down on a channel switch.
    sheet:
      opened !== null ? (
        <ActivitySheet
          row={opened.row}
          viewerId={viewerId}
          // A link's sheet makes no write of its own; its actions do.
          onActed={noop}
          onClosed={() => setOpened(null)}
          linkActions={actions}
        />
      ) : null,
    undoBar: undo ? (
      <UndoBar key={undo.key} message={undo.message} onUndo={undo.run} />
    ) : null,
  };
}
