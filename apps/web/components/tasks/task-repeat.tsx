"use client";

import { Repeat } from "lucide-react";
import { dueEntryFields } from "@repo/formatting";
import { taskSeriesLine, type TaskSeriesLine } from "@repo/validation";

/**
 * The moment a task typed as a due entry ("YYYY-MM-DD" or with a time,
 * `dueEntryFields`) is due, for its Repeat control (#5119): the weekday and
 * day of the month it defaults to. An untimed day reads at local noon, so
 * its weekday is the one the officer picked in any zone. `null` until the
 * entry reads as a day.
 */
export function firstDueOf(entry: string): Date | null {
  if (!entry) return null;
  const { due_date, due_at } = dueEntryFields(entry);
  const at = due_at
    ? new Date(due_at)
    : new Date(`${due_date.slice(0, 10)}T12:00:00`);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * How a copy of a repeating task repeats, on its tile's meta line: the ↻
 * glyph and "Every Monday", with "· next Nov 24" when `next` (#5119). Says
 * nothing for a task with no live series.
 */
export function TaskRepeatLine({
  task,
  next = false,
}: {
  task: {
    due_date: string;
    due_at?: string | null;
    series?: TaskSeriesLine | null;
  };
  next?: boolean;
}) {
  const due =
    firstDueOf(task.due_date) ?? (task.due_at ? new Date(task.due_at) : null);
  const line = due ? taskSeriesLine(task.series, due, { next }) : null;
  if (!line) return null;
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <Repeat className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{line}</span>
    </span>
  );
}
