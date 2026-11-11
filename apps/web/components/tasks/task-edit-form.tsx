"use client";

import { useUpdateTask, type TaskEdit, type TaskSubtask } from "@repo/hooks";
import { dueEntryFromTask } from "@repo/formatting";
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
}

/** The form's draft for a task as it stands. */
export function taskDraftFromTask(task: EditableTask): TaskDraft {
  return {
    title: task.title,
    assigneeId: task.assignee_id,
    dueDate: dueEntryFromTask(task),
    points: task.point_reward ? String(task.point_reward) : "",
    description: task.description ?? "",
    subtasks: [],
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
  if (input.due_date !== task.due_date || dueAt !== storedAt) {
    body.due_date = input.due_date;
    body.due_at = dueAt;
  }
  const points = input.point_reward || null;
  if (points !== (task.point_reward || null)) body.point_reward = points;
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
  const stored = task.stored_status ?? task.status;
  return (
    <TaskForm
      initialDraft={taskDraftFromTask(task)}
      onDiscard={onClose}
      onDone={onClose}
      onPost={async (input) => {
        const body = taskEditFrom(task, input);
        if (Object.keys(body).length === 0) return { ok: true };
        try {
          await updateTask.mutateAsync({ id: task.id, body });
          return { ok: true };
        } catch (error) {
          return {
            ok: false,
            error: getErrorMessage(error, "Retry in a moment."),
          };
        }
      }}
      editing={{
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
      }}
    />
  );
}
