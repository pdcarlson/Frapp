"use client";

import { useMemo } from "react";
import { taskNeedsSignOff } from "@repo/validation";
import {
  TASK_CONFIRMED_LABEL,
  TASK_DONE_LABEL,
  TASK_NEEDS_CHANGES_LABEL,
  TASK_STATUS_LABELS,
} from "./task-card";
import type { CalendarBirthday } from "./calendar-birthdays";
import { useTasks } from "./use-tasks";
import { useViewerUserId } from "./use-user";

/**
 * Tasks on the Events calendar (#4144): the viewer's own tasks on their due
 * day, and the tasks the viewer assigned to others, each with where it
 * stands. Web's and mobile's calendars both draw from this, and so can the
 * Activity page if it grows a calendar view, so the rules live once.
 *
 * Fed by `GET /v1/tasks`, which already returns exactly what the calendar
 * may show: a member gets only their own rows, and a `tasks:manage` holder
 * (the only role that can assign) gets the chapter's whole set, from which
 * the rows they created are theirs to follow. No new endpoint.
 *
 * A due date is a calendar date (`tasks.due_date` is a `date` column), so a
 * task sits on that day for every viewer, with no time zone shift. Every
 * task has one: the column is `NOT NULL`, so there is no "no due date" case.
 */

/**
 * Where a task stands, as the calendar marks it. `waiting` is the
 * assignee's half done ("Waiting on an officer"); `confirmed` is an officer
 * having signed it off.
 */
export type CalendarTaskState = "open" | "overdue" | "waiting" | "confirmed";

/** Which kinds of thing the calendar is showing. */
export type CalendarLayer = "events" | "mine" | "assigned" | "birthdays";

export const CALENDAR_LAYERS: ReadonlyArray<{
  value: CalendarLayer;
  label: string;
}> = [
  { value: "events", label: "Events" },
  { value: "mine", label: "My tasks" },
  { value: "assigned", label: "Assigned by me" },
  // Members' shared birthdays (#4959, `calendar-birthdays.ts`).
  { value: "birthdays", label: "Birthdays" },
];

export const ALL_CALENDAR_LAYERS: ReadonlySet<CalendarLayer> = new Set(
  CALENDAR_LAYERS.map((layer) => layer.value),
);

/**
 * Layers added after the stored list was a list of what's shown: a list saved
 * before one existed can't name it, so it reads as on (#4959).
 */
const LAYERS_ADDED_SINCE_SHOWN_LISTS: readonly CalendarLayer[] = ["birthdays"];

/**
 * Reads the stored layer choice back as the layers to show, keeping only
 * names it knows; `null` when nothing (or nothing readable) is stored.
 *
 * Stored as `{ "hidden": [...] }` since #4959, so a layer added later starts
 * on for everyone, as a new calendar does in Google Calendar. A bare array is
 * the older form, the shown layers, and gains the layers added since.
 */
export function parseCalendarLayers(
  raw: string | null | undefined,
): Set<CalendarLayer> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const shown = new Set(knownLayers(parsed));
      for (const layer of LAYERS_ADDED_SINCE_SHOWN_LISTS) shown.add(layer);
      return shown;
    }
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as { hidden?: unknown }).hidden)
    ) {
      const hidden = new Set(
        knownLayers((parsed as { hidden: unknown[] }).hidden),
      );
      return new Set(
        [...ALL_CALENDAR_LAYERS].filter((layer) => !hidden.has(layer)),
      );
    }
    return null;
  } catch {
    return null;
  }
}

/** The stored form of `shown`: the layers it hides. */
export function serializeCalendarLayers(
  shown: ReadonlySet<CalendarLayer>,
): string {
  return JSON.stringify({
    hidden: [...ALL_CALENDAR_LAYERS].filter((layer) => !shown.has(layer)),
  });
}

function knownLayers(values: unknown[]): CalendarLayer[] {
  return values.filter((value): value is CalendarLayer =>
    ALL_CALENDAR_LAYERS.has(value as CalendarLayer),
  );
}

export interface CalendarTaskAssignee {
  taskId: string;
  userId: string;
  state: CalendarTaskState;
  /** The shared task word for this assignee's copy ("To do", "Confirmed"). */
  label: string;
}

