import { describe, expect, it } from "vitest";
import {
  courseTextLength,
  courseTextTooLong,
  normalizeCourseNicknames,
} from "./backwork-courses";

describe("normalizeCourseNicknames", () => {
  it("trims, collapses spaces, and drops blanks", () => {
    expect(normalizeCourseNicknames(["  Calc   1 ", "", "  "])).toEqual(["Calc 1"]);
  });

  it("drops case-insensitive repeats, keeping the first spelling", () => {
    expect(normalizeCourseNicknames(["Orgo", "orgo", "ORGO 1"])).toEqual(["Orgo", "ORGO 1"]);
  });

  it("drops a nickname that repeats the name", () => {
    expect(normalizeCourseNicknames(["calculus i", "Calc I"], "Calculus I")).toEqual(["Calc I"]);
  });
});

describe("course text lengths count code points, like Postgres char_length", () => {
  it("counts an astral emoji once and a heart with its variation selector twice", () => {
    expect(courseTextLength("😀")).toBe(1);
    expect(courseTextLength("❤️")).toBe(2);
  });

  it("refuses a nickname of 60 hearts (120 code points)", () => {
    expect(courseTextTooLong(null, ["❤️".repeat(60)])).toMatch(/nickname/);
    expect(courseTextTooLong(null, ["❤️".repeat(30)])).toBeNull();
  });

  it("refuses a name past 255 code points", () => {
    expect(courseTextTooLong("x".repeat(256), [])).toMatch(/course name/);
    expect(courseTextTooLong("😀".repeat(255), [])).toBeNull();
  });
});
