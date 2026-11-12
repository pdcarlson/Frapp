"use client";

import { forwardRef } from "react";
import { DateField } from "@/components/ui/date-field";

type DueDateFieldProps = Omit<
  React.ComponentProps<typeof DateField>,
  "lean" | "withTime" | "error"
> & {
  /** The form was submitted without a due date: say so under the field. */
  missing?: boolean;
};

/**
 * A task's due date on web (#3928): the shared {@link DateField} leaning
 * ahead, with a time of day the way Todoist reads one, `Fri 5pm` (#4003).
 * The value is what `dueEntryFields` turns into `POST /v1/tasks`'s fields.
 * What this adds is the task form's message for a submit with no readable
 * date.
 */
export const DueDateField = forwardRef<HTMLInputElement, DueDateFieldProps>(
  function DueDateField({ missing, ...props }, ref) {
    return (
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
            : null
        }
      />
    );
  },
);
