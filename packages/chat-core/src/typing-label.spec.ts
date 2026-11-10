import { describe, expect, test } from "vitest";
import { typingLabel } from "./typing-label";

const names: Record<string, string> = {
  p: "Paul",
  s: "Shawn",
  a: "Alex",
  w: "Winston",
};
const nameOf = (id: string) => names[id] ?? null;

describe("typingLabel (#4014, #3785)", () => {
  test("nobody typing is no line", () => {
    expect(typingLabel([], nameOf)).toBeNull();
  });
  test("names one, two and three typists", () => {
    expect(typingLabel(["p"], nameOf)).toBe("Paul is typing…");
    expect(typingLabel(["p", "s"], nameOf)).toBe("Paul and Shawn are typing…");
    expect(typingLabel(["p", "s", "a"], nameOf)).toBe(
      "Paul, Shawn and Alex are typing…",
    );
  });
  test("four or more is several people", () => {
    expect(typingLabel(["p", "s", "a", "w"], nameOf)).toBe(
      "Several people are typing…",
    );
  });
  test("an unknown name reads as Someone", () => {
    expect(typingLabel(["x"], nameOf)).toBe("Someone is typing…");
  });
});
