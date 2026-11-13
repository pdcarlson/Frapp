import { afterEach, describe, expect, it } from "vitest";
import {
  blockGeometry,
  consecutiveDays,
  endsWithinDay,
  HOUR_HEIGHT,
  isAllDaySpan,
  layoutDay,
  MIN_BLOCK_MINUTES,
  spanWithinDay,
  timeGridColumns,
  type TimedSpan,
} from "./calendar-time-grid";

function span(id: string, start: number, end: number): TimedSpan<string> {
  return { item: id, startMinute: start, endMinute: end };
}

function lanesOf(spans: TimedSpan<string>[]) {
  return Object.fromEntries(
    layoutDay(spans).map((placed) => [
      placed.item,
      `${placed.lane}/${placed.lanes}`,
    ]),
  );
}

describe("layoutDay", () => {
  it("gives an event alone the whole column", () => {
    expect(lanesOf([span("a", 540, 600)])).toEqual({ a: "0/1" });
  });

  it("puts overlapping events side by side", () => {
    expect(lanesOf([span("a", 540, 660), span("b", 600, 720)])).toEqual({
      a: "0/2",
      b: "1/2",
    });
  });

  it("starts a new group once the earlier ones have ended", () => {
    expect(
      lanesOf([span("a", 540, 600), span("b", 600, 660), span("c", 600, 630)]),
    ).toEqual({ a: "0/1", b: "0/2", c: "1/2" });
  });

  it("reuses a freed lane inside a chain of overlaps", () => {
    // a overlaps b, b overlaps c, but a has ended when c starts.
    expect(
      lanesOf([span("a", 540, 600), span("b", 570, 690), span("c", 630, 690)]),
    ).toEqual({ a: "0/2", b: "1/2", c: "0/2" });
  });

  it("puts the longer of two same-start events on the left", () => {
    expect(lanesOf([span("short", 540, 570), span("long", 540, 720)])).toEqual({
      long: "0/2",
      short: "1/2",
    });
  });

  it("judges overlap on the drawn height of a very short event", () => {
    expect(lanesOf([span("a", 540, 545), span("b", 555, 600)])).toEqual({
      a: "0/2",
      b: "1/2",
    });
  });
});

describe("spanWithinDay", () => {
  const day = new Date(2026, 10, 13);

  it("measures minutes from the day's midnight", () => {
    expect(
      spanWithinDay(
        new Date(2026, 10, 13, 18, 30),
        new Date(2026, 10, 13, 20, 0),
        day,
      ),
    ).toEqual({ startMinute: 1110, endMinute: 1200 });
  });

  it("clips an event that runs past midnight to each day", () => {
    const start = new Date(2026, 10, 13, 22, 0);
    const end = new Date(2026, 10, 14, 2, 0);
    expect(spanWithinDay(start, end, day)).toEqual({
      startMinute: 1320,
      endMinute: 1440,
    });
    expect(spanWithinDay(start, end, new Date(2026, 10, 14))).toEqual({
      startMinute: 0,
      endMinute: 120,
    });
  });

  it("treats a missing or backwards end as an hour", () => {
    const start = new Date(2026, 10, 13, 9, 0);
    expect(spanWithinDay(start, null, day)).toEqual({
      startMinute: 540,
      endMinute: 600,
    });
    expect(spanWithinDay(start, new Date(2026, 10, 13, 8), day)).toEqual({
      startMinute: 540,
      endMinute: 600,
    });
  });

  it("is null for another day's event", () => {
    expect(
      spanWithinDay(new Date(2026, 10, 12, 9), new Date(2026, 10, 12, 10), day),
    ).toBeNull();
  });
});

describe("week helpers", () => {
  it("counts days across a month end", () => {
    expect(consecutiveDays(new Date(2026, 10, 29), 3)).toEqual([
      new Date(2026, 10, 29),
      new Date(2026, 10, 30),
      new Date(2026, 11, 1),
    ]);
  });

  it("files a day-long event in the all-day strip", () => {
    expect(isAllDaySpan(new Date(2026, 10, 13), new Date(2026, 10, 14))).toBe(
      true,
    );
    expect(
      isAllDaySpan(new Date(2026, 10, 13, 9), new Date(2026, 10, 13, 17)),
    ).toBe(false);
  });
});