interface CalendarTaskBase {
  /** Unique across the calendar. */
  key: string;
  title: string;
  /** The due day, `YYYY-MM-DD`, the same key the calendar files events by. */
  day: string;
  state: CalendarTaskState;
}

/** A task assigned to the viewer. */
export interface CalendarOwnTask extends CalendarTaskBase {
  kind: "mine";
  taskId: string;
  /** The shared task word for its status. */
  label: string;
  createdBy: string | null;
}

/**
 * Tasks the viewer assigned, one item per title and due day. An officer
 * hands the same task to a dozen members at once (each its own row), so a
 * day reads "Dues form, 4 of 12 done" rather than twelve identical lines.
 */
export interface CalendarAssignedTask extends CalendarTaskBase {
  kind: "assigned";
  assignees: CalendarTaskAssignee[];
  /** Assignees who have marked it done, confirmed or not. */
  doneCount: number;
  /** The short progress the row shows: the one assignee's word, or "4 of 12 done". */
  progress: string;
}

export type CalendarTask = CalendarOwnTask | CalendarAssignedTask;

/**
 * Anything on the calendar that isn't an event, filed by day: a task, or a
 * member's birthday (#4959). The day lists and the layer toggles take them
 * together, so every view that draws a task draws a birthday beside it.
 */
export type CalendarItem = CalendarTask | CalendarBirthday;

