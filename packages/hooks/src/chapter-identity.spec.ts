import { describe, expect, it } from "vitest";
import { signetDarkTokens } from "@repo/theme/signet";
import {
  DEFAULT_CHAPTER_ACCENT,
  EMPTY_CHAPTER_IDENTITY,
  FOUNDED_YEAR_MIN,
  chapterIdentityBranding,
  chapterIdentityIsValid,
  directoryMatchMarkFields,
  latestFoundedYear,
  lettersHiddenBy,
  normalizeAccentInput,
  parseFoundedYear,
  withOrgName,
  type ChapterIdentityForm,
} from "./chapter-identity";

describe("DEFAULT_CHAPTER_ACCENT", () => {
  it("is the Signet house seed, read from the token rather than copied", () => {
    // Equality with the token, not a hex literal: a seed change must move this
    // without anyone editing a test (#2102).
    expect(DEFAULT_CHAPTER_ACCENT).toBe(signetDarkTokens.color.gold.seed);
    expect(EMPTY_CHAPTER_IDENTITY.colorAccent).toBe(DEFAULT_CHAPTER_ACCENT);
  });

  it("is already in the form normalizeAccentInput produces", () => {
    // The default is what an untouched field sends, so it has to be the same
    // spelling a typed colour is stored as.
    expect(normalizeAccentInput(DEFAULT_CHAPTER_ACCENT)).toBe(
      DEFAULT_CHAPTER_ACCENT,
    );
  });
});

describe("normalizeAccentInput", () => {
  it("uppercases #rrggbb, so web's lowercase colour picker and mobile's typed field store one string", () => {
    expect(normalizeAccentInput("#7a5a2f")).toBe("#7A5A2F");
    expect(normalizeAccentInput("#7A5A2F")).toBe("#7A5A2F");
  });

  it("accepts a bare hex, as colour pickers copy it", () => {
    expect(normalizeAccentInput("1f1a15")).toBe("#1F1A15");
    expect(normalizeAccentInput("  ddb844 ")).toBe("#DDB844");
  });

  it("expands a 3-digit shorthand to the #RRGGBB the API requires", () => {
    expect(normalizeAccentInput("#fff")).toBe("#FFFFFF");
    expect(normalizeAccentInput("08e")).toBe("#0088EE");
  });

  it("takes the default for a blank field or anything that is not a hex colour", () => {
    for (const junk of [
      "gold",
      "#12345",
      "#1234567",
      "##fff",
      "#ggg",
      "",
      "   ",
    ]) {
      expect(normalizeAccentInput(junk)).toBe(DEFAULT_CHAPTER_ACCENT);
    }
    expect(normalizeAccentInput(undefined)).toBe(DEFAULT_CHAPTER_ACCENT);
    expect(normalizeAccentInput(null)).toBe(DEFAULT_CHAPTER_ACCENT);
  });
});

describe("parseFoundedYear", () => {
  const NOW = new Date(2026, 8, 28);

  it("accepts a year from FOUNDED_YEAR_MIN through next year", () => {
    expect(parseFoundedYear("1948", NOW)).toBe(1948);
    expect(parseFoundedYear(String(FOUNDED_YEAR_MIN), NOW)).toBe(1776);
    expect(latestFoundedYear(NOW)).toBe(2027);
    expect(parseFoundedYear("2027", NOW)).toBe(2027);
  });

  it("rejects empty, non-numeric, and out-of-range values", () => {
    expect(parseFoundedYear("", NOW)).toBeUndefined();
    expect(parseFoundedYear("abc", NOW)).toBeUndefined();
    expect(parseFoundedYear("1775", NOW)).toBeUndefined();
    // The bound Settings enforces: a mistyped 2999 used to be stored by the
    // wizards and then block every Settings > Org save.
    expect(parseFoundedYear("2028", NOW)).toBeUndefined();
    expect(parseFoundedYear("2999", NOW)).toBeUndefined();
  });
});

describe("chapterIdentityIsValid", () => {
  it("requires the API's minimum name and university lengths, after a trim", () => {
    expect(chapterIdentityIsValid(EMPTY_CHAPTER_IDENTITY)).toBe(false);
    expect(
      chapterIdentityIsValid({
        ...EMPTY_CHAPTER_IDENTITY,
        name: "Sig",
        university: "UC",
      }),
    ).toBe(true);
    expect(
      chapterIdentityIsValid({
        ...EMPTY_CHAPTER_IDENTITY,
        name: " AB ",
        university: "UCLA",
      }),
    ).toBe(false);
    expect(
      chapterIdentityIsValid({
        ...EMPTY_CHAPTER_IDENTITY,
        name: "Sigma",
        university: " U ",
      }),
    ).toBe(false);
  });
});

