import { describe, expect, it } from "vitest";
import {
  chapterInitials,
  chapterTextMark,
  displayedGreekLetters,
  greekLettersShown,
  resolveChapterMark,
} from "./chapter-mark";
import { ChapterBrandingSchema } from "./index";
import { CHAPTER_SHORT_NAME_MAX_LENGTH } from "./field-limits";

describe("resolveChapterMark (#2876)", () => {
  const everything = {
    short_name: "FIJI",
    greek_letters: "ΦΓΔ",
  };

  it("prefers the logo over everything", () => {
    expect(
      resolveChapterMark({
        logoUrl: "https://storage.example/logo.png",
        branding: everything,
        name: "Tau Nu",
      }),
    ).toEqual({ kind: "logo", url: "https://storage.example/logo.png" });
  });

  it("uses the short name before Greek letters", () => {
    expect(
      resolveChapterMark({ logoUrl: null, branding: everything, name: "Tau Nu" }),
    ).toEqual({ kind: "text", text: "FIJI", source: "short_name" });
  });

  it("uses Greek letters when there is no short name", () => {
    expect(
      resolveChapterMark({
        branding: { greek_letters: "ΣΦΕ" },
        name: "California Eta",
      }),
    ).toEqual({ kind: "text", text: "ΣΦΕ", source: "greek_letters" });
  });

  it("skips Greek letters for a chapter that turned them off", () => {
    // The beta chapter: a FIJI chapter with letters stored from the directory
    // autofill and no short name yet. It must not show ΦΓΔ.
    expect(
      resolveChapterMark({
        branding: { greek_letters: "ΦΓΔ", show_greek_letters: false },
        name: "Tau Nu",
      }),
    ).toEqual({ kind: "text", text: "TN", source: "initials" });
  });

  it("falls back to initials when nothing is set", () => {
    expect(resolveChapterMark({ branding: {}, name: "Alpha" })).toEqual({
      kind: "text",
      text: "AL",
      source: "initials",
    });
    expect(resolveChapterMark({ branding: null, name: "" })).toEqual({
      kind: "text",
      text: "--",
      source: "initials",
    });
  });

  it("treats blank and malformed values as unset", () => {
    expect(
      resolveChapterMark({
        logoUrl: "  ",
        branding: { short_name: "   ", greek_letters: 42 },
        name: "Beta Gamma",
      }),
    ).toEqual({ kind: "text", text: "BG", source: "initials" });
  });

  it("trims what it shows", () => {
    expect(chapterTextMark({ short_name: "  FIJI " })).toEqual({
      text: "FIJI",
      source: "short_name",
    });
  });
});

describe("greekLettersShown", () => {
  it("defaults to shown, so chapters from before the setting keep their letters", () => {
    expect(greekLettersShown({})).toBe(true);
    expect(greekLettersShown(undefined)).toBe(true);
    expect(greekLettersShown({ show_greek_letters: true })).toBe(true);
  });

  it("is off only for an explicit false", () => {
    expect(greekLettersShown({ show_greek_letters: false })).toBe(false);
    // A malformed value is not an opt-out.
    expect(greekLettersShown({ show_greek_letters: "false" })).toBe(true);
  });
});

describe("displayedGreekLetters", () => {
  it("hides stored letters when the chapter opted out, without needing them cleared", () => {
    expect(
      displayedGreekLetters({ greek_letters: "ΦΓΔ", show_greek_letters: false }),
    ).toBeNull();
    expect(displayedGreekLetters({ greek_letters: "ΦΓΔ" })).toBe("ΦΓΔ");
  });
});

describe("chapterInitials", () => {
  it("takes two words' first letters, or a one-word name's first two", () => {
    expect(chapterInitials("tau nu")).toBe("TN");
    expect(chapterInitials("Sigma Phi Epsilon")).toBe("SP");
    expect(chapterInitials("Alpha")).toBe("AL");
  });
});

describe("ChapterBrandingSchema short_name", () => {
  it("accepts a short name up to the cap, and an empty string to clear it", () => {
    expect(ChapterBrandingSchema.safeParse({ short_name: "FIJI" }).success).toBe(
      true,
    );
    expect(ChapterBrandingSchema.safeParse({ short_name: "" }).success).toBe(
      true,
    );
    expect(
      ChapterBrandingSchema.safeParse({
        short_name: "X".repeat(CHAPTER_SHORT_NAME_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
  });

  it("keeps show_greek_letters on read", () => {
    expect(
      ChapterBrandingSchema.parse({ show_greek_letters: false }),
    ).toEqual({ show_greek_letters: false });
  });
});
