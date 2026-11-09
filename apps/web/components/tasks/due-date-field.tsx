"use client";

import { forwardRef, useId, useState } from "react";
import { formatDueEntry, parseDueEntry } from "@repo/formatting";
import { Input } from "@/components/ui/input";

type DueDateFieldProps = Omit<
  React.ComponentProps<"input">,
  "value" | "onChange" | "type"
> & {
  /** `YYYY-MM-DD`, or `""` while nothing readable is typed. */
  value: string;
  onChange: (isoDate: string) => void;
  /** The form was submitted without a due date: say so under the field. */
  missing?: boolean;
  /** For specs; the field reads the clock otherwise. */
  now?: Date;
};

/**
 * A task's due date on web (#3928): type a month and a day, `Nov 14` or
 * `11/14`, or a word like `Friday` or `tomorrow`, and the year is filled in
 * as the next time that date comes round. A year is typed only for a date
 * further out. `parseDueEntry` in `@repo/formatting` owns what is read, and
 * the chat `/task` command reads its date the same way.
 *
 * It replaced the browser's date input, which shows and asks for a full
 * `MM/DD/YYYY`. The quick entry is how Todoist, Linear and Asana take a due
 * date; mobile's New task sheet gets there with preset chips and the
 * platform's picker instead.
 *
 * The parent holds the date, updated on every keystroke so Enter submits what
 * is typed. While the text differs from the date it was read as, that reading
 * floats just under the field ("Sat, Nov 14", or "Mar 14, 2027" when it is
 * not an upcoming day this year); leaving the field writes it in.
 *
 * Nothing under the field appears or goes on blur. A line that did would move
 * the form's buttons between a click's press and its release, and the click
 * would miss (the reading was such a line until review caught it). So the
 * reading is laid over the form, taking no room in it (the Add a task row's
 * field is too narrow to hold it beside the text), and the one message that
 * does take room, for a submit with no readable date, comes and goes with a
 * submit or a keystroke.
 */
export const DueDateField = forwardRef<HTMLInputElement, DueDateFieldProps>(
  function DueDateField(
    {
      value,
      onChange,
      missing,
      now,
      onBlur,
      className,
      "aria-describedby": describedBy,
      ...inputProps
    },
    ref,
  ) {
    const at = now ?? new Date();
    const noteId = useId();
    const [text, setText] = useState(() =>
      value ? formatDueEntry(value, at) : "",
    );
    // The parent moved the date without the member typing it (a reset after a
    // create, a prefill): show that date. A change the typing itself caused
    // already matches the text and leaves it alone.
    const [seen, setSeen] = useState(value);
    if (value !== seen) {
      setSeen(value);
      if (value !== (parseDueEntry(text, at) ?? "")) {
        setText(value ? formatDueEntry(value, at) : "");
      }
    }

    const shown = value ? formatDueEntry(value, at) : "";
    const error =
      missing && !value
        ? text.trim() === ""
          ? "Pick a due date."
          : "Try a date like Nov 14 or 11/14, or a day like Friday."
        : null;
    const reading = value && text !== shown ? shown : null;

    return (
      <>
        <div className="relative">
          <Input
            {...inputProps}
            ref={ref}
            type="text"
            autoComplete="off"
            value={text}
            className={className}
            aria-invalid={error ? true : undefined}
            aria-describedby={
              [describedBy, error || reading ? noteId : null]
                .filter(Boolean)
                .join(" ") || undefined
            }
            onChange={(event) => {
              const next = event.target.value;
              setText(next);
              onChange(parseDueEntry(next, at) ?? "");
            }}
            onBlur={(event) => {
              if (value) setText(shown);
              onBlur?.(event);
            }}
          />
          {reading ? (
            <span
              id={noteId}
              className="pointer-events-none absolute left-0 top-full z-10 mt-1 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-caption text-foreground shadow-md"
            >
              {reading}
            </span>
          ) : null}
        </div>
        {error ? (
          <p
            id={noteId}
            role="alert"
            className="mt-1 text-caption text-destructive-text"
          >
            {error}
          </p>
        ) : null}
      </>
    );
  },
);
