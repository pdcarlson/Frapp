import { describe, expect, it } from "vitest";
import {
  boundedEditDistance,
  fuzzyMatch,
  highlightRuns,
  normalizeWords,
} from "./fuzzy-match";

const docs = [
  "Cog Sci Homework 2 COGS 2120 Bram Fall 2026 Student Copy",
  "Cog Sci Midterm 1 COGS 2120 Bram Fall 2025 Answer Key",
  "Data Structures Exam 1 CSCI 1200 Thompson Spring 2026",
  "Data Structures Homework 5 CSCI 1200 Thompson Blank Copy",
];
const find = (query: string, aliases = {}) =>
  fuzzyMatch(docs, query, (d) => d, aliases).map((r) => r.item);

describe("normalizeWords", () => {
  it("lowercases, strips punctuation and accents", () => {
    expect(normalizeWords("Café: Lab #3, Part-B")).toEqual([
      "cafe",
      "lab",
      "3",
      "part",
      "b",
    ]);
  });
});

describe("boundedEditDistance", () => {
  it("counts a neighbour swap as one edit", () => {
    expect(boundedEditDistance("thompsno", "thompson", 2)).toBe(1);
  });
  it("gives up past the bound", () => {
    expect(boundedEditDistance("abc", "xyz", 1)).toBe(2);
  });
});

describe("fuzzyMatch", () => {
  it("finds the doc from Paul's screenshot, typo included", () => {
    expect(find("cog sci homework 2")[0]).toBe(docs[0]);
    expect(find("cog sci homwork 2")[0]).toBe(docs[0]);
  });

  it("needs every query word to match", () => {
    expect(find("cog sci exam")).toEqual([]);
  });

  it("matches the start of a word", () => {
    expect(find("struct")).toEqual([docs[2], docs[3]]);
  });

  it("forgives up to two edits on long words", () => {
    expect(find("thomspon")).toHaveLength(2);
  });

  it("never fuzzes numbers", () => {
    expect(find("homework 3")).toEqual([]);
    expect(find("2210")).toEqual([]);
    expect(find("21")).toEqual([docs[0], docs[1]]);
  });

  it("does not fuzz three-letter words", () => {
    expect(find("kez")).toEqual([]);
  });

  it("expands aliases", () => {
    expect(find("hw 5", { hw: "homework" })).toEqual([docs[3]]);
  });

  it("ranks exact over near matches and keeps order on ties", () => {
    const ranked = fuzzyMatch(["homwork notes", "homework notes"], "homework", (d) => d);
    expect(ranked.map((r) => r.item)).toEqual(["homework notes", "homwork notes"]);
  });

  it("returns everything, unscored, for an empty query", () => {
    expect(find("  ")).toEqual(docs);
  });

  it("reports the item words that matched", () => {
    const [first] = fuzzyMatch(docs, "homwork", (d) => d);
    expect(first?.hits).toEqual(["homework"]);
  });
});

describe("highlightRuns", () => {
  it("marks matched words and keeps spacing", () => {
    expect(highlightRuns("Cog Sci  Homework 2", ["homework"])).toEqual([
      { text: "Cog", hit: false },
      { text: " ", hit: false },
      { text: "Sci", hit: false },
      { text: "  ", hit: false },
      { text: "Homework", hit: true },
      { text: " ", hit: false },
      { text: "2", hit: false },
    ]);
  });
});
