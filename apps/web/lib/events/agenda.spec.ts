import { describe, expect, it } from "vitest";
import { localIsoDate } from "@repo/formatting";
import { collapseSeries } from "@repo/hooks/event-series";
import { addDays } from "@repo/hooks/calendar-time-grid";
import {
  selectCalendarTasks,
  type CalendarItem,
} from "@repo/hooks/calendar-tasks";
import {
  buildAgenda,
  kindsByDay,
  AGENDA_SPAN_DAYS,
  type AgendaInput,
} from "./agenda";

type Row = { id: string; start_time: string | null };

const anchor = new Date(2026, 10, 19);
const at = (days: number, hour = 18) => {
  const day = addDays(anchor, days);
  day.setHours(hour);
  return day.toISOString();
};
const key = (days: number) => localIsoDate(addDays(anchor, days));
const birthday = (days: number): CalendarItem => ({
  kind: "birthdays",
  key: `b-${days}`,
  title: "Dana",
  userId: "u",
  day: key(days),
});
/** The viewer's own task due `days` from the anchor. */
function task(days: number, status = "TODO"): CalendarItem {
  return selectCalendarTasks(
    [
      {
        id: `t-${days}-${status}`,
        title: `Task ${days}`,
        assignee_id: "me",
        created_by: "officer",
        due_date: key(days),
        status,
        points_awarded: status === "COMPLETED",
      },
    ],
    "me",
  )[0]!;
}

function agenda(
  rows: Row[],
  items: CalendarItem[] = [],
  options: Partial<AgendaInput<Row>> = {},
) {
  return buildAgenda<Row>({
    entries: rows.map((event) => ({ event, series: null })),
    items,
    startOf: (event) => event.start_time,
    keyOf: (event) => event.id,
    anchor,
    direction: 1,
    spanDays: AGENDA_SPAN_DAYS,
    forceAnchor: true,
    hidden: new Set(),
    ...options,
  });
}

const shape = (result: ReturnType<typeof agenda>) =>
  result.blocks.map((block) =>
    block.type === "day"
      ? `${block.day.key}:${block.day.rows.map((row) => row.kind).join(",")}`
      : block.type === "overdue"
        ? `overdue:${block.rows.length}`
        : "quiet-week",
  );

