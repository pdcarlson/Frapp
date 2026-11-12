import { describe, expect, it } from "vitest";
import { stripObjectReplacement } from "./message-text";

describe("stripObjectReplacement", () => {
  it("removes every object replacement character", () => {
    expect(stripObjectReplacement("take a look ￼")).toBe("take a look ");
    expect(stripObjectReplacement("￼a￼b￼")).toBe("ab");
  });

  it("leaves other text, emoji included, as it was", () => {
    const text = "see you at 8 👍🏽 — @Winston Hewitt";
    expect(stripObjectReplacement(text)).toBe(text);
  });

  it("returns an empty string for text that was only the placeholder", () => {
    expect(stripObjectReplacement("￼")).toBe("");
  });
});