describe("timeGridColumns (#4825)", () => {
  // Local wall-clock instants, as an event row's `start_time` arrives.
  const at = (day: number, hour: number, minute = 0) =>
    new Date(2026, 10, day, hour, minute).toISOString();
  const days = consecutiveDays(new Date(2026, 10, 13), 2);

  it("places a timed event as a block on its own day only", () => {
    const meeting = { id: "m", start_time: at(13, 18), end_time: at(13, 19) };
    const [fri, sat] = timeGridColumns(days, [meeting], new Map());
    expect(fri!.placed).toEqual([
      {
        item: meeting,
        startMinute: 18 * 60,
        endMinute: 19 * 60,
        lane: 0,
        lanes: 1,
      },
    ]);
    expect(fri!.allDay).toEqual([]);
    expect(sat!.placed).toEqual([]);
  });

  it("clips an event past midnight into both days", () => {
    const late = { id: "l", start_time: at(13, 22), end_time: at(14, 2) };
    const [fri, sat] = timeGridColumns(days, [late], new Map());
    expect(fri!.placed[0]).toMatchObject({
      startMinute: 22 * 60,
      endMinute: 1440,
    });
    expect(sat!.placed[0]).toMatchObject({ startMinute: 0, endMinute: 2 * 60 });
  });

  it("puts a day-long event in the strip of the days it covers, and no others", () => {
    const retreat = { id: "r", start_time: at(13, 9), end_time: at(14, 17) };
    const [fri, sat, sun] = timeGridColumns(
      consecutiveDays(new Date(2026, 10, 13), 3),
      [retreat],
      new Map(),
    );
    expect(fri!.allDay).toEqual([retreat]);
    expect(sat!.allDay).toEqual([retreat]);
    expect(sun!.allDay).toEqual([]);
    for (const column of [fri!, sat!, sun!]) expect(column.placed).toEqual([]);
  });

  it("lays overlapping events side by side", () => {
    const a = { id: "a", start_time: at(13, 9), end_time: at(13, 11) };
    const b = { id: "b", start_time: at(13, 10), end_time: at(13, 12) };
    const [fri] = timeGridColumns(days, [a, b], new Map());
    expect(fri!.placed.map((p) => [p.item.id, p.lane, p.lanes])).toEqual([
      ["a", 0, 2],
      ["b", 1, 2],
    ]);
  });

  it("gives an event with no end an hour, and drops one with no start", () => {
    const open = { id: "o", start_time: at(13, 9), end_time: null };
    const broken = { id: "x", start_time: "not a date", end_time: null };
    const [fri] = timeGridColumns(days, [open, broken], new Map());
    expect(fri!.placed.map((p) => [p.item.id, p.endMinute])).toEqual([
      ["o", 10 * 60],
    ]);
  });

  it("keys each column by its local date and attaches that day's tasks", () => {
    const tasks = new Map([["2026-11-14", ["dues"]]]);
    const [fri, sat] = timeGridColumns(days, [], tasks);
    expect([fri!.key, sat!.key]).toEqual(["2026-11-13", "2026-11-14"]);
    expect(fri!.tasks).toEqual([]);
    expect(sat!.tasks).toEqual(["dues"]);
    expect(sat!.day).toEqual(new Date(2026, 10, 14));
  });
});

/* eslint-disable turbo/no-undeclared-env-vars -- the zone under test, not a
   build input. */
describe("timeGridColumns keys by the local date east of UTC", () => {
  // Local midnight in Tokyo is the previous day in UTC, so a key built from
  // the UTC date would hand each column the day before's tasks. Node reads
  // TZ afresh when it is set, so this zone holds for these tests only.
  const zone = process.env.TZ;
  afterEach(() => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });

  it("files tasks under the column's own day in Tokyo", () => {
    process.env.TZ = "Asia/Tokyo";
    const day = new Date(2026, 10, 14);
    expect(day.toISOString().slice(0, 10)).toBe("2026-11-13");
    const [column] = timeGridColumns(
      [day],
      [],
      new Map([
        ["2026-11-13", ["yesterday"]],
        ["2026-11-14", ["today"]],
      ]),
    );
    expect(column!.key).toBe("2026-11-14");
    expect(column!.tasks).toEqual(["today"]);
  });
});

/* eslint-enable turbo/no-undeclared-env-vars */

describe("blockGeometry (#4825)", () => {
  it("draws a block from its start, as tall as it lasts", () => {
    expect(
      blockGeometry({ startMinute: 18 * 60, endMinute: 19 * 60 + 30 }),
    ).toEqual({
      top: 18 * HOUR_HEIGHT,
      height: 1.5 * HOUR_HEIGHT,
    });
  });

  it("never draws a block shorter than the overlap rule's minimum", () => {
    // MIN_BLOCK_MINUTES, the height layoutDay judges overlaps on.
    expect(
      blockGeometry({ startMinute: 9 * 60, endMinute: 9 * 60 + 10 }).height,
    ).toBe((MIN_BLOCK_MINUTES / 60) * HOUR_HEIGHT);
  });

  it("shows an end time only for a block that ends inside its day", () => {
    expect(endsWithinDay({ endMinute: 23 * 60 })).toBe(true);
    expect(endsWithinDay({ endMinute: 24 * 60 })).toBe(false);
  });
});
