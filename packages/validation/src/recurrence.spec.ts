import { describe, expect, it } from "vitest";
import {
  RECURRENCE_RULES,
  isRecurrenceRule,
  recurrenceChildCount,
  toRRuleLine,
} from "./recurrence";

describe("isRecurrenceRule", () => {
  it.each(RECURRENCE_RULES)("accepts %s", (rule) => {
    expect(isRecurrenceRule(rule)).toBe(true);
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
  // These are the numbers EventService.buildOccurrencePayloads materializes.
  // If one changes, the RRULE COUNT below must move with it — that coupling is
  // the reason both live in this module.
  it("returns the generator's child counts", () => {
    expect(recurrenceChildCount("WEEKLY")).toBe(12);
    expect(recurrenceChildCount("BIWEEKLY")).toBe(6);
    expect(recurrenceChildCount("MONTHLY")).toBe(6);
  });

  it("returns null for a rule the generator cannot expand", () => {
    expect(recurrenceChildCount("DAILY")).toBeNull();
    expect(recurrenceChildCount(null)).toBeNull();
    expect(recurrenceChildCount(undefined)).toBeNull();
  });
});

describe("toRRuleLine — rule mapping", () => {
  it("maps each rule to its RFC 5545 form", () => {
    expect(toRRuleLine("WEEKLY")).toBe("RRULE:FREQ=WEEKLY;COUNT=13");
    expect(toRRuleLine("MONTHLY")).toBe("RRULE:FREQ=MONTHLY;COUNT=7");
  });

  it("spells BIWEEKLY as a weekly rule with an interval", () => {
    // RFC 5545 has no BIWEEKLY frequency; INTERVAL=2 is the sanctioned form.
    expect(toRRuleLine("BIWEEKLY")).toBe("RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=7");
  });

  // The defect this module exists to prevent. RFC 5545 §3.8.5.3: "The DTSTART
  // property value always counts as the first occurrence." The parent event IS
  // that occurrence, so COUNT must exceed the child count by exactly one — a
  // COUNT equal to it silently drops the last meeting from every calendar.
  it.each(RECURRENCE_RULES)(
    "counts the DTSTART occurrence on top of %s's children",
    (rule) => {
      const children = recurrenceChildCount(rule);
      expect(children).not.toBeNull();
      expect(toRRuleLine(rule)).toContain(`COUNT=${(children as number) + 1}`);
    },
  );

  it("returns null rather than throwing for an unexportable rule", () => {
    // generateIcs runs against arbitrary stored rows; an unknown rule must
    // degrade to a plain VEVENT, not fail the member's download.
    expect(toRRuleLine("DAILY")).toBeNull();
    expect(toRRuleLine(null)).toBeNull();
    expect(toRRuleLine(undefined)).toBeNull();
    expect(toRRuleLine("")).toBeNull();
  });
});

describe("toRRuleLine", () => {
  it("prefixes the property name", () => {
    expect(toRRuleLine("WEEKLY")).toBe("RRULE:FREQ=WEEKLY;COUNT=13");
  });

  it("propagates null so callers can omit the line entirely", () => {
    expect(toRRuleLine("DAILY")).toBeNull();
    expect(toRRuleLine(null)).toBeNull();
  });

  it("never emits a line containing a raw newline or a stray space", () => {
    // An unfolded RRULE with embedded whitespace is the classic way an .ics
    // parses on one client and silently drops the recurrence on another.
    for (const rule of RECURRENCE_RULES) {
      const line = toRRuleLine(rule) as string;
      expect(line).not.toMatch(/[\r\n]/);
      expect(line).not.toMatch(/\s/);
      expect(line.length).toBeLessThanOrEqual(75); // RFC 5545 octet limit
    }
  });
});
