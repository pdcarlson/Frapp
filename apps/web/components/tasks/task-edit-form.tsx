"use client";

import { useRef } from "react";
import {
  useUpdateTask,
  type LiveTaskPhoto,
  type TaskEdit,
  type TaskSubtask,
} from "@repo/hooks";
import {
  TASK_SERIES_SCOPE_COPY,
  noTaskRepeatDraft,
  taskRepeatDraftFromRule,
  taskSaveScope,
  type TaskProofKind,
  type TaskSeriesLine,
} from "@repo/validation";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import { dueEntryFields, dueEntryFromTask } from "@repo/formatting";
import type { TaskInput } from "@repo/chat-core/dispatch";
import type { SubscriptionGate } from "@/components/shared/subscription-gate";
import { getErrorMessage } from "@/lib/utils";
import { TaskForm, type TaskDraft } from "./task-form";
import { TaskSubtaskList } from "./task-subtasks";

/** The task fields an edit reads and compares against. */
export interface EditableTask {
  id: string;
  title: string;
  description: string | null;
  assignee_id: string;
  due_date: string;
  due_at?: string | null;
  point_reward: number | null;
  /** The stored status: a new assignee starts anything past To do over. */
  stored_status?: string;
  status: string;
  subtasks?: TaskSubtask[];
  /** Task photos, reference then proof (#4635). */
  photos?: LiveTaskPhoto[];
  /** What Mark done needs (#4635). */
  proof_kind?: TaskProofKind;
  /** How it repeats, on a copy of a series (#5119). */
  series?: TaskSeriesLine | null;
}

/**
 * Whether the edit moves the task to another day, both days read on this
 * device's calendar (`dueEntryFromTask` puts a timed task on its local
 * day), so a time change seen from another zone isn't a move (#5119).
 */
function movesDay(task: EditableTask, input: TaskInput): boolean {
  const before = dueEntryFields(dueEntryFromTask(task)).due_date;
  return input.due_date.slice(0, 10) !== before.slice(0, 10);
}

/**
 * An "All upcoming tasks" write (#5119). The copy keeps its day there, so
 * only the time travels: the server reads the time of day from `due_at` and
 * refuses any `due_date` but the open copy's own.
 */
function seriesBody(body: TaskEdit): TaskEdit {
  const rest: TaskEdit = { ...body, scope: "series" };
  delete rest.due_date;
  return rest;
}

/** A copy of a series that still makes copies (#5119). */
function repeats(task: EditableTask): boolean {
  return !!task.series && !task.series.ended;
}

/** The task's reference photos, in order. */
function referencePhotos(task: EditableTask): LiveTaskPhoto[] {
  return (task.photos ?? []).filter((photo) => photo.kind === "reference");
}

/** The form's draft for a task as it stands. */
function taskDraftFromTask(task: EditableTask): TaskDraft {
  return {
    title: task.title,
    assigneeId: task.assignee_id,
    dueDate: dueEntryFromTask(task),
    points: task.point_reward ? String(task.point_reward) : "",
    description: task.description ?? "",
    subtasks: [],
    photoFiles: [],
    keptPhotos: referencePhotos(task),
    proofKind: task.proof_kind ?? "none",
    repeat:
      task.series && repeats(task)
        ? taskRepeatDraftFromRule(task.series.recurrence_rule)
        : noTaskRepeatDraft(),
    showMore: false,
  };
}

/**
 * Only what the officer changed, so an untouched field never rewrites the
 * row, and the due date and time travel as a pair, as the API reads them.
 * Empty when nothing changed.
 */
