"use client";

import { forwardRef } from "react";
import { dueTimePassed, splitDueEntry } from "@repo/formatting";
import { DateField } from "@/components/ui/date-field";
import { DueTimeControl } from "./due-time-control";

type DueDateFieldProps = Omit<
  React.ComponentProps<typeof DateField>,
  "lean" | "withTime" | "error"
> & {
  /** The form was submitted without a due date: say so under the field. */
  missing?: boolean;
  /** The form was submitted with a time already gone by (`dueEntryPassed`). */
  passed?: boolean;
  /** The time field's class, to match the form's other fields. */
  timeClassName?: string;
};

/**
 * A task's due date on web (#3928): the shared {@link DateField} leaning
 * ahead, with an optional time of day (#4003). The time can be typed the way
 * Todoist reads one, `Fri 5pm`, or set with the "Add a time" control under
 * the date (#4512), the phone's control on web. The value is what
 * `dueEntryFields` turns into `POST /v1/tasks`'s fields. What this adds is
 * the time control and the task form's messages for a submit with no
 * readable date or a time already gone by.
 */
export const DueDateField = forwardRef<HTMLInputElement, DueDateFieldProps>(
  function DueDateField({ missing, passed, timeClassName, ...props }, ref) {
    return (
      <div className="grid gap-1">
        <div>
          <DateField
            {...props}
            ref={ref}
            lean="ahead"
            withTime
            error={(typed) =>
              missing && !props.value
                ? typed.trim() === ""
                  ? "Pick a due date."
                  : "Try a date like November 14 or Friday, with a time if it has one, like Friday 5pm."
                : passed
                  ? "That time has already passed. Pick a later time or another day."
                  : null
            }
          />
        </div>
        <DueTimeControl
          value={props.value}
          onChange={props.onChange}
          className={timeClassName}
          disabled={props.disabled}
          now={props.now}
        />
      </div>
    );
  },
);

/**
 * True when a due entry's time has already gone by today, so the task would
 * be overdue the moment it's saved. `kept` is an edit's stored entry: a task
 * keeps its own time even once that has passed (#4296).
 */
export function dueEntryPassed(
  entry: string,
  now: Date = new Date(),
  kept?: string,
): boolean {
  return dueTimePassed(
    splitDueEntry(entry),
    now,
    kept === undefined ? undefined : splitDueEntry(kept),
  );
}
