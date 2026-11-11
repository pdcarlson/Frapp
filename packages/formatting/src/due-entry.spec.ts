import { describe, expect, it } from "vitest";
import {
  dueEntryFields,
  dueEntryFromTask,
  formatDueEntry,
  parseDueEntry,
  parseDueEntryWithTime,
} from "./due-entry";

// Monday, 9 November 2026, mid-afternoon local.
const NOW = new Date(2026, 10, 9, 15, 30);

describe("parseDueEntry (#3928)", () => {
  it.each([
    ["Nov 14", "2026-11-14"],
    ["november 14th", "2026-11-14"],
    ["14 Nov", "2026-11-14"],
    ["Nov. 14", "2026-11-14"],
    ["11/14", "2026-11-14"],
    ["11-14", "2026-11-14"],
    ["  12/1 ", "2026-12-01"],
    ["sept 3", "2027-09-03"],
  ])("reads %j as a month and a day", (text, expected) => {
    expect(parseDueEntry(text, NOW)).toBe(expected);
  });

  it("fills in the year as the next time the date comes round", () => {
    // Today counts: a task can be due the day it is filed.
    expect(parseDueEntry("11/9", NOW)).toBe("2026-11-09");
    // Yesterday's date is next year's.
    expect(parseDueEntry("11/8", NOW)).toBe("2027-11-08");
    expect(parseDueEntry("Jan 5", NOW)).toBe("2027-01-05");
  });

  it("finds the next leap day", () => {
    expect(parseDueEntry("Feb 29", NOW)).toBe("2028-02-29");
  });

  it("takes a typed year as written, so a far-off date stays reachable", () => {
    expect(parseDueEntry("Nov 14 2027", NOW)).toBe("2027-11-14");
    expect(parseDueEntry("Nov 14, 2027", NOW)).toBe("2027-11-14");
    expect(parseDueEntry("11/14/27", NOW)).toBe("2027-11-14");
    expect(parseDueEntry("11/14/2028", NOW)).toBe("2028-11-14");
    expect(parseDueEntry("11/14 2027", NOW)).toBe("2027-11-14");
    expect(parseDueEntry("2027-11-14", NOW)).toBe("2027-11-14");
    // A named year is not second-guessed, as the date input it replaced.
    expect(parseDueEntry("2020-01-01", NOW)).toBe("2020-01-01");
  });

  it("reads the relative words", () => {
    expect(parseDueEntry("today", NOW)).toBe("2026-11-09");
    expect(parseDueEntry("Tomorrow", NOW)).toBe("2026-11-10");
    expect(parseDueEntry("next week", NOW)).toBe("2026-11-16");
  });

  it("reads a weekday as the next one after today", () => {
    expect(parseDueEntry("fri", NOW)).toBe("2026-11-13");
    expect(parseDueEntry("Friday", NOW)).toBe("2026-11-13");
    expect(parseDueEntry("sun", NOW)).toBe("2026-11-15");
    // On a Monday, "Monday" is next week's, not today.
    expect(parseDueEntry("monday", NOW)).toBe("2026-11-16");
  });

  it("reads back what the field shows, past dates included", () => {
    for (const iso of [
      "2026-11-09",
      "2026-11-14",
      "2026-12-31",
      "2027-03-14",
      "2028-02-29",
      // Earlier this year: shown with its year, or it would read as 2027.
      "2026-11-08",
      "2026-01-05",
      "2025-06-01",
    ]) {
      expect(parseDueEntry(formatDueEntry(iso, NOW), NOW)).toBe(iso);
    }
  });

  it("reads narrowly where a number could be something else", () => {
    // `/task` runs this over what follows the @member.
    for (const text of [
      "1.5",
      "11.14",
      "tom",
      "11/14 10",
      "11/14 5",
      "Nov 14 1000",
      "Nov 14 5",
      "11/14/1999",
      "2150-01-01",
    ]) {
      expect(parseDueEntry(text, NOW), text).toBeNull();
    }
  });

  it.each(["", "   ", "soon", "Feb 30", "13/1", "11/31", "nov", "14", "ma 3"])(
    "returns null for %j",
    (text) => {
      expect(parseDueEntry(text, NOW)).toBeNull();
    },
  );
});

