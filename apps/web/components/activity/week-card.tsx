"use client";

import type { ReactNode } from "react";
import { Check } from "lucide-react";
import {
  ACTIVITY_WEEK_HINT,
  type ActivityAgenda,
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
import { Card } from "@/components/ui/card";
import { FOCUS_RING } from "@/components/ui/focus";
import { EYEBROW } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

/** The week ring: big enough to hold "12" over "of 24" at the type scale. */
const RING_SIZE = 96;
const RING_STROKE = 10;

/**
 * The top of `/activity` (#4766): one ring, done of total this week, where
 * the headline and its count tiles were (Paul, 2026-11-13: "too many little
 * cards that tell me no information", "maybe a percentage or like a dial").
 * The phone's week card (`apps/mobile/components/activity/week-card.tsx`) on
 * web, from the same model (`activityWeekSummary`); Apple Fitness's rings
 * and Bevel's daily dial are the comparables.
 *
 * Beside the ring, a line per kind that has anything this week. A line is a
 * toggle: pressing it narrows the To do list to that kind, and pressing it
 * again shows everything. Then the one thing to do next (`next`, the row the
 * page draws), under the lines on a narrow page and beside them on a wide
 * one.
 *
 * - Nothing due: the ring steps back to its groove and a quiet check, and the
 *   card says so. Never "0 of 0".
 * - Everything done: the ring closes in the success hue.
 * - A part couldn't load: its line draws a dash, the headline says "at
 *   least", and the card says which part. A failed read is never a zero.
 * - An API from before the week (`summary.state` is `unknown`): no ring, only
 *   the next thing.
 */
export function WeekCard({
  summary,
  next,
  nextLabel,
  filter,
  onFilter,
}: {
  summary: ActivityWeekSummary;
  /** The next thing's row, as a list item, or `null` when nothing is left. */
  next: ReactNode | null;
  nextLabel: ActivityAgenda["nextLabel"];
  filter: ActivityAgendaFilter;
  onFilter: (filter: ActivityAgendaFilter) => void;
}) {
  const known = summary.state !== "unknown";
  if (!known && !next) return null;
  const closed = summary.state === "done";
  return (
    <Card data-testid="activity-week-card">
      <section
        aria-labelledby={known ? "activity-week" : undefined}
        aria-label={known ? undefined : "Next"}
        className="flex flex-col @3xl:flex-row"
      >
        {known ? (
          <div className="min-w-0 flex-1 space-y-3 p-4">
            <div className="flex items-center gap-4">
              <span className="sr-only">{summary.spokenLabel}</span>
              <ProgressRing
                size={RING_SIZE}
                stroke={RING_STROKE}
                progress={summary.progress}
                tone={closed ? "success" : "accent"}
                data-testid="activity-week-ring"
              >
                {summary.total > 0 ? (
                  <>
                    <span className="text-headline leading-none tabular-nums text-foreground">
                      {summary.done}
                    </span>
                    <span className="text-caption tabular-nums text-muted-foreground">
                      of {summary.total}
                    </span>
                  </>
                ) : summary.incomplete ? (
                  <span className="text-headline text-muted-foreground">–</span>
                ) : (
                  <Check className="h-7 w-7 text-muted" />
                )}
              </ProgressRing>
              <div className="min-w-0 flex-1 space-y-1">
                <h2
                  id="activity-week"
                  className={cn(
                    "text-title",
                    closed ? "text-success" : "text-foreground",
                  )}
                >
                  {summary.headline}
                </h2>
                {summary.lines.length > 0 ? (
                  <div
                    role="group"
                    aria-label="This week by kind"
                    className="max-w-md"
                  >
                    {summary.lines.map((line) => (
                      <WeekLine
                        key={line.id}
                        line={line}
                        selected={filter === line.id}
                        onPress={() =>
                          onFilter(filter === line.id ? "all" : line.id)
                        }
                      />
                    ))}
                  </div>
                ) : summary.incomplete ? null : (
                  <p className="text-caption text-muted-foreground">
                    {ACTIVITY_WEEK_HINT}
                  </p>
                )}
              </div>
            </div>
            {summary.warning ? (
              <p className="text-caption text-warning">
                {summary.warning} Try again in a moment.
              </p>
            ) : null}
          </div>
        ) : null}
        {next ? (
          <div
            className={cn(
              "min-w-0 flex-1 space-y-1 p-4",
              known && "border-t border-border @3xl:border-l @3xl:border-t-0",
            )}
          >
            <p
              className={cn(
                EYEBROW,
                // The row under it starts at its own 8px padding.
                "px-2",
                nextLabel === "Happening now"
                  ? "text-accent-text"
                  : "text-muted-foreground",
              )}
            >
              {nextLabel}
            </p>
            <ul>{next}</ul>
          </div>
        ) : null}
      </section>
    </Card>
  );
}

/** One line beside the ring: a kind, how far along it is, and its count. */
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
        // edges whatever its label and count say. Under a phone's width the
        // bar steps out, so "Polls and sign-ups" keeps its words: the ring
        // already draws the proportion.
        "-mx-2 grid min-h-7 w-[calc(100%+1rem)] grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-sm px-2 text-left @sm:grid-cols-[minmax(0,5fr)_minmax(0,3fr)_4.5rem]",
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
      <span
        aria-hidden="true"
        className={cn(meterTrackDenseClassName, "hidden @sm:block")}
      >
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

/** The card before the first read, on the loaded card's frame. */
export function WeekCardSkeleton() {
  return (
    <Card aria-hidden="true">
      <div className="flex items-center gap-4 p-4">
        {/* The ring's 96px (`RING_SIZE`). */}
        <Skeleton className="h-24 w-24 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-3">
          <Skeleton className="h-[18px] w-48 max-w-full" />
          <Skeleton className="h-[11px] w-64 max-w-full" />
          <Skeleton className="h-[11px] w-56 max-w-full" />
        </div>
      </div>
    </Card>
  );
}
