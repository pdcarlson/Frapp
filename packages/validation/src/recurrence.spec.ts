import { describe, expect, it } from "vitest";
import {
  RECURRENCE_RULES,
  isRecurrenceRule,
  recurrenceChildCount,
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
  // These are the numbers EventSeriesService.buildOccurrencePayloads materializes.
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
