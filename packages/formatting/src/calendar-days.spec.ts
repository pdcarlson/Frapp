import { describe, expect, it } from "vitest";
import { dayDelta, monthGrid, startOfMonth } from "./calendar-days";

/** Local wall-clock construction — the suite pins `TZ=America/Los_Angeles`. */
function at(year: number, month: number, day: number, hour: number): Date {
  return new Date(year, month - 1, day, hour);
}

describe("dayDelta", () => {
  it("counts calendar days, not elapsed hours", () => {
    // Two hours apart, one calendar day apart.
    expect(dayDelta(at(2026, 8, 17, 23), at(2026, 8, 18, 1))).toBe(1);
    // Twenty-two hours apart, same calendar day.
    expect(dayDelta(at(2026, 8, 17, 1), at(2026, 8, 17, 23))).toBe(0);
  });

  it("is signed — a `to` before `from` counts backwards", () => {
    expect(dayDelta(at(2026, 8, 18, 9), at(2026, 8, 17, 9))).toBe(-1);
  });

  it("is zero for the same instant", () => {
    const now = at(2026, 8, 17, 9);
    expect(dayDelta(now, now)).toBe(0);
  });

  it("crosses a month boundary", () => {
    expect(dayDelta(at(2026, 8, 31, 9), at(2026, 9, 1, 9))).toBe(1);
  });

  it("crosses a year boundary", () => {
    expect(dayDelta(at(2026, 12, 31, 9), at(2027, 1, 1, 9))).toBe(1);
  });

  // The two DST cases below pin stability across a transition, not a
  // difference from elapsed-time arithmetic: `Math.round` absorbs a ±1h offset
  // at equal hour-of-day, so a naive `(to - from) / MS_PER_DAY` answers these
  // correctly too. The case that separates the two readings is the first test
  // above. These guard a future rewrite that counts local midnights or steps
  // days by hand, both of which go wrong on a 23- or 25-hour day.

  it("is stable across the spring-forward DST gap", () => {
    // 2026-03-08 is the US spring-forward date — that local day is 23h long.
    expect(dayDelta(at(2026, 3, 7, 12), at(2026, 3, 8, 12))).toBe(1);
    expect(dayDelta(at(2026, 3, 7, 12), at(2026, 3, 9, 12))).toBe(2);
  });

  it("is stable across the autumn fall-back DST overlap", () => {
    // 2026-11-01 is 25h long in the same zone.
    expect(dayDelta(at(2026, 11, 1, 12), at(2026, 11, 2, 12))).toBe(1);
  });

  it("reads the local calendar, not the UTC date", () => {
    // Both instants land on 2026-08-17 in UTC, so a UTC-date reading answers 0.
    // In this zone they are the 16th at 19:00 and the 17th at 13:00, so the
    // local reading answers 1. This assertion is the one that fails if the
    // body is ever swapped to `getUTC*` — the property every TODAY/EARLIER and
    // "due tomorrow" caller depends on.
    const before = new Date("2026-08-17T02:00:00.000Z");
    const after = new Date("2026-08-17T20:00:00.000Z");
    expect(dayDelta(before, after)).toBe(1);
  });
});

describe("monthGrid", () => {
  it("draws six weeks from the Sunday on or before the 1st", () => {
    // November 2026 starts on a Sunday.
    const nov = monthGrid(at(2026, 11, 18, 12));
    expect(nov).toHaveLength(42);
    expect(nov[0]).toEqual(new Date(2026, 10, 1));
    expect(nov[41]).toEqual(new Date(2026, 11, 12));
    // December 2026 starts on a Tuesday, so the grid opens on Nov 29.
    const dec = monthGrid(at(2026, 12, 1, 0));
    expect(dec[0]).toEqual(new Date(2026, 10, 29));
    expect(dec[2]).toEqual(new Date(2026, 11, 1));
  });

  it("keeps every cell on local midnight across a DST change", () => {
    // Los Angeles springs forward on Mar 8, 2026 and falls back on Nov 1.
    for (const anchor of [at(2026, 3, 1, 0), at(2026, 11, 1, 0)]) {
      const grid = monthGrid(anchor);
      for (const [index, day] of grid.entries()) {
        expect(day.getHours()).toBe(0);
        if (index > 0) expect(dayDelta(grid[index - 1]!, day)).toBe(1);
      }
    }
  });

  it("starts a month at its first day", () => {
    expect(startOfMonth(at(2026, 2, 28, 23))).toEqual(new Date(2026, 1, 1));
  });
});
