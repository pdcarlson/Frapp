import { describe, expect, it } from "vitest";
import {
  boundedEditDistance,
  fuzzyMatch,
  fuzzyMatchWords,
  highlightRuns,
  matchesWordStarts,
  matchQueryWord,
  normalizeWords,
  withNumeralVariants,
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

describe("normalizeWords, other scripts", () => {
  it("keeps Greek and CJK letters, so such a query narrows instead of matching all", () => {
    expect(normalizeWords("Ψυχολογία 101")).toEqual(["ψυχολογια", "101"]);
    const docs = ["Ψυχολογία notes", "Physics notes"];
    expect(fuzzyMatch(docs, "ψυχολογια", (d) => d).map((r) => r.item)).toEqual([docs[0]]);
    expect(fuzzyMatch(docs, "王", (d) => d)).toEqual([]);
  });
});

describe("fuzzyMatchWords", () => {
  it("scores pre-normalised words the same as fuzzyMatch scores text", () => {
    const items = [{ words: ["homework", "2"] }, { words: ["exam", "1"] }];
    expect(fuzzyMatchWords(items, "homwork", (i) => i.words).map((r) => r.item)).toEqual([
      items[0],
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
    expect(find("212")).toEqual([docs[0], docs[1]]);
  });

  it("never fuzzes a word with a digit in it", () => {
    const courses = ["CS 101 cs101", "CS 102 cs102", "COGS 2120 cogs2120"];
    const match = (q: string) => fuzzyMatch(courses, q, (d) => d).map((r) => r.item);
    expect(match("cs201")).toEqual([]);
    expect(match("cs101")).toEqual([courses[0]]);
    expect(match("cogs2210")).toEqual([]);
    expect(match("cogs21")).toEqual([courses[2]]);
  });

  it("matches a one or two digit number as a whole word only", () => {
    // "2" must not find Homework 5 through its year or course number.
    expect(find("homework 2")).toEqual([docs[0]]);
    expect(find("hw 2", { hw: "homework" })).toEqual([docs[0]]);
    expect(find("21")).toEqual([]);
  });

  it("matches a Roman numeral from I to X as a whole word only, like a short number", () => {
    const titles = ["Calculus I Final", "Calculus II Midterm", "Integral practice", "Unit VII notes"];
    const findTitle = (query: string) => fuzzyMatch(titles, query, (t) => t).map((r) => r.item);
    // "i" neither prefixes "ii" nor "integral"; "calc i" behaves as "calc 1".
    expect(findTitle("calc i")).toEqual(["Calculus I Final"]);
    expect(findTitle("i")).toEqual(["Calculus I Final"]);
    expect(matchQueryWord("i", ["integral"]).score).toBe(0);
    // "viii" is four letters, yet never fuzzes to "vii".
    expect(matchQueryWord("viii", ["vii"]).score).toBe(0);
    expect(findTitle("vii")).toEqual(["Unit VII notes"]);
  });

  it("lets a single letter start a word, so live search never blanks on the first key", () => {
    expect(find("d")).toEqual([docs[2], docs[3]]);
  });

  it("allows one edit from 4 letters and two from 7, no more", () => {
    const words = ["lab", "quiz", "midterm", "homeworksheets"];
    const match = (q: string) => fuzzyMatch(words, q, (d) => d).map((r) => r.item);
    expect(match("quix")).toEqual(["quiz"]); // 4 letters, 1 edit
    expect(match("qxix")).toEqual([]); // 4 letters, 2 edits
    expect(match("mdtrem")).toEqual([]); // 6 letters, 2 edits
    expect(match("mdterrm")).toEqual(["midterm"]); // 7 letters, 2 edits
    expect(match("mdtrrem")).toEqual([]); // 7 letters, 3 edits
    // A typo near the start of a longer word: 1 edit from its first letters.
    expect(match("homewrk")).toEqual(["homeworksheets"]);
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

describe("withNumeralVariants", () => {
  it("adds the digits after a Roman numeral and the numeral after a digit", () => {
    expect(withNumeralVariants(["calculus", "i"])).toEqual(["calculus", "i", "1"]);
    expect(withNumeralVariants(["calc", "2"])).toEqual(["calc", "2", "ii"]);
    expect(withNumeralVariants(["ix", "10"])).toEqual(["ix", "9", "10", "x"]);
  });

  it("leaves longer numbers and numerals past X alone", () => {
    expect(withNumeralVariants(["1010", "xi", "11", "0"])).toEqual(["1010", "xi", "11", "0"]);
  });

  it("makes 'calc 1' and 'calc i' find either spelling", () => {
    const items = [
      { id: "roman", words: withNumeralVariants(normalizeWords("Calculus I")) },
      { id: "digit", words: withNumeralVariants(normalizeWords("Calc 1")) },
    ];
    const ids = (query: string) =>
      fuzzyMatchWords(items, query, (item) => item.words)
        .map((r) => r.item.id)
        .sort();
    expect(ids("calc 1")).toEqual(["digit", "roman"]);
    expect(ids("calc i")).toEqual(["digit", "roman"]);
    expect(ids("calculus 1")).toEqual(["roman"]);
    expect(ids("calculus i")).toEqual(["roman"]);
  });

  it("keeps a lone digit a whole-word match: '1' does not find Calculus II", () => {
    const words = withNumeralVariants(normalizeWords("Calculus II"));
    expect(matchQueryWord("1", words).score).toBe(0);
    expect(matchQueryWord("2", words).score).toBeGreaterThan(0);
  });
});

describe("matchQueryWord", () => {
  it("tries the alias too", () => {
    expect(matchQueryWord("hw", ["homework"], { hw: "homework" }).hit).toBe("homework");
    expect(matchQueryWord("hw", ["homework"]).score).toBe(0);
  });
});

describe("matchesWordStarts", () => {
  it("finds a word behind punctuation, which a name matcher would miss", () => {
    expect(matchesWordStarts("(Exec) Treasurer", "exec")).toBe(true);
    expect(matchesWordStarts("Rush/Recruitment Chair", "rec")).toBe(true);
    expect(matchesWordStarts("MATH 2210 · Calc (Honors)", "honors 22")).toBe(true);
    expect(matchesWordStarts("Vice President", "vi pre")).toBe(true);
    expect(matchesWordStarts("Vice President", "ice")).toBe(false);
    // Every word must match: a second word narrows, never widens.
    expect(matchesWordStarts("Vice President", "vi tre")).toBe(false);
    expect(matchesWordStarts("Anything", "  ")).toBe(true);
  });
});