export function taskEditFrom(task: EditableTask, input: TaskInput): TaskEdit {
  const body: TaskEdit = {};
  if (input.title !== task.title) body.title = input.title;
  const description = input.description ?? null;
  if (description !== (task.description?.trim() || null)) {
    body.description = description;
  }
  if (input.assignee_id !== task.assignee_id) {
    body.assignee_id = input.assignee_id;
  }
  const dueAt = input.due_at ?? null;
  const storedAt = task.due_at ? new Date(task.due_at).toISOString() : null;
  // A timed task's day is its time's day: an unchanged `due_at` is an
  // unchanged due, even read where the zone puts it on another day.
  if (
    dueAt !== storedAt ||
    (dueAt === null && input.due_date !== task.due_date)
  ) {
    body.due_date = input.due_date;
    body.due_at = dueAt;
  }
  const points = input.point_reward || null;
  if (points !== (task.point_reward || null)) body.point_reward = points;
  // The reference photos as they should stand, sent only when they changed:
  // one removed, one added, or a new order (#4635).
  if (input.reference_photo_paths !== undefined) {
    const held = referencePhotos(task).map((photo) => photo.storage_path);
    const next = input.reference_photo_paths;
    if (
      next.length !== held.length ||
      next.some((path, i) => path !== held[i])
    ) {
      body.reference_photo_paths = next;
    }
  }
  if (
    input.proof_kind !== undefined &&
    input.proof_kind !== (task.proof_kind ?? "none")
  ) {
    body.proof_kind = input.proof_kind;
  }
  // A Repeat change, on a copy of a live series only (#5119): the new rule,
  // or null to stop repeating.
  if (
    repeats(task) &&
    input.recurrence_rule !== undefined &&
    input.recurrence_rule !== (task.series?.recurrence_rule ?? null)
  ) {
    body.recurrence_rule = input.recurrence_rule;
  }
  return body;
}

/**
 * A board tile in edit (#4296): the + card's task form, opened on the task
 * as it stands, in the tile's place, the way Todoist's board turns a card
 * into its editor. Steps are the task's live checklist, added and removed as
 * they're typed, as they are on the tile; the other fields save together.
 */
export function TaskEditForm({
  task,
  assigneeName,
  gate,
  onClose,
}: {
  task: EditableTask;
  /** Whom a new pick would replace, for the line under Assignee. */
  assigneeName: string;
  gate: SubscriptionGate;
  onClose: () => void;
}) {
  const updateTask = useUpdateTask();
  const { confirm, confirmDialog } = useConfirmDialog();
  // The scope `beforeSave` settled on, for the write that follows it.
  const scope = useRef<"instance" | "series">("instance");
  const stored = task.stored_status ?? task.status;
  return (
    <>
      {confirmDialog}
      <TaskForm
        initialDraft={taskDraftFromTask(task)}
        onDiscard={onClose}
        onDone={onClose}
        beforeSave={async (input, hasNewPhotos) => {
          // On a copy of a live series (#5119), decided before any photo
          // uploads, so backing out leaves nothing behind.
          const body = taskEditFrom(task, input);
          const { recurrence_rule, ...rest } = body;
          const decided = taskSaveScope(task, {
            ...(recurrence_rule !== undefined ? { recurrence_rule } : {}),
            movesDay: movesDay(task, input),
            changesOther: Object.keys(rest).length > 0 || hasNewPhotos,
          });
          if (decided.kind === "refuse") return decided.message;
          if (decided.kind !== "ask") {
            scope.current = decided.kind;
            return true;
          }
          const picked = await confirm({
            title: TASK_SERIES_SCOPE_COPY.saveTitle,
            description: TASK_SERIES_SCOPE_COPY.saveMessage,
            confirmLabel: TASK_SERIES_SCOPE_COPY.allUpcoming,
            alternativeLabel: TASK_SERIES_SCOPE_COPY.thisTask,
            tone: "default",
          });
          // Dismissed: the form stays open with the edit, and nothing failed.
          if (!picked) return false;
          scope.current = picked.alternative ? "instance" : "series";
          return true;
        }}
        onPost={async (input) => {
          const body = taskEditFrom(task, input);
          if (Object.keys(body).length === 0) return { ok: true };
          try {
            await updateTask.mutateAsync({
              id: task.id,
              body: scope.current === "series" ? seriesBody(body) : body,
            });
            return { ok: true };
          } catch (error) {
            return {
              ok: false,
              error: getErrorMessage(error, "Retry in a moment."),
            };
          }
        }}
        editing={{
          taskId: task.id,
          steps: (
            <div className="grid gap-1">
              <p className="text-sm font-medium">Subtasks</p>
              <TaskSubtaskList
                taskId={task.id}
                subtasks={task.subtasks ?? []}
                canCheck
                canEdit
                closed={false}
                gate={gate}
                embedded
              />
            </div>
          ),
          assigneeNote: (assigneeId) =>
            assigneeId !== task.assignee_id && stored !== "TODO" ? (
              <p className="text-caption text-muted-foreground">
                Saving starts it over at To do. {assigneeName}&apos;s progress
                doesn&apos;t carry.
              </p>
            ) : null,
          repeats: repeats(task),
        }}
      />
    </>
  );
}
