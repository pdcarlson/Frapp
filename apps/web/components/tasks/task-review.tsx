"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MoreHorizontal, Pencil, SquareArrowOutUpRight } from "lucide-react";
import {
  canEditCardTask,
  isAwaitingReview,
  readEditableCardTask,
  readLiveTask,
  sendBackReasonChips,
  taskDueLine,
  taskStatusLabel,
  taskReview,
  useConfirmTask,
  useNow,
  useRejectTask,
  useTask,
  type ActivityFace,
} from "@repo/hooks";
import { formatPoints } from "@repo/formatting";
import {
  CardTaskEdit,
  TASK_CONFIRM_FAILURE,
} from "@/components/chat/renderers/task-card";
import { InlineNote } from "@/components/shared/inline-note";
import { OWNS_ESCAPE } from "@/components/shared/panel";
import {
  SubscriptionNotice,
  useSubscriptionGate,
} from "@/components/shared/subscription-gate";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/lib/hooks/use-toast";
import { getErrorMessage, initials } from "@/lib/utils";
import {
  ProofLinkChip,
  SendBackDialog,
  TaskPhotoStrip,
  TaskProofGallery,
} from "./task-photo";

/**
 * An officer's review of one submitted task (#4693), in Activity's panel: who
 * handed it in and when, the proof as big as the panel allows, the send-back
 * it answers on a resubmission, the reply, and two actions, Send back and a
 * Confirm that names its payout. Edit and Open in Tasks sit under the ⋯, so
 * nothing competes with the decision.
 *
 * It reads the task by id, so it shows the task as it is now wherever it was
 * opened from. Once the task is no longer waiting (confirmed or sent back,
 * here or elsewhere), `onDone` closes it and the list re-reads.
 */
