import { describe, expect, test } from "vitest";
import {
  dndEndsAt,
  endOfToday,
  lineEndsAt,
  lineProblem,
  nextStatusChangeAt,
  ownStatusAt,
  tomorrowMorning,
} from "./member-status";

const NOW = Date.parse("2026-11-09T15:30:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

describe("ownStatusAt", () => {
  test("a member who never saved is Online with no line", () => {
    expect(ownStatusAt({}, NOW)).toEqual({
      status: "online",
      statusEndsAt: null,
      line: null,
      lineEndsAt: null,
    });
  });

  test("a status and line before their end times hold", () => {
    const own = ownStatusAt(
      {
        status: "dnd",
        status_expires_at: iso(NOW + 1000),
        custom_status: "In class",
        custom_status_expires_at: iso(NOW + 2000),
      },
      NOW,
    );
    expect(own).toEqual({
      status: "dnd",
      statusEndsAt: NOW + 1000,
      line: "In class",
      lineEndsAt: NOW + 2000,
    });
    expect(nextStatusChangeAt(own)).toBe(NOW + 1000);
  });

  // The server's own read rule, applied to what a tab already holds.
  test("past their end times, the status reads Online and the line none", () => {
    const own = ownStatusAt(
      {
        status: "dnd",
        status_expires_at: iso(NOW),
        custom_status: "In class",
        custom_status_expires_at: iso(NOW - 1),
      },
      NOW,
    );
    expect(own).toEqual({
      status: "online",
      statusEndsAt: null,
      line: null,
      lineEndsAt: null,
    });
    expect(nextStatusChangeAt(own)).toBeNull();
  });

  test("an unknown stored status reads Online rather than inventing one", () => {
    expect(ownStatusAt({ status: "away" }, NOW).status).toBe("online");
  });
});

describe("end times", () => {
  test("DND for 1 and 8 hours, and no end for until I turn it off", () => {
    const now = new Date(NOW);
    expect(dndEndsAt("1h", now)).toBe(iso(NOW + 60 * 60 * 1000));
    expect(dndEndsAt("8h", now)).toBe(iso(NOW + 8 * 60 * 60 * 1000));
    expect(dndEndsAt(null, now)).toBeNull();
  });

  test("until tomorrow is 8:00 AM on the next local day", () => {
    const now = new Date(2026, 10, 9, 23, 30);
    const end = tomorrowMorning(now);
    expect([end.getFullYear(), end.getMonth(), end.getDate()]).toEqual([
      2026, 10, 10,
    ]);
    expect([end.getHours(), end.getMinutes()]).toEqual([8, 0]);
    expect(dndEndsAt("tomorrow", now)).toBe(end.toISOString());
  });

  test("Today ends at the next local midnight", () => {
    const now = new Date(2026, 10, 9, 15, 30);
    const end = endOfToday(now);
    expect([end.getDate(), end.getHours(), end.getMinutes()]).toEqual([10, 0, 0]);
    expect(lineEndsAt("today", now)).toBe(end.toISOString());
  });

  test("the line's fixed durations, and Don't clear", () => {
    const now = new Date(NOW);
    expect(lineEndsAt("30m", now)).toBe(iso(NOW + 30 * 60 * 1000));
    expect(lineEndsAt("1h", now)).toBe(iso(NOW + 60 * 60 * 1000));
    expect(lineEndsAt("4h", now)).toBe(iso(NOW + 4 * 60 * 60 * 1000));
    expect(lineEndsAt(null, now)).toBeNull();
  });

  // The API's instant rule needs an explicit offset; `Z` is one.
  test("every end time carries an explicit offset", () => {
    expect(dndEndsAt("1h", new Date(NOW))).toMatch(/Z$/);
    expect(lineEndsAt("today", new Date(NOW))).toMatch(/Z$/);
  });
});

describe("lineProblem", () => {
  test("80 code points pass and 81 don't, counted as the API counts", () => {
    expect(lineProblem("x".repeat(80), 80)).toBeNull();
    expect(lineProblem("x".repeat(81), 80)).toMatch(/80 characters/);
    // One emoji is two UTF-16 units but one code point.
    expect(lineProblem("😀".repeat(80), 80)).toBeNull();
  });

  test("a pasted line break is refused", () => {
    expect(lineProblem("one\ntwo", 80)).toMatch(/one line/);
    expect(lineProblem("one\u2028two", 80)).toMatch(/one line/);
  });

  test("surrounding spaces don't count against the cap", () => {
    expect(lineProblem(`  ${"x".repeat(80)}  `, 80)).toBeNull();
  });
});
