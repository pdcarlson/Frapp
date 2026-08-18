/**
 * Draft state and validation for the s19 "New task" sheet.
 *
 * ## Why the rules live here and not in `@repo/validation`
 *
 * That package carries no task schema — `"task"` appears in it only as a chat
 * message kind and `"tasks"` as a notification category. `CreateTaskDto`
 * (`apps/api/src/interface/dtos/task.dto.ts`) is the authority, and the web task
 * form does not share a schema either. Adding one to a shared package for a
 * single caller would create a second authority to keep in sync; these copies
 * exist only so the sheet can disable its own CTA rather than post a request it
 * knows will 400. Same relationship `CHECK_IN_GRACE_MINUTES` has to the
 * attendance service.
 *
 * ## Why the due date is presets and not a picker
 *
 * `apps/mobile` has no date-picker dependency, and `package.json` is frozen
 * under #937's hotspot protocol — adding one is an integrator PR that this slice
 * would then have to wait behind. Expo Go is the only run path
 * (`spec/ui/mobile/README.md`) and this app is on SDK 57, so a picker's Go
 * compatibility could not be verified here anyway. C4 made exactly this call one
 * cluster ago when `service-hours.tsx` dropped the drawn proof-upload rather
 * than take a file-picker dependency.
 *
 * TODO-DESIGN: `canvas-screens.dc.html` s19 draws a single free date field
 * ("Fri, Aug 21"); these presets cannot express a date beyond next week. Nearest
 * pattern used: the existing `FilterChips` selection row. Restore the drawn
 * field once an integrator lands a picker.
 */

import { POINTS_MAX, TITLE_MAX_LENGTH } from "./limits";

export interface NewTaskDraft {
  title: string;
  /** `YYYY-MM-DD`, device-local. */
  dueDate: string;
  assigneeId: string | null;
  /** Raw keypad text, so a half-typed value is not silently coerced. */
  pointsInput: string;
}

export interface DuePreset {
  id: string;
  label: string;
  /** `YYYY-MM-DD`, device-local. */
  date: string;
}

/**
 * Today as `YYYY-MM-DD` in the device's own zone.
 *
 * Deliberately not `toISOString().slice(0, 10)`, which is UTC: at 9pm PDT that
 * returns tomorrow, so a member choosing "Today" would file a task due the next
 * day. Identical to `todayIsoDate` in `lib/more/service-hours.ts`.
 */
export function localIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** `now` plus `days`, as a local date. Month and year rollover is `Date`'s job. */
function addDays(now: Date, days: number): Date {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  next.setDate(next.getDate() + days);
  return next;
}

/**
 * The four due-date choices the sheet offers.
 *
 * "This Friday" is dropped when today *is* Friday or the weekend, because it
 * would either duplicate "Today" or point backwards — the row shows three chips
 * then rather than one that lies.
 */
export function duePresets(now: Date): DuePreset[] {
  const presets: DuePreset[] = [
    { id: "today", label: "Today", date: localIsoDate(now) },
    { id: "tomorrow", label: "Tomorrow", date: localIsoDate(addDays(now, 1)) },
  ];

  // 5 = Friday. `getDay()` is Sunday-indexed.
  const daysToFriday = (5 - now.getDay() + 7) % 7;
  if (daysToFriday > 1) {
    presets.push({
      id: "friday",
      label: "Friday",
      date: localIsoDate(addDays(now, daysToFriday)),
    });
  }

  presets.push({
    id: "next-week",
    label: "Next week",
    date: localIsoDate(addDays(now, 7)),
  });

  return presets;
}

/**
 * The drawn date-field label — "Fri, Aug 21".
 *
 * Parsed at UTC noon so a bare `YYYY-MM-DD` does not render as the previous day
 * west of Greenwich, the same fix `lib/more/service-hours.ts` documents.
 */
export function formatDueFieldLabel(isoDate: string): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * The keypad's text as a point reward.
 *
 * Three outcomes, not two: `"omit"` for a blank field (the reward is optional
 * and the drawn LATER row carries no chip), a value, or `"invalid"`. Collapsing
 * blank into invalid would leave the CTA disabled on the common case of not
 * offering points at all.
 */
export type PointsParse =
  | { kind: "omit" }
  | { kind: "value"; points: number }
  | { kind: "invalid" };

export function parsePointReward(value: string): PointsParse {
  const trimmed = value.trim();
  if (trimmed.length === 0) return { kind: "omit" };
  if (!/^\d{1,6}$/.test(trimmed)) return { kind: "invalid" };
  const points = Number(trimmed);
  if (!Number.isInteger(points) || points < 0 || points > POINTS_MAX) {
    return { kind: "invalid" };
  }
  return { kind: "value", points };
}

export interface ValidatedNewTask {
  title: string;
  assignee_id: string;
  due_date: string;
  point_reward?: number;
}

/**
 * The draft as a request body, or `null` while it is not yet postable.
 *
 * Mirrors `CreateTaskDto`: title non-empty and ≤ 255, `assignee_id` a member id,
 * `due_date` a `YYYY-MM-DD`, `point_reward` an optional integer in
 * `0 … POINTS_ADJUSTMENT_MAX`. The assignee comes from the roster picker, so
 * only its presence is checked here — the server re-validates chapter
 * membership regardless.
 */
export function validateNewTask(draft: NewTaskDraft): ValidatedNewTask | null {
  const title = draft.title.trim();
  if (title.length === 0 || title.length > TITLE_MAX_LENGTH) return null;
  if (!draft.assigneeId) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.dueDate)) return null;

  const points = parsePointReward(draft.pointsInput);
  if (points.kind === "invalid") return null;

  const body: ValidatedNewTask = {
    title,
    assignee_id: draft.assigneeId,
    due_date: draft.dueDate,
  };
  if (points.kind === "value") body.point_reward = points.points;
  return body;
}
