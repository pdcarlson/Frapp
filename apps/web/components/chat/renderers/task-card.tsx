"use client";

import { useState } from "react";
import { CheckCircle2, Pencil, Undo2 } from "lucide-react";
import { TasksGlyph } from "../chat-glyphs";
import {
  canEditCardTask,
  canReadCardTask,
  readEditableCardTask,
  readLiveTask,
  taskCardControls,
  TASK_ACTION_LABELS,
  taskStatusLabel,
  useMembers,
  useMyPermissions,
  subtaskProgress,
  useNow,
  useTask,
  taskDueLine,
  useUpdateTaskStatus,
  useConfirmTask,
  useRejectTask,
  viewerIsCardAssignee,
} from "@repo/hooks";
import type { TaskStatus } from "@repo/hooks";
import { EYEBROW, MESSAGE_CARD } from "../chip";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@repo/chat-core/types";
import { readTaskPayload } from "@repo/chat-core/cards";
import { Badge } from "@/components/ui/badge";
import { taskStatusKind } from "@/components/tasks/task-status";
import { Button } from "@/components/ui/button";
import { Can } from "@/components/shared/can";
import { can } from "@repo/validation";
import { formatPointsChip } from "@repo/formatting";
import {
  SubscriptionNotice,
  useSubscriptionGate,
} from "@/components/shared/subscription-gate";
import { TaskEditForm } from "@/components/tasks/task-edit-form";
import { memberLabel } from "@repo/hooks/display-names";
import { useToast } from "@/lib/hooks/use-toast";
import { getErrorMessage } from "@/lib/utils";

interface TaskCardProps {
  message: ChatMessage;
  /** Known, never `null` — see `MessageRendererProps.viewerId`. */
  viewerId: string;
  /** False while the optimistic chat row is not yet server-acked. */
  isConfirmed: boolean;
}

/**
 * What a refused confirm says, wherever a card's Confirm runs: the task card
 * here and an Activity row's Confirm (#4402).
 */
export const TASK_CONFIRM_FAILURE = {
  title: "Couldn't confirm task",
  fallback: "Only admins with tasks:manage can confirm completions.",
} as const;

/**
 * Task assignment card. The chat message is an immutable creation-time snapshot
 * (`actor → assignee`, title, due date, point reward); the *live* status is read
 * back from the task query so the card reflects lifecycle changes without ever
 * mutating the message row. Server-originated (a client cannot forge
 * `kind:"task"` — see `ChatService.SERVER_ONLY_KINDS`).
 *
 * Interactive: the assignee can Start / Mark done and an admin
 * (`tasks:manage`) can Confirm / Reject inline. Buttons fire the existing task
 * REST endpoints with optimistic cache writes; the server stays the trust
 * boundary, so the gating here is UX-only. Which controls show, and when the
 * live status can be read at all, are `taskCardControls` and `canReadCardTask`
 * in `@repo/hooks`, the rules the mobile card applies too.
 */
