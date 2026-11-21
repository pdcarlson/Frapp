"use client";

import { useMemo } from "react";
import {
  activityChannelLinks,
  useActivity,
  useActivityUnread,
  useMyPermissions,
  useNowDate,
  type ActivityRow,
} from "@repo/hooks";
import { can } from "@repo/validation";
import {
  ActivityLinkRow,
  useActivityLinkActions,
} from "@/components/activity/activity-link-row";
import { FOCUS_RING } from "@/components/ui/focus";
import { cn } from "@/lib/utils";

const ROW_CLASS = cn(
  "flex min-h-12 w-full items-center gap-3 rounded-md px-2 py-1.5 text-left",
  "transition-colors hover:bg-card-hover",
  FOCUS_RING,
);

/**
 * The sign-up links posted in this channel (#5779), in the channel menu
 * beside Pinned and Saved, where Discord keeps a channel's Links. Activity
 * listed every channel's until Paul's direction A moved them here
 * (`spec/behavior/activity.md` § Links). Each row opens the form in a new
 * tab, with Done and the row's menu (Hide, Open in chat, and Remove for
 * everyone for `channels:manage`), as it did on Activity.
 *
 * It reads Activity's own read, which every member already has warm.
 * Opening a link clears its dot, as opening it from Activity did.
 */
export function ChannelLinksPanel({ channelId }: { channelId: string }) {
  const activity = useActivity();
  const now = useNowDate();
  const permissions = useMyPermissions();
  const canRemove = can("channels:manage", permissions.data?.permissions);
  const actions = useActivityLinkActions();
  const { markRead } = useActivityUnread(activity.data);
  const rows = useMemo(
    () =>
      activity.data ? activityChannelLinks(activity.data, channelId, now) : [],
    [activity.data, channelId, now],
  );
  if (activity.isPending) {
    return (
      <p className="px-3 py-4 text-caption text-muted-foreground">
        Loading links…
      </p>
    );
  }
  if (activity.isError && !activity.data) {
    return (
      <p className="px-3 py-4 text-caption text-warning">
        Couldn&apos;t load links. Try again in a moment.
      </p>
    );
  }
  if (rows.length === 0) {
    return (
      <p className="px-3 py-4 text-caption text-muted-foreground">
        {CHANNEL_LINKS_EMPTY}
      </p>
    );
  }
  return (
    <ul className="max-h-96 overflow-y-auto p-1">
      {rows.map((row) =>
        isLink(row) ? (
          <ActivityLinkRow
            key={row.key}
            row={row}
            rowClassName={ROW_CLASS}
            canRemove={canRemove}
            actions={actions}
            onOpen={(opened) => {
              if (opened.unread && opened.readRef) markRead([opened.readRef]);
            }}
          />
        ) : null,
      )}
    </ul>
  );
}

/** An empty channel's Links. */
export const CHANNEL_LINKS_EMPTY = "Nothing to sign up for in this channel.";

function isLink(
  row: ActivityRow,
): row is Extract<ActivityRow, { kind: "link" }> {
  return row.kind === "link";
}

/**
 * How many links the channel menu's row counts, once the read is in. Only
 * while the menu is open (`enabled`): the menu sits in every channel's header,
 * and Activity's read is the heaviest the app makes, so a closed menu never
 * asks for it.
 */
export function useChannelLinkCount(
  channelId: string | null,
  enabled = true,
): number | undefined {
  const activity = useActivity({ enabled });
  if (!channelId || !activity.data) return undefined;
  return activity.data.links.filter((link) => link.channel_id === channelId)
    .length;
}
