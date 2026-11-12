import { describe, expect, it } from "vitest";
import { checkInLabel, pointsLabel, recurrenceLabel } from "./event-labels";

// Built from local wall-clock parts so the day comparison holds in any zone
// the suite runs in.
const local = (y: number, m: number, d: number, h: number, min: number) =>
  new Date(y, m - 1, d, h, min).toISOString();

describe("recurrenceLabel", () => {
  it("reads every catalog rule as its picker label", () => {
    expect(recurrenceLabel("WEEKLY")).toBe("Weekly");
    expect(recurrenceLabel("BIWEEKLY")).toBe("Bi-weekly");
    expect(recurrenceLabel("MONTHLY")).toBe("Monthly");
  });

  it("is absent for a one-time event, not a One-time label", () => {
    expect(recurrenceLabel(null)).toBeNull();
    expect(recurrenceLabel(undefined)).toBeNull();
    expect(recurrenceLabel("")).toBeNull();
  });

  it("reads a structured rule as its pattern", () => {
    expect(
      recurrenceLabel(
        "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TH;COUNT=20;TZID=America/New_York",
      ),
    ).toBe("Every Mon and Thu");
  });

  it("never prints a raw token it does not know", () => {
    expect(recurrenceLabel("EVERY_OTHER_DAY")).toBe("Every other day");
  });
});

describe("pointsLabel", () => {
  it("pluralises", () => {
    expect(pointsLabel(1)).toBe("1 point");
    expect(pointsLabel(5)).toBe("5 points");
  });

  it("is absent when the event awards nothing", () => {
    expect(pointsLabel(0)).toBeNull();
    expect(pointsLabel(undefined)).toBeNull();
    expect(pointsLabel("5")).toBeNull();
  });
});

describe("checkInLabel", () => {
  const start = local(2026, 11, 6, 17, 0);

  it("gives the time of day alone on the event's own day", () => {
    expect(checkInLabel(local(2026, 11, 6, 17, 3), start)).toMatch(
      /^Checked in 5:03\sPM$/,
    );
  });

  it("names the day when the check-in landed on another one", () => {
    const label = checkInLabel(
      local(2026, 11, 7, 0, 10),
      start,
      new Date(2026, 10, 5),
    );
    expect(label).toMatch(/^Checked in Sat, Nov 7 · 12:10\sAM$/);
  });

  it("never prints seconds or a numeric date", () => {
    const label = checkInLabel(local(2026, 11, 6, 17, 3), start) ?? "";
    expect(label).not.toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/);
    expect(label).not.toMatch(/:\d\d:\d\d/);
  });

  it("is absent without a readable check-in time", () => {
    expect(checkInLabel(null, start)).toBeNull();
    expect(checkInLabel("not a date", start)).toBeNull();
  });
});
