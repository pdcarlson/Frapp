import { describe, expect, it } from "vitest";
import {
  consecutiveDays,
  isAllDaySpan,
  layoutDay,
  spanWithinDay,
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