export function TaskReview({
  taskId,
  assigneeName,
  face,
  waitingAfter = 0,
  onSkip,
  onDone,
}: {
  taskId: string;
  /** From the Activity row; empty when the member has left. */
  assigneeName: string;
  /** The assignee on the roster, for their photo; null for one who left. */
  face: ActivityFace | null;
  /** How many more wait after this one (#4693); Confirm moves to the next. */
  waitingAfter?: number;
  /** Leave this one waiting and open the next. */
  onSkip?: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const query = useTask(taskId);
  const confirmTask = useConfirmTask();
  const rejectTask = useRejectTask();
  const gate = useSubscriptionGate();
  const now = useNow();
  const [sendingBack, setSendingBack] = useState(false);
  const [editing, setEditing] = useState(false);
  // A cached read can predate the submission this review is for (a push
  // opens it moments after Mark done), so it reads the task again on open.
  const refetch = query.refetch;
  useEffect(() => {
    void refetch();
  }, [taskId, refetch]);

  const live = readLiveTask(query.data);
  if (!live) {
    return query.isError ? (
      <InlineNote>
        Couldn&apos;t load this task. It may have been deleted, or you may no
        longer manage tasks.
      </InlineNote>
    ) : (
      <InlineNote>Loading the task…</InlineNote>
    );
  }
  const raw = query.data as { title?: string } | undefined;
  const title = raw?.title ?? "Task";
  const review = taskReview(live, new Date(now));
  const due = taskDueLine(live.due, live.status, new Date(now));
  const editable = canEditCardTask({ live, canManage: true })
    ? readEditableCardTask(query.data)
    : null;
  const name = assigneeName || face?.name || "A member";
  const firstName = name.split(" ")[0] ?? name;
  const busy = confirmTask.isPending || rejectTask.isPending;

  // Confirmed or sent back elsewhere since the list was read. While this
  // review's own action is in flight its optimistic write reads the same
  // way, so it keeps its place until `onDone` closes it.
  if (!isAwaitingReview(live) && !busy) {
    return query.isFetching ? (
      <InlineNote>Loading the task…</InlineNote>
    ) : (
      <InlineNote>
        {title} isn&apos;t waiting on a review anymore. Status:{" "}
        {taskStatusLabel(live)}.
      </InlineNote>
    );
  }

  if (editing && editable) {
    return (
      <div
        role="group"
        aria-label={`Editing ${editable.title}`}
        {...{ [OWNS_ESCAPE]: "" }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            setEditing(false);
          }
        }}
      >
        <CardTaskEdit
          task={editable}
          gate={gate}
          onClose={() => setEditing(false)}
        />
      </div>
    );
  }

  const facts = [
    due?.text,
    review.timing,
    live.point_reward ? formatPoints(live.point_reward) : null,
  ].filter(Boolean);

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="flex items-center gap-3">
        <Avatar className="h-10 w-10">
          {face?.avatarUrl ? <AvatarImage src={face.avatarUrl} alt="" /> : null}
          <AvatarFallback tint={face?.tint}>{initials(name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-label font-semibold">{name}</p>
          {review.submitted ? (
            <p className="text-caption text-muted-foreground">
              {review.submitted}
            </p>
          ) : null}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`More for ${title}`}
              title="More"
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[200px]">
            {editable ? (
              <DropdownMenuItem onSelect={() => setEditing(true)}>
                <Pencil aria-hidden="true" />
                Edit task
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem asChild>
              <Link href="/tasks">
                <SquareArrowOutUpRight aria-hidden="true" />
                Open Tasks
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="grid gap-1">
        <h3 className="text-title font-bold">{title}</h3>
        {facts.length > 0 ? (
          <p className="text-caption text-muted-foreground">
            {facts.join(" · ")}
          </p>
        ) : null}
      </div>

      {review.proofPhotos.length > 0 ? (
        <TaskProofGallery
          taskId={live.id}
          photos={review.proofPhotos}
          label="Proof"
        />
      ) : null}
      {review.link ? <ProofLinkChip link={review.link} /> : null}

      {review.sentBackReason || review.note ? (
        <div className="grid gap-2">
          {review.sentBackReason ? (
            <p className="rounded-[10px] bg-warning-tint px-3 py-2 text-caption text-foreground">
              <span className="font-medium">You sent it back: </span>
              &ldquo;{review.sentBackReason}&rdquo;
            </p>
          ) : null}
          {review.note ? (
            <p className="rounded-[10px] bg-surface-1 px-3 py-2 text-body text-foreground">
              <span className="font-medium">{firstName}: </span>
              {review.note}
            </p>
          ) : null}
        </div>
      ) : null}

      <TaskPhotoStrip
        taskId={live.id}
        photos={review.referencePhotos}
        label="Reference photos"
      />

      <div className="flex flex-wrap gap-2 pt-1">
        <Button
          type="button"
          variant="secondary"
          className="flex-1"
          {...gate.controlProps(busy)}
          onClick={() => setSendingBack(true)}
        >
          Send back
        </Button>
        <Button
          type="button"
          className="flex-1"
          {...gate.controlProps(busy)}
          onClick={() =>
            confirmTask.mutate(taskId, {
              onSuccess: onDone,
              onError: (error) =>
                toast({
                  title: TASK_CONFIRM_FAILURE.title,
                  description: getErrorMessage(
                    error,
                    TASK_CONFIRM_FAILURE.fallback,
                  ),
                  variant: "destructive",
                }),
            })
          }
        >
          {review.confirmLabel}
        </Button>
      </div>
      <SubscriptionNotice
        gate={gate}
        feature="reviewing tasks"
        className="mb-0"
      />
      {waitingAfter > 0 ? (
        <div className="flex items-center justify-between gap-2 text-caption text-muted-foreground">
          <span>{waitingAfter} more waiting</span>
          {onSkip ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={onSkip}
            >
              Skip
            </Button>
          ) : null}
        </div>
      ) : null}

      <SendBackDialog
        title={title}
        proofKind={live.proof_kind}
        reasons={sendBackReasonChips(live.proof_kind)}
        open={sendingBack}
        onClose={() => setSendingBack(false)}
        onSubmit={async (body) => {
          await rejectTask.mutateAsync({ id: taskId, body });
          onDone();
        }}
      />
    </div>
  );
}
