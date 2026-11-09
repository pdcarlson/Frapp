import { describe, expect, it } from "vitest";
import { normalizeCourseNicknames } from "./backwork-courses";

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