function str(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * A row's state from what the server renders. `status` is the display
 * status (the server synthesizes `OVERDUE`); a confirm leaves it at
 * `COMPLETED` and sets `points_awarded` / `confirmed_at`.
 */
function calendarTaskState(row: Record<string, unknown>): {
  state: CalendarTaskState;
  label: string;
} | null {
  const status = str(row, "status");
  if (status === "COMPLETED") {
    const confirmed =
      row.points_awarded === true || str(row, "confirmed_at") !== null;
    // No points and no proof: Done as marked, no sign-off (#4635).
    const kind = str(row, "proof_kind");
    const done =
      kind !== null &&
      !taskNeedsSignOff({
        point_reward:
          typeof row.point_reward === "number" ? row.point_reward : null,
        proof_kind: kind,
      });
    return confirmed
      ? {
          state: "confirmed",
          label: done ? TASK_DONE_LABEL : TASK_CONFIRMED_LABEL,
        }
      : { state: "waiting", label: TASK_STATUS_LABELS.COMPLETED };
  }
  if (status === "OVERDUE") {
    return { state: "overdue", label: TASK_STATUS_LABELS.OVERDUE };
  }
  if (status === "TODO" || status === "IN_PROGRESS") {
    // A sent-back task reads Needs changes here too (#4635).
    return {
      state: "open",
      label:
        status === "IN_PROGRESS" && str(row, "sent_back_at") !== null
          ? TASK_NEEDS_CHANGES_LABEL
          : TASK_STATUS_LABELS[status],
    };
  }
  return null;
}

const STATE_ORDER: Record<CalendarTaskState, number> = {
  overdue: 0,
  open: 1,
  waiting: 2,
  confirmed: 3,
};

/** A group's state: the one most in need of attention among its assignees. */
function groupState(assignees: CalendarTaskAssignee[]): CalendarTaskState {
  let worst: CalendarTaskState = "confirmed";
  for (const assignee of assignees) {
    if (STATE_ORDER[assignee.state] < STATE_ORDER[worst]) {
      worst = assignee.state;
    }
  }
  return worst;
}

/**
 * The calendar's tasks from a `GET /v1/tasks` body. A row that can't be
 * drawn honestly (no id, title, due date or known status) is dropped. A task
 * an officer assigned to themselves is theirs, so it shows once, as theirs.
 */
export function selectCalendarTasks(
  body: unknown,
  viewerUserId: string | null,
): CalendarTask[] {
  if (!viewerUserId || !Array.isArray(body)) return [];
  const items: CalendarTask[] = [];
  const groups = new Map<string, CalendarAssignedTask>();

  for (const value of body) {
    if (!value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    const id = str(row, "id");
    const title = str(row, "title");
    const due = str(row, "due_date");
    const assigneeId = str(row, "assignee_id");
    const createdBy = str(row, "created_by");
    const status = calendarTaskState(row);
    if (!id || !title || !due || !status || !assigneeId) continue;
    const day = due.slice(0, 10);

    if (assigneeId === viewerUserId) {
      items.push({
        kind: "mine",
        key: `task:${id}`,
        taskId: id,
        title,
        day,
        state: status.state,
        label: status.label,
        createdBy,
      });
      continue;
    }
    if (createdBy !== viewerUserId) continue;

    const groupKey = `${day}\u0000${title.trim().toLowerCase()}`;
    let group = groups.get(groupKey);
    if (!group) {
      group = {
        kind: "assigned",
        key: `assigned:${day}:${id}`,
        title,
        day,
        state: "confirmed",
        assignees: [],
        doneCount: 0,
        progress: "",
      };
      groups.set(groupKey, group);
      items.push(group);
    }
    group.assignees.push({
      taskId: id,
      userId: assigneeId,
      state: status.state,
      label: status.label,
    });
  }

  for (const group of groups.values()) {
    group.assignees.sort(
      (first, second) => STATE_ORDER[first.state] - STATE_ORDER[second.state],
    );
    group.state = groupState(group.assignees);
    group.doneCount = group.assignees.filter(
      (assignee) =>
        assignee.state === "waiting" || assignee.state === "confirmed",
    ).length;
    group.progress =
      group.assignees.length === 1
        ? group.assignees[0]!.label
        : `${group.doneCount} of ${group.assignees.length} done`;
  }

  return items;
}

/**
 * A day's birthdays first, all-day as Google Calendar lists them, then the
 * viewer's own tasks, then what they assigned.
 */
const KIND_ORDER: Record<CalendarItem["kind"], number> = {
  birthdays: 0,
  mine: 1,
  assigned: 2,
};

function itemStateOrder(item: CalendarItem): number {
  return item.kind === "birthdays" ? 0 : STATE_ORDER[item.state];
}

/**
 * The items shown, by day, in the order a day lists them: birthdays, then
 * the viewer's own tasks before what they assigned, each most in need of
 * attention first (overdue, open, waiting, confirmed), then by title.
 */
export function calendarTasksByDay(
  items: readonly CalendarItem[],
  layers: ReadonlySet<CalendarLayer>,
): Map<string, CalendarItem[]> {
  const map = new Map<string, CalendarItem[]>();
  for (const item of items) {
    if (!layers.has(item.kind)) continue;
    const bucket = map.get(item.day);
    if (bucket) bucket.push(item);
    else map.set(item.day, [item]);
  }
  for (const bucket of map.values()) {
    bucket.sort(
      (first, second) =>
        KIND_ORDER[first.kind] - KIND_ORDER[second.kind] ||
        itemStateOrder(first) - itemStateOrder(second) ||
        first.title.localeCompare(second.title),
    );
  }
  return map;
}

/**
 * The words a task item says to a screen reader, and on web as its title:
 * "Dues form, your task, overdue" / "Dues form, assigned by you, 4 of 12 done".
 */
export function calendarTaskAccessibleLabel(item: CalendarTask): string {
  return item.kind === "mine"
    ? `${item.title}, your task, ${item.label.toLowerCase()}`
    : `${item.title}, assigned by you, ${item.progress.toLowerCase()}`;
}

/** What the layer toggles can offer: a kind with nothing in it is not shown. */
export interface CalendarTasksResult {
  items: CalendarTask[];
  hasMine: boolean;
  hasAssigned: boolean;
}

/** The calendar's tasks for the signed-in member, from the shared tasks query. */
export function useCalendarTasks(): CalendarTasksResult {
  const tasksQuery = useTasks();
  const viewerUserId = useViewerUserId();
  return useMemo(() => {
    const items = selectCalendarTasks(tasksQuery.data, viewerUserId);
    return {
      items,
      hasMine: items.some((item) => item.kind === "mine"),
      hasAssigned: items.some((item) => item.kind === "assigned"),
    };
  }, [tasksQuery.data, viewerUserId]);
}
