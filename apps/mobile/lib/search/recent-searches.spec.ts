import { describe, expect, it } from "vitest";
import {
  parseRecentSearches,
  RECENT_SEARCH_LIMIT,
  withRecentSearch,
} from "./recent-searches";

describe("withRecentSearch", () => {
  it("puts the newest first, trimmed, with no copy that differs only in case", () => {
    expect(withRecentSearch(["formal", "Rush"], "  rush ")).toEqual([
      "rush",
      "formal",
    ]);
  });

  it("keeps only the newest few, and ignores blank words", () => {
    const many = Array.from({ length: RECENT_SEARCH_LIMIT }, (_, i) => `s${i}`);
    expect(withRecentSearch(many, "new")).toHaveLength(RECENT_SEARCH_LIMIT);
    expect(withRecentSearch(many, "new")[0]).toBe("new");
    expect(withRecentSearch(["a"], "   ")).toEqual(["a"]);
  });
});

describe("parseRecentSearches", () => {
  it("reads a stored list and drops anything that isn't one", () => {
    expect(parseRecentSearches('["rush", 3, ""]')).toEqual(["rush"]);
    expect(parseRecentSearches("{}")).toEqual([]);
    expect(parseRecentSearches("not json")).toEqual([]);
    expect(parseRecentSearches(null)).toEqual([]);
  });
});
