/**
 * Up for grabs on the phone's Tasks screen (Paul, 2026-11-18, the Tasks
 * overhaul § 3): open tasks a member in the right set may claim, often for
 * points. Pure, so the screen only composes; the reads and the optimistic
 * claim live in `@repo/hooks` (`use-open-tasks.ts`).
 */

import { statusOf } from "@repo/api-sdk";
import { formatDueLabel, formatPoints } from "@repo/formatting";
import type { OpenTask } from "@repo/hooks";
import { openTaskScopeLabel, TASK_AUDIENCE_COPY } from "@repo/validation";

/**
 * The postings the board shows: open ones only, oldest due first as the
 * server sends them. A `tasks:manage` officer is served every open posting
 * (so they can hand one over or take it down), the rest only the ones they
 * may claim; `hidden` drops ones a claim just lost (a 409) while the list
 * reads again.
 */
export function selectOpenTasks(
  data: readonly OpenTask[] | undefined,
  hidden: ReadonlySet<string> = new Set(),
): OpenTask[] {
  return (data ?? []).filter(
    (posting) => posting.status === "open" && !hidden.has(posting.id),
  );
}

/** The posting's due, as the board's rows say it: "Due Friday". */
export function openTaskDue(posting: OpenTask, now: Date): string | null {
  return formatDueLabel(posting.due_at ?? posting.due_date, now);
}

/**
 * The line under a posting's title: "10 points · Philanthropy Committee · Due
 * Friday". The role or group is named for a posting narrowed to one, as the
 * reason this member is seeing it; one open to the chapter, or to people
 * picked by name, needs no such word on a row the member already sees.
 */
export function openTaskLine(posting: OpenTask, now: Date): string {
  return [
    posting.point_reward ? formatPoints(posting.point_reward) : null,
    (posting.scope === "role" || posting.scope === "group") &&
    posting.scope_name
      ? posting.scope_name
      : null,
    openTaskDue(posting, now),
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Who may claim it, in full, for its sheet: "Anyone in the chapter",
 * "Someone in Philanthropy Committee", "One of Sam, Alex and 3 others".
 */
export function openTaskWho(
  posting: OpenTask,
  nameOf: (userId: string) => string,
): string {
  return openTaskScopeLabel(
    posting,
    posting.scope === "people"
      ? (posting.scope_user_ids ?? []).map(
          (userId) => nameOf(userId).split(/\s+/)[0] ?? nameOf(userId),
        )
      : undefined,
  );
}

/** The toast after a claim lands: "It's yours. Due Saturday." */
export function claimedLine(posting: OpenTask, now: Date): string {
  const due = openTaskDue(posting, now);
  return due ? `It's yours. ${due}.` : "It's yours.";
}

/** Whether a claim lost to another member's (the API's 409). */
export function claimLost(error: unknown): boolean {
  return statusOf(error) === 409;
}

/** The new task's id, off a claim's or an assignment's answer. */
export function claimedTaskId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const id = (data as { id?: unknown }).id;
  return typeof id === "string" ? id : null;
}

/**
 * Said once Give it back lands, as the board's line under its points card:
 * from the board's own toast, and from the task's screen, which returns to
 * the board with {@link RELEASED_PARAM} so the line shows there (and
 * announces it before it goes).
 */
export const RELEASED_LINE = `It's back on ${TASK_AUDIENCE_COPY.upForGrabs}.`;

/** `/tasks?released=1`: the task screen's Give it back landed. */
export const RELEASED_PARAM = "released";

/** Said when Give it back didn't land. */
export const RELEASE_FAILED = "Couldn't give that task back. Try again.";
