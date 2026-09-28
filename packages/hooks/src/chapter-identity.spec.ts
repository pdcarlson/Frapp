import { describe, expect, it } from "vitest";
import { signetDarkTokens } from "@repo/theme/signet";
import {
  DEFAULT_CHAPTER_ACCENT,
  EMPTY_CHAPTER_IDENTITY,
  chapterIdentityIsValid,
  normalizeAccentInput,
  parseFoundedYear,
} from "./chapter-identity";

describe("DEFAULT_CHAPTER_ACCENT", () => {
  it("is the Signet house seed, read from the token rather than copied", () => {
    // Equality with the token, not a hex literal: a seed change must move this
    // without anyone editing a test (#2102).
    expect(DEFAULT_CHAPTER_ACCENT).toBe(signetDarkTokens.color.gold.seed);
    expect(EMPTY_CHAPTER_IDENTITY.colorAccent).toBe(DEFAULT_CHAPTER_ACCENT);
  });

  it("is already in the form normalizeAccentInput produces", () => {
    // The default is sent as-is when the founder never touches the field, so it
    // has to be the same spelling a typed colour is stored as.
    expect(normalizeAccentInput(DEFAULT_CHAPTER_ACCENT, "")).toBe(
      DEFAULT_CHAPTER_ACCENT,
    );
  });
});

describe("normalizeAccentInput", () => {
  const FALLBACK = "#123456";

  it("uppercases #rrggbb, so web's lowercase colour picker and mobile's typed field store one string", () => {
    expect(normalizeAccentInput("#7a5a2f", FALLBACK)).toBe("#7A5A2F");
    expect(normalizeAccentInput("#7A5A2F", FALLBACK)).toBe("#7A5A2F");
  });

  it("accepts a bare hex, as colour pickers copy it", () => {
    expect(normalizeAccentInput("1f1a15", FALLBACK)).toBe("#1F1A15");
    expect(normalizeAccentInput("  ddb844 ", FALLBACK)).toBe("#DDB844");
  });

  it("expands a 3-digit shorthand to the #RRGGBB the API requires", () => {
    expect(normalizeAccentInput("#fff", FALLBACK)).toBe("#FFFFFF");
    expect(normalizeAccentInput("08e", FALLBACK)).toBe("#0088EE");
  });

  it("returns the fallback for anything that is not a hex colour", () => {
    for (const junk of [
      "gold",
      "#12345",
      "#1234567",
      "##fff",
      "#ggg",
      "",
      "   ",
    ]) {
      expect(normalizeAccentInput(junk, FALLBACK)).toBe(FALLBACK);
    }
    expect(normalizeAccentInput(undefined, FALLBACK)).toBe(FALLBACK);
    expect(normalizeAccentInput(null, FALLBACK)).toBe(FALLBACK);
  });
});

describe("parseFoundedYear", () => {
  it("accepts a year in range", () => {
    expect(parseFoundedYear("1948")).toBe(1948);
  });

  it("rejects empty, non-numeric, and out-of-range values", () => {
    expect(parseFoundedYear("")).toBeUndefined();
    expect(parseFoundedYear("abc")).toBeUndefined();
    expect(parseFoundedYear("1600")).toBeUndefined();
    expect(parseFoundedYear("10000")).toBeUndefined();
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
