import { describe, expect, it } from "vitest";
import {
  matchPickerOptions,
  parseSearchToken,
  searchDateBounds,
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

  it("ignores custom dates left behind under a preset", () => {
    expect(
      searchDateBounds({ preset: "today", from: "2026-01-01" }, now),
    ).toEqual({ after: midnight(2026, 11, 10) });
  });
});

describe("parseSearchToken", () => {
  it("reads a trailing from: or in: and keeps the words before it", () => {
    expect(parseSearchToken("budget from:ada lov")).toEqual({
      kind: "from",
      partial: "ada lov",
      rest: "budget ",
    });
    expect(parseSearchToken("IN:#gen")).toEqual({
      kind: "in",
      partial: "gen",
      rest: "",
    });
  });

  it("is not fooled by a word that only ends in the keyword", () => {
    expect(parseSearchToken("login:")).toBeNull();
    expect(parseSearchToken("budget")).toBeNull();
    // A URL's colon ends any earlier token.
    expect(parseSearchToken("from:ada https://x.test")).toBeNull();
  });
});

describe("matchPickerOptions", () => {
  const options = [
    { id: "1", label: "Ada Lovelace" },
    { id: "2", label: "Grace Hopper" },
  ];

  it("keeps options holding every typed word, ignoring case", () => {
    expect(matchPickerOptions(options, "LOVE ada")).toEqual([options[0]]);
    expect(matchPickerOptions(options, "")).toEqual(options);
    expect(matchPickerOptions(options, "zed")).toEqual([]);
  });
});
