import { describe, expect, it } from "vitest";
import {
  formatTaskRepeatRule,
  isRepeatRule,
  isTaskRepeatRule,
  nextTaskRepeatDate,
  parseRepeatRule,
  parseTaskRepeatRule,
  taskCopyDueInstant,
  zonedDateAndTime,
} from "./recurrence";

const NY = "America/New_York";

/** Every copy's day from `first`, stepping until the rule ends or `max`. */
function copies(rule: string, first: string, max = 20): string[] {
  const days = [first];
  let at = first;
  while (days.length < max) {
    const next = nextTaskRepeatDate(rule, first, at);
    if (!next) break;
    days.push(next);
    at = next;
  }
  return days;
}

describe("parseTaskRepeatRule (#5119)", () => {
  it("accepts a rule with no end, which events refuse", () => {
    const rule = `FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;TZID=${NY}`;
    expect(parseTaskRepeatRule(rule)?.end).toEqual({ kind: "never" });
    expect(isTaskRepeatRule(rule)).toBe(true);
    expect(parseRepeatRule(rule)).toBeNull();
    expect(isRepeatRule(rule)).toBe(false);
  });

  it("keeps COUNT and UNTIL, and refuses both at once", () => {
    expect(
      parseTaskRepeatRule(`FREQ=DAILY;INTERVAL=1;COUNT=3;TZID=${NY}`)?.end,
    ).toEqual({ kind: "count", count: 3 });
    expect(
      parseTaskRepeatRule(`FREQ=DAILY;INTERVAL=1;UNTIL=20261201;TZID=${NY}`)
        ?.end,
    ).toEqual({ kind: "until", until: "2026-12-01" });
    expect(
      parseTaskRepeatRule(
        `FREQ=DAILY;INTERVAL=1;COUNT=3;UNTIL=20261201;TZID=${NY}`,
      ),
    ).toBeNull();
  });

  it("refuses legacy tokens, a missing zone and a COUNT under 2", () => {
    expect(parseTaskRepeatRule("WEEKLY")).toBeNull();
    expect(parseTaskRepeatRule("FREQ=DAILY;INTERVAL=1")).toBeNull();
    expect(
      parseTaskRepeatRule(`FREQ=DAILY;INTERVAL=1;COUNT=1;TZID=${NY}`),
    ).toBeNull();
    expect(parseTaskRepeatRule(42)).toBeNull();
  });

  it("writes a never-ending rule with no end, and reads it back", () => {
    const parsed = parseTaskRepeatRule(`FREQ=WEEKLY;BYDAY=TH,MO;TZID=${NY}`)!;
    const text = formatTaskRepeatRule(parsed);
    expect(text).toBe(`FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TH;TZID=${NY}`);
    expect(parseTaskRepeatRule(text)).toEqual(parsed);
  });
});

