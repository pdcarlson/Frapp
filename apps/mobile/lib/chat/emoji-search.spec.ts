import { describe, expect, it } from "vitest";
import { EMOJI_GROUPS } from "./emoji-data";
import {
  EMOJI_COLUMNS,
  canonicalEmoji,
  emojiKey,
  emojiPickerRows,
} from "./emoji-search";

function emojis(rows: ReturnType<typeof emojiPickerRows>): string[] {
  return rows.flatMap((row) => (row.kind === "emoji" ? row.emojis : []));
}

describe("emojiPickerRows", () => {
  it("lists every group under its heading when nothing is typed", () => {
    const rows = emojiPickerRows("");
    const headings = rows.filter((row) => row.kind === "heading");
    expect(headings.map((h) => h.kind === "heading" && h.name)).toEqual(
      EMOJI_GROUPS.map((g) => g.name),
    );
    expect(headings[0]).toMatchObject({ name: "Smileys & emotion" });
    const total = EMOJI_GROUPS.reduce((n, g) => n + g.entries.length, 0);
    expect(emojis(rows)).toHaveLength(total);
  });

  it("breaks each group into lines of the column count", () => {
    for (const row of emojiPickerRows("")) {
      if (row.kind === "emoji") {
        expect(row.emojis.length).toBeLessThanOrEqual(EMOJI_COLUMNS);
        expect(row.emojis.length).toBeGreaterThan(0);
      }
    }
  });

  it("finds an emoji by its name or a tag, with no headings", () => {
    const rows = emojiPickerRows("fire");
    expect(rows.every((row) => row.kind === "emoji")).toBe(true);
    // The flame, whose name starts with the word, ranks first.
    expect(emojis(rows)[0]).toBe("🔥");
    expect(emojis(emojiPickerRows("thumbs up")).map(emojiKey)).toContain("👍");
  });

  it("needs every word typed, in any case", () => {
    expect(emojis(emojiPickerRows("RED HEART"))).toContain("❤️");
    expect(emojis(emojiPickerRows("zzqx"))).toEqual([]);
  });

  it("keeps keys unique, so the list never reuses a row", () => {
    const keys = emojiPickerRows("").map((row) => row.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("canonicalEmoji", () => {
  it("hands back the spelling already in use, so a pick joins its chip", () => {
    // emojibase spells thumbs up with U+FE0F; the quick row does not.
    expect(canonicalEmoji("👍\uFE0F", ["👍", "🔥"])).toBe("👍");
  });

  it("keeps the picker's spelling for an emoji nobody has used", () => {
    expect(canonicalEmoji("🎉", ["👍"])).toBe("🎉");
  });
});
