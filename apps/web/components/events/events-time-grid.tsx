"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Repeat } from "lucide-react";
import { EventsGlyph } from "@/components/events/chapter-ops-glyphs";
import { FOCUS_RING } from "@/components/ui/focus";
import { cn } from "@/lib/utils";
import { formatTimeOfDay, localIsoDate } from "@repo/formatting";
import type { CalendarTask } from "@repo/hooks/calendar-tasks";
import {
  blockGeometry,
  endsWithinDay,
  GRID_HOURS as HOURS,
  HOUR_HEIGHT,
  hourLabel,
  minuteOfDay,
  OPEN_AT_HOUR,
  timeGridColumns,
  TWO_LINE_MIN_HEIGHT,
} from "@repo/hooks/calendar-time-grid";
import { CalendarTaskChip } from "@/components/events/calendar-tasks";

type EventRow = Record<string, unknown>;

export type CalendarEventFacts = {
  eventId: string;
  eventName: string;
  isMandatory: boolean;
  isSeriesHead: boolean;
  isSeriesInstance: boolean;
  clockLabel: string | null;
  viewLabel: string;
};

type EventsTimeGridProps = {
  /** The columns, each at local midnight: seven for Week, one for Day. */
  days: Date[];
  events: EventRow[];
  tasksByDay: Map<string, CalendarTask[]>;
  nameOf: (userId: string) => string;
  factsOf: (event: EventRow) => CalendarEventFacts;
  onSelectEvent: (event: EventRow) => void;
  /** A column's heading opens that day in the Day view (Week only). */
  onOpenDay?: (day: Date) => void;
  onCreateAt: (day: Date, hour: number) => void;
  canCreate: boolean;
  createDisabled: boolean;
  createDescribedBy?: string;
  createTitle?: string;
};

/** The current time, moved on each minute, for the now line. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/**
 * The Week and Day views (#4818), drawn the way Google Calendar, Apple
 * Calendar and Outlook draw them: an hour column at the left and a column per
 * day, each timed event a block at its start and as tall as it lasts, events
 * that overlap side by side, and a strip at the top for what has no time of
 * day (the day's tasks, and an event that lasts a whole day or more). A red
 * line marks the time now in today's column. An officer presses an empty
 * hour to make an event starting then.
 */
