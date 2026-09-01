import { describe, expect, it } from "vitest";
import { titleCase, vocab } from "./vocabulary";

describe("vocab", () => {
  it("falls back to the IFC default when the chapter has no override", () => {
    expect(vocab("pledge", undefined)).toBe("New member");
    expect(vocab("pledge", {})).toBe("New member");
  });

  it("returns the chapter's own override when set", () => {
    expect(vocab("pledge", { vocabulary: { pledge: "Aspirant" } })).toBe(
      "Aspirant",
    );
  });

  it("ignores a blank or non-string override and falls back to the default", () => {
    expect(vocab("pledge", { vocabulary: { pledge: "   " } })).toBe(
      "New member",
    );
  });
});

// #351 diff-review finding: the rollover copy's regex assertions are
// case-insensitive, so they alone would not catch a capitalization
// regression — this pins the pure helper's behavior directly.
describe("titleCase", () => {
  it("capitalizes every word, not just the string's first character", () => {
    // The bug this guards: a naive "capitalize only the first char of the
    // whole string" helper leaves "New member" unchanged, since its first
    // character ("N") is already uppercase.
    expect(titleCase("New member")).toBe("New Member");
    expect(titleCase(vocab("pledge", undefined))).toBe("New Member");
  });

  it("leaves an already-fully-capitalized term unchanged", () => {
    expect(titleCase("Aspirant")).toBe("Aspirant");
    expect(titleCase("Pledge Class")).toBe("Pledge Class");
  });

  it("handles an empty string without throwing", () => {
    expect(titleCase("")).toBe("");
  });
});
