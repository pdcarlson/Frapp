import { describe, expect, it } from "vitest";
import { extractMentionTokens } from "./mentions";
import { withoutObjectReplacement } from "./message-text";

describe("withoutObjectReplacement", () => {
  it("turns every object replacement character into a space", () => {
    expect(withoutObjectReplacement("take a look ￼")).toBe("take a look  ");
    expect(withoutObjectReplacement("a￼b￼c")).toBe("a b c");
  });

  it("keeps a mention written right after one", () => {
    expect(extractMentionTokens(withoutObjectReplacement("hi￼@Alice"))).toEqual(
      ["Alice"],
    );
  });

  it("leaves other text, emoji included, as it was", () => {
    const text = "see you at 8 👍🏽 — @Winston Hewitt";
    expect(withoutObjectReplacement(text)).toBe(text);
  });

  it("leaves text that was only the placeholder blank", () => {
    expect(withoutObjectReplacement("￼").trim()).toBe("");
  });
});
