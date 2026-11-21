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
  test("a typist the roster can't name yet is left out, never Someone", () => {
    expect(typingLabel(["x"], nameOf)).toBeNull();
    expect(typingLabel(["x", "p"], nameOf)).toBe("Paul is typing…");
    expect(typingLabel(["p", "x", "s"], nameOf)).toBe(
      "Paul and Shawn are typing…",
    );
  });
  test("counts only the named toward several people", () => {
    expect(typingLabel(["p", "s", "a", "x"], nameOf)).toBe(
      "Paul, Shawn and Alex are typing…",
    );
  });
});
