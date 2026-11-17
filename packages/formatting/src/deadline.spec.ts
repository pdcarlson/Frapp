import { describe, expect, it } from "vitest";
import { CLOSES_AT_CASES, closesAtHasPassed } from "./deadline";

describe("closesAtHasPassed (#5242)", () => {
  it.each(CLOSES_AT_CASES)("%s", (_label, closesAt, now, passed) => {
    expect(closesAtHasPassed(closesAt, now)).toBe(passed);
  });

  it("covers the boundary from both sides and every no-deadline shape", () => {
    expect(
      CLOSES_AT_CASES.map(([label, , , passed]) => [label, passed]),
    ).toEqual([
      ["before its end time", false],
      ["exactly at its end time", true],
      ["after its end time", true],
      ["with no end time (undefined)", false],
      ["with no end time (null)", false],
      ["with an empty end time", false],
      ["with an unparseable end time", false],
    ]);
  });
});
