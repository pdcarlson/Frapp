import { describe, expect, it } from "vitest";
import { EMOJI_GROUPS } from "./emoji-data";
import {
  EMOJI_COLUMNS,
  canonicalEmoji,
  emojiKey,
  emojiLabel,
  emojiPickerRows,
} from "./emoji";
import {
  RECENT_EMOJI_LIMIT,
  parseRecentEmoji,
  serializeRecentEmoji,
  withRecentEmoji,
} from "./emoji-recent";

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
    const keys = emojiPickerRows("", { recent: ["🔥", "🎉"] }).map(
      (row) => row.key,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("puts the member's recent emoji first, under Recent", () => {
    const rows = emojiPickerRows("", { recent: ["🎉", "🔥"] });
    expect(rows[0]).toMatchObject({ kind: "heading", name: "Recent" });
    expect(rows[1]).toMatchObject({ emojis: ["🎉", "🔥"], section: "recent" });
    expect(rows[2]).toMatchObject({ kind: "heading", section: 0 });
  });

  it("draws no Recent heading before anything is used, nor while searching", () => {
    expect(emojiPickerRows("")[0]).toMatchObject({
      name: "Smileys & emotion",
    });
    const searched = emojiPickerRows("fire", { recent: ["🎉"] });
    expect(searched.some((row) => row.kind === "heading")).toBe(false);
  });

  it("tags each row with its section, for the category bar", () => {
    const rows = emojiPickerRows("");
    const flags = rows.filter(
      (row) => row.kind === "heading" && row.name === "Flags",
    );
    expect(flags[0]?.section).toBe(EMOJI_GROUPS.length - 1);
  });
});

describe("emojiLabel", () => {
  it("names an emoji in either spelling", () => {
    expect(emojiLabel("😂")).toBe("face with tears of joy");
    expect(emojiLabel("👍")).toBe(emojiLabel("👍\uFE0F"));
    expect(emojiLabel("x")).toBeUndefined();
  });
});

describe("recent emoji", () => {
  it("moves a use to the front once, whatever its spelling", () => {
    expect(withRecentEmoji(["🔥", "👍\uFE0F"], "👍")).toEqual(["👍", "🔥"]);
  });

  it("keeps at most the limit", () => {
    const many = Array.from({ length: RECENT_EMOJI_LIMIT }, (_, i) =>
      String.fromCodePoint(0x1f600 + i),
    );
    const next = withRecentEmoji(many, "🎉");
    expect(next).toHaveLength(RECENT_EMOJI_LIMIT);
    expect(next[0]).toBe("🎉");
  });

  it("round-trips through storage", () => {
    const list = ["👨‍👩‍👧‍👦", "🏴󠁧󠁢󠁥󠁮󠁧󠁿", "1️⃣", "🇺🇸", "❤️"];
    expect(parseRecentEmoji(serializeRecentEmoji(list))).toEqual(list);
  });

  it("drops anything that isn't an emoji, and a non-string", () => {
    expect(parseRecentEmoji("🔥 hello 🎉  42 🔥")).toEqual(["🔥", "🎉"]);
    expect(parseRecentEmoji(null)).toEqual([]);
    expect(parseRecentEmoji(7)).toEqual([]);
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
