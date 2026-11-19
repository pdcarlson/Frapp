"use client";

import { forwardRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import {
  dueTimePassed,
  formatDateEntry,
  splitDueEntry,
} from "@repo/formatting";
import { DateField } from "@/components/ui/date-field";
import { FOCUS_RING } from "@/components/ui/focus";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { DueTimeControl } from "./due-time-control";
import { propertyChipClass } from "./property-chip";

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
  /**
   * A date with no time of day (a meeting's action item): no "Add a time",
   * and a typed time is not read.
   */
  withoutTime?: boolean;
  /** The time field's name, where several due fields share a screen. */
  timeLabel?: string;
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
  function DueDateField(
    {
      missing,
      passed,
      timeClassName,
      timeLabel,
      withoutTime = false,
      ...props
    },
    ref,
  ) {
    return (
      <div className="grid gap-1">
        <div>
          <DateField
            {...props}
            ref={ref}
            lean="ahead"
            withTime={!withoutTime}
            error={(typed) =>
              missing && !props.value
                ? typed.trim() === ""
                  ? "Pick a due date."
                  : withoutTime
                    ? "Try a date like November 14 or Friday."
                    : "Try a date like November 14 or Friday, with a time if it has one, like Friday 5pm."
                : passed
                  ? "That time has already passed. Pick a later time or another day."
                  : null
            }
          />
        </div>
        {withoutTime ? null : (
          <DueTimeControl
            value={props.value}
            onChange={props.onChange}
            className={timeClassName}
            label={timeLabel}
            disabled={props.disabled}
            now={props.now}
          />
        )}
      </div>
    );
  },
);

/**
 * A due date drawn as a property chip, "Wednesday · 5 PM", that opens the
 * due field (the date, its month, and Add a time) in a popover: a suggested
 * task's card (#5562; Paul, 2026-11-19), where full fields read as a form to
 * fill in. `note` says inside the popover why a guessed day was picked, so
 * nothing hangs under the chip.
 */
export function DueChip({
  value,
  onChange,
  label,
  timeLabel,
  placeholder = "When?",
  guessed = false,
  missing = false,
  passed = false,
  note,
  disabled,
  now,
}: {
  value: string;
  onChange: (value: string) => void;
  /** The chip's accessible name, "Due date for Book the venue". */
  label: string;
  timeLabel?: string;
  placeholder?: string;
  guessed?: boolean;
  missing?: boolean;
  passed?: boolean;
  note?: string | null;
  disabled?: boolean;
  now?: Date;
}) {
  const [open, setOpen] = useState(false);
  const shown = value ? formatDateEntry(value, now ?? new Date()) : null;
  const problem = (missing && !value) || passed;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={
            shown
              ? `${label}: ${shown}${guessed && note ? `. ${note}` : ""}`
              : label
          }
          title={guessed && note ? note : undefined}
          aria-invalid={problem || undefined}
          className={cn(
            propertyChipClass({
              guessed: guessed && !!value && !problem,
              missing: problem,
              empty: !value,
            }),
            FOCUS_RING,
          )}
        >
          <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{shown ?? placeholder}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={12}
        className="w-[min(18rem,calc(100vw-1.5rem))] space-y-2 p-3"
      >
        <DueDateField
          aria-label={label}
          timeLabel={timeLabel}
          placeholder="Due: Fri 5pm"
          missing={missing}
          passed={passed}
          value={value}
          onChange={onChange}
          disabled={disabled}
          now={now}
        />
        {note && !problem ? (
          <p className="text-caption text-muted-foreground">{note}</p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

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
