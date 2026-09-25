"use client";

import { useMemo } from "react";
import {
  BLOCK_LIST_WAITING_FOR_NETWORK,
  BLOCKED_MEMBERS_EMPTY_TITLE,
  BLOCKED_MEMBERS_ERROR_BODY,
  BLOCKED_MEMBERS_ERROR_TITLE,
  BLOCKED_MEMBERS_OFFLINE_BODY,
  BLOCKED_MEMBERS_SCOPE,
  BLOCKED_MEMBERS_STALE,
  BLOCKED_MEMBERS_TITLE,
} from "@repo/chat-core/block-copy";
import {
  memberFallbackLabel,
  useActiveChapterId,
  useBlockedUserIds,
  useMemberDisplayNames,
} from "@repo/hooks";
import { useUnblockFlow } from "@/components/chat/use-unblock-flow";
import {
  NestedEmpty,
  NestedError,
  NestedLoading,
} from "@/components/shared/nested-states";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * The empty state's body, web's own: web offers no Block, so it says where a
 * member can block someone. Every other string on this card is shared with
 * mobile's sheet (`@repo/chat-core/block-copy`).
 */
export const BLOCKED_MEMBERS_EMPTY_BODY_WEB =
  "Block someone from a message or their profile in the mobile app. Their messages in this chapter's chat are hidden from you here too, and they aren't told.";

/**
 * `/profile` → Blocked members: the one place on web a block can always be
 * undone (`spec/behavior/chat/README.md` § Block — "a tombstone in a thread
 * the member may never reopen is not sufficient"; #2313). The same states and
 * words as mobile's Settings → Blocked members sheet.
 *
 * Only a confirmed read may say the list is empty. An unavailable read with a
 * cached list still shows that list — everyone on it is blocked — but says it
 * could not be refreshed, with the same way back as the error state. While the
 * read is parked for the network, both say it loads once the browser is online
 * instead of offering a Retry that visibly does nothing.
 */
export function BlockedMembersCard() {
  const chapterId = useActiveChapterId();
  const blockList = useBlockedUserIds();
  const { nameFor } = useMemberDisplayNames();
  const { requestUnblock, isPending, confirmDialog } = useUnblockFlow();

  // A member who has left the chapter drops off the roster but can still be
  // on the list — a block outlives their membership — so the fallback label is
  // permanent for them, not a loading state.
  const rows = useMemo(
    () =>
      [...blockList.ids]
        .map((userId) => {
          const name = nameFor(userId);
          return { userId, name, label: name ?? memberFallbackLabel(userId) };
        })
        .sort((a, b) => a.label.localeCompare(b.label)),
    [blockList.ids, nameFor],
  );

  let body: React.ReactNode;
  if (!chapterId) {
    body = (
      <NestedEmpty
        title="Select a chapter"
        description="Blocks apply per chapter, so this list appears once a chapter is active."
      />
    );
  } else if (blockList.status === "loading") {
    body = <NestedLoading message="Loading your blocked members" />;
  } else if (blockList.status === "unavailable" && rows.length === 0) {
    body = (
      <NestedError
        title={BLOCKED_MEMBERS_ERROR_TITLE}
        description={
          blockList.isPaused
            ? BLOCKED_MEMBERS_OFFLINE_BODY
            : BLOCKED_MEMBERS_ERROR_BODY
        }
        onRetry={blockList.isPaused ? undefined : blockList.retry}
      />
    );
  } else if (rows.length === 0) {
    body = (
      <NestedEmpty
        title={BLOCKED_MEMBERS_EMPTY_TITLE}
        description={BLOCKED_MEMBERS_EMPTY_BODY_WEB}
      />
    );
  } else {
    body = (
      <div className="space-y-3">
        {blockList.status === "unavailable" ? (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <p className="min-w-0 flex-1">{BLOCKED_MEMBERS_STALE}</p>
            {blockList.isPaused ? (
              <span className="shrink-0">{BLOCK_LIST_WAITING_FOR_NETWORK}</span>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                aria-label="Retry loading your blocked members"
                disabled={blockList.isRetrying}
                onClick={blockList.retry}
              >
                Retry
              </Button>
            )}
          </div>
        ) : null}
        <ul className="divide-y divide-border rounded-lg border border-border">
          {rows.map((row) => (
            <li
              key={row.userId}
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              <span className="min-w-0 truncate text-sm font-medium">
                {row.label}
              </span>
              <Button
                variant="secondary"
                size="sm"
                aria-label={`Unblock ${row.label}`}
                disabled={isPending}
                onClick={() => void requestUnblock(row.userId, row.name)}
              >
                Unblock
              </Button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <Card id="blocked-members" className="scroll-mt-16">
      <CardHeader>
        <CardTitle>{BLOCKED_MEMBERS_TITLE}</CardTitle>
        <CardDescription>{BLOCKED_MEMBERS_SCOPE}</CardDescription>
      </CardHeader>
      <CardContent>{body}</CardContent>
      {confirmDialog}
    </Card>
  );
}
