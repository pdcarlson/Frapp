// Runs under TZ=America/Los_Angeles (package.json), in the en-US locale.
import { describe, expect, it } from "vitest";
import {
  formatDay,
  formatDayRange,
  formatDayTime,
  formatDayTimeRange,
  formatDueLabel,
  formatListStamp,
  formatRelativeDayTime,
  formatTimestampFull,
  formatWeekdayDay,
} from "./display";

// Wed Nov 4, 2026, 9:00 AM Pacific.
const NOW = new Date("2026-11-04T09:00:00-08:00");
// Fri Nov 6, 2026, 5:00 PM Pacific.
const FRI_5PM = "2026-11-07T01:00:00.000Z";

describe("house date shapes", () => {
  it("leaves a missing or unreadable value out", () => {
    for (const fn of [formatDay, formatWeekdayDay, formatDayTime, formatRelativeDayTime, formatDueLabel]) {
      expect(fn(undefined, NOW)).toBeNull();
      expect(fn("", NOW)).toBeNull();
      expect(fn("not a date", NOW)).toBeNull();
    }
    expect(formatTimestampFull(null)).toBeNull();
    expect(formatDayTimeRange(undefined, FRI_5PM, NOW)).toBeNull();
    expect(formatDayRange("2026-08-24", undefined)).toBeNull();
  });

  it("prints a day as a short month and day, adding the year only outside this one", () => {
    expect(formatDay(FRI_5PM, NOW)).toBe("Nov 6");
    expect(formatDay("2025-11-06T20:00:00Z", NOW)).toBe("Nov 6, 2025");
    expect(formatWeekdayDay(FRI_5PM, NOW)).toBe("Fri, Nov 6");
  });

  it("keeps a bare date on its calendar day, west of Greenwich", () => {
    // `new Date("2026-11-04")` is UTC midnight: Nov 3 in Los Angeles.
    expect(formatDay("2026-11-04", NOW)).toBe("Nov 4");
    expect(formatDueLabel("2026-11-04", NOW)).toBe("Due today");
  });

  it("prints a time after a middle dot, never with seconds", () => {
    expect(formatDayTime(FRI_5PM, NOW)).toBe("Fri, Nov 6 · 5:00 PM");
    expect(formatDayTime("2026-11-07T01:00:42.000Z", NOW)).not.toMatch(/:42/);
    expect(formatTimestampFull(FRI_5PM)).toBe("Nov 6, 2026, 5:00 PM");
  });

  it("says a shared day period once in a range", () => {
    expect(formatDayTimeRange(FRI_5PM, "2026-11-07T03:00:00.000Z", NOW)).toBe(
      "Fri, Nov 6 · 5:00 – 7:00 PM",
    );
    expect(formatDayTimeRange("2026-11-06T19:00:00.000Z", FRI_5PM, NOW)).toBe(
      "Fri, Nov 6 · 11:00 AM – 5:00 PM",
    );
    expect(formatDayTimeRange(FRI_5PM, "2026-11-07T09:00:00.000Z", NOW)).toBe(
      "Fri, Nov 6 · 5:00 PM – Sat, Nov 7 · 1:00 AM",
    );
    expect(formatDayTimeRange(FRI_5PM, null, NOW)).toBe("Fri, Nov 6 · 5:00 PM");
  });

  it("spans days with the year said once", () => {
    expect(formatDayRange("2026-08-24", "2026-12-12")).toBe("Aug 24 – Dec 12, 2026");
    expect(formatDayRange("2026-12-01", "2027-01-15")).toBe("Dec 1, 2026 – Jan 15, 2027");
  });

  it("reads a row's when relative to today, as mobile's event row does", () => {
    expect(formatRelativeDayTime("2026-11-04T17:00:00-08:00", NOW)).toBe("Today · 5:00 PM");
    expect(formatRelativeDayTime("2026-11-05T17:00:00-08:00", NOW)).toBe("Tomorrow · 5:00 PM");
    expect(formatRelativeDayTime("2026-11-03T17:00:00-08:00", NOW)).toBe("Yesterday · 5:00 PM");
    expect(formatRelativeDayTime(FRI_5PM, NOW)).toBe("Friday · 5:00 PM");
    expect(formatRelativeDayTime("2026-11-20T17:00:00-08:00", NOW)).toBe("Nov 20 · 5:00 PM");
  });

  it("stamps a message list row: clock today, then Yesterday, weekday, date", () => {
    expect(formatListStamp("2026-11-04T08:41:00-08:00", NOW)).toBe("8:41 AM");
    expect(formatListStamp("2026-11-03T17:00:00-08:00", NOW)).toBe("Yesterday");
    expect(formatListStamp("2026-11-02T17:00:00-08:00", NOW)).toBe("Mon");
    expect(formatListStamp("2026-10-29T17:00:00-08:00", NOW)).toBe("Thu");
    expect(formatListStamp("2026-10-28T17:00:00-08:00", NOW)).toBe("Oct 28");
    expect(formatListStamp("2025-12-30T17:00:00-08:00", NOW)).toBe("Dec 30, 2025");
    expect(formatListStamp(undefined, NOW)).toBeNull();
  });

  it("counts a due date down, as mobile's task subtitle does", () => {
    expect(formatDueLabel("2026-11-05", NOW)).toBe("Due tomorrow");
    expect(formatDueLabel("2026-11-06", NOW)).toBe("Due Friday");
    expect(formatDueLabel("2026-11-20", NOW)).toBe("Due Nov 20");
    expect(formatDueLabel("2026-11-03", NOW)).toBe("Overdue by 1 day");
    expect(formatDueLabel("2026-11-01", NOW)).toBe("Overdue by 3 days");
  });
});
