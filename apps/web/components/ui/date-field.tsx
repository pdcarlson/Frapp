"use client";

import { forwardRef, useId, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  type DateLean,
  formatDateEntry,
  localIsoDate,
  parseBareDateLocalNoon,
  parseDateEntry,
  parseDateEntryWithTime,
} from "@repo/formatting";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type DateFieldProps = Omit<
  React.ComponentProps<"input">,
  "value" | "onChange" | "type"
> & {
  /**
   * `YYYY-MM-DD`, `YYYY-MM-DDTHH:MM` when `withTime` and a time was typed, or
   * `""` while nothing readable is typed.
   */
  value: string;
  onChange: (value: string) => void;
  /**
   * Which year a month and a day with none is read in (`DateLean` in
   * `@repo/formatting`): `ahead` for something coming up, `back` for
   * something that happened, `nearest` for either side of today.
   */
  lean?: DateLean;
  /** Read a time of day too, `Fri 5pm` (a task's due, #4003). */
  withTime?: boolean;
  /**
   * A message under the field, for a submit the field can't satisfy. A
   * function gets the text as typed, so the message can say how to write a
   * date when something unreadable was typed.
   */
  error?: string | null | ((typed: string) => string | null);
  /** For specs; the field reads the clock otherwise. */
  now?: Date;
};

/**
 * Every date a member enters on web (#3928, #3937): type a month and a day,
 * `Nov 14` or `11/14`, or a word like `Friday` or `yesterday`, and the year is
 * filled in from which way the field leans. A year is typed only for a date
 * further off. A click opens a month to pick from instead, the way Google
 * Calendar's date field does both.
 *
 * It replaced the browser's date input, which shows and asks for a full
 * `MM/DD/YYYY`. `parseDateEntry` and `formatDateEntry` in `@repo/formatting`
 * own what is read and how a held date is written (`Today`, `Friday`,
 * `November 14`, `March 14, 2027`), and the chat `/task` command reads its
 * date the same way.
 *
 * The parent holds the date, updated on every keystroke so Enter submits what
 * is typed. While the text differs from the date it was read as, that reading
 * heads the month under the field; leaving the field writes it in.
 *
 * Nothing under the field appears or goes on blur. A line that did would move
 * the form's buttons between a click's press and its release, and the click
 * would miss. So the month floats over the form, taking no room in it, and
 * the one message that does take room, `error`, comes and goes with the
 * caller's submit.
 */
