"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Plus, Repeat } from "lucide-react";
import { EventsGlyph } from "@/components/events/chapter-ops-glyphs";
import { Button } from "@/components/ui/button";
import { FOCUS_RING } from "@/components/ui/focus";
import { cn } from "@/lib/utils";
import { compactControlClassName } from "@/components/shared/table-controls";
import { InlineNote } from "@/components/shared/inline-note";
import { stateMicrocopy } from "@/lib/state-microcopy";
import { formatTimeOfDay, localIsoDate, parseInstant } from "@repo/formatting";
import { useIsNarrow } from "@/lib/use-is-narrow";
import { attendanceFieldsOf, eventDefaultAttendance } from "@repo/validation";
import type { CalendarTask } from "@repo/hooks/calendar-tasks";
import {
  CalendarTaskChip,
  CalendarTaskRow,
} from "@/components/events/calendar-tasks";

type EventRow = Record<string, unknown>;

type EventsCalendarProps = {
  events: EventRow[];
  onSelectEvent: (event: EventRow) => void;
  /**
   * Fires when an officer clicks a day's date number (the compact month: the
   * picked day's New event) to create an event on that day. `disabled` mirrors `SubscriptionGate.controlProps().disabled` —
   * the caller is responsible for gating; this component only renders the
   * disabled state it's given so a lapsed chapter still sees the day it
   * clicked, not a silently inert control.
   */
  onCreateOnDay: (day: Date) => void;
  /**
   * The viewer can create events (`EVENT_CREATE_PERMISSIONS`: `events:create`
   * and `members:view`). Otherwise a day number is a plain date: no button,
   * and no dashed "+" on today.
   */
  canCreate: boolean;
  /**
   * Whether the chapter has any event at all, before search and filters. A
   * chapter with none gets one line under the month (how to make the first
   * event, or that nothing is scheduled yet) and, for a creator whose days
   * are live, a dashed "+" on today where the first event will land.
   */
  chapterHasEvents: boolean;
  createDisabled: boolean;
  /**
   * Ties the disabled create button to its explanation, matching every other
   * gated control on this page — pass `controlProps()["aria-describedby"]`
   * (set for a subscription/pending block, omitted for an offline-only
   * block so it does not name a notice that is not in the tree).
   */
  createDescribedBy?: string;
  /**
   * Offline reason from `controlProps().title`. Native `title`, not a
   * tooltip primitive — #920 deleted ShadCN tooltip, and #1753 attaches
   * "Reconnect to make changes." to the control itself.
   */
  createTitle?: string;
  /**
   * Lifted to the parent rather than kept as local state: the page unmounts
   * the calendar while the list is showing, and a `useState` here would
   * silently reset to the current month every time an officer switches to
   * the list and back.
   */
  monthAnchor: Date;
  onMonthAnchorChange: (next: Date) => void;
  /**
   * The viewer's tasks and the tasks they assigned, by due day, already
   * narrowed to the kinds switched on (#4144). A day lists them after its
   * events.
   */
  tasksByDay?: Map<string, CalendarTask[]>;
  /** A member's name, for who assigned a task and who it went to. */
  nameOf?: (userId: string) => string;
  /** The Events / My tasks / Assigned by me toggles, under the month. */
  layerToggles?: ReactNode;
};

const NO_TASKS = new Map<string, CalendarTask[]>();
const fallbackName = () => "A member";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Events and tasks together: a busy day shows three, then "+N more". */
const MAX_VISIBLE_EVENTS_PER_DAY = 3;
/**
 * Below this calendar width the month goes compact (#4022): a day cell is
 * about 80px, too narrow for an event's name ("Cha…" beside chat at 480px).
 * The days then carry a dot per event, and the picked day's events are
 * listed under the grid with their full names.
 */
const COMPACT_BELOW_WIDTH = 600;
const MAX_DOTS_PER_DAY = 3;

/**
 * What both months draw for one event, so the wide grid's chip and the
 * compact month's row name it, mark it and badge its series the same way.
 */
