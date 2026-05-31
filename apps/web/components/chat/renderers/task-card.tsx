"use client";

import { CheckCircle2, ClipboardList, Undo2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useTask,
  useUpdateTaskStatus,
  useConfirmTask,
  useRejectTask,
} from "@repo/hooks";
import type { ChatMessage } from "@/lib/chat/types";
import type { TaskPayload } from "@repo/chat-integrations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Can } from "@/components/shared/can";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/utils";

interface TaskCardProps {
  message: ChatMessage;
  viewerId: string | null;
  /** False while the optimistic chat row is not yet server-acked. */
  isConfirmed: boolean;
}

type TaskStatus = "TODO" | "IN_PROGRESS" | "COMPLETED" | "OVERDUE";

/** Live task shape read back from `GET /v1/tasks/{id}` (display status). */
interface LiveTask {
  id: string;
  title: string;
  assignee_id: string;
  due_date: string;
  status: TaskStatus;
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
    point_reward:
      typeof r.point_reward === "number" ? r.point_reward : null,
    points_awarded: r.points_awarded === true,
  };
}

function formatDate(value: string): string {
  // due_date is a date-only `YYYY-MM-DD`; parse at local midnight so the
  // rendered day matches the server-formatted `content` string instead of
  // shifting back a day in negative-UTC-offset timezones.
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00`)
    : new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
}

const STATUS_BADGE: Record<TaskStatus, "default" | "outline" | "destructive"> = {
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
  const queryClient = useQueryClient();
  const updateStatus = useUpdateTaskStatus();
  const confirmTask = useConfirmTask();
  const rejectTask = useRejectTask();

  // Hooks must run before any early return; `useTask` no-ops on an empty id.
  const taskId = payload?.task_id ?? "";
  const { data: liveRaw } = useTask(taskId);

  if (!payload) {
    return (
      <div className="mt-1 whitespace-pre-wrap break-words text-sm">
        {message.content}
      </div>
    );
  }

  const live = coerceLiveTask(liveRaw);
  const status: TaskStatus = live?.status ?? payload.status;
  const pointsAwarded = live?.points_awarded ?? false;
  const isAssignee = viewerId != null && viewerId === payload.assignee_user_id;
  const actionsDisabled =
    !isConfirmed ||
    updateStatus.isPending ||
    confirmTask.isPending ||
    rejectTask.isPending;

  const taskKey = ["tasks", payload.task_id];

  async function runOptimistic(
    next: Partial<LiveTask>,
    action: () => Promise<unknown>,
    errorTitle: string,
    errorFallback: string,
  ): Promise<void> {
    const prev = queryClient.getQueryData<unknown>(taskKey);
    const prevTask = coerceLiveTask(prev);
    if (prevTask) {
      queryClient.setQueryData(taskKey, { ...prevTask, ...next });
    }
    try {
      await action();
    } catch (error) {
      if (prev !== undefined) queryClient.setQueryData(taskKey, prev);
      toast({
        title: errorTitle,
        description: getErrorMessage(error, errorFallback),
        variant: "destructive",
      });
    }
  }

  return (
    <div className="mt-1 rounded-md border-l-4 border-[color:var(--side-accent,#7A5A2F)] bg-[color:var(--mention-bg,theme(colors.amber.50))] px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-[color:var(--side-accent,#7A5A2F)]">
          <ClipboardList className="h-3 w-3" aria-hidden="true" /> Task
        </div>
        <Badge variant={STATUS_BADGE[status]}>{STATUS_LABELS[status]}</Badge>
      </div>
      <p className="mt-1 text-sm font-medium">{payload.title}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span>
          {payload.assigner_name} → {payload.assignee_name}
        </span>
        <span aria-hidden="true">·</span>
        <span>Due {formatDate(payload.due_date)}</span>
        {payload.point_reward ? (
          <Badge variant="outline">+{payload.point_reward} pts</Badge>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {isAssignee && status === "TODO" ? (
          <Button
            size="sm"
            variant="outline"
            disabled={actionsDisabled}
            onClick={() =>
              void runOptimistic(
                { status: "IN_PROGRESS" },
                () =>
                  updateStatus.mutateAsync({
                    id: payload.task_id,
                    body: { status: "IN_PROGRESS" },
                  }),
                "Couldn't start task",
                "Only the assignee can start this task.",
              )
            }
          >
            Start
          </Button>
        ) : null}
        {isAssignee && status === "IN_PROGRESS" ? (
          <Button
            size="sm"
            variant="outline"
            disabled={actionsDisabled}
            onClick={() =>
              void runOptimistic(
                { status: "COMPLETED" },
                () =>
                  updateStatus.mutateAsync({
                    id: payload.task_id,
                    body: { status: "COMPLETED" },
                  }),
                "Couldn't complete task",
                "The API rejected the transition.",
              )
            }
          >
            Mark complete
          </Button>
        ) : null}
        {status === "COMPLETED" ? (
          <Can permission="tasks:manage">
            <Button
              size="sm"
              disabled={actionsDisabled || pointsAwarded}
              onClick={() =>
                void runOptimistic(
                  { points_awarded: true },
                  () => confirmTask.mutateAsync(payload.task_id),
                  "Couldn't confirm task",
                  "Only admins with tasks:manage can confirm completions.",
                )
              }
            >
              <CheckCircle2 className="h-4 w-4" />
              {pointsAwarded ? "Confirmed" : "Confirm"}
            </Button>
            {pointsAwarded ? null : (
              <Button
                size="sm"
                variant="outline"
                disabled={actionsDisabled}
                onClick={() =>
                  void runOptimistic(
                    { status: "IN_PROGRESS" },
                    () => rejectTask.mutateAsync({ id: payload.task_id }),
                    "Couldn't reject task",
                    "Only admins with tasks:manage can reject completions.",
                  )
                }
              >
                <Undo2 className="h-4 w-4" />
                Reject
              </Button>
            )}
          </Can>
        ) : null}
      </div>
    </div>
  );
}
