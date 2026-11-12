import { describe, expect, it } from "vitest";
import {
  MAX_SERIES_MEETINGS,
  RECURRENCE_RULES,
  checkSeriesLength,
  describeRepeatPattern,
  describeSeriesLength,
  formatRepeatRule,
  isRecurrenceRule,
  isRepeatRule,
  nthWeekdayOf,
  parseRepeatRule,
  recurrenceChildCount,
  seriesChildStarts,
  type RepeatRule,
} from "./recurrence";

const NY = "America/New_York";

/** Wall-clock reading in New York, "YYYY-MM-DD HH:MM". */
function ny(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: NY,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

function rule(overrides: Partial<RepeatRule>): string {
  return formatRepeatRule({
    freq: "WEEKLY",
    interval: 1,
    byDay: ["MO"],
    nthWeekday: null,
    end: { kind: "count", count: 4 },
    timeZone: NY,
    ...overrides,
  });
}

describe("isRecurrenceRule (legacy tokens)", () => {
  it.each(RECURRENCE_RULES)("accepts %s", (token) => {
    expect(isRecurrenceRule(token)).toBe(true);
  });

  it("rejects values outside the catalog, including near-misses", () => {
    for (const value of ["DAILY", "YEARLY", "weekly", "WEEKLY ", ""]) {
      expect(isRecurrenceRule(value)).toBe(false);
    }
  });

  it("rejects non-strings without throwing", () => {
    for (const value of [null, undefined, 12, {}, ["WEEKLY"]]) {
      expect(isRecurrenceRule(value)).toBe(false);
    }
  });
});

describe("recurrenceChildCount", () => {
  it("returns the legacy tokens' fixed lengths", () => {
    expect(recurrenceChildCount("WEEKLY")).toBe(12);
    expect(recurrenceChildCount("BIWEEKLY")).toBe(6);
    expect(recurrenceChildCount("MONTHLY")).toBe(6);
    expect(recurrenceChildCount("FREQ=DAILY")).toBeNull();
  });
});

describe("parseRepeatRule / formatRepeatRule", () => {
  it("round-trips a structured rule in one canonical spelling", () => {
    const text = rule({ byDay: ["TH", "MO"], interval: 2 });
    expect(text).toBe(
      "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;COUNT=4;TZID=America/New_York",
    );
    expect(parseRepeatRule(text)).toMatchObject({
      legacy: null,
      freq: "WEEKLY",
      interval: 2,
      byDay: ["MO", "TH"],
      end: { kind: "count", count: 4 },
      timeZone: NY,
    });
  });

  it("reads a monthly nth weekday and an until date", () => {
    const text = rule({
      freq: "MONTHLY",
      nthWeekday: { n: -1, day: "FR" },
      end: { kind: "until", until: "2027-05-01" },
    });
    expect(text).toBe(
      "FREQ=MONTHLY;INTERVAL=1;BYDAY=-1FR;UNTIL=20270501;TZID=America/New_York",
    );
    expect(parseRepeatRule(text)).toMatchObject({
      nthWeekday: { n: -1, day: "FR" },
      end: { kind: "until", until: "2027-05-01" },
    });
  });

  it("reads a legacy token as its pattern with a rolling length", () => {
    expect(parseRepeatRule("BIWEEKLY")).toMatchObject({
      legacy: "BIWEEKLY",
      freq: "WEEKLY",
      interval: 2,
      end: { kind: "rolling", children: 6 },
      timeZone: "UTC",
    });
  });

  it.each([
    "",
    "DAILY",
    "FREQ=YEARLY;COUNT=3;TZID=UTC",
    "FREQ=WEEKLY;COUNT=3;TZID=UTC", // weekly must name its days
    "FREQ=WEEKLY;BYDAY=MO;TZID=UTC", // no end
    "FREQ=WEEKLY;BYDAY=MO;COUNT=3;UNTIL=20270101;TZID=UTC", // two ends
    "FREQ=WEEKLY;BYDAY=MO;COUNT=3", // no zone
    "FREQ=WEEKLY;BYDAY=MO;COUNT=3;TZID=-05:00", // an offset, not a zone
    "FREQ=WEEKLY;BYDAY=MO,MO;COUNT=3;TZID=UTC",
    "FREQ=WEEKLY;BYDAY=XX;COUNT=3;TZID=UTC",
    "FREQ=WEEKLY;BYDAY=MO;COUNT=1;TZID=UTC", // one meeting is not a series
    `FREQ=WEEKLY;BYDAY=MO;COUNT=${MAX_SERIES_MEETINGS + 1};TZID=UTC`,
    "FREQ=WEEKLY;INTERVAL=0;BYDAY=MO;COUNT=3;TZID=UTC",
    "FREQ=WEEKLY;INTERVAL=31;BYDAY=MO;COUNT=3;TZID=UTC",
    "FREQ=MONTHLY;BYDAY=5TU;COUNT=3;TZID=UTC",
    "FREQ=MONTHLY;BYDAY=MO,TU;COUNT=3;TZID=UTC",
    "FREQ=DAILY;BYDAY=MO;COUNT=3;TZID=UTC",
    "FREQ=DAILY;UNTIL=20270230;TZID=UTC", // no Feb 30
    "FREQ=DAILY;COUNT=3;TZID=UTC;WKST=MO", // unknown key
    "FREQ=DAILY;FREQ=DAILY;COUNT=3;TZID=UTC",
  ])("rejects %j", (value) => {
    expect(parseRepeatRule(value)).toBeNull();
    expect(isRepeatRule(value)).toBe(false);
  });
});

describe("seriesChildStarts", () => {
  it("meets on every chosen weekday: Monday and Thursday", () => {
    // Mon 2027-01-04 19:00 New York.
    const start = new Date("2027-01-05T00:00:00Z");
    const starts = seriesChildStarts(
      rule({ byDay: ["MO", "TH"], end: { kind: "count", count: 5 } }),
      start,
    )!;
    expect(starts.map(ny)).toEqual([
      "2027-01-07 19:00",
      "2027-01-11 19:00",
      "2027-01-14 19:00",
      "2027-01-18 19:00",
    ]);
  });

  it("keeps the wall-clock time across a DST change (#3662)", () => {
    // Weekly Saturday 23:30 New York from Feb 6, 2027; DST starts Mar 14.
    const start = new Date("2027-02-07T04:30:00Z");
    const starts = seriesChildStarts(
      rule({ byDay: ["SA"], end: { kind: "count", count: 8 } }),
      start,
    )!;
    expect(starts.map(ny)).toEqual([
      "2027-02-13 23:30",
      "2027-02-20 23:30",
      "2027-02-27 23:30",
      "2027-03-06 23:30",
      "2027-03-13 23:30",
      "2027-03-20 23:30",
      "2027-03-27 23:30",
    ]);
  });

  it("skips weeks for every N weeks", () => {
    const start = new Date("2027-01-05T00:00:00Z"); // Mon
    const starts = seriesChildStarts(
      rule({ interval: 3, byDay: ["MO"], end: { kind: "count", count: 3 } }),
      start,
    )!;
    expect(starts.map(ny)).toEqual(["2027-01-25 19:00", "2027-02-15 19:00"]);
  });

  it("meets on the nth weekday of each month", () => {
    // Tue 2027-01-12 is the second Tuesday.
    const start = new Date("2027-01-13T00:00:00Z");
    const starts = seriesChildStarts(
      rule({
        freq: "MONTHLY",
        nthWeekday: { n: 2, day: "TU" },
        end: { kind: "count", count: 4 },
      }),
      start,
    )!;
    expect(starts.map(ny)).toEqual([
      "2027-02-09 19:00",
      "2027-03-09 19:00",
      "2027-04-13 19:00",
    ]);
  });

  it("meets on the last weekday of each month", () => {
    const start = new Date("2027-01-30T00:00:00Z"); // Fri Jan 29, 19:00
    const starts = seriesChildStarts(
      rule({
        freq: "MONTHLY",
        nthWeekday: { n: -1, day: "FR" },
        end: { kind: "count", count: 3 },
      }),
      start,
    )!;
    expect(starts.map(ny)).toEqual(["2027-02-26 19:00", "2027-03-26 19:00"]);
  });

  it("clamps a monthly-by-date series on the 31st to short months", () => {
    const start = new Date("2027-01-31T15:00:00Z");
    const starts = seriesChildStarts(
      rule({ freq: "MONTHLY", end: { kind: "count", count: 3 } }),
      start,
    )!;
    expect(starts.map(ny)).toEqual(["2027-02-28 10:00", "2027-03-31 10:00"]);
  });

  it("stops on the until day, inclusive, in the rule's zone", () => {
    const start = new Date("2027-01-05T00:00:00Z"); // Mon 19:00 NY
    const starts = seriesChildStarts(
      rule({ byDay: ["MO"], end: { kind: "until", until: "2027-01-25" } }),
      start,
    )!;
    expect(starts.map(ny)).toEqual([
      "2027-01-11 19:00",
      "2027-01-18 19:00",
      "2027-01-25 19:00",
    ]);
  });

  it("counts a COUNT from the first meeting, so regenerating drops past meetings", () => {
    const start = new Date("2027-01-05T00:00:00Z");
    const text = rule({ byDay: ["MO"], end: { kind: "count", count: 4 } });
    const after = new Date("2027-01-12T00:00:00Z").getTime();
    expect(seriesChildStarts(text, start, after)!.map(ny)).toEqual([
      "2027-01-18 19:00",
      "2027-01-25 19:00",
    ]);
  });

  it("steps a legacy token in UTC and keeps its rolling length", () => {
    const start = "2027-01-04T19:00:00Z";
    expect(seriesChildStarts("WEEKLY", start)).toHaveLength(12);
    const after = new Date("2027-03-01T00:00:00Z").getTime();
    const later = seriesChildStarts("WEEKLY", start, after)!;
    expect(later).toHaveLength(12);
    expect(later[0]!.toISOString()).toBe("2027-03-01T19:00:00.000Z");
    expect(
      seriesChildStarts("MONTHLY", "2027-01-31T10:00:00Z")![0]!.toISOString(),
    ).toBe("2027-02-28T10:00:00.000Z");
  });

  it("returns null for an unreadable rule or start", () => {
    expect(seriesChildStarts("NOPE", "2027-01-01T00:00:00Z")).toBeNull();
    expect(seriesChildStarts("WEEKLY", "not a date")).toBeNull();
  });
});

describe("checkSeriesLength", () => {
  const start = new Date("2027-01-05T00:00:00Z");

  it("accepts a count, and an until that leaves meetings", () => {
    expect(checkSeriesLength(rule({}), start)).toBeNull();
    expect(
      checkSeriesLength(
        rule({ end: { kind: "until", until: "2027-02-01" } }),
        start,
      ),
    ).toBeNull();
  });

  it("refuses an until that leaves no second meeting", () => {
    expect(
      checkSeriesLength(
        rule({ end: { kind: "until", until: "2027-01-06" } }),
        start,
      ),
    ).toMatch(/no meeting after the first/);
  });

  it("refuses an until that would make too many meetings", () => {
    expect(
      checkSeriesLength(
        rule({
          freq: "DAILY",
          byDay: [],
          end: { kind: "until", until: "2028-01-01" },
        }),
        start,
      ),
    ).toMatch(/at most/);
  });
});

describe("describeRepeatPattern", () => {
  const start = new Date("2027-01-13T00:00:00Z"); // Tue Jan 12, 19:00 NY

  it.each([
    [rule({ byDay: ["MO", "TH"] }), "Every Mon and Thu"],
    [rule({ byDay: ["TU"] }), "Every Tuesday"],
    [rule({ byDay: ["TU"], interval: 2 }), "Every other Tuesday"],
    [
      rule({ byDay: ["MO", "WE", "FR"], interval: 3 }),
      "Every 3 weeks on Mon, Wed and Fri",
    ],
    [rule({ byDay: ["MO", "TU", "WE", "TH", "FR"] }), "Every weekday"],
    [
      rule({ freq: "MONTHLY", nthWeekday: { n: 2, day: "TU" } }),
      "Every month on the second Tuesday",
    ],
    [rule({ freq: "MONTHLY", interval: 2 }), "Every 2 months on the 12th"],
    [rule({ freq: "DAILY", byDay: [] }), "Every day"],
    [rule({ freq: "DAILY", byDay: [], interval: 3 }), "Every 3 days"],
  ])("%s reads %j", (text, expected) => {
    expect(describeRepeatPattern(text, start)).toBe(expected);
  });

  it("leaves legacy tokens to their callers", () => {
    expect(describeRepeatPattern("WEEKLY", start)).toBeNull();
  });
});

describe("describeSeriesLength", () => {
  it("states the count and the last date in the rule's zone", () => {
    const start = new Date("2027-01-05T00:00:00Z");
    expect(
      describeSeriesLength(
        start,
        rule({ byDay: ["MO", "TH"], end: { kind: "count", count: 5 } }),
      ),
    ).toBe("5 meetings, the last on Jan 18.");
  });

  it("adds the year when the series crosses into the next", () => {
    const start = new Date("2026-12-01T00:00:00Z");
    expect(
      describeSeriesLength(
        start,
        rule({ end: { kind: "until", until: "2027-01-11" } }),
      ),
    ).toBe("7 meetings, the last on Jan 11, 2027.");
  });
});

describe("nthWeekdayOf", () => {
  it("names the week of the month a day is in", () => {
    expect(nthWeekdayOf(new Date("2027-01-13T00:00:00Z"), NY)).toEqual({
      n: 2,
      day: "TU",
    });
    expect(nthWeekdayOf(new Date("2027-01-30T00:00:00Z"), NY, true)).toEqual({
      n: -1,
      day: "FR",
    });
  });
});
