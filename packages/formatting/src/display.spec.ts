// Runs under TZ=America/Los_Angeles (package.json), in the en-US locale.
import { describe, expect, it } from "vitest";
import {
  formatDay,
  formatDayHeading,
  formatDayRange,
  formatDayTime,
  formatDayTimeRange,
  formatDueLabel,
  formatEndsLabel,
  formatDueOn,
  formatEventWindow,
  formatPoints,
  formatPointsChip,
  formatRelativeDayTime,
  formatSentLabel,
  formatActedLabel,
  formatTimestampFull,
  formatWeekdayDay,
  isDueOverdue,
} from "./display";

// Wed Nov 4, 2026, 9:00 AM Pacific.
const NOW = new Date("2026-11-04T09:00:00-08:00");
// Fri Nov 6, 2026, 5:00 PM Pacific.
const FRI_5PM = "2026-11-07T01:00:00.000Z";

describe("house date shapes", () => {
  it("leaves a missing or unreadable value out", () => {
    for (const fn of [
      formatDay,
      formatWeekdayDay,
      formatDayTime,
      formatRelativeDayTime,
      formatDueLabel,
    ]) {
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
    expect(formatDayRange("2026-08-24", "2026-12-12")).toBe(
      "Aug 24 – Dec 12, 2026",
    );
    expect(formatDayRange("2026-12-01", "2027-01-15")).toBe(
      "Dec 1, 2026 – Jan 15, 2027",
    );
  });

  it("reads a row's when relative to today, as mobile's event row does", () => {
    expect(formatRelativeDayTime("2026-11-04T17:00:00-08:00", NOW)).toBe(
      "Today · 5:00 PM",
    );
    expect(formatRelativeDayTime("2026-11-05T17:00:00-08:00", NOW)).toBe(
      "Tomorrow · 5:00 PM",
    );
    expect(formatRelativeDayTime("2026-11-03T17:00:00-08:00", NOW)).toBe(
      "Yesterday · 5:00 PM",
    );
    expect(formatRelativeDayTime(FRI_5PM, NOW)).toBe("Friday · 5:00 PM");
    expect(formatRelativeDayTime("2026-11-20T17:00:00-08:00", NOW)).toBe(
      "Nov 20 · 5:00 PM",
    );
  });

  it("writes a day heading out, as the Events lists group by", () => {
    expect(formatDayHeading("2026-11-04T17:00:00-08:00", NOW)).toBe("Today");
    expect(formatDayHeading("2026-11-05T08:00:00-08:00", NOW)).toBe("Tomorrow");
    expect(formatDayHeading("2026-11-03T17:00:00-08:00", NOW)).toBe(
      "Yesterday",
    );
    expect(formatDayHeading(FRI_5PM, NOW)).toBe("Friday");
    expect(formatDayHeading("2026-11-10T17:00:00-08:00", NOW)).toBe("Tuesday");
    expect(formatDayHeading("2026-11-11T17:00:00-08:00", NOW)).toBe(
      "November 11",
    );
    expect(formatDayHeading("2026-10-30T17:00:00-07:00", NOW)).toBe(
      "October 30",
    );
    expect(formatDayHeading("2027-01-03T17:00:00-08:00", NOW)).toBe(
      "January 3, 2027",
    );
    expect(formatDayHeading(null, NOW)).toBeNull();
  });

  it("counts a due date down, as mobile's task subtitle does", () => {
    expect(formatDueLabel("2026-11-05", NOW)).toBe("Due tomorrow");
    expect(formatDueLabel("2026-11-06", NOW)).toBe("Due Friday");
    expect(formatDueLabel("2026-11-20", NOW)).toBe("Due Nov 20");
    expect(formatDueLabel("2026-11-03", NOW)).toBe("Overdue by 1 day");
    expect(formatDueLabel("2026-11-01", NOW)).toBe("Overdue by 3 days");
  });

  it("writes a day heading out: Today, Tomorrow, Yesterday, the weekday, then the date", () => {
    expect(formatDayHeading("2026-11-04T23:00:00-08:00", NOW)).toBe("Today");
    expect(formatDayHeading("2026-11-05T00:30:00-08:00", NOW)).toBe("Tomorrow");
    expect(formatDayHeading("2026-11-03T20:00:00-08:00", NOW)).toBe(
      "Yesterday",
    );
    expect(formatDayHeading(FRI_5PM, NOW)).toBe("Friday");
    // Six days ahead is still the weekday; seven is the date.
    expect(formatDayHeading("2026-11-10T18:00:00-08:00", NOW)).toBe("Tuesday");
    expect(formatDayHeading("2026-11-11T18:00:00-08:00", NOW)).toBe(
      "November 11",
    );
    expect(formatDayHeading("2027-01-03T18:00:00-08:00", NOW)).toBe(
      "January 3, 2027",
    );
    expect(formatDayHeading("not a date", NOW)).toBeNull();
  });
});

describe("formatActedLabel", () => {
  it("leads with the verb it is given", () => {
    expect(
      formatActedLabel("Submitted", "2026-11-04T08:46:00-08:00", NOW),
    ).toBe("Submitted today at 8:46 AM");
    expect(formatActedLabel("Resubmitted", "nope", NOW)).toBeNull();
  });
});

describe("formatSentLabel", () => {
  it("says when, in words", () => {
    expect(formatSentLabel("2026-11-04T08:46:00-08:00", NOW)).toBe(
      "Sent today at 8:46 AM",
    );
    expect(formatSentLabel("2026-11-03T09:00:00-08:00", NOW)).toBe(
      "Sent yesterday at 9:00 AM",
    );
    expect(formatSentLabel("2026-10-20T09:00:00-07:00", NOW)).toMatch(
      /^Sent Oct 20 at 9:00/,
    );
  });

  it("leaves an unreadable time out", () => {
    expect(formatSentLabel("not a date", NOW)).toBeNull();
  });
});

describe("a due time (#4003)", () => {
  const at = (iso: string) => new Date(iso);

  it("counts down to the time, naming it", () => {
    expect(formatDueLabel("2026-11-04T17:00:00-08:00", NOW)).toBe(
      "Due today at 5 PM",
    );
    expect(formatDueLabel("2026-11-05T09:30:00-08:00", NOW)).toBe(
      "Due tomorrow at 9:30 AM",
    );
    expect(formatDueLabel(FRI_5PM, NOW)).toBe("Due Friday at 5 PM");
    expect(formatDueLabel("2026-11-20T23:59:00-08:00", NOW)).toBe(
      "Due Nov 20 at 11:59 PM",
    );
  });

  it("is overdue from the minute, by the minute, hour, then day", () => {
    const due = "2026-11-04T08:00:00-08:00";
    expect(formatDueLabel(due, at("2026-11-04T08:00:30-08:00"))).toBe(
      "Overdue by 1 minute",
    );
    expect(formatDueLabel(due, at("2026-11-04T08:40:00-08:00"))).toBe(
      "Overdue by 40 minutes",
    );
    expect(formatDueLabel(due, at("2026-11-04T11:10:00-08:00"))).toBe(
      "Overdue by 3 hours",
    );
    expect(formatDueLabel(due, at("2026-11-06T09:00:00-08:00"))).toBe(
      "Overdue by 2 days",
    );
  });

  it("states a due without a countdown", () => {
    expect(formatDueOn(FRI_5PM, NOW)).toBe("Due Nov 6 at 5 PM");
    expect(formatDueOn("2026-11-06", NOW)).toBe("Due Nov 6");
    expect(formatDueOn(undefined, NOW)).toBeNull();
  });
});

describe("formatEventWindow (#4135)", () => {
  const pt = (iso: string) => new Date(iso).toISOString();

  it("says Tonight for an evening event today and the day period once", () => {
    expect(
      formatEventWindow(
        pt("2026-11-04T18:00:00-08:00"),
        pt("2026-11-04T19:00:00-08:00"),
        NOW,
      ),
    ).toBe("Tonight · 6:00 – 7:00 PM");
  });

  it("says Today, not Tonight, for a morning event", () => {
    expect(
      formatEventWindow(
        pt("2026-11-04T10:00:00-08:00"),
        pt("2026-11-04T11:00:00-08:00"),
        NOW,
      ),
    ).toBe("Today · 10:00 – 11:00 AM");
  });

  it("names tomorrow, the weekday within the week, and the date beyond", () => {
    expect(
      formatEventWindow(
        pt("2026-11-05T18:00:00-08:00"),
        pt("2026-11-05T19:00:00-08:00"),
        NOW,
      ),
    ).toBe("Tomorrow · 6:00 – 7:00 PM");
    expect(formatEventWindow(FRI_5PM, "", NOW)).toBe("Friday · 5:00 PM");
    expect(
      formatEventWindow(
        pt("2026-11-20T18:00:00-08:00"),
        pt("2026-11-20T19:00:00-08:00"),
        NOW,
      ),
    ).toBe("Fri, Nov 20 · 6:00 – 7:00 PM");
    expect(formatEventWindow(pt("2027-01-08T18:00:00-08:00"), "", NOW)).toBe(
      "Fri, Jan 8, 2027 · 6:00 PM",
    );
  });

  it("keeps both day periods when the event crosses noon", () => {
    expect(
      formatEventWindow(
        pt("2026-11-05T11:00:00-08:00"),
        pt("2026-11-05T13:00:00-08:00"),
        NOW,
      ),
    ).toBe("Tomorrow · 11:00 AM – 1:00 PM");
  });

  it("names the end's day when it ends on another one", () => {
    expect(
      formatEventWindow(
        pt("2026-11-05T22:00:00-08:00"),
        pt("2026-11-06T01:00:00-08:00"),
        NOW,
      ),
    ).toBe("Tomorrow · 10:00 PM – Fri, Nov 6 · 1:00 AM");
  });

  it("leaves an unreadable start out", () => {
    expect(formatEventWindow("not-a-date", "", NOW)).toBeNull();
    expect(formatEventWindow(undefined, undefined, NOW)).toBeNull();
  });
});

describe("points wording (#4135)", () => {
  it("writes a count in words and a chip short", () => {
    expect(formatPoints(1)).toBe("1 point");
    expect(formatPoints(10)).toBe("10 points");
    expect(formatPoints(0)).toBe("0 points");
    expect(formatPointsChip(5)).toBe("+5 pts");
  });
});

describe("isDueOverdue (#4133)", () => {
  it("is true once a bare day is over, or a due time has passed", () => {
    expect(isDueOverdue("2026-11-03", NOW)).toBe(true);
    expect(isDueOverdue("2026-11-04T16:00:00.000Z", NOW)).toBe(true);
  });

  it("stays false today, tomorrow and later, and on a bad date", () => {
    expect(isDueOverdue("2026-11-04", NOW)).toBe(false);
    expect(isDueOverdue("2026-11-05", NOW)).toBe(false);
    expect(isDueOverdue(FRI_5PM, NOW)).toBe(false);
    expect(isDueOverdue("banana", NOW)).toBe(false);
    expect(isDueOverdue(null, NOW)).toBe(false);
  });
});

describe("formatEndsLabel", () => {
  it("leads the countdown with the card's verb", () => {
    expect(formatEndsLabel("Closes", "2026-11-05T18:00:00-08:00", NOW)).toBe(
      "Closes tomorrow at 6 PM",
    );
    expect(formatEndsLabel("Ends", "2026-11-06T18:00:00-08:00", NOW)).toBe(
      "Ends Friday at 6 PM",
    );
  });

  it("is null for no end time, a Date, or one already past", () => {
    expect(formatEndsLabel("Ends", undefined, NOW)).toBeNull();
    expect(
      formatEndsLabel("Ends", new Date("2026-11-05T18:00:00-08:00"), NOW),
    ).toBeNull();
    expect(
      formatEndsLabel("Ends", "2026-11-03T18:00:00-08:00", NOW),
    ).toBeNull();
  });
});