export function TaskCard({ message, viewerId, isConfirmed }: TaskCardProps) {
  const payload = readTaskPayload(message);
  const { toast } = useToast();
  const updateStatus = useUpdateTaskStatus();
  const confirmTask = useConfirmTask();
  const rejectTask = useRejectTask();
  const { data: permissionsPayload } = useMyPermissions();

  /*
    `!!viewerId` rather than `!= null`, for the reason `poll-card` records: the
    declared type does not stop `undefined` arriving through a spread, and
    `undefined != null` is false. A false value here hides the assignee's
    controls and keeps a tasks:manage holder's Confirm off a task that isn't
    theirs, which is the safe direction.
  */
  const isAssignee =
    !!viewerId && !!payload && viewerId === payload.assignee_user_id;
  const canManage = can("tasks:manage", permissionsPayload?.permissions);
  // Hooks must run before any early return; `useTask` no-ops on an empty id.
  // Only the assignee and a tasks:manage holder can read the task, so nobody
  // else asks: for them the request is a guaranteed 403.
  const { data: liveRaw } = useTask(
    payload && canReadCardTask({ isAssignee, canManage })
      ? payload.task_id
      : "",
  );
  // Same constraint: this one is a hook too, so it cannot sit down with the
  // derived values below the malformed-payload return.
  //
  // Every button on this card hits `task.controller.ts` — PATCH /tasks/:id/status,
  // POST /tasks/:id/confirm, POST /tasks/:id/reject — which is paid-ops. The chat
  // surface itself is `@FreeTier`, so it is easy to assume a card rendered inside
  // chat inherits that; it does not. The route decides, not the host (#841).
  const gate = useSubscriptionGate();
  // The due countdown's clock, a hook for the same reason.
  const now = useNow();
  // An officer's edit (#4512) puts the task form in the card's place until it
  // saves or is cancelled, as the board's tile does (#4296).
  const [editing, setEditing] = useState(false);

  if (!payload) {
    return (
      <div className="mt-1 whitespace-pre-wrap break-words text-base">
        {message.content}
      </div>
    );
  }

  const live = readLiveTask(liveRaw);
  // The badge is the live status only. The payload's is the creation-time
  // `TODO` forever, so drawing it before (or instead of) a live read would call
  // a finished task "To do".
  const status: TaskStatus | null = live?.status ?? null;
  const statusLabel = live ? taskStatusLabel(live) : null;
  // The due line (#4135): the live due date once read, since an edit can move
  // it after this card was posted, counting down against a ticking clock.
  const due = taskDueLine(
    live?.due ?? payload.due_at ?? payload.due_date,
    status,
    new Date(now),
  );
  // No control until the live task is read (#2065): acting on the snapshot
  // offered Start on tasks already in progress or done.
  // The controls follow whom the task is assigned to now (#4296): an edit
  // can hand it to someone else after this card was posted.
  const isAssigneeNow = viewerIsCardAssignee(
    viewerId,
    payload.assignee_user_id,
    live,
  );
  const controls = taskCardControls({
    live,
    isAssignee: isAssigneeNow,
    canManage,
  });
  const memberControls = controls.filter(
    (control) => control === "start" || control === "complete",
  );
  // Confirm, Confirmed and Reject are worked out as if `tasks:manage` were
  // held, and `<Can>` decides: it tells a check that couldn't run from a
  // denial (design-system README §4, §5 rule 4), and for the check that
  // couldn't run it draws the offline chip and Retry. That only reaches a
  // viewer whose task is read without the permission, which is the assignee
  // (their own Reject). Any other officer whose permissions couldn't be read
  // never reads the task, so their card offers nothing, the way every card
  // does before its live task arrives.
  const managerControls = taskCardControls({
    live,
    isAssignee: isAssigneeNow,
    canManage: true,
  }).filter((control) => control !== "start" && control !== "complete");
  // Edit, wherever the card is shown (chat and Activity, #4512): the board's
  // rule, a tasks:manage holder until the task is confirmed.
  const editable = canEditCardTask({ live, canManage })
    ? readEditableCardTask(liveRaw)
    : null;
  const actionsDisabled =
    !isConfirmed ||
    updateStatus.isPending ||
    confirmTask.isPending ||
    rejectTask.isPending;

  /**
   * Per-call failure copy. The optimistic write and its rollback moved into the
   * shared hooks (#560), leaving only the message here — `@repo/hooks` has no
   * toast, and mobile has none at all.
   *
   * Note which callback each half sits on, because the asymmetry is deliberate:
   * the **rollback** is a mutation-level callback, which always fires; this
   * **toast** is a per-`mutate()` option, which react-query v5 drops for a
   * superseded mutation. That is the behavior we want — a superseded action's
   * toast is noise, while its rollback is not optional. Putting the rollback
   * here instead would silently leave a wrong value in the cache.
   */
  function onFailure(title: string, fallback: string) {
    return {
      onError: (error: unknown) =>
        toast({
          title,
          description: getErrorMessage(error, fallback),
          variant: "destructive",
        }),
    };
  }

  if (editing && editable) {
    return (
      <Card
        className={cn(MESSAGE_CARD)}
        role="group"
        aria-label={`Editing ${editable.title}`}
        // Escape puts the card back unsaved, like the board tile's Escape. A
        // picker open inside handles its own Escape in its portal first.
        onKeyDown={(event) => {
          if (event.key === "Escape" && !event.defaultPrevented) {
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
      </Card>
    );
  }

  return (
    <Card className={cn(MESSAGE_CARD)}>
      <div className="flex items-center justify-between gap-2">
        <div
          className={cn(
            EYEBROW,
            "flex items-center gap-1.5 text-muted-foreground",
          )}
        >
          <TasksGlyph className="h-4 w-4" /> Task
        </div>
        <div className="flex items-center gap-1">
          {editable ? (
            // A square icon by the badge, as on the board's tile: the
            // lifecycle actions below stay the card's actions.
            <Button
              size="icon"
              variant="ghost"
              className="size-7 pointer-coarse:size-11"
              aria-label={`Edit ${payload.title}`}
              {...gate.controlProps(!isConfirmed)}
              onClick={() => setEditing(true)}
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
            </Button>
          ) : null}
          {live && statusLabel ? (
            <Badge variant={taskStatusKind(live)}>{statusLabel}</Badge>
          ) : null}
        </div>
      </div>
      <p className="mt-2 text-base font-bold">{payload.title}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted-foreground">
        <span>
          {payload.assigner_name} → {payload.assignee_name}
        </span>
        <span aria-hidden="true">·</span>
        <span className={cn(due?.overdue && "text-destructive-text")}>
          {due?.text ?? `Due ${payload.due_date}`}
        </span>
        {live && live.subtasks.length > 0 ? (
          <>
            <span aria-hidden="true">·</span>
            <span>{subtaskProgress(live.subtasks)?.label} subtasks</span>
          </>
        ) : null}
        {payload.point_reward ? (
          <Badge variant="outline">
            {formatPointsChip(payload.point_reward)}
          </Badge>
        ) : null}
      </div>
      {memberControls.length > 0 || managerControls.length > 0 ? (
        // `empty:hidden`: a denied `<Can>` leaves the row with nothing in it,
        // and an empty row would still add its margin to the card.
        <div className="mt-3 flex flex-wrap gap-2 empty:hidden">
          {controls.includes("start") ? (
            <Button
              size="sm"
              variant="secondary"
              {...gate.controlProps(actionsDisabled)}
              onClick={() =>
                updateStatus.mutate(
                  { id: payload.task_id, body: { status: "IN_PROGRESS" } },
                  onFailure(
                    "Couldn't start task",
                    "Only the assignee can start this task.",
                  ),
                )
              }
            >
              {TASK_ACTION_LABELS.start}
            </Button>
          ) : null}
          {controls.includes("complete") ? (
            <Button
              size="sm"
              variant="secondary"
              {...gate.controlProps(actionsDisabled)}
              onClick={() =>
                updateStatus.mutate(
                  { id: payload.task_id, body: { status: "COMPLETED" } },
                  onFailure("Couldn't complete task", "Try again in a moment."),
                )
              }
            >
              {TASK_ACTION_LABELS.complete}
            </Button>
          ) : null}
          {managerControls.length > 0 ? (
            <Can permission="tasks:manage">
              {managerControls.includes("confirm") ||
              managerControls.includes("confirmed") ? (
                // `confirmed` is a disabled indicator, not an action: an admin
                // sees that the completion was confirmed.
                <Button
                  size="sm"
                  {...gate.controlProps(
                    actionsDisabled || managerControls.includes("confirmed"),
                  )}
                  onClick={() =>
                    confirmTask.mutate(
                      payload.task_id,
                      onFailure(
                        TASK_CONFIRM_FAILURE.title,
                        TASK_CONFIRM_FAILURE.fallback,
                      ),
                    )
                  }
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {managerControls.includes("confirmed")
                    ? TASK_ACTION_LABELS.confirmed
                    : TASK_ACTION_LABELS.confirm}
                </Button>
              ) : null}
              {managerControls.includes("reject") ? (
                <Button
                  size="sm"
                  variant="secondary"
                  {...gate.controlProps(actionsDisabled)}
                  onClick={() =>
                    rejectTask.mutate(
                      { id: payload.task_id },
                      onFailure(
                        "Couldn't reject task",
                        "Only admins with tasks:manage can reject completions.",
                      ),
                    )
                  }
                >
                  <Undo2 className="h-4 w-4" />
                  {TASK_ACTION_LABELS.reject}
                </Button>
              ) : null}
            </Can>
          ) : null}
          {/*
            The notice belongs to the action row, not the card: a timeline of
            task cards would otherwise repeat the same chapter-wide sentence
            under every one, including cards this viewer could never act on.
            Hence `controls`, which counts a manager control only once the
            permission is known to be held.
          */}
          {controls.length > 0 ? (
            <SubscriptionNotice
              gate={gate}
              feature="task actions"
              className="mb-0 w-full"
            />
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

/**
 * The board's edit form on a card (#4512), with the name of whom the task is
 * assigned to now for the line under Assignee: an edit may have handed it on
 * since the card was posted, so the snapshot's name won't do.
 */
function CardTaskEdit({
  task,
  gate,
  onClose,
}: {
  task: NonNullable<ReturnType<typeof readEditableCardTask>>;
  gate: ReturnType<typeof useSubscriptionGate>;
  onClose: () => void;
}) {
  const members = useMembers().data ?? [];
  const assignee = members.find(
    (member) => member.user_id === task.assignee_id,
  );
  return (
    <TaskEditForm
      task={task}
      assigneeName={memberLabel(assignee?.display_name, task.assignee_id)}
      gate={gate}
      onClose={onClose}
    />
  );
}
