"use client";

import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { localIsoDate } from "@repo/formatting";
import { CALENDAR_KIND_HUE } from "@repo/hooks/activity-agenda";
import { CALENDAR_KINDS, type CalendarKind } from "@repo/hooks/calendar-tasks";
import { Button } from "@/components/ui/button";
import { FOCUS_RING } from "@/components/ui/focus";
import { compactControlClassName } from "@/components/shared/table-controls";
import { addDays } from "@/lib/events/agenda";
import { cn } from "@/lib/utils";

/**
 * The Events agenda's navigator (#5560): a way to jump the agenda to a day,
 * never a second view of the same things (`design-system/README.md` § 2).
 * A wide pane gets a small month beside the agenda; a narrow one (beside
 * chat) a week strip over it, ported from the phone's Activity strip
 * (`apps/mobile/components/activity/week-strip.tsx`). Both draw a dot per
 * kind a day holds, in the kind's own hue, the same hue its rows wear, so a
 * dot is a promise of what the day's rows look like.
 *
 * Today is the filled chapter-accent disc and the picked day a foreground
 * ring: the two never look alike, and a dot is never the accent.
 */

/** Sunday first, as the hour grid's weeks run. */
const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"] as const;
/** At most one dot per kind, and there are three kinds. */
const KIND_ORDER: readonly CalendarKind[] = ["events", "tasks", "birthdays"];

const FULL_DAY: Intl.DateTimeFormatOptions = {
  weekday: "long",
  month: "long",
  day: "numeric",
};

type DotsByDay = ReadonlyMap<string, ReadonlySet<CalendarKind>>;

function spokenDay(day: Date, kinds: ReadonlySet<CalendarKind> | undefined) {
  const label = day.toLocaleDateString(undefined, FULL_DAY);
  const names = KIND_ORDER.filter((kind) => kinds?.has(kind)).map(
    (kind) => CALENDAR_KINDS.find((entry) => entry.value === kind)!.label,
  );
  return names.length > 0
    ? `${label}, ${names.join(", ").toLowerCase()}`
    : label;
}

function Dots({
  dayKey,
  kinds,
}: {
  dayKey: string;
  kinds: ReadonlySet<CalendarKind> | undefined;
}) {
  return (
    <span aria-hidden="true" className="flex h-1.5 items-center gap-0.5">
      {KIND_ORDER.filter((kind) => kinds?.has(kind)).map((kind) => (
        <span
          key={kind}
          data-testid={`events-dot-${dayKey}-${kind}`}
          data-hue={CALENDAR_KIND_HUE[kind]}
          className="h-1 w-1 rounded-full"
          style={{ backgroundColor: CALENDAR_KIND_HUE[kind] }}
        />
      ))}
    </span>
  );
}

/** A day's number: today the accent disc, the picked day a ring. */
function dayNumberClassName(isToday: boolean, isPicked: boolean) {
  return cn(
    "flex h-7 w-7 items-center justify-center rounded-full text-caption tabular-nums",
    isToday
      ? "bg-primary font-bold text-primary-foreground"
      : "font-medium text-foreground",
    // 1.5px, outside the disc when the picked day is today, so both read.
    isPicked &&
      (isToday
        ? "ring-[1.5px] ring-foreground ring-offset-1 ring-offset-background"
        : "ring-[1.5px] ring-inset ring-foreground"),
  );
}

function DayButton({
  day,
  todayKey,
  pickedKey,
  dots,
  onPick,
  className,
  children,
}: {
  day: Date;
  todayKey: string;
  pickedKey: string | null;
  dots: DotsByDay;
  onPick: (day: Date) => void;
  className?: string;
  children?: ReactNode;
}) {
  const key = localIsoDate(day);
  const isToday = key === todayKey;
  const isPicked = key === pickedKey;
  return (
    <button
      type="button"
      aria-label={spokenDay(day, dots.get(key))}
      aria-current={isToday ? "date" : undefined}
      aria-pressed={isPicked}
      data-today={isToday || undefined}
      data-picked={isPicked || undefined}
      onClick={() => onPick(day)}
      className={cn(
        "flex flex-col items-center gap-0.5 rounded-md py-0.5 transition-colors hover:bg-card-hover",
        FOCUS_RING,
        className,
      )}
    >
      {children}
      <span className={dayNumberClassName(isToday, isPicked)}>
        {day.getDate()}
      </span>
      <Dots dayKey={key} kinds={dots.get(key)} />
    </button>
  );
}

function StepButton({
  label,
  direction,
  onClick,
}: {
  label: string;
  direction: -1 | 1;
  onClick: () => void;
}) {
  const Glyph = direction === -1 ? ChevronLeft : ChevronRight;
  return (
    <Button
      variant="ghost"
      size="icon"
      className={compactControlClassName}
      aria-label={label}
      onClick={onClick}
    >
      <Glyph className="h-4 w-4" />
    </Button>
  );
}

/**
 * The wide pane's month: its name with chevrons, seven columns of day
 * numbers and their dots. Only the month's own days: no trailing week of the
 * next month to read as this one.
 */
