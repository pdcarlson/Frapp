import { describe, expect, it } from "vitest";
import {
  MAX_IMPORTED_REACTION_CHIPS,
  importedReactionGlyph,
  selectImportedReactions,
} from "./imported-reactions";

describe("selectImportedReactions", () => {
  const payload = {
    source: "discord",
    reactions: [
      { emoji: "🔥", name: null, count: 4 },
      { emoji: "party_blob", name: "party_blob", count: 2 },
    ],
  };

  it("reads totals only on kind imported", () => {
    expect(selectImportedReactions("imported", payload)).toEqual([
      { emoji: "🔥", name: null, count: 4 },
      { emoji: "party_blob", name: "party_blob", count: 2 },
    ]);
    expect(selectImportedReactions("text", payload)).toEqual([]);
  });

  it("drops zero counts, missing emoji, and non-objects", () => {
    expect(
      selectImportedReactions("imported", {
        reactions: [
          { emoji: "👍", name: null, count: 0 },
          { emoji: "", name: null, count: 3 },
          { emoji: "🎉", name: null, count: 1 },
          "nope",
        ],
      }),
    ).toEqual([{ emoji: "🎉", name: null, count: 1 }]);
  });

  it(`caps at ${MAX_IMPORTED_REACTION_CHIPS}, matching the importer`, () => {
    const reactions = Array.from({ length: 25 }, (_, i) => ({
      emoji: `e${i}`,
      name: null,
      count: 1,
    }));
    expect(selectImportedReactions("imported", { reactions })).toHaveLength(
      MAX_IMPORTED_REACTION_CHIPS,
    );
  });

  it("returns nothing when payload is absent or reactions is not an array", () => {
    expect(selectImportedReactions("imported", null)).toEqual([]);
    expect(selectImportedReactions("imported", { reactions: {} })).toEqual([]);
  });
});

describe("importedReactionGlyph", () => {
  it("passes a pictograph through", () => {
    expect(
      importedReactionGlyph({ emoji: "🔥", name: null, count: 4 }),
    ).toBe("🔥");
  });

  it("wraps a custom-emoji name so it does not read as prose", () => {
    expect(
      importedReactionGlyph({
        emoji: "party_blob",
        name: "party_blob",
        count: 2,
      }),
    ).toBe(":party_blob:");
  });
});
