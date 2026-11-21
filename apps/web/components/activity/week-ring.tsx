"use client";

import { useState } from "react";
import {
  ACTIVITY_WEEK_HINT,
  type ActivityAgendaFilter,
  type ActivityWeekLine,
  type ActivityWeekSummary,
} from "@repo/hooks";
import { Skeleton } from "@/components/shared/async-states";
import {
  meterFillClassName,
  meterTrackDenseClassName,
} from "@/components/shared/meter";
import { ProgressRing } from "@/components/shared/progress-ring";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { FOCUS_RING } from "@/components/ui/focus";
import { cn } from "@/lib/utils";

/** The small ring: a glance, not a card (#5779). */
const RING_SIZE = 22;
const RING_STROKE = 3;

/**
 * The week on `/activity`, as a small ring beside the page title (#5779,
 * Paul's pick 2026-11-20: "Small ring beside the title"), where the week card
 * with its 96px ring and Next row was (#4766). Done of total this week
 * ("4/15"), from `activityWeekSummary`, the phone's ring
 * (`apps/mobile/components/activity/week-ring.tsx`) on web. Apple Fitness
 * keeps its rings this small in a summary, one press from the detail.
 *
 * Pressed, it opens the per-kind lines. A line is a toggle: it narrows the To
 * do list to that kind, and pressing it again shows everything.
 *
 * - Nothing due: the ring is its groove and says "0", never "0/0".
 * - Everything done: the ring closes in the success hue.
 * - A part couldn't load: the lines draw a dash and say which part.
 * - An API from before the week (`summary.state` is `unknown`): no ring.
 */
export function WeekRing({
  summary,
  filter,
  onFilter,
}: {
  summary: ActivityWeekSummary;
  filter: ActivityAgendaFilter;
  onFilter: (filter: ActivityAgendaFilter) => void;
}) {
  const [open, setOpen] = useState(false);
  if (summary.state === "unknown") return null;
  const closed = summary.state === "done";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={summary.spokenLabel || summary.headline}
          id="activity-week-ring"
          data-testid="activity-week-ring"
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-2.5 text-caption font-semibold tabular-nums transition-colors hover:bg-card-hover pointer-coarse:h-11",
            filter !== "all" ? "text-accent-text" : "text-foreground",
            FOCUS_RING,
          )}
        >
          <ProgressRing
            size={RING_SIZE}
            stroke={RING_STROKE}
            progress={summary.progress}
            tone={closed ? "success" : "accent"}
          />
          {summary.total > 0
            ? `${summary.done}/${summary.total}`
            : summary.incomplete
              ? "–"
              : "0"}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-2 p-3">
        <p
          className={cn(
            "text-sm font-semibold",
            closed ? "text-success" : "text-foreground",
          )}
        >
          {summary.headline}
        </p>
        {summary.lines.length > 0 ? (
          <div role="group" aria-label="This week by kind">
            {summary.lines.map((line) => (
              <WeekLine
                key={line.id}
                line={line}
                selected={filter === line.id}
                onPress={() => {
                  onFilter(filter === line.id ? "all" : line.id);
                  setOpen(false);
                }}
              />
            ))}
          </div>
        ) : summary.incomplete ? null : (
          <p className="text-caption text-muted-foreground">
            {ACTIVITY_WEEK_HINT}
          </p>
        )}
        {summary.warning ? (
          <p className="text-caption text-warning">
            {summary.warning} Try again in a moment.
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/** One line under the ring: a kind, how far along it is, and its count. */
function WeekLine({
  line,
  selected,
  onPress,
}: {
  line: ActivityWeekLine;
  selected: boolean;
  onPress: () => void;
}) {
  const progress =
    line.done === null || line.total === null || line.total === 0
      ? 0
      : Math.min(1, line.done / line.total);
  const closed = line.total !== null && line.total > 0 && progress === 1;
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={line.spokenLabel}
      title={
        selected
          ? "Show everything in the list again"
          : `Show only ${line.label.toLowerCase()} in the list`
      }
      onClick={onPress}
      id={`activity-week-line-${line.id}`}
      data-testid={`activity-week-line-${line.id}`}
      className={cn(
        // One column each, so every line's bar starts and ends on the same
        // edges whatever its label and count say.
        "-mx-2 grid min-h-8 w-[calc(100%+1rem)] grid-cols-[minmax(0,5fr)_minmax(0,3fr)_4.5rem] items-center gap-2 rounded-sm px-2 text-left",
        "transition-colors hover:bg-card-hover pointer-coarse:min-h-11",
        FOCUS_RING,
      )}
    >
      <span
        className={cn(
          "truncate text-caption",
          selected ? "font-semibold text-accent-text" : "text-foreground",
        )}
      >
        {line.label}
      </span>
      <span aria-hidden="true" className={meterTrackDenseClassName}>
        <span
          className={cn("block", meterFillClassName, closed && "bg-success")}
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </span>
      <span
        className={cn(
          "text-right text-caption font-semibold tabular-nums",
          selected ? "text-accent-text" : "text-muted-foreground",
        )}
      >
        {line.done === null ? "–" : `${line.done} of ${line.total}`}
      </span>
    </button>
  );
}

/** The ring before the first read, on the loaded ring's frame. */
export function WeekRingSkeleton() {
  return <Skeleton aria-hidden="true" className="h-8 w-16 rounded-full" />;
}