export const DateField = forwardRef<HTMLInputElement, DateFieldProps>(
  function DateField(
    {
      value,
      onChange,
      lean = "ahead",
      withTime = false,
      error: errorFor,
      now,
      onBlur,
      onKeyDown,
      onPointerDown,
      className,
      disabled,
      "aria-describedby": describedBy,
      "aria-invalid": ariaInvalid,
      ...inputProps
    },
    ref,
  ) {
    const at = now ?? new Date();
    const noteId = useId();
    const errorId = useId();
    const anchorRef = useRef<HTMLDivElement>(null);
    const read = (text: string) =>
      withTime
        ? parseDateEntryWithTime(text, at, lean)
        : parseDateEntry(text, at, lean);
    const written = (entry: string) =>
      entry ? formatDateEntry(entry, at, lean) : "";

    const [text, setText] = useState(() => written(value));
    const [open, setOpen] = useState(false);
    const [focused, setFocused] = useState(false);
    // The parent moved the date without the member typing it (a reset after a
    // create, a prefill): show that date. A change the typing itself caused
    // already matches the text and leaves it alone.
    const [seen, setSeen] = useState(value);
    if (value !== seen) {
      setSeen(value);
      if (value !== (read(text) ?? "")) setText(written(value));
    }

    const [day = "", time] = value.split("T");
    const shown = written(value);
    const unreadable = text.trim() !== "" && !value;
    const reading = value && text !== shown ? fullDay(day, at) : null;
    const error = typeof errorFor === "function" ? errorFor(text) : errorFor;

    const pick = (picked: string) => {
      const next = withTime && time ? `${picked}T${time}` : picked;
      setText(written(next));
      setSeen(next);
      onChange(next);
      setOpen(false);
    };

    return (
      <>
        <Popover open={open && !disabled} onOpenChange={setOpen}>
          <PopoverAnchor asChild>
            <div ref={anchorRef} className="relative">
              <Input
                {...inputProps}
                ref={ref}
                type="text"
                autoComplete="off"
                aria-haspopup="grid"
                aria-expanded={open && !disabled}
                disabled={disabled}
                value={text}
                className={className}
                aria-invalid={
                  ariaInvalid ??
                  (error || (unreadable && !focused) ? true : undefined)
                }
                aria-describedby={
                  [describedBy, error ? errorId : null, reading ? noteId : null]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
                onPointerDown={(event) => {
                  setOpen(true);
                  onPointerDown?.(event);
                }}
                onFocus={(event) => {
                  setFocused(true);
                  inputProps.onFocus?.(event);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && open) {
                    event.stopPropagation();
                    setOpen(false);
                  }
                  if (event.key === "ArrowDown" && !open) setOpen(true);
                  onKeyDown?.(event);
                }}
                onChange={(event) => {
                  const next = event.target.value;
                  setText(next);
                  setOpen(true);
                  onChange(read(next) ?? "");
                }}
                onBlur={(event) => {
                  setFocused(false);
                  setOpen(false);
                  if (value) setText(shown);
                  onBlur?.(event);
                }}
              />
            </div>
          </PopoverAnchor>
          <PopoverContent
            align="start"
            className="w-auto p-3"
            // Not a dialog: focus stays in the field, so to assistive tech it
            // is the field's popup, a group named for what it does.
            role="group"
            aria-label="Pick a day"
            // The field keeps focus and the caret: the month is a helper for
            // the pointer, and typing goes on while it is open.
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => event.preventDefault()}
            onMouseDown={(event) => event.preventDefault()}
            onInteractOutside={(event) => {
              // A press back in the field is not "outside": it keeps typing.
              const target = event.target as Node | null;
              if (target && anchorRef.current?.contains(target)) {
                event.preventDefault();
              }
            }}
          >
            <MonthPicker
              key={day || "none"}
              selected={day}
              now={at}
              heading={
                reading ? (
                  <span id={noteId}>{reading}</span>
                ) : unreadable ? (
                  <span className="text-muted-foreground">
                    Try {lean === "back" ? "yesterday" : "Friday"}, November 14
                    or 11/14
                  </span>
                ) : null
              }
              onPick={pick}
            />
          </PopoverContent>
        </Popover>
        {error ? (
          <p
            id={errorId}
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

/** `Saturday, November 14, 2026`: what a typed date was read as, in full. */
function fullDay(isoDate: string, now: Date): string | null {
  const at = parseBareDateLocalNoon(isoDate);
  if (!at) return null;
  const weekday = WEEKDAY_NAMES[at.getDay()]!;
  const month = MONTH_NAMES[at.getMonth()]!;
  const year =
    at.getFullYear() === now.getFullYear() ? "" : `, ${at.getFullYear()}`;
  return `${weekday}, ${month} ${at.getDate()}${year}`;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/**
 * A month to pick a day from: the held day's month, or this one. Days are
 * buttons a pointer presses; a keyboard types into the field instead, so
 * they stay out of the tab order.
 */
function MonthPicker({
  selected,
  now,
  heading,
  onPick,
}: {
  selected: string;
  now: Date;
  heading: React.ReactNode;
  onPick: (isoDate: string) => void;
}) {
  const start = parseBareDateLocalNoon(selected) ?? now;
  const [month, setMonth] = useState(
    () => new Date(start.getFullYear(), start.getMonth(), 1),
  );
  const today = localIsoDate(now);
  const gridStart = new Date(month);
  gridStart.setDate(1 - month.getDay());
  const days = Array.from({ length: 42 }, (_, index) => {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + index);
    return day;
  });
  const step = (by: number) =>
    setMonth(new Date(month.getFullYear(), month.getMonth() + by, 1));
  const title = `${MONTH_NAMES[month.getMonth()]} ${month.getFullYear()}`;

  return (
    <div className="w-64">
      {heading ? (
        <p className="mb-2 text-label font-semibold text-foreground">
          {heading}
        </p>
      ) : null}
      <div className="mb-1 flex items-center justify-between">
        <button
          type="button"
          tabIndex={-1}
          aria-label="Previous month"
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-card-hover hover:text-foreground"
          onClick={() => step(-1)}
        >
          <ChevronLeft aria-hidden className="size-4" />
        </button>
        <span className="text-label font-semibold">{title}</span>
        <button
          type="button"
          tabIndex={-1}
          aria-label="Next month"
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-card-hover hover:text-foreground"
          onClick={() => step(1)}
        >
          <ChevronRight aria-hidden className="size-4" />
        </button>
      </div>
      <div
        role="grid"
        aria-label={title}
        className="grid grid-cols-7 text-center text-caption"
      >
        {WEEKDAY_NAMES.map((name) => (
          <span
            key={name}
            role="columnheader"
            aria-label={name}
            className="py-1 text-muted-foreground"
          >
            {name.charAt(0)}
          </span>
        ))}
        {days.map((day) => {
          const iso = localIsoDate(day);
          const inMonth = day.getMonth() === month.getMonth();
          const isSelected = iso === selected;
          const isToday = iso === today;
          return (
            <button
              key={iso}
              type="button"
              tabIndex={-1}
              role="gridcell"
              aria-selected={isSelected}
              aria-label={fullDay(iso, new Date(0)) ?? iso}
              onClick={() => onPick(iso)}
              className={cn(
                "mx-auto flex size-8 items-center justify-center rounded-full text-label",
                isSelected
                  ? "bg-primary font-semibold text-primary-foreground"
                  : isToday
                    ? "font-bold text-foreground ring-1 ring-inset ring-input hover:bg-card-hover"
                    : inMonth
                      ? "text-foreground hover:bg-card-hover"
                      : "text-muted-foreground hover:bg-card-hover",
              )}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