describe("buildAgenda (#5560)", () => {
  it("always shows the anchor day, then the days that hold anything", () => {
    const result = agenda([{ id: "a", start_time: at(2) }], [birthday(2)]);
    expect(shape(result)).toEqual([`${key(0)}:`, `${key(2)}:events,birthdays`]);
    expect(result.dayKeys).toEqual(new Set([key(2)]));
  });

  it("says a quiet week once, and carries on past the window to the next day with anything", () => {
    const result = agenda([{ id: "a", start_time: at(45) }]);
    expect(shape(result)).toEqual([
      `${key(0)}:`,
      "quiet-week",
      `${key(45)}:events`,
    ]);
    expect(result.hasMore).toBe(false);
  });

  it("stops at the window and says there is more", () => {
    const result = agenda([
      { id: "a", start_time: at(1) },
      { id: "b", start_time: at(40) },
    ]);
    expect(shape(result)).toEqual([`${key(0)}:`, `${key(1)}:events`]);
    expect(result.hasMore).toBe(true);
    expect(result.counts.events).toBe(1);
  });

  it("gathers unfinished tasks due before today under Overdue, first, counted as Tasks", () => {
    const result = agenda(
      [{ id: "a", start_time: at(1) }],
      [task(-3), task(-2, "COMPLETED"), task(-1, "OVERDUE"), task(1)],
      { overdueBefore: key(0) },
    );
    expect(shape(result)).toEqual([
      "overdue:2",
      `${key(0)}:`,
      `${key(1)}:events,tasks`,
    ]);
    expect(result.counts.tasks).toBe(3);
  });

  it("hides Overdue with the Tasks key, and keeps it out of Past and All", () => {
    const items = [task(-3)];
    expect(
      shape(
        agenda([], items, {
          overdueBefore: key(0),
          hidden: new Set(["tasks"]),
        }),
      )[0],
    ).toBe(`${key(0)}:`);
    expect(shape(agenda([], items))[0]).toBe(`${key(0)}:`);
  });

  it("lists Past back from the anchor, newest first, with no forced day", () => {
    const result = agenda(
      [
        { id: "late", start_time: at(-1) },
        { id: "early", start_time: at(-5) },
      ],
      [],
      { direction: -1, forceAnchor: false },
    );
    expect(shape(result)).toEqual([`${key(-1)}:events`, `${key(-5)}:events`]);
  });

  it("carries Past back past its window to the next day that has anything", () => {
    const result = agenda([{ id: "old", start_time: at(-60) }], [], {
      direction: -1,
      forceAnchor: false,
    });
    expect(shape(result)).toEqual([`${key(-60)}:events`]);
    expect(result.hasMore).toBe(false);
  });

  it("heads Past with a picked day, saying when it's empty", () => {
    const result = agenda([{ id: "old", start_time: at(-2) }], [], {
      direction: -1,
      forceAnchor: true,
    });
    expect(shape(result)).toEqual([`${key(0)}:`, `${key(-2)}:events`]);
  });

  it("hides a kind's rows but still counts them", () => {
    const result = agenda([], [birthday(0), birthday(3)], {
      hidden: new Set(["birthdays"]),
    });
    expect(shape(result)).toEqual([`${key(0)}:`, "quiet-week"]);
    expect(result.counts.birthdays).toBe(2);
  });

  it("counts All's earlier days only as they show", () => {
    const result = agenda(
      [{ id: "old", start_time: at(-10) }],
      [birthday(-20), birthday(-10)],
      { eventsBeforeAnchor: true },
    );
    expect(shape(result)).toEqual([
      `${key(-10)}:events,birthdays`,
      `${key(0)}:`,
      "quiet-week",
    ]);
    expect(result.counts).toEqual({ events: 1, tasks: 0, birthdays: 1 });

    // With events off, an event-only earlier day no longer shows or counts.
    const hidden = agenda([{ id: "old", start_time: at(-10) }], [], {
      eventsBeforeAnchor: true,
      hidden: new Set(["events"]),
    });
    expect(shape(hidden)).toEqual([`${key(0)}:`, "quiet-week"]);
    expect(hidden.counts.events).toBe(0);
  });

  it("lists events with no readable start last, under their own group", () => {
    const result = agenda([
      { id: "a", start_time: null },
      { id: "b", start_time: at(1) },
    ]);
    expect(shape(result)).toEqual([
      `${key(0)}:`,
      `${key(1)}:events`,
      "undated:events",
    ]);
  });

  it("re-collapses a series from a later anchor, so its meeting there shows", () => {
    const series = [0, 7, 14].map((offset, index) => ({
      id: `s-${index}`,
      start_time: at(offset),
      recurrence_rule: index === 0 ? "WEEKLY" : null,
      parent_event_id: index === 0 ? null : "s-0",
    }));
    const later = addDays(anchor, 7);
    const entries = collapseSeries(
      series.filter((event) => new Date(event.start_time) >= later),
      anchor.getTime(),
    );
    const result = buildAgenda({
      entries,
      items: [],
      startOf: (event) => event.start_time,
      keyOf: (event) => event.id,
      anchor: later,
      direction: 1,
      spanDays: AGENDA_SPAN_DAYS,
      forceAnchor: true,
      hidden: new Set(),
    });
    expect(result.dayKeys).toEqual(new Set([key(7)]));
  });
});

describe("kindsByDay", () => {
  it("files each kind on its day, less what the key hides", () => {
    const map = kindsByDay(
      [{ id: "a", start_time: at(1) }],
      (event) => event.start_time,
      [birthday(1), task(1)],
      new Set(["birthdays"]),
    );
    expect(map.get(key(1))).toEqual(new Set(["events", "tasks"]));
  });
});
