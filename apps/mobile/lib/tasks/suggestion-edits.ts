import type { AiSuggestion, TaskSuggestionEdits } from "@repo/hooks";
import type { ValidatedNewTask } from "@/lib/tasks/create-task";

type SuggestedTask = NonNullable<AiSuggestion["task"]>;

/** Only what the officer changed in the form, as the accept route takes it. */
export function suggestionEdits(
  task: SuggestedTask,
  form: ValidatedNewTask,
): TaskSuggestionEdits | undefined {
  const edits: TaskSuggestionEdits = {};
  if (form.title !== task.title) edits.title = form.title;
  if (form.assignee_id !== task.assignee_id) {
    edits.assignee_id = form.assignee_id;
  }
  const dueAt = form.due_at ?? null;
  if (form.due_date !== task.due_date || dueAt !== task.due_at) {
    edits.due_date = form.due_date;
    edits.due_at = dueAt;
  }
  const steps = form.subtasks ?? [];
  if (
    steps.length !== task.subtasks.length ||
    steps.some((step, index) => step !== task.subtasks[index])
  ) {
    edits.subtasks = steps;
  }
  return Object.keys(edits).length > 0 ? edits : undefined;
}
