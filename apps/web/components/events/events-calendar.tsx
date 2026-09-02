"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Repeat } from "lucide-react";
import { EventsGlyph } from "@/components/events/chapter-ops-glyphs";
import { Button } from "@/components/ui/button";
import { FOCUS_RING } from "@/components/ui/focus";
import { cn } from "@/lib/utils";
import { formatClock } from "@repo/formatting";

type EventRow = Record<string, unknown>;

type EventsCalendarProps = {
  events: EventRow[];
  onSelectEvent: (event: EventRow) => void;
  /**
   * Fires when an officer clicks a day's date number to create an event on
   * that day. `disabled` mirrors `SubscriptionGate.controlProps().disabled` —
   * the caller is responsible for gating; this component only renders the
   * disabled state it's given so a lapsed chapter still sees the day it
   * clicked, not a silently inert control.
   */
  onCreateOnDay: (day: Date) => void;
  createDisabled: boolean;
};

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_VISIBLE_EVENTS_PER_DAY = 3;

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

// Local (viewer-timezone) day key, not UTC — an event's calendar day is
// wherever the officer viewing it is standing, matching how `formatDate`
// elsewhere on this page already renders `start_time` in local time.
function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// A 6x7 grid anchored to the Sunday on/before the 1st, so every month
// renders the same fixed height regardless of how many weeks it spans.
function buildMonthGrid(monthAnchor: Date): Date[] {
  const first = startOfMonth(monthAnchor);
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - first.getDay());
  const days: Date[] = [];
  for (let index = 0; index < 42; index += 1) {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + index);
    days.push(day);
  }
  return days;
}

export function EventsCalendar({
  events,
  onSelectEvent,
  onCreateOnDay,
  createDisabled,
}: EventsCalendarProps) {
  const [monthAnchor, setMonthAnchor] = useState(() =>
    startOfMonth(new Date()),
  );

  const days = useMemo(() => buildMonthGrid(monthAnchor), [monthAnchor]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, EventRow[]>();
    for (const event of events) {
      const startRaw =
        typeof event.start_time === "string" ? event.start_time : null;
      if (!startRaw) continue;
      const start = new Date(startRaw);
      if (Number.isNaN(start.getTime())) continue;
      const key = localDayKey(start);
      const bucket = map.get(key);
      if (bucket) {
        bucket.push(event);
      } else {
        map.set(key, [event]);
      }
    }
    for (const bucket of map.values()) {
      bucket.sort((first, second) => {
        const firstTime =
          typeof first.start_time === "string"
            ? new Date(first.start_time).getTime()
            : 0;
        const secondTime =
          typeof second.start_time === "string"
            ? new Date(second.start_time).getTime()
            : 0;
        return firstTime - secondTime;
      });
    }
    return map;
  }, [events]);

  const todayKey = localDayKey(new Date());
  const monthLabel = monthAnchor.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  function goToPreviousMonth() {
    setMonthAnchor(
      (previous) =>
        new Date(previous.getFullYear(), previous.getMonth() - 1, 1),
    );
  }
  function goToNextMonth() {
    setMonthAnchor(
      (previous) =>
        new Date(previous.getFullYear(), previous.getMonth() + 1, 1),
    );
  }
  function goToToday() {
    setMonthAnchor(startOfMonth(new Date()));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">{monthLabel}</h3>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={goToToday}>
            Today
          </Button>
          <Button
            variant="secondary"
            size="icon"
            aria-label="Previous month"
            onClick={goToPreviousMonth}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            aria-label="Next month"
            onClick={goToNextMonth}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-md border border-border">
        <div className="grid grid-cols-7 gap-px bg-border text-xs font-semibold text-muted-foreground">
          {WEEKDAY_LABELS.map((label) => (
            <div key={label} className="bg-card px-2 py-1.5 text-center">
              {label}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-px bg-border">
          {days.map((day) => {
            const key = localDayKey(day);
            const dayEvents = eventsByDay.get(key) ?? [];
            const isCurrentMonth = day.getMonth() === monthAnchor.getMonth();
            const isToday = key === todayKey;
            const visibleEvents = dayEvents.slice(
              0,
              MAX_VISIBLE_EVENTS_PER_DAY,
            );
            const overflowCount = dayEvents.length - visibleEvents.length;
            const dayLabel = day.toLocaleDateString(undefined, {
              month: "long",
              day: "numeric",
              year: "numeric",
            });

            return (
              <div
                key={key}
                className={cn(
                  "flex min-h-24 flex-col gap-1 bg-card p-2",
                  !isCurrentMonth && "bg-muted/40",
                )}
              >
                <button
                  type="button"
                  disabled={createDisabled}
                  aria-label={`Create event on ${dayLabel}`}
                  className={cn(
                    "flex h-7 w-7 items-center justify-center self-start rounded-full border border-transparent text-xs font-semibold transition-colors",
                    FOCUS_RING,
                    "hover:bg-accent-subtle disabled:pointer-events-none disabled:text-disabled",
                    isToday
                      ? "bg-primary text-primary-foreground hover:bg-primary-hover"
                      : isCurrentMonth
                        ? "text-foreground"
                        : "text-muted-foreground",
                  )}
                  onClick={() => onCreateOnDay(day)}
                >
                  {day.getDate()}
                </button>

                <div className="flex flex-col gap-1">
                  {visibleEvents.map((event) => {
                    const eventId = String(
                      event.id ?? event.name ?? "unknown-event",
                    );
                    const eventName = String(event.name ?? "Untitled event");
                    const isMandatory =
                      typeof event.is_mandatory === "boolean"
                        ? event.is_mandatory
                        : false;
                    // The series head carries `recurrence_rule`; every
                    // generated occurrence carries `parent_event_id` instead
                    // (and a null `recurrence_rule`) — see
                    // `event.service.ts`. Distinct icons so the two don't
                    // read as the same thing on the grid.
                    const isSeriesHead =
                      typeof event.recurrence_rule === "string" &&
                      event.recurrence_rule.length > 0;
                    const isSeriesInstance =
                      typeof event.parent_event_id === "string" &&
                      event.parent_event_id.length > 0;
                    const clockLabel = formatClock(event.start_time);

                    return (
                      <button
                        key={eventId}
                        type="button"
                        title={eventName}
                        aria-label={`View ${eventName}${clockLabel ? `, ${clockLabel}` : ""}${isMandatory ? ", mandatory" : ""}`}
                        className={cn(
                          "flex items-center gap-1 truncate rounded-xs border-l-2 bg-card px-1.5 py-1 text-left text-[11px] font-semibold text-foreground transition-colors",
                          FOCUS_RING,
                          "hover:bg-accent-subtle",
                          isMandatory ? "border-l-primary" : "border-l-border",
                        )}
                        onClick={() => onSelectEvent(event)}
                      >
                        {isSeriesHead ? (
                          <EventsGlyph className="h-3 w-3 shrink-0 text-muted-foreground" />
                        ) : null}
                        {isSeriesInstance ? (
                          <Repeat
                            aria-hidden="true"
                            className="h-3 w-3 shrink-0 text-muted-foreground"
                          />
                        ) : null}
                        <span className="truncate">{eventName}</span>
                      </button>
                    );
                  })}
                  {overflowCount > 0 ? (
                    <span className="px-1.5 text-[11px] text-muted-foreground">
                      +{overflowCount} more
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
