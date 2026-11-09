"use client";

import { forwardRef, useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { formatDueEntry, parseDueEntry } from "./due-entry";

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
 * further out. `due-entry.ts` owns what is read.
 *
 * It replaced the browser's date input, which shows and asks for a full
 * `MM/DD/YYYY`. The quick entry is how Todoist, Linear and Asana take a due
 * date; mobile's New task sheet gets there with preset chips and the
 * platform's picker instead.
 *
 * The parent holds the date, updated on every keystroke so Enter submits what
 * is typed. While the text differs from the date it was read as, that reading
 * shows under the field ("Sat, Nov 14", with the year when it is not this
 * one); leaving the field writes it into the field.
 */
export const DueDateField = forwardRef<HTMLInputElement, DueDateFieldProps>(
  function DueDateField(
    {
      value,
      onChange,
      missing,
      now,
      onBlur,
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
    const [touched, setTouched] = useState(false);
    // The parent moved the date without the member typing it (a reset after a
    // create, a prefill): show that date. A change the typing itself caused
    // already matches the text and leaves it alone.
    const [seen, setSeen] = useState(value);
    if (value !== seen) {
      setSeen(value);
      if (value !== (parseDueEntry(text, at) ?? "")) {
        setText(value ? formatDueEntry(value, at) : "");
        setTouched(false);
      }
    }

    const shown = value ? formatDueEntry(value, at) : "";
    const unread = text.trim() !== "" && !value;
    const error = unread
      ? touched || missing
        ? "Try a date like Nov 14 or 11/14, or a day like Friday."
        : null
      : missing && !value
        ? "Pick a due date."
        : null;
    const reading = !error && value && text !== shown ? shown : null;

    return (
      <>
        <Input
          {...inputProps}
          ref={ref}
          type="text"
          inputMode="text"
          autoComplete="off"
          value={text}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            [describedBy, error || reading ? noteId : null]
              .filter(Boolean)
              .join(" ") || undefined
          }
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            setTouched(false);
            onChange(parseDueEntry(next, at) ?? "");
          }}
          onBlur={(event) => {
            setTouched(true);
            if (value) setText(shown);
            onBlur?.(event);
          }}
        />
        {error ? (
          <p
            id={noteId}
            role="alert"
            className="mt-1 text-caption text-destructive-text"
          >
            {error}
          </p>
        ) : reading ? (
          <p id={noteId} className="mt-1 text-caption text-muted-foreground">
            {reading}
          </p>
        ) : null}
      </>
    );
  },
);
