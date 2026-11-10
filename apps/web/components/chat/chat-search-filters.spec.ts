import { afterEach, describe, expect, it, vi } from "vitest";
import {
  matchPickerOptions,
  parseSearchToken,
  searchDateBounds,
  searchDateLabel,
} from "./chat-search-filters";

/** Local midnight of a calendar day, as the instant the request carries. */
function midnight(year: number, month: number, day: number): string {
  return new Date(year, month - 1, day).toISOString();
}

describe("searchDateBounds", () => {
  const now = new Date(2026, 10, 10, 15, 30);

  it("sends no bound for any time", () => {
    expect(searchDateBounds({ preset: "any" }, now)).toEqual({});
  });

  it("starts today at the member's own midnight", () => {
    expect(searchDateBounds({ preset: "today" }, now)).toEqual({
      after: midnight(2026, 11, 10),
    });
  });

  it("starts the last 7 and 30 days at a local midnight", () => {
    expect(searchDateBounds({ preset: "7d" }, now)).toEqual({
      after: midnight(2026, 11, 3),
    });
    expect(searchDateBounds({ preset: "30d" }, now)).toEqual({
      after: midnight(2026, 10, 11),
    });
  });

  it("includes the whole last day of a custom range", () => {
    // `before` is exclusive in the API, so the bound is the next midnight.
    expect(
      searchDateBounds(
        { preset: "custom", from: "2026-11-01", to: "2026-11-05" },
        now,
      ),
    ).toEqual({ after: midnight(2026, 11, 1), before: midnight(2026, 11, 6) });
  });

  it("reads a backwards range in order and an empty field as no bound", () => {
    expect(
      searchDateBounds(
        { preset: "custom", from: "2026-11-05", to: "2026-11-01" },
        now,
      ),
    ).toEqual({ after: midnight(2026, 11, 1), before: midnight(2026, 11, 6) });
    expect(
      searchDateBounds({ preset: "custom", to: "2026-11-05" }, now),
    ).toEqual({ before: midnight(2026, 11, 6) });
    expect(searchDateBounds({ preset: "custom" }, now)).toEqual({});
  });

  it("sends no bound for a year still being typed", () => {
    // A date field reports 0002, 0020, 0202 on the way to 2026.
    expect(
      searchDateBounds({ preset: "custom", from: "0202-11-01" }, now),
    ).toEqual({});
  });

  it("ignores custom dates left behind under a preset", () => {
    expect(
      searchDateBounds({ preset: "today", from: "2026-01-01" }, now),
    ).toEqual({ after: midnight(2026, 11, 10) });
  });
});

describe("searchDateBounds away from UTC", () => {
  // CI runs web specs in UTC, where local midnight is UTC midnight and every
  // day is 24 hours, so the cases above cannot tell the two apart.
  afterEach(() => vi.unstubAllEnvs());

  it("uses the member's midnight, not UTC's", () => {
    vi.stubEnv("TZ", "America/New_York");
    const now = new Date("2026-11-10T20:30:00Z"); // 3:30 PM in New York

    expect(searchDateBounds({ preset: "today" }, now)).toEqual({
      after: "2026-11-10T05:00:00.000Z",
    });
    expect(
      searchDateBounds(
        { preset: "custom", from: "2026-11-01", to: "2026-11-05" },
        now,
      ),
    ).toEqual({
      // Nov 1 was still daylight time (UTC-4); Nov 6 is standard (UTC-5).
      after: "2026-11-01T04:00:00.000Z",
      before: "2026-11-06T05:00:00.000Z",
    });
  });

  it("counts calendar days across a clock change, not 24-hour blocks", () => {
    vi.stubEnv("TZ", "America/New_York");
    const now = new Date("2026-11-10T20:30:00Z");

    // Oct 11 was daylight time: its midnight is 04:00Z, which 30 x 24h misses.
    expect(searchDateBounds({ preset: "30d" }, now)).toEqual({
      after: "2026-10-11T04:00:00.000Z",
    });
  });
});

describe("searchDateLabel", () => {
  it("names a preset and a custom range, and nothing for a range in waiting", () => {
    expect(searchDateLabel({ preset: "any" })).toBeNull();
    expect(searchDateLabel({ preset: "7d" })).toBe("Last 7 days");
    // No date yet: the chip must not paint as set while no bound is sent.
    expect(searchDateLabel({ preset: "custom" })).toBeNull();
    expect(
      searchDateLabel({ preset: "custom", from: "0202-11-01" }),
    ).toBeNull();
    expect(
      searchDateLabel({
        preset: "custom",
        from: "2026-11-01",
        to: "2026-11-05",
      }),
    ).toBe("2026-11-01 to 2026-11-05");
    expect(searchDateLabel({ preset: "custom", to: "2026-11-05" })).toBe(
      "Until 2026-11-05",
    );
  });
});

describe("parseSearchToken", () => {
  it("reads a trailing from: or in: and keeps the words before it", () => {
    expect(parseSearchToken("budget from:ada")).toEqual({
      kind: "from",
      partial: "ada",
      rest: "budget ",
    });
    expect(parseSearchToken("IN:#gen")).toEqual({
      kind: "in",
      partial: "gen",
      rest: "",
    });
    expect(parseSearchToken("budget in:")).toEqual({
      kind: "in",
      partial: "",
      rest: "budget ",
    });
  });

  it("leaves from: and in: alone anywhere but the last word", () => {
    // Otherwise the words after it would be dropped from the search unseen.
    expect(parseSearchToken("error in: login page")).toBeNull();
    expect(parseSearchToken("note from: bob")).toBeNull();
    expect(parseSearchToken("from:ada budget")).toBeNull();
    expect(parseSearchToken("login:")).toBeNull();
    expect(parseSearchToken("budget")).toBeNull();
  });
});

describe("matchPickerOptions", () => {
  const options = [
    { id: "1", label: "Ada Lovelace" },
    { id: "2", label: "José Ramírez" },
  ];

  it("matches word starts, ignoring case and accents, as the member column does", () => {
    expect(matchPickerOptions(options, "LOVE")).toEqual([options[0]]);
    expect(matchPickerOptions(options, "jose")).toEqual([options[1]]);
    expect(matchPickerOptions(options, "")).toEqual(options);
    expect(matchPickerOptions(options, "zed")).toEqual([]);
  });
});
