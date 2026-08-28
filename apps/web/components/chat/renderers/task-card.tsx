"use client";

import { CheckCircle2, Undo2 } from "lucide-react";
import { TasksGlyph } from "../chat-glyphs";
import {
  useMyPermissions,
  useTask,
  useUpdateTaskStatus,
  useConfirmTask,
  useRejectTask,
} from "@repo/hooks";
import type { TaskStatus } from "@repo/hooks";
import { EYEBROW, MESSAGE_CARD } from "../chip";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@repo/chat-core/types";
import type { TaskPayload } from "@repo/chat-integrations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Can } from "@/components/shared/can";
import { can } from "@repo/validation";
import { parseBareDateLocalMidnight } from "@repo/formatting";
import {
  SubscriptionNotice,
  useSubscriptionGate,
} from "@/components/shared/subscription-gate";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/utils";

interface TaskCardProps {
  message: ChatMessage;
  viewerId: string | null;
  /** False while the optimistic chat row is not yet server-acked. */
  isConfirmed: boolean;
}

/** Live task shape read back from `GET /v1/tasks/{id}`. */
interface LiveTask {
  id: string;
  title: string;
  assignee_id: string;
  due_date: string;
  /** Display status — `OVERDUE` when derived. Drives the badge. */
  status: TaskStatus;
  /**
   * The persisted status (#1051). Drives which action is offered, because
   * `OVERDUE` renders identically for a stored `TODO` and a stored
   * `IN_PROGRESS`, and the server checks its transition table against this.
   * `undefined` from a pre-#1051 API — deliberately not defaulted, so the
   * caller can tell "unknown" from a real value.
   */
  stored_status: TaskStatus | undefined;
  point_reward: number | null;
  points_awarded: boolean;
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  COMPLETED: "Awaiting confirmation",
  OVERDUE: "Overdue",
};

/**
 * Defensive read of a `task` payload. A malformed row returns `null` so the
 * renderer falls back to the hot-path `content` string instead of blanking the
 * timeline (master-plan guard-on-missing-key rule).
 */
function readPayload(message: ChatMessage): TaskPayload | null {
  const raw = message.payload;
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.task_id !== "string" ||
    typeof r.title !== "string" ||
    typeof r.assignee_name !== "string" ||
    typeof r.assigner_name !== "string" ||
    typeof r.due_date !== "string"
  ) {
    return null;
  }
  return {
    task_id: r.task_id,
    title: r.title,
    assigner_user_id:
      typeof r.assigner_user_id === "string" ? r.assigner_user_id : "",
    assigner_name: r.assigner_name,
    assignee_user_id:
      typeof r.assignee_user_id === "string" ? r.assignee_user_id : "",
    assignee_name: r.assignee_name,
    due_date: r.due_date,
    status: "TODO",
    point_reward:
      typeof r.point_reward === "number" && Number.isFinite(r.point_reward)
        ? r.point_reward
        : null,
    created_at: typeof r.created_at === "string" ? r.created_at : "",
  };
}

function coerceLiveTask(data: unknown): LiveTask | null {
  if (!data || typeof data !== "object") return null;
  const r = data as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.status !== "string") return null;
  return {
    id: r.id,
    title: typeof r.title === "string" ? r.title : "",
    assignee_id: typeof r.assignee_id === "string" ? r.assignee_id : "",
    due_date: typeof r.due_date === "string" ? r.due_date : "",
    status: r.status as TaskStatus,
    stored_status:
      typeof r.stored_status === "string"
        ? (r.stored_status as TaskStatus)
        : undefined,
    point_reward: typeof r.point_reward === "number" ? r.point_reward : null,
    points_awarded: r.points_awarded === true,
  };
}

/** Which status this row's *actions* are decided by — see the board's twin. */
function actionStatusOf(live: LiveTask): TaskStatus | undefined {
  if (live.stored_status === undefined) {
    // Derivation only ever produces `OVERDUE`, so any other rendered value is
    // also the stored one; `OVERDUE` alone is ambiguous and offers nothing.
    return live.status === "OVERDUE" ? undefined : live.status;
  }
  return live.stored_status === "OVERDUE" ? "TODO" : live.stored_status;
}

function formatDate(value: string): string {
  // due_date is a date-only `YYYY-MM-DD`; parse at local midnight so the
  // rendered day matches the server-formatted `content` string instead of
  // shifting back a day in negative-UTC-offset timezones. Protected cluster —
  // do not fold into formatLocaleDate (`new Date(value)` is UTC midnight).
  const local = parseBareDateLocalMidnight(value);
  if (local) return local.toLocaleDateString();
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return value;
  return instant.toLocaleDateString();
}

const STATUS_BADGE: Record<TaskStatus, "default" | "outline" | "destructive"> =
  {
    TODO: "outline",
    IN_PROGRESS: "default",
    COMPLETED: "default",
    OVERDUE: "destructive",
  };

/**
 * Task assignment card. The chat message is an immutable creation-time snapshot
 * (`actor → assignee`, title, due date, point reward); the *live* status is read
 * back from the task query so the card reflects lifecycle changes without ever
 * mutating the message row. Server-originated (a client cannot forge
 * `kind:"task"` — see `ChatService.SERVER_ONLY_KINDS`).
 *
 * Interactive: the assignee can Start / Mark complete and an admin
 * (`tasks:manage`) can Confirm / Reject inline. Buttons fire the existing task
 * REST endpoints with optimistic cache writes; the server stays the trust
 * boundary, so the gating here is UX-only.
 */
