"use client";

import { Clock, X } from "lucide-react";
import {
  formatDueTimeLabel,
  localIsoDate,
  splitDueEntry,
  suggestedDueTime,
} from "@repo/formatting";
import { Button } from "@/components/ui/button";
import { FOCUS_RING } from "@/components/ui/focus";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * A task's optional time of day on web (#4512), the phone's `DueTimeField`
 * (#4003) in a browser: most tasks are due by a day, so it starts as a quiet
 * "Add a time" line rather than a field every task has to answer. Pressing it
 * gives the task a time, starting where the phone starts (`suggestedDueTime`),
 * and the browser's time field then sits beside a button that takes the time
 * off again, the way Todoist's and Google Tasks' date pickers carry an
 * optional time.
 *
 * It reads and writes the same due entry the date field holds
 * (`YYYY-MM-DD`, `YYYY-MM-DDTHH:MM` with a time), so a time typed into the date
 * field, `Fri 5pm`, shows here too.
 */
export function DueTimeControl({
  value,
  onChange,
  className,
  disabled,
  label = "Due time",
  now,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
  /** The time field's name; a list of rows names each for its task. */
  label?: string;
  /** For specs; the control reads the clock otherwise. */
  now?: Date;
}) {
  const { dueDate, dueTime } = splitDueEntry(value);

  if (!dueTime) {
    return (
      // Drawn like the form's "Add subtasks" line beside it: a quiet row, not
      // a button every task has to answer.
      <button
        type="button"
        disabled={disabled}
        className={cn(
          "flex min-h-9 items-center gap-2 justify-self-start rounded-md px-1 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50",
          FOCUS_RING,
        )}
        onClick={() => {
          const at = now ?? new Date();
          // A time needs a day: with none picked yet, it's today's.
          const day = dueDate || localIsoDate(at);
          onChange(`${day}T${suggestedDueTime(day, at)}`);
        }}
      >
        <Clock className="size-4" aria-hidden="true" />
        Add a time
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Input
        type="time"
        aria-label={label}
        title={formatDueTimeLabel(dueTime)}
        className={cn("min-w-0 flex-1", className)}
        disabled={disabled}
        value={dueTime}
        onChange={(event) => {
          const next = event.target.value;
          // Empty while a part of the time is being retyped: holding the last
          // whole time keeps the field in place. The button takes it off.
          if (next) onChange(`${dueDate}T${next}`);
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Remove the time"
        disabled={disabled}
        className="text-muted-foreground"
        onClick={() => onChange(dueDate)}
      >
        <X aria-hidden />
      </Button>
    </div>
  );
}