function calendarEventFacts(event: EventRow) {
  const eventName = String(event.name ?? "Untitled event");
  // Required of everyone by default, as the list's badge.
  const isMandatory =
    eventDefaultAttendance(attendanceFieldsOf(event)) === "required";
  // The time of day only: the day is the cell's (or the day list's) own.
  const clockLabel = formatTimeOfDay(event.start_time);
  return {
    eventId: String(event.id ?? event.name ?? "unknown-event"),
    eventName,
    isMandatory,
    // The series head carries `recurrence_rule`; every generated occurrence
    // carries `parent_event_id` instead (and a null `recurrence_rule`), see
    // `event-series.service.ts`. Distinct icons so the two don't read as the
    // same thing.
    isSeriesHead:
      typeof event.recurrence_rule === "string" &&
      event.recurrence_rule.length > 0,
    isSeriesInstance:
      typeof event.parent_event_id === "string" &&
      event.parent_event_id.length > 0,
    clockLabel,
    viewLabel: `View ${eventName}${clockLabel ? `, ${clockLabel}` : ""}${isMandatory ? ", mandatory" : ""}`,
  };
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

// Local (viewer-timezone) day key, not UTC — an event's calendar day is
// wherever the officer viewing it is standing, matching how the list row
// on this page renders `start_time` in local time.
const localDayKey = localIsoDate;

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

// The date in a day cell: a round chip that a creator can press. Today gets
// the raised fill and a ring; a day outside the month is muted.
function dayNumberClassName(isToday: boolean, isCurrentMonth: boolean) {
  return cn(
    "flex h-7 w-7 items-center justify-center self-start rounded-full border border-transparent text-xs font-semibold",
    isToday
      ? "bg-popover font-bold text-foreground ring-1 ring-inset ring-input"
      : isCurrentMonth
        ? "text-foreground"
        : "text-muted-foreground",
  );
}

export function EventsCalendar({
  events,
  onSelectEvent,
  onCreateOnDay,
  canCreate,
  chapterHasEvents,
  createDisabled,
  createDescribedBy,
  createTitle,
  monthAnchor,
  onMonthAnchorChange,
  tasksByDay = NO_TASKS,
  nameOf = fallbackName,
  layerToggles = null,
}: EventsCalendarProps) {
  // Per-day "show all" toggle for a day whose event count exceeds the
  // visible cap — keyed by day so expanding one busy day doesn't expand
  // every other day too. Reset is implicit: a fresh month grid means fresh
  // keys, so navigating away and back naturally collapses everything.
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  // Measured, not a viewport query: beside chat the page is narrow while the
  // window is wide. Unmeasured (the server, tests) draws the full month.
  const [sectionRef, narrow] = useIsNarrow<HTMLElement>(COMPACT_BELOW_WIDTH);
  const compact = narrow === true;
  // The compact month's picked day. Kept even when the month changes; a key
  // outside the shown month falls back below, so it needs no reset.
  const [pickedKey, setPickedKey] = useState<string | null>(null);

  const days = useMemo(() => buildMonthGrid(monthAnchor), [monthAnchor]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, EventRow[]>();
    for (const event of events) {
      const start = parseInstant(event.start_time);
      if (!start) continue;
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
        // `?? 0` is unreachable: only rows the `parseInstant` filter above
        // accepted are in this bucket. It stays as the total function the
        // comparator contract needs, not as a second readability decision.
        const firstTime = parseInstant(first.start_time)?.getTime() ?? 0;
        const secondTime = parseInstant(second.start_time)?.getTime() ?? 0;
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
    onMonthAnchorChange(
      new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() - 1, 1),
    );
  }
  function goToNextMonth() {
    onMonthAnchorChange(
      new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 1),
    );
  }
  function goToToday() {
    onMonthAnchorChange(startOfMonth(new Date()));
    setPickedKey(todayKey);
  }
  // A day from the month before or after (the grid's leading and trailing
  // days carry their dots too) opens its own month, as a phone calendar does.
  function pickDay(day: Date) {
    if (day.getMonth() !== monthAnchor.getMonth()) {
      onMonthAnchorChange(startOfMonth(day));
    }
    setPickedKey(localDayKey(day));
  }

  // The compact month's day: the one picked if it is in this month, else
  // today when this is the current month, else the 1st.
  const monthKeyPrefix = localDayKey(startOfMonth(monthAnchor)).slice(0, 7);
  const shownDayKey = pickedKey?.startsWith(monthKeyPrefix)
    ? pickedKey
    : todayKey.startsWith(monthKeyPrefix)
      ? todayKey
      : localDayKey(startOfMonth(monthAnchor));

  return (
    <section
      ref={sectionRef}
      aria-labelledby="events-calendar-month"
      className="space-y-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="events-calendar-month" className="text-base font-semibold">
          {monthLabel}
        </h2>
        <div className="flex items-center gap-1">
          <Button variant="secondary" size="toolbar" onClick={goToToday}>
            Today
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={compactControlClassName}
            aria-label="Previous month"
            onClick={goToPreviousMonth}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={compactControlClassName}
            aria-label="Next month"
            onClick={goToNextMonth}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {layerToggles}

      {chapterHasEvents ? null : (
        <InlineNote>
          {/*
            The how only when a day can actually be pressed: a lapsed
            chapter or an offline officer gets the fact, and the notice
            above the toolbar says why the days are off.
          */}
          {canCreate && !createDisabled
            ? compact
              ? stateMicrocopy.events.calendarFirstEventCompact
              : stateMicrocopy.events.calendarFirstEvent
            : stateMicrocopy.events.calendarNothingYet}
        </InlineNote>
      )}

      {compact ? (
        <CompactMonth
          days={days}
          monthAnchor={monthAnchor}
          todayKey={todayKey}
          eventsByDay={eventsByDay}
          tasksByDay={tasksByDay}
          nameOf={nameOf}
          shownDayKey={shownDayKey}
          onPickDay={pickDay}
          onSelectEvent={onSelectEvent}
          onCreateOnDay={onCreateOnDay}
          canCreate={canCreate}
          createDisabled={createDisabled}
          createDescribedBy={createDescribedBy}
          createTitle={createTitle}
        />
      ) : (
        /*
        A hairline frame on the page surface, not a card: the grid's 1px gaps
        show `--border` between cells that paint `--background`.
      */
        <div className="overflow-hidden rounded-[14px] border border-border">
          <div className="grid grid-cols-7 gap-px bg-border text-xs font-semibold text-muted-foreground">
            {WEEKDAY_LABELS.map((label) => (
              <div
                key={label}
                className="bg-background px-2 py-1.5 text-center"
              >
                {label}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-px bg-border">
            {days.map((day) => {
              const key = localDayKey(day);
              const dayEvents = eventsByDay.get(key) ?? [];
              const dayTasks = tasksByDay.get(key) ?? [];
              const isCurrentMonth = day.getMonth() === monthAnchor.getMonth();
              const isToday = key === todayKey;
              const isExpanded = expandedDays.has(key);
              // Events first, then tasks, under one cap: the day's first
              // three things, whatever they are, then "+N more".
              const itemCount = dayEvents.length + dayTasks.length;
              const visibleCount =
                isExpanded || itemCount <= MAX_VISIBLE_EVENTS_PER_DAY
                  ? itemCount
                  : MAX_VISIBLE_EVENTS_PER_DAY;
              const visibleEvents = dayEvents.slice(0, visibleCount);
              const visibleTasks = dayTasks.slice(
                0,
                Math.max(0, visibleCount - visibleEvents.length),
              );
              const overflowCount = itemCount - visibleCount;
              const dayLabel = day.toLocaleDateString(undefined, {
                month: "long",
                day: "numeric",
                year: "numeric",
              });

              return (
                <div
                  key={key}
                  className={cn(
                    "flex min-h-24 flex-col gap-1 p-2",
                    isCurrentMonth ? "bg-background" : "bg-surface-1",
                  )}
                >
                  {canCreate ? (
                    <button
                      type="button"
                      disabled={createDisabled}
                      title={createTitle}
                      aria-label={`Create event on ${dayLabel}`}
                      aria-describedby={createDescribedBy}
                      className={cn(
                        dayNumberClassName(isToday, isCurrentMonth),
                        "transition-colors",
                        FOCUS_RING,
                        "hover:bg-card-hover disabled:pointer-events-none disabled:text-disabled",
                      )}
                      onClick={() => onCreateOnDay(day)}
                    >
                      {day.getDate()}
                    </button>
                  ) : (
                    <span
                      className={dayNumberClassName(isToday, isCurrentMonth)}
                    >
                      {day.getDate()}
                    </span>
                  )}

                  {/*
                  Rule 2 of the empty-states plan: the first action sits where
                  the first item will go. A pointer target only: the day
                  number above is the same action and the one a keyboard or a
                  screen reader reaches, so this stays out of both.
                */}
                  {isToday &&
                  canCreate &&
                  !createDisabled &&
                  !chapterHasEvents ? (
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-hidden="true"
                      data-testid="calendar-first-event-slot"
                      className={cn(
                        "flex h-7 items-center justify-center rounded-xs border border-dashed border-input text-muted-foreground transition-colors",
                        "hover:bg-card-hover hover:text-foreground",
                      )}
                      onClick={() => onCreateOnDay(day)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  ) : null}

                  <div className="flex flex-col gap-1">
                    {visibleEvents.map((event) => {
                      const {
                        eventId,
                        eventName,
                        isMandatory,
                        isSeriesHead,
                        isSeriesInstance,
                        viewLabel,
                      } = calendarEventFacts(event);

                      return (
                        <button
                          key={eventId}
                          type="button"
                          title={eventName}
                          aria-label={viewLabel}
                          className={cn(
                            "flex items-center gap-1 truncate rounded-xs border-l-2 bg-surface-1 px-1.5 py-1 text-left text-[11px] font-semibold text-foreground transition-colors",
                            FOCUS_RING,
                            "hover:bg-card-hover",
                            isMandatory
                              ? "border-l-primary"
                              : "border-l-border",
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
                    {visibleTasks.map((item) => (
                      <CalendarTaskChip
                        key={item.key}
                        item={item}
                        nameOf={nameOf}
                      />
                    ))}
                    {overflowCount > 0 ? (
                      <button
                        type="button"
                        className={cn(
                          "rounded-xs px-1.5 py-0.5 text-left text-[11px] font-semibold text-muted-foreground transition-colors",
                          FOCUS_RING,
                          "hover:bg-card-hover hover:text-foreground",
                        )}
                        aria-label={`Show ${overflowCount} more on ${dayLabel}`}
                        onClick={() =>
                          setExpandedDays((previous) => {
                            const next = new Set(previous);
                            next.add(key);
                            return next;
                          })
                        }
                      >
                        +{overflowCount} more
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

type CompactMonthProps = {
  days: Date[];
  monthAnchor: Date;
  todayKey: string;
  eventsByDay: Map<string, EventRow[]>;
  tasksByDay: Map<string, CalendarTask[]>;
  nameOf: (userId: string) => string;
  shownDayKey: string;
  onPickDay: (day: Date) => void;
} & Pick<
  EventsCalendarProps,
  | "onSelectEvent"
  | "onCreateOnDay"
  | "canCreate"
  | "createDisabled"
  | "createDescribedBy"
  | "createTitle"
>;

/**
 * The month on a narrow page (#4022), the shape Google Calendar's and Apple
 * Calendar's phone month views use: each day a dot per event (up to three),
 * pressing a day picks it, and the picked day's events are listed under the
 * grid with their full names and times. Nothing is cut: every event opens
 * from the list, and a creator makes one on the picked day from its
 * "New event" button, which is what the day number does on the wide month.
 */
function CompactMonth({
  days,
  monthAnchor,
  todayKey,
  eventsByDay,
  tasksByDay,
  nameOf,
  shownDayKey,
  onPickDay,
  onSelectEvent,
  onCreateOnDay,
  canCreate,
  createDisabled,
  createDescribedBy,
  createTitle,
}: CompactMonthProps) {
  const shownDay =
    days.find((day) => localDayKey(day) === shownDayKey) ?? days[0]!;
  const shownEvents = eventsByDay.get(shownDayKey) ?? [];
  const shownTasks = tasksByDay.get(shownDayKey) ?? [];
  const shownDayLabel = shownDay.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-[14px] border border-border">
        <div
          aria-hidden="true"
          className="grid grid-cols-7 gap-px bg-border text-caption font-semibold text-muted-foreground"
        >
          {WEEKDAY_LABELS.map((label) => (
            <div key={label} className="bg-background py-1.5 text-center">
              {label.slice(0, 1)}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-px bg-border">
          {days.map((day) => {
            const key = localDayKey(day);
            const count = eventsByDay.get(key)?.length ?? 0;
            const dayTasks = tasksByDay.get(key) ?? [];
            const taskCount = dayTasks.length;
            const hasOverdue = dayTasks.some(
              (item) => item.state === "overdue",
            );
            const isCurrentMonth = day.getMonth() === monthAnchor.getMonth();
            const isToday = key === todayKey;
            const isPicked = key === shownDayKey;
            const dayLabel = day.toLocaleDateString(undefined, {
              month: "long",
              day: "numeric",
            });
            return (
              <button
                key={key}
                type="button"
                aria-pressed={isPicked}
                aria-label={`${dayLabel}, ${count === 0 ? "no events" : `${count} event${count > 1 ? "s" : ""}`}${taskCount === 0 ? "" : `, ${taskCount} task${taskCount > 1 ? "s" : ""}`}`}
                className={cn(
                  "flex min-h-11 flex-col items-center gap-1 py-1.5 transition-colors",
                  FOCUS_RING,
                  isPicked
                    ? "bg-popover"
                    : isCurrentMonth
                      ? "bg-background hover:bg-card-hover"
                      : "bg-surface-1 hover:bg-card-hover",
                )}
                onClick={() => onPickDay(day)}
              >
                <span
                  className={cn(
                    dayNumberClassName(isToday, isCurrentMonth),
                    "h-6 w-6 self-center",
                  )}
                >
                  {day.getDate()}
                </span>
                <span aria-hidden="true" className="flex h-1.5 gap-0.5">
                  {Array.from(
                    { length: Math.min(count, MAX_DOTS_PER_DAY) },
                    (_, index) => (
                      <span
                        key={index}
                        className="h-1.5 w-1.5 rounded-full bg-primary"
                      />
                    ),
                  )}
                  {/*
                    Tasks are one ring after the event dots, however many:
                    a dot is an event, a ring is something due. Red while
                    any of the day's tasks is overdue.
                  */}
                  {taskCount > 0 ? (
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full border",
                        hasOverdue
                          ? "border-destructive-text"
                          : "border-muted-foreground",
                      )}
                    />
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <section aria-labelledby="events-calendar-day" className="space-y-1">
        <div className="flex min-h-9 items-center justify-between gap-2 px-2">
          <h3
            id="events-calendar-day"
            className="text-caption font-semibold text-foreground"
          >
            {shownDayLabel}
          </h3>
          {canCreate ? (
            <Button
              variant="ghost"
              size="toolbar"
              className="gap-1.5"
              disabled={createDisabled}
              title={createTitle}
              aria-describedby={createDescribedBy}
              aria-label={`New event on ${shownDayLabel}`}
              onClick={() => onCreateOnDay(shownDay)}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              New event
            </Button>
          ) : null}
        </div>
        {shownEvents.length === 0 && shownTasks.length === 0 ? (
          <p className="px-2 text-sm text-muted-foreground">
            {stateMicrocopy.events.calendarDayEmpty}
          </p>
        ) : (
          <ul role="list" className="space-y-1">
            {shownEvents.map((event) => {
              const {
                eventId,
                eventName,
                isMandatory,
                isSeriesHead,
                isSeriesInstance,
                clockLabel,
                viewLabel,
              } = calendarEventFacts(event);
              return (
                <li key={eventId}>
                  <button
                    type="button"
                    title={eventName}
                    aria-label={viewLabel}
                    className={cn(
                      "flex min-h-11 w-full items-center gap-3 rounded-md border-l-2 px-2 py-1.5 text-left transition-colors",
                      FOCUS_RING,
                      "hover:bg-card-hover",
                      isMandatory ? "border-l-primary" : "border-l-border",
                    )}
                    onClick={() => onSelectEvent(event)}
                  >
                    <span className="w-16 shrink-0 text-caption tabular-nums text-muted-foreground">
                      {clockLabel ?? ""}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                      {eventName}
                    </span>
                    {isSeriesHead ? (
                      <EventsGlyph className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    ) : null}
                    {isSeriesInstance ? (
                      <Repeat
                        aria-hidden="true"
                        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                      />
                    ) : null}
                  </button>
                </li>
              );
            })}
            {shownTasks.map((item) => (
              <li key={item.key}>
                <CalendarTaskRow item={item} nameOf={nameOf} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