describe("formatDueEntry", () => {
  it("leaves the year off inside the current one and shows it outside", () => {
    expect(formatDueEntry("2026-11-14", NOW)).toBe("Sat, Nov 14");
    expect(formatDueEntry("2026-11-09", NOW)).toBe("Mon, Nov 9");
    expect(formatDueEntry("2027-03-14", NOW)).toBe("Mar 14, 2027");
  });

  it("shows the year on a day already past, even this year", () => {
    expect(formatDueEntry("2026-11-02", NOW)).toBe("Nov 2, 2026");
  });

  it("is English in every locale, so the parser can read it back", () => {
    const real = Date.prototype.toLocaleDateString;
    Date.prototype.toLocaleDateString = function (_locale, options) {
      return real.call(this, "es-US", options);
    };
    try {
      expect(formatDueEntry("2026-11-14", NOW)).toBe("Sat, Nov 14");
      expect(formatDueEntry("2027-03-14", NOW)).toBe("Mar 14, 2027");
    } finally {
      Date.prototype.toLocaleDateString = real;
    }
  });
});

describe("parseDueEntryWithTime (#4003)", () => {
  it.each([
    ["Fri 5pm", "2026-11-13T17:00"],
    ["friday 5 pm", "2026-11-13T17:00"],
    ["5pm friday", "2026-11-13T17:00"],
    ["11/14 9:30am", "2026-11-14T09:30"],
    ["Nov 14 at 11:59 PM", "2026-11-14T23:59"],
    ["tomorrow noon", "2026-11-10T12:00"],
    ["tomorrow 17:30", "2026-11-10T17:30"],
    ["today 12am", "2026-11-09T00:00"],
    // A time alone: today while it's still ahead, tomorrow once it has gone.
    ["6pm", "2026-11-09T18:00"],
    ["9am", "2026-11-10T09:00"],
    // Its own output reads back.
    ["Fri, Nov 13 · 5 PM", "2026-11-13T17:00"],
    ["Fri, Nov 13 · 5:30 PM", "2026-11-13T17:30"],
    // No time: just the date, as before.
    ["Nov 14", "2026-11-14"],
  ])("reads %j as %s", (raw, expected) => {
    expect(parseDueEntryWithTime(raw, NOW)).toBe(expected);
  });

  it.each(["fri 5", "13pm", "5:75pm", "24:00", "Feb 30 5pm", "soon 5pm"])(
    "refuses %j",
    (raw) => {
      expect(parseDueEntryWithTime(raw, NOW)).toBe(null);
    },
  );
});

describe("formatDueEntry with a time", () => {
  it("adds the time after the day, minutes only when there are some", () => {
    expect(formatDueEntry("2026-11-13T17:00", NOW)).toBe("Fri, Nov 13 · 5 PM");
    expect(formatDueEntry("2026-11-13T09:05", NOW)).toBe(
      "Fri, Nov 13 · 9:05 AM",
    );
    expect(formatDueEntry("2026-11-13T00:00", NOW)).toBe("Fri, Nov 13 · 12 AM");
    expect(formatDueEntry("2026-11-13T12:00", NOW)).toBe("Fri, Nov 13 · 12 PM");
  });
});

describe("dueEntryFields / dueEntryFromTask", () => {
  it("sends a day alone as a day", () => {
    expect(dueEntryFields("2026-11-13")).toEqual({ due_date: "2026-11-13" });
  });

  it("sends a time as the device-local instant, and reads it back", () => {
    const fields = dueEntryFields("2026-11-13T17:00");
    // The suite runs in America/Los_Angeles (PST, UTC-8).
    expect(fields).toEqual({
      due_date: "2026-11-13",
      due_at: "2026-11-14T01:00:00.000Z",
    });
    expect(dueEntryFromTask(fields)).toBe("2026-11-13T17:00");
    expect(dueEntryFromTask({ due_date: "2026-11-13", due_at: null })).toBe(
      "2026-11-13",
    );
  });
});
