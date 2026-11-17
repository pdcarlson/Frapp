import { describe, expect, it } from "vitest";
import { closesAtHasPassed } from "./deadline";

const END = "2026-11-12T12:00:00.000Z";
const AT = Date.parse(END);

describe("closesAtHasPassed (#5242)", () => {
  it.each([
    ["before its end time", END, AT - 1, false],
    ["exactly at its end time", END, AT, true],
    ["after its end time", END, AT + 1, true],
    ["with no end time (undefined)", undefined, AT, false],
    ["with no end time (null)", null, AT, false],
    ["with an empty end time", "", AT, false],
    ["with an unparseable end time", "soon", AT, false],
  ] as const)("%s", (_label, closesAt, now, passed) => {
    expect(closesAtHasPassed(closesAt, now)).toBe(passed);
  });
});