describe("nextTaskRepeatDate (#5119)", () => {
  it("steps a weekly rule from the first copy", () => {
    const rule = `FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;TZID=${NY}`;
    expect(copies(rule, "2026-11-16", 4)).toEqual([
      "2026-11-16",
      "2026-11-23",
      "2026-11-30",
      "2026-12-07",
    ]);
  });

  it("counts a weekly rule's other days in the first copy's week", () => {
    const rule = `FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;COUNT=5;TZID=${NY}`;
    // Monday Nov 16, then Thursday the 19th, then every other week.
    expect(copies(rule, "2026-11-16")).toEqual([
      "2026-11-16",
      "2026-11-19",
      "2026-11-30",
      "2026-12-03",
      "2026-12-14",
    ]);
  });

  it("starts from a first copy off the pattern, as an event head does", () => {
    const rule = `FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;COUNT=3;TZID=${NY}`;
    // Sunday Nov 15 is the first copy; Mondays after it.
    expect(copies(rule, "2026-11-15")).toEqual([
      "2026-11-15",
      "2026-11-16",
      "2026-11-23",
    ]);
  });

  it("falls back to a short month's last day for the 31st", () => {
    const rule = `FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=31;COUNT=4;TZID=${NY}`;
    expect(copies(rule, "2027-01-31")).toEqual([
      "2027-01-31",
      "2027-02-28",
      "2027-03-31",
      "2027-04-30",
    ]);
  });

  it("meets on the nth weekday and the last one", () => {
    expect(
      copies(
        `FREQ=MONTHLY;INTERVAL=1;BYDAY=2TU;COUNT=3;TZID=${NY}`,
        "2026-11-10",
      ),
    ).toEqual(["2026-11-10", "2026-12-08", "2027-01-12"]);
    expect(
      copies(
        `FREQ=MONTHLY;INTERVAL=1;BYDAY=-1FR;COUNT=3;TZID=${NY}`,
        "2026-11-27",
      ),
    ).toEqual(["2026-11-27", "2026-12-25", "2027-01-29"]);
  });

  it("counts a monthly copy later in the first copy's own month", () => {
    // First copy on the 3rd; the 2nd Tuesday of Nov 2026 is the 10th.
    expect(
      copies(
        `FREQ=MONTHLY;INTERVAL=1;BYDAY=2TU;COUNT=3;TZID=${NY}`,
        "2026-11-03",
      ),
    ).toEqual(["2026-11-03", "2026-11-10", "2026-12-08"]);
  });

  it("stops at UNTIL, that day included", () => {
    const rule = `FREQ=DAILY;INTERVAL=2;UNTIL=20261120;TZID=${NY}`;
    expect(copies(rule, "2026-11-16")).toEqual([
      "2026-11-16",
      "2026-11-18",
      "2026-11-20",
    ]);
  });

  it("never ends without COUNT or UNTIL, and steps far ahead cheaply", () => {
    const rule = `FREQ=DAILY;INTERVAL=3;TZID=${NY}`;
    expect(nextTaskRepeatDate(rule, "2026-11-16", "2036-11-16")).toBe(
      "2036-11-17",
    );
    expect(
      nextTaskRepeatDate(
        `FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;TZID=${NY}`,
        "2026-11-16",
        "2046-01-01",
      ),
    ).toBe("2046-01-08");
  });

  it("matches the step-by-step walk however far it skips ahead", () => {
    const rule = `FREQ=WEEKLY;INTERVAL=3;BYDAY=TU,SA;COUNT=40;TZID=${NY}`;
    const walk = copies(rule, "2026-11-17", 100);
    expect(walk).toHaveLength(40);
    // Asked from any day, the answer is the first walked day after it.
    for (let offset = 0; offset < 280; offset += 5) {
      const at = new Date(Date.UTC(2026, 10, 17 + offset))
        .toISOString()
        .slice(0, 10);
      const expected = walk.find((day) => day > at) ?? null;
      expect(nextTaskRepeatDate(rule, "2026-11-17", at)).toBe(expected);
    }
  });

  it("answers the first copy for a day before it, null for bad input", () => {
    const rule = `FREQ=DAILY;INTERVAL=1;TZID=${NY}`;
    expect(nextTaskRepeatDate(rule, "2026-11-16", "2026-11-01")).toBe(
      "2026-11-16",
    );
    expect(nextTaskRepeatDate("WEEKLY", "2026-11-16", "2026-11-16")).toBeNull();
    expect(nextTaskRepeatDate(rule, "2026-02-30", "2026-11-16")).toBeNull();
  });
});

describe("taskCopyDueInstant (#5119)", () => {
  it("keeps 9 PM on the wall clock across both DST changes", () => {
    // US DST ends Nov 1 2026 and starts Mar 14 2027.
    expect(taskCopyDueInstant("2026-10-26", "21:00", NY).toISOString()).toBe(
      "2026-10-27T01:00:00.000Z",
    );
    expect(taskCopyDueInstant("2026-11-02", "21:00", NY).toISOString()).toBe(
      "2026-11-03T02:00:00.000Z",
    );
    expect(taskCopyDueInstant("2027-03-15", "21:00", NY).toISOString()).toBe(
      "2027-03-16T01:00:00.000Z",
    );
  });

  it("is due at the end of the day in the rule's zone with no time", () => {
    expect(taskCopyDueInstant("2026-11-16", null, NY).toISOString()).toBe(
      "2026-11-17T05:00:00.000Z",
    );
  });

  it("reads back the day and time it was made from", () => {
    const at = taskCopyDueInstant("2026-11-16", "21:00", NY);
    expect(zonedDateAndTime(at, NY)).toEqual({
      date: "2026-11-16",
      time: "21:00:00",
    });
  });
});
