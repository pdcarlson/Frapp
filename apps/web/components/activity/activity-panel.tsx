"use client";

import Link from "next/link";
import { useContext, useMemo } from "react";
import {
  activityEventMessage,
  activityHoursMessage,
  activityTaskMessage,
} from "@repo/chat-core/activity-cards";
import {
  CLOSE_POLL_CONFIRM_BODY,
  CLOSE_POLL_CONFIRM_LABEL,
  CLOSE_POLL_CONFIRM_TITLE,
} from "@repo/chat-core/polls";
import { EventCard } from "@/components/chat/renderers/event-card";
import { HoursCard } from "@/components/chat/renderers/hours-card";
import { PollCard } from "@/components/chat/renderers/poll-card";
import { TaskCard } from "@/components/chat/renderers/task-card";
import { TaskReview } from "@/components/tasks/task-review";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import { InlineNote } from "@/components/shared/inline-note";
import {
  Panel,
  PanelBody,
  PanelContent,
  PanelHeader,
} from "@/components/shared/panel";
import {
  SubscriptionNotice,
  useSubscriptionGate,
} from "@/components/shared/subscription-gate";
import { useServiceReview } from "@/components/service/use-service-review";
import { Button, buttonVariants } from "@/components/ui/button";
import { chatDeepLink } from "@/lib/chat/chat-links";
import { eventDeepLink } from "@/lib/events/event-links";
import type { ActivityRow } from "@repo/hooks";
import { ActivityFaces } from "./activity-row-lead";
import { useActivityPoll } from "./use-activity-poll";

const PANEL_TITLES: Record<ActivityRow["kind"], string> = {
  task: "Task",
  poll: "Poll",
  event: "Event",
  hours: "Service hours",
  link: "Link",
};

/**
 * The panel a row opens: the record, drawn with the card chat draws for it,
 * so a member votes, marks a task done, confirms it or checks in here with
 * the controls they already know from chat (#3897).
 *
 * The cards are chat's own components, unchanged. Each reads its record's
 * live state by id, so the panel shows the record as it is now, and each
 * card's own buttons call the same routes they call in chat. Two things are
 * added around them, because the cards do not carry them:
 * - a poll gets "Open in chat", a link to the message where the poll lives;
 * - a pending service entry gets Approve and Reject. Chat's hours card is a
 *   read-only record (review has always been the Service hours page's), so
 *   the review here is that page's own flow (`useServiceReview`).
 *
 * `onActed` runs after an action that changes what the page lists, so the row
 * can leave "Needs you".
 */
/**
 * The tasks waiting on the viewer's sign-off, for stepping from one review to
 * the next (#4693): those after a row, and how to open one.
 */
export interface ReviewQueue {
  after: (key: string) => ActivityRow[];
  open: (row: ActivityRow) => void;
}

export function ActivityPanel({
  row,
  viewerId,
  onClose,
  onActed,
  reviewQueue,
}: {
  row: ActivityRow | null;
  viewerId: string | null;
  reviewQueue?: ReviewQueue;
  /**
   * Close the panel. With a row key, only if that row is still the open one:
   * an action's answer can arrive after the member has moved to another row.
   */
  onClose: (key?: string) => void;
  onActed: () => void;
}) {
  return (
    <Panel
      open={row !== null}
      onOpenChange={(open) => !open && onClose()}
      docked
      backLabel="Back to activity"
    >
      {row ? (
        <PanelContent aria-describedby={undefined}>
          <PanelHeader>
            {row.kind === "task" && row.glyph === "confirm"
              ? "Review task"
              : PANEL_TITLES[row.kind]}
          </PanelHeader>
          <PanelBody>
            {viewerId ? (
              <PanelCard
                // A different row is a different card: no state carries over.
                key={row.key}
                row={row}
                viewerId={viewerId}
                onClose={onClose}
                onActed={onActed}
                reviewQueue={reviewQueue}
              />
            ) : (
              // The cards decide whose controls to show from the viewer's id;
              // without it they would show none, or the wrong ones.
              <InlineNote>Loading your account…</InlineNote>
            )}
          </PanelBody>
        </PanelContent>
      ) : null}
    </Panel>
  );
}

function PanelCard({
  row,
  viewerId,
  onClose,
  onActed,
  reviewQueue,
}: {
  row: ActivityRow;
  viewerId: string;
  onClose: (key?: string) => void;
  onActed: () => void;
  reviewQueue?: ReviewQueue;
}) {
  switch (row.kind) {
    case "task":
      return (
        <TaskPanel
          row={row}
          viewerId={viewerId}
          onClose={onClose}
          onActed={onActed}
          reviewQueue={reviewQueue}
        />
      );
    case "event":
      return <EventPanel row={row} />;
    case "poll":
      return <PollPanel row={row} viewerId={viewerId} />;
    case "hours":
      return (
        <HoursPanel
          row={row}
          viewerId={viewerId}
          onClose={onClose}
          onActed={onActed}
        />
      );
    case "link":
      // A sign-up link row opens the link, not the panel.
      return null;
  }
}

