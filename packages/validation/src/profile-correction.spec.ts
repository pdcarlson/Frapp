import { describe, expect, it } from "vitest";
import {
  CORRECTION_NAME_REQUIRED_MESSAGE,
  GRADUATION_YEAR_MESSAGE,
  correctionDraft,
  correctionPatch,
  parseGraduationYear,
} from "./profile-correction";

const original = correctionDraft({
  displayName: "Jonh Smith",
  graduationYear: 2026,
});

describe("correctionPatch", () => {
  it("sends only what changed, trimmed", () => {
    expect(
      correctionPatch(original, {
        name: " John Smith ",
        graduationYear: "2026",
      }),
    ).toEqual({ ok: true, patch: { display_name: "John Smith" } });
    expect(
      correctionPatch(original, { name: "Jonh Smith", graduationYear: "2027" }),
    ).toEqual({ ok: true, patch: { graduation_year: 2027 } });
  });

  it("sends nothing when nothing changed", () => {
    expect(correctionPatch(original, original)).toEqual({
      ok: true,
      patch: {},
    });
  });

  it("clears a blank year", () => {
    expect(
      correctionPatch(original, { name: "Jonh Smith", graduationYear: " " }),
    ).toEqual({ ok: true, patch: { graduation_year: null } });
  });

  it("refuses a blank name", () => {
    expect(
      correctionPatch(original, { name: "  ", graduationYear: "2026" }),
    ).toEqual({
      ok: false,
      field: "name",
      message: CORRECTION_NAME_REQUIRED_MESSAGE,
    });
  });

  it.each(["27", "1899", "2101", "20x7"])("refuses year %s", (year) => {
    expect(
      correctionPatch(original, { name: "Jonh Smith", graduationYear: year }),
    ).toEqual({
      ok: false,
      field: "graduationYear",
      message: GRADUATION_YEAR_MESSAGE,
    });
  });

  it("opens on blanks for an unset profile", () => {
    expect(
      correctionDraft({ displayName: null, graduationYear: null }),
    ).toEqual({ name: "", graduationYear: "" });
  });
});

describe("parseGraduationYear", () => {
  it("reads blank as clearing the year", () => {
    expect(parseGraduationYear("  ")).toBeNull();
  });

  it("takes four digits in range", () => {
    expect(parseGraduationYear(" 2027 ")).toBe(2027);
  });

  it.each(["27", "'27", "1899", "2101", "20x7"])("refuses %s", (text) => {
    expect(parseGraduationYear(text)).toBeUndefined();
  });
});
