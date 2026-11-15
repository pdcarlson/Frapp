import {
  EMPTY_TASK_PHOTO_DRAFT,
  type TaskPhotoDraft,
} from "@/components/tasks/task-photo";

/** What a typed `/task` could read, for the form to open on. */
export type TaskPrefill = {
  title?: string;
  dueDate?: string;
  pointReward?: number;
};

/** Everything the form holds, kept by the + card while it is closed. */
export interface TaskDraft extends TaskPhotoDraft {
  title: string;
  assigneeId: string;
  dueDate: string;
  points: string;
  description: string;
  /** The steps typed so far (#4003). */
  subtasks: string[];
  showMore: boolean;
}

export function taskDraftFrom(
  prefill: TaskPrefill = {},
  assigneeId = "",
): TaskDraft {
  return {
    title: prefill.title ?? "",
    assigneeId,
    dueDate: prefill.dueDate ?? "",
    points:
      prefill.pointReward !== undefined ? String(prefill.pointReward) : "",
    description: "",
    subtasks: [],
    ...EMPTY_TASK_PHOTO_DRAFT,
    // Open when the typed command set something that lives there.
    showMore: prefill.pointReward !== undefined,
  };
}
