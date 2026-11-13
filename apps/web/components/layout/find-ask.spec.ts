import { describe, expect, it } from "vitest";
import { asksFirst } from "./find-ask";

/** Which row Enter means in the one field for search and Ask (#4904). */
describe("asksFirst", () => {
  it.each([
    "when is formal?",
    "dues?",
    "who has the van keys",
    "what's due",
    "is rush open",
    "which venue did we pick for formal",
    "budget vote last spring meeting",
  ])("reads %j as a question", (text) => {
    expect(asksFirst(text)).toBe(true);
  });

  it.each([
    "",
    "   ",
    "gen",
    "general",
    "Ada Lovelace",
    "van keys",
    "rush week photos",
    // One word is a search, whatever the word.
    "which",
    "who",
  ])("reads %j as a search", (text) => {
    expect(asksFirst(text)).toBe(false);
  });

  it("is not thrown by case or spacing", () => {
    expect(asksFirst("  WHO   has the keys ")).toBe(true);
  });
});
