import { describe, expect, it } from "vitest";
import { isLockedOutOfChapter } from "./no-access";

describe("isLockedOutOfChapter (#3236, #3850)", () => {
  it("holds for an empty answer in the member's only chapter", () => {
    expect(isLockedOutOfChapter([], 1)).toBe(true);
  });

  it("doesn't hold before there is an answer, or when the read is off", () => {
    expect(isLockedOutOfChapter(undefined, 1)).toBe(false);
    expect(isLockedOutOfChapter(null, 1)).toBe(false);
  });

  it("doesn't hold for a member of several chapters, who switches in the shell", () => {
    expect(isLockedOutOfChapter([], 2)).toBe(false);
  });

  it("doesn't hold for a member with any permission", () => {
    expect(isLockedOutOfChapter(["members:view"], 1)).toBe(false);
  });
});
