"use client";

import { Repeat } from "lucide-react";
import {
  taskFirstDue,
  taskSeriesLine,
  type TaskSeriesLine,
} from "@repo/validation";

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
    taskFirstDue(task.due_date) ?? (task.due_at ? new Date(task.due_at) : null);
  const line = due ? taskSeriesLine(task.series, due, { next }) : null;
  if (!line) return null;
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <Repeat className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{line}</span>
    </span>
  );
}
