import { describe, expect, it, vi } from "vitest";
import {
  formatClock,
  formatLocaleDate,
  formatLocaleDateTime,
  formatTimeOfDay,
  formatTimeOfDayShort,
} from "./locale";

describe("formatLocaleDateTime", () => {
  it("returns an em dash for missing or unparseable values", () => {
    expect(formatLocaleDateTime(undefined)).toBe("—");
    expect(formatLocaleDateTime(null)).toBe("—");
    expect(formatLocaleDateTime("")).toBe("—");
    expect(formatLocaleDateTime(123)).toBe("—");
    expect(formatLocaleDateTime("not-a-date")).toBe("—");
  });

  it("matches toLocaleString for a parseable instant", () => {
    const value = "2026-08-16T17:09:00.000Z";
    expect(formatLocaleDateTime(value)).toBe(new Date(value).toLocaleString());
  });
});

describe("formatLocaleDate", () => {
  it("returns an em dash for missing or unparseable values", () => {
    expect(formatLocaleDate(undefined)).toBe("—");
    expect(formatLocaleDate("")).toBe("—");
    expect(formatLocaleDate("nope")).toBe("—");
  });

  it("matches toLocaleDateString for a parseable instant", () => {
    const value = "2026-08-16T17:09:00.000Z";
    expect(formatLocaleDate(value)).toBe(new Date(value).toLocaleDateString());
  });
});

describe("formatClock", () => {
  it("returns an empty string for missing or unparseable values", () => {
    expect(formatClock(undefined)).toBe("");
    expect(formatClock(null)).toBe("");
    expect(formatClock("")).toBe("");
    expect(formatClock("later")).toBe("");
  });

  it("includes hour, minute, month, and day options", () => {
    const value = new Date(2026, 7, 16, 17, 9).toISOString();
    const rendered = formatClock(value);
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered).toBe(
      new Date(value).toLocaleString(undefined, {
        hour: "numeric",
        minute: "2-digit",
        month: "short",
        day: "numeric",
      }),
    );
  });
});

describe("formatTimeOfDay", () => {
  it("returns an empty string for missing or unparseable values", () => {
    expect(formatTimeOfDay(undefined)).toBe("");
    expect(formatTimeOfDay("later")).toBe("");
    expect(formatTimeOfDayShort(null)).toBe("");
    expect(formatTimeOfDayShort("later")).toBe("");
  });

  it("prints the time of day and never the date", () => {
    const value = new Date(2026, 7, 16, 17, 9).toISOString();
    expect(formatTimeOfDay(value)).toBe(
      new Date(value).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      }),
    );
    expect(formatTimeOfDay(value)).not.toMatch(/Aug|16/);
  });

  it("follows the device into a new time zone mid-session", () => {
    // A tab or a backgrounded phone that crosses zones: the day dividers read
    // `Date`'s getters, which move with the device, so the time must too.
    const value = "2026-09-30T08:30:00Z";
    const live = () =>
      new Date(value)
        .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
        .replace(/\u202f/g, " ");
    try {
      vi.stubEnv("TZ", "America/New_York");
      const east = formatTimeOfDay(value);
      expect(east).toBe(live());
      vi.stubEnv("TZ", "America/Los_Angeles");
      expect(formatTimeOfDay(value)).toBe(live());
      expect(formatTimeOfDay(value)).not.toBe(east);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("drops the day period for the gutter, and nothing else", () => {
    const value = new Date(2026, 7, 16, 17, 9).toISOString();
    const short = formatTimeOfDayShort(value);
    expect(short).toMatch(/^\d{1,2}:09$/);
    expect(formatTimeOfDay(value).startsWith(short)).toBe(true);
  });

  it("keeps the day period when the run began in the other one (a run across noon)", () => {
    const morning = new Date(2026, 7, 16, 11, 50).toISOString();
    const afternoon = new Date(2026, 7, 16, 12, 20).toISOString();
    const later = new Date(2026, 7, 16, 11, 55).toISOString();
    // Same period as the run's author line: the short form.
    expect(formatTimeOfDayShort(later, morning)).toBe(
      formatTimeOfDayShort(later),
    );
    // Across noon, only where the locale has a day period to lose.
    const hasPeriod =
      formatTimeOfDay(afternoon) !== formatTimeOfDayShort(afternoon);
    expect(formatTimeOfDayShort(afternoon, morning)).toBe(
      hasPeriod ? formatTimeOfDay(afternoon) : formatTimeOfDayShort(afternoon),
    );
  });
});
