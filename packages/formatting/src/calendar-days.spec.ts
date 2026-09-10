import { describe, expect, it } from "vitest";
import { dayDelta } from "./calendar-days";

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

  it("survives the spring-forward DST gap", () => {
    // 2026-03-08 is the US spring-forward date: that local day is 23 hours
    // long, so raw-millisecond division would round to the wrong integer.
    // Reading local Y/M/D through `Date.UTC` keeps it at exactly one day.
    expect(dayDelta(at(2026, 3, 7, 12), at(2026, 3, 8, 12))).toBe(1);
    expect(dayDelta(at(2026, 3, 7, 12), at(2026, 3, 9, 12))).toBe(2);
  });

  it("survives the autumn fall-back DST overlap", () => {
    // 2026-11-01 is 25 hours long in the same zone.
    expect(dayDelta(at(2026, 11, 1, 12), at(2026, 11, 2, 12))).toBe(1);
  });

  it("reads the local calendar, not the UTC date", () => {
    // 09:00Z and 20:00Z on the same UTC day are both the 17th locally too in
    // this zone (02:00 and 13:00), so the split must be zero — the property
    // every TODAY/EARLIER and "due tomorrow" caller depends on.
    const morning = new Date("2026-08-17T09:00:00.000Z");
    const evening = new Date("2026-08-17T20:00:00.000Z");
    expect(dayDelta(morning, evening)).toBe(0);
  });
});
