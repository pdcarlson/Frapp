import { describe, expect, it } from "vitest";
import {
  parseRecentSearches,
  RECENT_SEARCH_LIMIT,
  recentSearchesKey,
  rememberSearch,
} from "./recent-searches";

describe("rememberSearch", () => {
  it("puts the newest first, once, whatever its case", () => {
    expect(rememberSearch(["dues", "Rush"], " rush ")).toEqual([
      "rush",
      "dues",
    ]);
  });

  it("keeps a short list", () => {
    const full = Array.from({ length: RECENT_SEARCH_LIMIT }, (_, i) => `q${i}`);
    const next = rememberSearch(full, "new");
    expect(next).toHaveLength(RECENT_SEARCH_LIMIT);
    expect(next[0]).toBe("new");
    expect(next).not.toContain(`q${RECENT_SEARCH_LIMIT - 1}`);
  });

  it("keeps nothing blank", () => {
    expect(rememberSearch(["dues"], "   ")).toEqual(["dues"]);
  });
});

describe("parseRecentSearches", () => {
  it("reads a stored list and nothing else", () => {
    expect(parseRecentSearches(JSON.stringify(["a", 3, " b ", ""]))).toEqual([
      "a",
      "b",
    ]);
    expect(parseRecentSearches(null)).toEqual([]);
    expect(parseRecentSearches("{oops")).toEqual([]);
    expect(parseRecentSearches(JSON.stringify({ a: 1 }))).toEqual([]);
  });
});

it("keys the list by member and chapter", () => {
  expect(recentSearchesKey("u1", "ch1")).toBe("frapp.search.recent.v1:u1:ch1");
  expect(recentSearchesKey("u1", null)).toBe("frapp.search.recent.v1:u1:sole");
});