export function TaskCard({ message, viewerId, isConfirmed }: TaskCardProps) {
  const payload = readPayload(message);
  const { toast } = useToast();
  const updateStatus = useUpdateTaskStatus();
  const confirmTask = useConfirmTask();
  const rejectTask = useRejectTask();

  // Hooks must run before any early return; `useTask` no-ops on an empty id.
  const taskId = payload?.task_id ?? "";
  const { data: liveRaw } = useTask(taskId);
  // Same constraint — this one is a hook too, so it cannot sit down with the
  // derived values below the malformed-payload return.
  //
  // Every button on this card hits `task.controller.ts` — PATCH /tasks/:id/status,
  // POST /tasks/:id/confirm, POST /tasks/:id/reject — which is paid-ops. The chat
  // surface itself is `@FreeTier`, so it is easy to assume a card rendered inside
  // chat inherits that; it does not. The route decides, not the host (#841).
  const gate = useSubscriptionGate();
  const { data: permissionsPayload } = useMyPermissions();

  if (!payload) {
    return (
      <div className="mt-1 whitespace-pre-wrap break-words text-base">
        {message.content}
      </div>
    );
  }

  const live = coerceLiveTask(liveRaw);
  const status: TaskStatus = live?.status ?? payload.status;
  // The badge shows `status` (so an overdue task reads as overdue), but the
  // action row keys off `storedStatus`: the server's transition table is
  // checked against the stored value, and `OVERDUE` hides whether that is
  // `TODO` or `IN_PROGRESS`. Before #1051 exposed it, an overdue task offered
  // the assignee no action at all — the task could never be moved.
  //
  // A row whose *persisted* status is `OVERDUE` maps to `TODO`, because
  // `VALID_ASSIGNEE_TRANSITIONS[OVERDUE]` is `[IN_PROGRESS]` — the same move
  // Start makes. `undefined` means a pre-#1051 API left the stored value
  // ambiguous, and no branch below matches it, so no action is offered.
  const storedStatus: TaskStatus | undefined = live
    ? actionStatusOf(live)
    : payload.status;
  const pointsAwarded = live?.points_awarded ?? false;
  const isAssignee = viewerId != null && viewerId === payload.assignee_user_id;
  const actionsDisabled =
    !isConfirmed ||
    updateStatus.isPending ||
    confirmTask.isPending ||
    rejectTask.isPending;
  // The notice belongs to the action row, not the card: a timeline of task
  // cards would otherwise repeat the same chapter-wide sentence under every
  // one, including cards this viewer could never act on anyway.
  // Mirrors the render conditions of the four buttons below, INCLUDING the
  // `tasks:manage` gate on the COMPLETED branch. Without that last term a
  // rank-and-file member scrolling a channel full of completed cards gets one
  // orphaned notice per card, explaining a control they cannot see — which is
  // the exact repetition this variable exists to prevent.
  const canManageTasks = can("tasks:manage", permissionsPayload?.permissions);
  // Confirm is refused server-side on your own task (#1056), so the assignee
  // sees no confirm affordance here. Reject is unaffected — it withholds points
  // rather than awarding them — so a COMPLETED card still shows an action to a
  // `tasks:manage` assignee, and this stays true for them.
  const showsAnyAction =
    (isAssignee &&
      (storedStatus === "TODO" || storedStatus === "IN_PROGRESS")) ||
    (storedStatus === "COMPLETED" && canManageTasks);

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

  return (
    <Card className={cn(MESSAGE_CARD)}>
      <div className="flex items-center justify-between gap-2">
        <div
          className={cn(EYEBROW, "flex items-center gap-1.5 text-accent-text")}
        >
          <TasksGlyph className="h-4 w-4" /> Task
        </div>
        <Badge variant={STATUS_BADGE[status]}>{STATUS_LABELS[status]}</Badge>
      </div>
      <p className="mt-2 text-base font-bold">{payload.title}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted-foreground">
        <span>
          {payload.assigner_name} → {payload.assignee_name}
        </span>
        <span aria-hidden="true">·</span>
        <span>Due {formatDate(payload.due_date)}</span>
        {payload.point_reward ? (
          <Badge variant="outline">+{payload.point_reward} pts</Badge>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {isAssignee && storedStatus === "TODO" ? (
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
            Start
          </Button>
        ) : null}
        {isAssignee && storedStatus === "IN_PROGRESS" ? (
          <Button
            size="sm"
            variant="secondary"
            {...gate.controlProps(actionsDisabled)}
            onClick={() =>
              updateStatus.mutate(
                { id: payload.task_id, body: { status: "COMPLETED" } },
                onFailure(
                  "Couldn't complete task",
                  "The API rejected the transition.",
                ),
              )
            }
          >
            Mark complete
          </Button>
        ) : null}
        {storedStatus === "COMPLETED" ? (
          <Can permission="tasks:manage">
            {isAssignee ? null : (
              <Button
                size="sm"
                {...gate.controlProps(actionsDisabled || pointsAwarded)}
                onClick={() =>
                  confirmTask.mutate(
                    payload.task_id,
                    onFailure(
                      "Couldn't confirm task",
                      "Only admins with tasks:manage can confirm completions.",
                    ),
                  )
                }
              >
                <CheckCircle2 className="h-4 w-4" />
                {pointsAwarded ? "Confirmed" : "Confirm"}
              </Button>
            )}
            {pointsAwarded ? null : (
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
                Reject
              </Button>
            )}
          </Can>
        ) : null}
        {showsAnyAction ? (
          <SubscriptionNotice
            gate={gate}
            feature="task actions"
            className="mb-0 w-full"
          />
        ) : null}
      </div>
    </Card>
  );
}