export function EventsTimeGrid({
  days,
  events,
  tasksByDay,
  nameOf,
  factsOf,
  onSelectEvent,
  onOpenDay,
  onCreateAt,
  canCreate,
  createDisabled,
  createDescribedBy,
  createTitle,
}: EventsTimeGridProps) {
  // Today from the same clock as the now line, so a page left open past
  // midnight moves both to the new day.
  const now = useNow();
  const todayKey = localIsoDate(now);
  const isDayView = days.length === 1;
  // The labels never change; build them once rather than per hour per
  // column on every minute's render.
  const hourLabels = useMemo(() => HOURS.map(hourLabel), []);

  const columns = useMemo(
    () => timeGridColumns(days, events, tasksByDay),
    [days, events, tasksByDay],
  );

  const hasStrip = columns.some(
    (column) => column.allDay.length > 0 || column.tasks.length > 0,
  );
  const gridColumns = {
    gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0, 1fr))`,
  };

  // Opened at 8 AM once; moving to another week keeps where the officer
  // scrolled, as Google Calendar does.
  const scrolled = useRef(false);
  const scrollRef = (node: HTMLDivElement | null) => {
    if (!node || scrolled.current) return;
    // A little above the hour, so its label isn't cut by the edge.
    node.scrollTop = OPEN_AT_HOUR * HOUR_HEIGHT - 8;
    scrolled.current = true;
  };

  return (
    <div className="overflow-hidden rounded-[14px] border border-border">
      {/* Day headings */}
      <div
        className="grid gap-px border-b border-border bg-border"
        style={gridColumns}
      >
        <div className="bg-background" />
        {columns.map(({ day, key }) => {
          const isToday = key === todayKey;
          const weekday = day.toLocaleDateString(undefined, {
            weekday: "short",
          });
          const fullLabel = day.toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
          });
          const number = (
            <span
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full border border-transparent text-sm font-semibold",
                isToday
                  ? "bg-popover font-bold text-foreground ring-1 ring-inset ring-input"
                  : "text-foreground",
              )}
            >
              {day.getDate()}
            </span>
          );
          return (
            <div
              key={key}
              className={cn(
                "flex items-center gap-1.5 bg-background px-2 py-1.5",
                isDayView ? "justify-start" : "justify-center",
              )}
            >
              <span
                className={cn(
                  "text-caption font-semibold",
                  isToday ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {weekday}
              </span>
              {onOpenDay && !isDayView ? (
                <button
                  type="button"
                  aria-label={`Open ${fullLabel}`}
                  className={cn(
                    "rounded-full transition-colors hover:bg-card-hover",
                    FOCUS_RING,
                  )}
                  onClick={() => onOpenDay(day)}
                >
                  {number}
                </button>
              ) : (
                number
              )}
            </div>
          );
        })}
      </div>

      {/* What has no time of day: tasks due, and day-long events */}
      {hasStrip ? (
        <div
          className="grid gap-px border-b border-border bg-border"
          style={gridColumns}
        >
          <div className="flex items-start justify-end bg-background px-1.5 py-1.5 text-caption font-semibold uppercase text-muted-foreground">
            All day
          </div>
          {columns.map(({ key, allDay, tasks }) => (
            <div
              key={key}
              className="flex min-w-0 flex-col gap-1 bg-background p-1"
            >
              {allDay.map((event) => (
                <EventChip
                  key={factsOf(event).eventId}
                  facts={factsOf(event)}
                  onSelect={() => onSelectEvent(event)}
                />
              ))}
              {tasks.map((item) => (
                <CalendarTaskChip key={item.key} item={item} nameOf={nameOf} />
              ))}
            </div>
          ))}
        </div>
      ) : null}

      {/* The hours */}
      <div
        ref={scrollRef}
        data-testid="events-time-grid-scroll"
        className="h-[min(65vh,640px)] overflow-y-auto"
      >
        <div
          className="relative grid"
          style={{ ...gridColumns, height: HOURS.length * HOUR_HEIGHT }}
        >
          <div aria-hidden="true" className="relative bg-background">
            {HOURS.slice(1).map((hour) => (
              <span
                key={hour}
                className="absolute right-1.5 -translate-y-1/2 text-caption tabular-nums text-muted-foreground"
                style={{ top: hour * HOUR_HEIGHT }}
              >
                {hourLabels[hour]}
              </span>
            ))}
          </div>

          {columns.map(({ day, key, placed }) => {
            const isToday = key === todayKey;
            const dayLabel = day.toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
            });
            return (
              <div
                key={key}
                data-testid={`time-grid-day-${key}`}
                className="relative border-l border-border bg-background"
              >
                {HOURS.map((hour) => {
                  const lineClass = cn(
                    "absolute inset-x-0",
                    hour > 0 && "border-t border-border",
                  );
                  const style = {
                    top: hour * HOUR_HEIGHT,
                    height: HOUR_HEIGHT,
                  };
                  if (!canCreate) {
                    return (
                      <div
                        key={hour}
                        aria-hidden="true"
                        className={lineClass}
                        style={style}
                      />
                    );
                  }
                  return (
                    <button
                      key={hour}
                      type="button"
                      // The Day view's hours are its keyboard path to a
                      // timed event. In the Week the 168 slots stay out of
                      // the tab order: a day's heading opens its Day view,
                      // and New event is the toolbar's.
                      tabIndex={isDayView ? undefined : -1}
                      disabled={createDisabled}
                      title={createTitle}
                      aria-describedby={createDescribedBy}
                      aria-label={`Create event on ${dayLabel} at ${hourLabels[hour]}`}
                      className={cn(
                        lineClass,
                        "transition-colors hover:bg-card-hover disabled:pointer-events-none",
                        FOCUS_RING,
                      )}
                      style={style}
                      onClick={() => onCreateAt(day, hour)}
                    />
                  );
                })}

                {placed.map((span) => {
                  const facts = factsOf(span.item);
                  const { top, height } = blockGeometry(span);
                  const endLabel = endsWithinDay(span)
                    ? formatTimeOfDay(span.item.end_time)
                    : null;
                  return (
                    <button
                      key={`${facts.eventId}-${key}`}
                      type="button"
                      title={facts.eventName}
                      aria-label={facts.viewLabel}
                      className={cn(
                        "absolute z-10 flex flex-col overflow-hidden rounded-xs border-l-2 bg-surface-1 px-1.5 py-0.5 text-left text-caption leading-tight text-foreground ring-1 ring-background transition-colors",
                        FOCUS_RING,
                        "hover:bg-card-hover",
                        facts.isMandatory
                          ? "border-l-primary"
                          : "border-l-border",
                      )}
                      style={{
                        top,
                        height: height - 1,
                        left: `calc(${(span.lane / span.lanes) * 100}% + 2px)`,
                        width: `calc(${100 / span.lanes}% - 4px)`,
                      }}
                      onClick={() => onSelectEvent(span.item)}
                    >
                      <span className="flex min-w-0 items-center gap-1 font-semibold">
                        <SeriesMark facts={facts} />
                        <span className="truncate">{facts.eventName}</span>
                      </span>
                      {height >= TWO_LINE_MIN_HEIGHT && facts.clockLabel ? (
                        <span className="truncate tabular-nums text-muted-foreground">
                          {facts.clockLabel}
                          {endLabel ? ` – ${endLabel}` : ""}
                        </span>
                      ) : null}
                    </button>
                  );
                })}

                {isToday ? (
                  <div
                    aria-hidden="true"
                    data-testid="time-grid-now"
                    className="pointer-events-none absolute inset-x-0 z-20 h-0.5 bg-destructive"
                    style={{ top: (minuteOfDay(now) / 60) * HOUR_HEIGHT - 1 }}
                  >
                    <span className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full bg-destructive" />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function SeriesMark({ facts }: { facts: CalendarEventFacts }) {
  if (facts.isSeriesHead) {
    return <EventsGlyph className="h-3 w-3 shrink-0 text-muted-foreground" />;
  }
  if (facts.isSeriesInstance) {
    return (
      <Repeat
        aria-hidden="true"
        className="h-3 w-3 shrink-0 text-muted-foreground"
      />
    );
  }
  return null;
}

export function EventChip({
  facts,
  onSelect,
}: {
  facts: CalendarEventFacts;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      title={facts.eventName}
      aria-label={facts.viewLabel}
      className={cn(
        "flex items-center gap-1 truncate rounded-xs border-l-2 bg-surface-1 px-1.5 py-1 text-left text-[11px] font-semibold text-foreground transition-colors",
        FOCUS_RING,
        "hover:bg-card-hover",
        facts.isMandatory ? "border-l-primary" : "border-l-border",
      )}
      onClick={onSelect}
    >
      <SeriesMark facts={facts} />
      <span className="truncate">{facts.eventName}</span>
    </button>
  );
}