export function MiniMonth({
  month,
  onMonthChange,
  todayKey,
  pickedKey,
  dots,
  onPick,
}: {
  /** Any day in the month shown. */
  month: Date;
  onMonthChange: (next: Date) => void;
  todayKey: string;
  pickedKey: string | null;
  dots: DotsByDay;
  onPick: (day: Date) => void;
}) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const length = new Date(
    month.getFullYear(),
    month.getMonth() + 1,
    0,
  ).getDate();
  const days = Array.from({ length }, (_, index) => addDays(first, index));
  const title = first.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
  const step = (direction: -1 | 1) =>
    onMonthChange(
      new Date(first.getFullYear(), first.getMonth() + direction, 1),
    );
  return (
    <section aria-label="Pick a day" className="space-y-2">
      <div className="flex items-center gap-1">
        <h2
          className="min-w-0 flex-1 truncate px-1 text-sm font-semibold"
          aria-live="polite"
        >
          {title}
        </h2>
        <StepButton
          label="Previous month"
          direction={-1}
          onClick={() => step(-1)}
        />
        <StepButton label="Next month" direction={1} onClick={() => step(1)} />
      </div>
      <div className="grid grid-cols-7 gap-y-1 text-center">
        {WEEKDAY_INITIALS.map((initial, index) => (
          <span
            key={index}
            aria-hidden="true"
            className="text-caption font-semibold text-muted-foreground"
          >
            {initial}
          </span>
        ))}
        {days.map((day) => (
          <DayButton
            key={day.getDate()}
            day={day}
            todayKey={todayKey}
            pickedKey={pickedKey}
            dots={dots}
            onPick={onPick}
            className={
              day.getDate() === 1 ? COLUMN_START[day.getDay()] : undefined
            }
          />
        ))}
      </div>
    </section>
  );
}

/** The 1st's column, so the month starts under its weekday. */
const COLUMN_START = [
  "col-start-1",
  "col-start-2",
  "col-start-3",
  "col-start-4",
  "col-start-5",
  "col-start-6",
  "col-start-7",
] as const;

/**
 * The narrow pane's week: seven days from `start`, each its weekday initial,
 * its number and its dots, with chevrons that step a week.
 */
export function WeekStrip({
  start,
  onStartChange,
  todayKey,
  pickedKey,
  dots,
  onPick,
}: {
  start: Date;
  onStartChange: (next: Date) => void;
  todayKey: string;
  pickedKey: string | null;
  dots: DotsByDay;
  onPick: (day: Date) => void;
}) {
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  return (
    <section aria-label="Pick a day" className="flex items-center gap-1">
      <StepButton
        label="Previous week"
        direction={-1}
        onClick={() => onStartChange(addDays(start, -7))}
      />
      <div className="grid min-w-0 flex-1 grid-cols-7">
        {days.map((day) => (
          <DayButton
            key={localIsoDate(day)}
            day={day}
            todayKey={todayKey}
            pickedKey={pickedKey}
            dots={dots}
            onPick={onPick}
          >
            <span
              aria-hidden="true"
              className="text-caption font-semibold text-muted-foreground"
            >
              {WEEKDAY_INITIALS[day.getDay()]}
            </span>
          </DayButton>
        ))}
      </div>
      <StepButton
        label="Next week"
        direction={1}
        onClick={() => onStartChange(addDays(start, 7))}
      />
    </section>
  );
}

/**
 * The colour key, which is also the filter: a toggle per kind, its swatch,
 * its name and how many the agenda's range holds. Off, the swatch goes
 * hollow and the name is struck through, and the kind's rows and dots go.
 */
export function KindKey({
  hidden,
  counts,
  onToggle,
  compact = false,
}: {
  hidden: ReadonlySet<CalendarKind>;
  counts: Record<CalendarKind, number>;
  onToggle: (kind: CalendarKind) => void;
  /** One row under the week strip, rather than a column under the month. */
  compact?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label="Show on Events"
      className={cn(
        compact ? "flex flex-wrap items-center gap-x-1" : "flex flex-col",
      )}
    >
      {CALENDAR_KINDS.map(({ value, label }) => {
        const on = !hidden.has(value);
        const hue = CALENDAR_KIND_HUE[value];
        return (
          <button
            key={value}
            type="button"
            aria-pressed={on}
            aria-label={`${label}, ${counts[value]}`}
            onClick={() => onToggle(value)}
            className={cn(
              "flex min-h-8 items-center gap-2 rounded-md px-2 text-left text-caption transition-colors hover:bg-card-hover pointer-coarse:min-h-11",
              FOCUS_RING,
            )}
          >
            <span
              aria-hidden="true"
              data-testid={`events-key-swatch-${value}`}
              data-hue={hue}
              className={cn(
                "h-2.5 w-2.5 shrink-0",
                value === "tasks"
                  ? "rounded-full"
                  : value === "birthdays"
                    ? "rounded-[3px]"
                    : "rounded-[2px]",
              )}
              style={
                on ? { backgroundColor: hue } : { border: `1.5px solid ${hue}` }
              }
            />
            <span
              className={cn(
                "font-semibold",
                on ? "text-foreground" : "text-muted-foreground line-through",
              )}
            >
              {label}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {counts[value]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
