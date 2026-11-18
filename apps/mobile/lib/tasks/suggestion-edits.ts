import type { AiSuggestion, TaskSuggestionEdits } from "@repo/hooks";
import {
  taskWhoOf,
  taskWhoSuggestionFields,
  type TaskWho,
} from "@repo/validation";
import type { ValidatedNewTask } from "@/lib/tasks/create-task";

type SuggestedTask = NonNullable<AiSuggestion["task"]>;

/** Two answers to Who? as the same people, in any order. */
function sameWho(a: TaskWho | null, b: TaskWho | null): boolean {
  const key = (who: TaskWho | null) => {
    if (!who) return "";
    if (who.kind === "person") return `person:${who.userId}`;
    const { target } = who;
    const on =
      target.kind === "people"
        ? [...target.userIds].sort().join(",")
        : target.kind === "chapter"
          ? ""
          : target.id;
    return `${who.kind}:${target.kind}:${on}`;
  };
  return key(a) === key(b);
}

/** Only what the officer changed in the form, as the accept route takes it. */
export function suggestionEdits(
  task: SuggestedTask,
  form: ValidatedNewTask,
): TaskSuggestionEdits | undefined {
  const edits: TaskSuggestionEdits = {};
  if (form.title !== task.title) edits.title = form.title;
  // One answer to Who? (2026-11-18): a member, several, a role, a group or
  // everyone, each doing it or one claiming it. Changed, every who-field
  // goes, so the edit replaces the whole answer.
  if (!sameWho(form.who, taskWhoOf(task))) {
    Object.assign(edits, taskWhoSuggestionFields(form.who));
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
