/**
 * Who a task is for when it isn't one person (#4295 step 3; Paul, 2026-11-17:
 * "can we make tasks assignable to everyone?", and he picked "one group task,
 * a copy each"). `spec/behavior/tasks.md` § Tasks for everyone.
 *
 * `everyone` is the chapter's active members, alumni left out
 * (`spec/behavior/alumni.md`): each gets their own copy of the task, with its
 * own progress, proof and points, and the board shows the group as one tile,
 * "14 of 20 done". Sent as `audience` on `POST /v1/tasks` in place of
 * `assignee_id`, and on a suggested task's payload beside it.
 */
export const TASK_AUDIENCE_EVERYONE = "everyone";

export const TASK_AUDIENCES = [TASK_AUDIENCE_EVERYONE] as const;

export type TaskAudience = (typeof TASK_AUDIENCES)[number];

/** Whether a value is one of {@link TASK_AUDIENCES}. */
export function isTaskAudience(value: unknown): value is TaskAudience {
  return (
    typeof value === "string" &&
    (TASK_AUDIENCES as readonly string[]).includes(value)
  );
}

/** The words every surface uses for a group task. */
export const TASK_AUDIENCE_COPY = {
  /** The option in a Who or Assignee picker, and a group tile's who. */
  everyone: "Everyone",
  /** Under the picker once Everyone is chosen. */
  everyoneHint: (count: number | null) =>
    count === null
      ? "Each active member gets their own copy."
      : count === 1
        ? "1 active member gets their own copy."
        : `Each of ${count} active members gets their own copy.`,
  /** A group tile's progress line: "14 of 20 done". */
  progress: (done: number, total: number) => `${done} of ${total} done`,
  /** Why a group task can't repeat or carry photos yet. */
  noRepeat: "A task for everyone can't repeat yet.",
  noPhotos: "A task for everyone can't carry photos yet.",
  /** The edit and delete scopes on a group copy. */
  thisMemberOnly: "This member only",
  everyonesCopy: "Everyone's copy",
} as const;

/**
 * How far along a group task is (#4295 step 3), counted over its copies.
 * `done` counts every copy whose member has marked it done, confirmed or
 * still waiting on an officer; `confirmed` only the ones an officer signed
 * off (or that needed no sign-off).
 */
export interface TaskGroupProgress {
  total: number;
  done: number;
  confirmed: number;
}