describe("chapterIdentityBranding", () => {
  // Both wizards send exactly this, so these cases are the "web and mobile
  // store the same string for the same input" guarantee (#1642).
  it("sends the house seed for an untouched form (#2102)", () => {
    expect(chapterIdentityBranding(EMPTY_CHAPTER_IDENTITY)).toEqual({
      greek_letters: undefined,
      short_name: undefined,
      show_greek_letters: undefined,
      designation: undefined,
      school_short: undefined,
      founded_at: undefined,
      colors: { accent: DEFAULT_CHAPTER_ACCENT },
    });
  });

  it("sends the default, never the raw text, when the accent field is blank or not a colour", () => {
    // The API's DTO rejects "" and "gold", so sending either failed the whole
    // create on mobile.
    for (const colorAccent of ["", "gold"]) {
      expect(
        chapterIdentityBranding({ ...EMPTY_CHAPTER_IDENTITY, colorAccent })
          .colors.accent,
      ).toBe(DEFAULT_CHAPTER_ACCENT);
    }
  });

  it("trims text fields, drops empty ones, and normalizes the accent and year", () => {
    expect(
      chapterIdentityBranding({
        name: "Sigma",
        university: "UCLA",
        greekLetters: " ΣΦΕ ",
        shortName: "",
        showGreekLetters: true,
        designation: "   ",
        schoolShort: "UCLA",
        foundedYear: "1948",
        colorAccent: "#8b0000",
      }),
    ).toEqual({
      greek_letters: "ΣΦΕ",
      short_name: undefined,
      show_greek_letters: undefined,
      designation: undefined,
      school_short: "UCLA",
      founded_at: 1948,
      colors: { accent: "#8B0000" },
    });
  });

  it("sends a short name and the Greek-letters opt-out (#2876)", () => {
    // A FIJI chapter the directory autofilled with ΦΓΔ: the letters are kept,
    // hidden, and the short name is its mark.
    const branding = chapterIdentityBranding({
      ...EMPTY_CHAPTER_IDENTITY,
      greekLetters: "ΦΓΔ",
      shortName: " FIJI ",
      showGreekLetters: false,
    });
    expect(branding.greek_letters).toBe("ΦΓΔ");
    expect(branding.short_name).toBe("FIJI");
    expect(branding.show_greek_letters).toBe(false);
  });
});

describe("lettersHiddenBy", () => {
  it("reads the picked row's organization before the typed name", () => {
    // FIJI's row renamed to something unrelated is still FIJI.
    expect(lettersHiddenBy("Phi Gamma Delta", { name: "Tau Nu Chapter" })).toBe(
      "Phi Gamma Delta",
    );
  });

  it("falls back to the typed name, and can only hide letters", () => {
    expect(lettersHiddenBy(null, { name: "FIJI" })).toBe("Phi Gamma Delta");
    expect(
      lettersHiddenBy("Sigma Nu", { name: "Phi Gamma Delta Tau Nu" }),
    ).toBe("Phi Gamma Delta");
    expect(lettersHiddenBy("Sigma Nu", { name: "Sigma Nu" })).toBeNull();
    expect(lettersHiddenBy(undefined, { name: "" })).toBeNull();
  });
});

describe("withOrgName", () => {
  it("by hand, naming FIJI fills an empty short name and turns the letters off", () => {
    expect(withOrgName(EMPTY_CHAPTER_IDENTITY, "FIJI", false)).toMatchObject({
      name: "FIJI",
      shortName: "FIJI",
      showGreekLetters: false,
    });
  });

  it("by hand, leaving FIJI undoes both", () => {
    const fiji = withOrgName(EMPTY_CHAPTER_IDENTITY, "FIJI", false);
    expect(withOrgName(fiji, "Sigma Nu", false)).toMatchObject({
      name: "Sigma Nu",
      shortName: "",
      showGreekLetters: true,
    });
  });

  it("after a directory pick, changes the name alone", () => {
    const picked: ChapterIdentityForm = {
      ...EMPTY_CHAPTER_IDENTITY,
      name: "Phi Gamma Delta",
      shortName: "FIJI",
      showGreekLetters: false,
    };
    expect(withOrgName(picked, "Tau Nu Chapter", true)).toEqual({
      ...picked,
      name: "Tau Nu Chapter",
    });
  });
});

describe("directoryMatchMarkFields", () => {
  const fijiRow: ChapterIdentityForm = {
    ...EMPTY_CHAPTER_IDENTITY,
    name: "Phi Gamma Delta",
    shortName: "FIJI",
    showGreekLetters: false,
  };

  it("picking FIJI's row fills the short name and turns the letters off", () => {
    expect(
      directoryMatchMarkFields("Phi Gamma Delta", null, EMPTY_CHAPTER_IDENTITY),
    ).toEqual({ shortName: "FIJI", showGreekLetters: false });
  });

  it("undoes FIJI's fields when another row follows a renamed FIJI row", () => {
    // The rename changed the name alone, so the edited name no longer says
    // FIJI: the previously picked row is what set the fields.
    const renamed = withOrgName(fijiRow, "Tau Nu Chapter", true);
    expect(
      directoryMatchMarkFields("Sigma Nu", "Phi Gamma Delta", renamed),
    ).toEqual({ shortName: "", showGreekLetters: true });
  });

  it("fills FIJI's fields when FIJI's row follows another row renamed FIJI", () => {
    const sigEp: ChapterIdentityForm = {
      ...EMPTY_CHAPTER_IDENTITY,
      name: "Sigma Phi Epsilon",
    };
    const renamed = withOrgName(sigEp, "FIJI", true);
    expect(
      directoryMatchMarkFields("Phi Gamma Delta", "Sigma Phi Epsilon", renamed),
    ).toEqual({ shortName: "FIJI", showGreekLetters: false });
  });

  it("reads the typed name when no row was picked", () => {
    const typed = withOrgName(EMPTY_CHAPTER_IDENTITY, "FIJI", false);
    expect(directoryMatchMarkFields("Sigma Nu", null, typed)).toEqual({
      shortName: "",
      showGreekLetters: true,
    });
  });

  it("keeps a short name the founder typed", () => {
    expect(
      directoryMatchMarkFields("Phi Gamma Delta", null, {
        ...EMPTY_CHAPTER_IDENTITY,
        shortName: "Fiji Tau Nu",
      }),
    ).toEqual({ shortName: "Fiji Tau Nu", showGreekLetters: false });
  });
});
