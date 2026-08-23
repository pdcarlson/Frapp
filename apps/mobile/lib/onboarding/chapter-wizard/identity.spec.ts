import { describe, expect, it } from "vitest";
import {
  DEFAULT_ACCENT,
  EMPTY_IDENTITY,
  identityIsValid,
  normalizeHex,
  parseFoundedYear,
} from "./identity";

describe("normalizeHex", () => {
  it("accepts #RRGGBB and uppercases it", () => {
    expect(normalizeHex("#7a5a2f", DEFAULT_ACCENT)).toBe("#7A5A2F");
  });

  it("accepts RRGGBB without a hash", () => {
    expect(normalizeHex("1f1a15", DEFAULT_ACCENT)).toBe("#1F1A15");
  });

  it("falls back on junk", () => {
    expect(normalizeHex("gold", DEFAULT_ACCENT)).toBe(DEFAULT_ACCENT);
    expect(normalizeHex("#fff", DEFAULT_ACCENT)).toBe(DEFAULT_ACCENT);
    expect(normalizeHex(undefined, DEFAULT_ACCENT)).toBe(DEFAULT_ACCENT);
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
  });
});

describe("identityIsValid", () => {
  it("requires a name and university of the same lengths the web wizard does", () => {
    expect(identityIsValid(EMPTY_IDENTITY)).toBe(false);
    expect(
      identityIsValid({
        ...EMPTY_IDENTITY,
        name: "Sig",
        university: "UCLA",
      }),
    ).toBe(true);
    expect(
      identityIsValid({
        ...EMPTY_IDENTITY,
        name: "AB",
        university: "UCLA",
      }),
    ).toBe(false);
  });
});
