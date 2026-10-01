import { describe, expect, it } from "vitest";
import {
  chapterInitials,
  chapterTextMark,
  displayedGreekLetters,
  greekLettersShown,
  resolveChapterMark,
} from "./chapter-mark";
import { ChapterBrandingSchema } from "./index";

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
    ).toEqual({
      logoUrl: "https://storage.example/logo.png",
      // Still resolved: it is what shows if the logo fails to load.
      text: "FIJI",
      source: "short_name",
    });
  });

  it("uses the short name before Greek letters", () => {
    expect(
      resolveChapterMark({ logoUrl: null, branding: everything, name: "Tau Nu" }),
    ).toEqual({ logoUrl: null, text: "FIJI", source: "short_name" });
  });

  it("uses Greek letters when there is no short name", () => {
    expect(
      resolveChapterMark({
        branding: { greek_letters: "ΣΦΕ" },
        name: "California Eta",
      }),
    ).toEqual({ logoUrl: null, text: "ΣΦΕ", source: "greek_letters" });
  });

  it("skips Greek letters for a chapter that turned them off", () => {
    // The beta chapter: a FIJI chapter with letters stored from the directory
    // autofill and no short name yet. It must not show ΦΓΔ.
    expect(
      resolveChapterMark({
        branding: { greek_letters: "ΦΓΔ", show_greek_letters: false },
        name: "Tau Nu",
      }),
    ).toEqual({ logoUrl: null, text: "TN", source: "initials" });
  });

  it("falls back to initials when nothing is set", () => {
    expect(resolveChapterMark({ branding: {}, name: "Alpha" })).toEqual({
      logoUrl: null,
      text: "AL",
      source: "initials",
    });
    expect(resolveChapterMark({ branding: null, name: "" })).toEqual({
      logoUrl: null,
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
    ).toEqual({ logoUrl: null, text: "BG", source: "initials" });
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

  it("never splits a character outside the BMP into a lone surrogate", () => {
    expect(chapterInitials("😀 Chapter")).toBe("😀C");
    expect(chapterInitials("a😀")).toBe("A😀");
    expect(chapterInitials("𝚽 Gamma")).toBe("𝚽G");
  });
});

describe("ChapterBrandingSchema short_name", () => {
  it("parses any short name the API accepts, since the DTO owns the cap", () => {
    // class-validator counts this as 4 (it drops U+FE0F), so the API stores
    // it; zod would count 8, so a zod cap would refuse it.
    expect(
      ChapterBrandingSchema.safeParse({ short_name: "❤️❤️❤️❤️" }).success,
    ).toBe(true);
    expect(ChapterBrandingSchema.safeParse({ short_name: "" }).success).toBe(
      true,
    );
  });

  it("keeps show_greek_letters on read", () => {
    expect(
      ChapterBrandingSchema.parse({ show_greek_letters: false }),
    ).toEqual({ show_greek_letters: false });
  });
});
