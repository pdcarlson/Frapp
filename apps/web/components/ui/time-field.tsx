"use client";

import { forwardRef, useEffect, useId, useRef, useState } from "react";
import { formatDueTimeLabel, parseTimeEntry } from "@repo/formatting";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** The list's step: Google Calendar and Outlook both offer quarter hours. */
const STEP_MINUTES = 15;
const TIMES: string[] = Array.from(
  { length: (24 * 60) / STEP_MINUTES },
  (_, i) => {
    const total = i * STEP_MINUTES;
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  },
);

type TimeFieldProps = Omit<
  React.ComponentProps<"input">,
  "value" | "onChange" | "type"
> & {
  /** `HH:MM` on the 24-hour clock, or `""` while nothing readable is typed. */
  value: string;
  onChange: (value: string) => void;
  /**
   * `HH:MM` a bare hour is read near (`parseTimeEntry`) and the list opens
   * on when nothing is held: a start time for an end field.
   */
  anchor?: string;
  /**
   * An end field's start (`HH:MM`): each later time in the list says how
   * long the meeting would run, `8 PM (1 hr)`, as Google Calendar's does.
   */
  from?: string;
};

/**
 * A time of day on web (#5219), replacing the browser's `<input type="time">`
 * and its spinner of hours, five-minute steps and an AM/PM column. Type it,
 * `7`, `7pm`, `7:30` or `19:30`, or press the field and pick from a list of
 * quarter hours, the way Google Calendar's and Outlook's time boxes work. It
 * reads like `DateField` beside it: the held time is written out (`7 PM`),
 * the list floats over the form and never moves it, and focus stays in the
 * field while the list is open.
 */
export const TimeField = forwardRef<HTMLInputElement, TimeFieldProps>(
  function TimeField(
    {
      value,
      onChange,
      anchor = "19:00",
      from,
      onBlur,
      onKeyDown,
      onPointerDown,
      className,
      disabled,
      "aria-invalid": ariaInvalid,
      ...inputProps
    },
    ref,
  ) {
    const listId = useId();
    const anchorRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLUListElement>(null);
    const written = (time: string) => (time ? formatDueTimeLabel(time) : "");
    const [text, setText] = useState(() => written(value));
    const [open, setOpen] = useState(false);
    const [focused, setFocused] = useState(false);
    const [seen, setSeen] = useState(value);
    if (value !== seen) {
      setSeen(value);
      if (value !== (parseTimeEntry(text, anchor) ?? "")) {
        setText(written(value));
      }
    }

    const options = from ? rotateFrom(from) : TIMES;
    const near = value || nearestStep(anchor);
    const [active, setActive] = useState<string | null>(null);
    const highlighted = active ?? near;
    const unreadable = text.trim() !== "" && !value;

    // Open on the held time, or the anchor, not at midnight.
    useEffect(() => {
      if (!open) return;
      const frame = requestAnimationFrame(() => {
        listRef.current
          ?.querySelector<HTMLElement>(`[data-time="${highlighted}"]`)
          ?.scrollIntoView({ block: "center" });
      });
      return () => cancelAnimationFrame(frame);
      // Only when it opens or the highlight moves.
    }, [open, highlighted]);

    const pick = (time: string) => {
      setText(written(time));
      setSeen(time);
      onChange(time);
      setActive(null);
      setOpen(false);
    };

    const step = (by: number) => {
      const index = options.indexOf(nearestStep(highlighted));
      const next = options[(index + by + options.length) % options.length];
      if (next) setActive(next);
      setOpen(true);
    };

    return (
      <Popover open={open && !disabled} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div ref={anchorRef} className="relative">
            <Input
              {...inputProps}
              ref={ref}
              type="text"
              inputMode="text"
              autoComplete="off"
              role="combobox"
              aria-autocomplete="none"
              aria-controls={listId}
              aria-expanded={open && !disabled}
              aria-activedescendant={
                open ? `${listId}-${highlighted.replace(":", "")}` : undefined
              }
              disabled={disabled}
              value={text}
              placeholder={inputProps.placeholder ?? "7 PM"}
              className={className}
              aria-invalid={
                ariaInvalid ?? (unreadable && !focused ? true : undefined)
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
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  step(1);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  step(-1);
                } else if (event.key === "Enter" && open && active) {
                  event.preventDefault();
                  pick(active);
                } else if (event.key === "Escape" && open) {
                  event.stopPropagation();
                  setOpen(false);
                }
                onKeyDown?.(event);
              }}
              onChange={(event) => {
                const next = event.target.value;
                setText(next);
                setActive(null);
                setOpen(true);
                onChange(parseTimeEntry(next, anchor) ?? "");
              }}
              onBlur={(event) => {
                setFocused(false);
                setOpen(false);
                setActive(null);
                if (value) setText(written(value));
                onBlur?.(event);
              }}
            />
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-trigger-width)] min-w-40 p-1"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onMouseDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            const target = event.target as Node | null;
            if (target && anchorRef.current?.contains(target)) {
              event.preventDefault();
            }
          }}
        >
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="Times"
            className="max-h-60 overflow-y-auto"
          >
            {options.map((time) => {
              const selected = time === value;
              return (
                <li
                  key={time}
                  id={`${listId}-${time.replace(":", "")}`}
                  data-time={time}
                  role="option"
                  aria-selected={selected}
                  onClick={() => pick(time)}
                  className={cn(
                    "flex min-h-8 cursor-pointer items-center justify-between gap-3 rounded-md px-2 text-sm pointer-coarse:min-h-11",
                    selected
                      ? "bg-accent-subtle font-semibold text-accent-text"
                      : time === highlighted
                        ? "bg-card-hover"
                        : "hover:bg-card-hover",
                  )}
                >
                  <span>{formatDueTimeLabel(time)}</span>
                  {from ? (
                    <span className="text-caption text-muted-foreground">
                      {durationLabel(from, time)}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </PopoverContent>
      </Popover>
    );
  },
);

function toMinutes(time: string): number {
  const [h = 0, m = 0] = time.split(":").map(Number);
  return h * 60 + m;
}

/** The list step at or just after `time`. */
function nearestStep(time: string): string {
  const at = toMinutes(time);
  return TIMES.find((step) => toMinutes(step) >= at) ?? TIMES[0] ?? "00:00";
}

/** The list starting a step after `from`, for an end field. */
function rotateFrom(from: string): string[] {
  const start = TIMES.indexOf(nearestStep(from));
  const index = start < 0 ? 0 : start;
  return [...TIMES.slice(index + 1), ...TIMES.slice(0, index + 1)];
}

/** `30 min`, `1 hr`, `1.5 hrs`: how long from `from` to `to`, past midnight too. */
export function durationLabel(from: string, to: string): string {
  const minutes = (toMinutes(to) - toMinutes(from) + 1440) % 1440;
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  const shown = Number.isInteger(hours)
    ? `${hours}`
    : hours.toFixed(2).replace(/0$/, "").replace(/\.0$/, "");
  return `${shown} ${hours === 1 ? "hr" : "hrs"}`;
}