/**
 * A task waiting on the viewer's sign-off opens as its review (#4693); any
 * other task opens as chat's card.
 */
function TaskPanel({
  row,
  viewerId,
  onClose,
  onActed,
  reviewQueue,
}: {
  row: Extract<ActivityRow, { kind: "task" }>;
  viewerId: string;
  onClose: (key?: string) => void;
  onActed: () => void;
  reviewQueue?: ReviewQueue;
}) {
  const message = useMemo(() => activityTaskMessage(row.task), [row.task]);
  const faceFor = useContext(ActivityFaces);
  if (row.glyph === "confirm") {
    const rest = reviewQueue?.after(row.key) ?? [];
    const next = rest[0];
    return (
      <TaskReview
        taskId={row.task.id}
        assigneeName={row.task.assignee_name}
        face={faceFor(row.task.assignee_id)}
        waitingAfter={rest.length}
        onSkip={next && reviewQueue ? () => reviewQueue.open(next) : undefined}
        onDone={() => {
          // The list re-reads. With more waiting, the next one opens (the
          // grader's "next student"); otherwise only this row's panel
          // closes, in case the officer has already moved on.
          onActed();
          if (next && reviewQueue) reviewQueue.open(next);
          else onClose(row.key);
        }}
      />
    );
  }
  return <TaskCard message={message} viewerId={viewerId} isConfirmed />;
}

function EventPanel({ row }: { row: Extract<ActivityRow, { kind: "event" }> }) {
  const message = useMemo(() => activityEventMessage(row.event), [row.event]);
  return (
    <>
      <EventCard message={message} isConfirmed />
      <div>
        <Link
          href={eventDeepLink(row.event.id)}
          className={buttonVariants({ variant: "secondary", size: "sm" })}
        >
          Open in Events
        </Link>
      </div>
    </>
  );
}

function PollPanel({
  row,
  viewerId,
}: {
  row: Extract<ActivityRow, { kind: "poll" }>;
  viewerId: string;
}) {
  const poll = useActivityPoll(row.poll);
  const { confirm, confirmDialog } = useConfirmDialog();
  if (!poll.message) return null;
  return (
    <>
      <PollCard
        message={poll.message}
        viewerId={viewerId}
        // No vote until the votes are read: the card decides "have I voted"
        // from them, and a tally drawn from nothing would read as zero.
        isConfirmed={!poll.votesLoading && !poll.votesFailed}
        onVote={(messageId, actionType, payload) =>
          void poll.vote(messageId, actionType, payload)
        }
        onClosePoll={(messageId) =>
          void confirm({
            title: CLOSE_POLL_CONFIRM_TITLE,
            description: CLOSE_POLL_CONFIRM_BODY,
            confirmLabel: CLOSE_POLL_CONFIRM_LABEL,
          }).then((result) => {
            if (result !== null) void poll.close(messageId);
          })
        }
      />
      {poll.votesFailed ? (
        <InlineNote>
          Couldn&apos;t load this poll&apos;s votes, so voting is paused here.
          Open it in chat to vote.
        </InlineNote>
      ) : null}
      <div>
        <Link
          href={chatDeepLink({
            channelId: row.poll.channel_id,
            messageId: row.poll.message_id,
          })}
          className={buttonVariants({ variant: "secondary", size: "sm" })}
        >
          Open in chat
        </Link>
      </div>
      {confirmDialog}
    </>
  );
}

function HoursPanel({
  row,
  viewerId,
  onClose,
  onActed,
}: {
  row: Extract<ActivityRow, { kind: "hours" }>;
  viewerId: string;
  onClose: (key?: string) => void;
  onActed: () => void;
}) {
  const message = useMemo(() => activityHoursMessage(row.entry), [row.entry]);
  const review = useServiceReview();
  // Reviewing is a paid-ops write (`ServiceEntryController`), as on the
  // Service hours page.
  const gate = useSubscriptionGate();
  // Closing re-reads the page, so the row leaves the list; it closes only this
  // row's panel. If the member has already moved on, the close is a no-op and
  // `onActed` does the re-read instead.
  const settle = (recorded: boolean) => {
    if (!recorded) return;
    onActed();
    onClose(row.key);
  };
  return (
    <>
      <HoursCard message={message} viewerId={viewerId} />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => void review.approve(row.entry).then(settle)}
          {...gate.controlProps(review.isPending)}
        >
          Approve
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => void review.reject(row.entry).then(settle)}
          {...gate.controlProps(review.isPending)}
        >
          Reject
        </Button>
      </div>
      <SubscriptionNotice gate={gate} feature="reviewing hours" />
      {review.confirmDialog}
    </>
  );
}
