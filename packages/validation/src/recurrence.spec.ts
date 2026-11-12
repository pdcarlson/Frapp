import { describe, expect, it } from "vitest";
import {
  MAX_SERIES_MEETINGS,
  advanceRepeatRule,
  shiftRepeatRule,
  ordinal,
  RECURRENCE_RULES,
  checkSeriesLength,
  describeRepeatPattern,
  describeSeriesLength,
  formatRepeatRule,
  isRecurrenceRule,
  isRepeatRule,
  parseRepeatRule,
  seriesChildStarts,
  type RepeatRule,
} from "./recurrence";

const NY = "America/New_York";
const BERLIN = "Europe/Berlin";

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
    monthDay: null,
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

  it("writes and reads a by-date monthly rule's day", () => {
    const text = rule({ freq: "MONTHLY", byDay: [], monthDay: 31 });
    expect(text).toBe(
      "FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=31;COUNT=4;TZID=America/New_York",
    );
    expect(parseRepeatRule(text)).toMatchObject({
      monthDay: 31,
      nthWeekday: null,
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
    "FREQ=DAILY;COUNT=3;TZID= America/New_York", // untrimmed zone
    "FREQ=DAILY;COUNT=3;TZID=America/New_York ",
    "FREQ=MONTHLY;BYMONTHDAY=0;COUNT=3;TZID=UTC",
    "FREQ=MONTHLY;BYMONTHDAY=32;COUNT=3;TZID=UTC",
    "FREQ=MONTHLY;BYMONTHDAY=05;COUNT=3;TZID=UTC",
    "FREQ=MONTHLY;BYMONTHDAY=9;BYDAY=2TU;COUNT=3;TZID=UTC", // both anchors
    "FREQ=WEEKLY;BYDAY=MO;BYMONTHDAY=9;COUNT=3;TZID=UTC",
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

  it("keeps BYMONTHDAY=31 from a head clamped to Feb 28", () => {
    // The head a promotion left on Feb 28; the series still meets on the 31st.
    const start = new Date("2027-02-28T15:00:00Z");
    const starts = seriesChildStarts(
      rule({
        freq: "MONTHLY",
        byDay: [],
        monthDay: 31,
        end: { kind: "count", count: 3 },
      }),
      start,
    )!;
    expect(starts.map(ny)).toEqual(["2027-03-31 10:00", "2027-04-30 10:00"]);
  });

  it("makes a whole series at the largest interval", () => {
    const starts = seriesChildStarts(
      rule({
        interval: 30,
        byDay: ["MO"],
        end: { kind: "count", count: MAX_SERIES_MEETINGS },
      }),
      new Date("2027-01-05T00:00:00Z"),
    )!;
    expect(starts).toHaveLength(MAX_SERIES_MEETINGS - 1);
    const monthly = seriesChildStarts(
      rule({
        freq: "MONTHLY",
        byDay: [],
        interval: 30,
        end: { kind: "count", count: MAX_SERIES_MEETINGS },
      }),
      new Date("2027-01-05T00:00:00Z"),
    )!;
    expect(monthly).toHaveLength(MAX_SERIES_MEETINGS - 1);
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

  it("names BYMONTHDAY over the first meeting's day", () => {
    expect(
      describeRepeatPattern(
        rule({ freq: "MONTHLY", byDay: [], monthDay: 31 }),
        "2027-02-28T15:00:00Z",
      ),
    ).toBe("Every month on the 31st");
  });

  it("takes a caller's usual day for a monthly rule without BYMONTHDAY", () => {
    expect(
      describeRepeatPattern(
        rule({ freq: "MONTHLY", byDay: [] }),
        "2027-02-28T15:00:00Z",
        { monthDay: 31 },
      ),
    ).toBe("Every month on the 31st");
  });

  it("says the days a reader in another zone sees", () => {
    // Monday 11 PM in New York is Tuesday 5 AM in Berlin.
    const late = "2027-01-05T04:00:00Z";
    expect(
      describeRepeatPattern(rule({ byDay: ["MO", "TH"] }), late, {
        timeZone: BERLIN,
      }),
    ).toBe("Every Tue and Fri");
    expect(
      describeRepeatPattern(rule({ byDay: ["MO", "TH"] }), late, {
        timeZone: NY,
      }),
    ).toBe("Every Mon and Thu");
  });

  it("names a monthly rule's first meeting as a reader in another zone sees it", () => {
    // Jan 31, 11 PM in New York is Feb 1 in Berlin.
    expect(
      describeRepeatPattern(
        rule({ freq: "MONTHLY", byDay: [], monthDay: 31 }),
        "2027-02-01T04:00:00Z",
        { timeZone: BERLIN },
      ),
    ).toBe("Every month on the 1st");
    // The second Tuesday of Sep 2027 (the 14th), 11 PM in New York, is
    // Wednesday the 15th in Berlin: the third Wednesday, as Sep starts on one.
    expect(
      describeRepeatPattern(
        rule({ freq: "MONTHLY", nthWeekday: { n: 2, day: "TU" } }),
        "2027-09-15T03:00:00Z",
        { timeZone: BERLIN },
      ),
    ).toBe("Every month on the third Wednesday");
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

/** Wall-clock reading in Berlin, "YYYY-MM-DD HH:MM". */
function berlin(at: Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: BERLIN,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
}

describe("stepping across a DST change", () => {
  it("lands a 2:30 AM New York meeting after the spring-forward gap", () => {
    // 2027-03-14 2:00 EST jumps to 3:00 EDT; 2:30 AM doesn't exist.
    const starts = seriesChildStarts(
      rule({ freq: "DAILY", byDay: [], end: { kind: "count", count: 3 } }),
      "2027-03-13T07:30:00Z", // Mar 13, 2:30 AM EST
    );
    expect(starts?.map(ny)).toEqual(["2027-03-14 03:30", "2027-03-15 02:30"]);
  });

  it("lands a 2:30 AM Berlin meeting after the spring-forward gap", () => {
    // 2027-03-28 2:00 CET jumps to 3:00 CEST.
    const starts = seriesChildStarts(
      rule({
        freq: "DAILY",
        byDay: [],
        end: { kind: "count", count: 3 },
        timeZone: BERLIN,
      }),
      "2027-03-27T01:30:00Z", // Mar 27, 2:30 AM CET
    );
    expect(starts?.map(berlin)).toEqual([
      "2027-03-28 03:30",
      "2027-03-29 02:30",
    ]);
  });

  it("takes the first 1:30 AM of a fall-back night", () => {
    // 2027-11-07 2:00 EDT falls back to 1:00 EST; 1:30 AM happens twice.
    const starts = seriesChildStarts(
      rule({ freq: "DAILY", byDay: [], end: { kind: "count", count: 2 } }),
      "2027-11-06T05:30:00Z", // Nov 6, 1:30 AM EDT
    );
    expect(starts?.map((at) => at.toISOString())).toEqual([
      "2027-11-07T05:30:00.000Z", // 1:30 AM EDT, not 6:30Z (EST)
    ]);
  });
});

describe("advanceRepeatRule", () => {
  // Mondays at 7 PM in New York: Jan 4, 11, 18, 25, ...
  const head = "2027-01-05T00:00:00Z";
  const jan11 = "2027-01-12T00:00:00Z";
  const jan18 = "2027-01-19T00:00:00Z";

  it("drops a COUNT by the pattern's meetings before the new head", () => {
    // Jan 4 and Jan 11 are used, whether or not Jan 11's row still exists
    // (a meeting canceled on its own still counts).
    expect(
      advanceRepeatRule(
        rule({ end: { kind: "count", count: 8 } }),
        head,
        jan18,
      ),
    ).toBe(rule({ end: { kind: "count", count: 6 } }));
  });

  it("is null when fewer than two meetings would remain", () => {
    const three = rule({ end: { kind: "count", count: 3 } });
    expect(advanceRepeatRule(three, head, jan18)).toBeNull();
    expect(advanceRepeatRule(three, head, jan11)).toBe(
      rule({ end: { kind: "count", count: 2 } }),
    );
    // An UNTIL too: a lone meeting must not keep a rule it can't satisfy.
    expect(
      advanceRepeatRule(
        rule({ end: { kind: "until", until: "2027-01-11" } }),
        head,
        jan11,
      ),
    ).toBeNull();
  });

  it("leaves an UNTIL and a legacy token as they were", () => {
    const until = rule({ end: { kind: "until", until: "2027-03-01" } });
    expect(advanceRepeatRule(until, head, jan11)).toBe(until);
    expect(advanceRepeatRule("WEEKLY", head, jan11)).toBe("WEEKLY");
  });

  it("pins a by-date monthly rule to the old head's day", () => {
    // Head on Jan 31 in New York; the successor on Feb 28 must not move the
    // series to the 28th.
    const monthly = rule({
      freq: "MONTHLY",
      byDay: [],
      end: { kind: "until", until: "2027-06-30" },
    });
    expect(
      advanceRepeatRule(
        monthly,
        "2027-01-31T23:00:00Z",
        "2027-02-28T23:00:00Z",
      ),
    ).toBe(
      rule({
        freq: "MONTHLY",
        byDay: [],
        monthDay: 31,
        end: { kind: "until", until: "2027-06-30" },
      }),
    );
  });
});

describe("shiftRepeatRule", () => {
  const mon = "2027-01-05T00:00:00Z"; // Mon Jan 4, 7 PM New York
  const tue = "2027-01-06T00:00:00Z";

  it("moves a weekly rule's days by the days the head moved", () => {
    expect(shiftRepeatRule(rule({ byDay: ["MO", "TH"] }), mon, tue)).toBe(
      rule({ byDay: ["TU", "FR"] }),
    );
    // Saturday wraps to Sunday.
    expect(shiftRepeatRule(rule({ byDay: ["SA"] }), mon, tue)).toBe(
      rule({ byDay: ["SU"] }),
    );
  });

  it("moves a monthly rule to the new head's day or nth weekday", () => {
    expect(
      shiftRepeatRule(
        rule({ freq: "MONTHLY", byDay: [], monthDay: 4 }),
        mon,
        tue,
      ),
    ).toBe(rule({ freq: "MONTHLY", byDay: [], monthDay: 5 }));
    expect(
      shiftRepeatRule(
        rule({ freq: "MONTHLY", nthWeekday: { n: 1, day: "MO" } }),
        mon,
        tue,
      ),
    ).toBe(rule({ freq: "MONTHLY", nthWeekday: { n: 1, day: "TU" } }));
  });

  it("leaves a move within the day, a daily rule and a token alone", () => {
    const weekly = rule({ byDay: ["MO"] });
    expect(shiftRepeatRule(weekly, mon, "2027-01-05T01:00:00Z")).toBe(weekly);
    const daily = rule({ freq: "DAILY", byDay: [] });
    expect(shiftRepeatRule(daily, mon, tue)).toBe(daily);
    expect(shiftRepeatRule("WEEKLY", mon, tue)).toBe("WEEKLY");
  });
});

describe("every N days and months", () => {
  it("steps a daily rule by its interval", () => {
    const starts = seriesChildStarts(
      rule({
        freq: "DAILY",
        byDay: [],
        interval: 3,
        end: { kind: "count", count: 3 },
      }),
      "2027-01-05T00:00:00Z",
    );
    expect(starts?.map(ny)).toEqual(["2027-01-07 19:00", "2027-01-10 19:00"]);
  });

  it("steps a monthly rule by its interval", () => {
    const starts = seriesChildStarts(
      rule({
        freq: "MONTHLY",
        byDay: [],
        interval: 2,
        end: { kind: "count", count: 3 },
      }),
      "2027-01-05T00:00:00Z",
    );
    expect(starts?.map(ny)).toEqual(["2027-03-04 19:00", "2027-05-04 19:00"]);
  });
});

describe("zone spelling", () => {
  it("reads any spelling of a zone as the runtime's one", () => {
    expect(
      parseRepeatRule("FREQ=DAILY;COUNT=3;TZID=aMeRiCa/nEw_YoRk")?.timeZone,
    ).toBe(NY);
  });
});

describe("ordinal", () => {
  it("says a day of the month aloud", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "23rd",
      "31st",
    ]);
  });
});
