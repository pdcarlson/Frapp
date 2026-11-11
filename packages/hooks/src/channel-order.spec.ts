import { describe, expect, it } from "vitest";
import { applyCategoryOrder, applyChannelOrder } from "./use-chat";

// The optimistic writes behind a drag in the web rail (#4178): the cache must
// show what the server's RPCs will leave, or the row jumps back and forth.
describe("applyChannelOrder", () => {
  const rows = [
    { id: "general", category_id: null, display_order: null },
    { id: "random", category_id: null, display_order: null },
    { id: "rush", category_id: "b", display_order: 0 },
    { id: "dm", category_id: null, display_order: null },
  ];

  it("numbers the listed channels in order and files them under the section", () => {
    const next = applyChannelOrder(rows, "a", ["rush", "general"]);
    expect(next.find((r) => r.id === "rush")).toEqual({
      id: "rush",
      category_id: "a",
      display_order: 0,
    });
    expect(next.find((r) => r.id === "general")).toEqual({
      id: "general",
      category_id: "a",
      display_order: 1,
    });
  });

  it("leaves rows it doesn't list as they were, and the input untouched", () => {
    const next = applyChannelOrder(rows, null, ["random"]);
    expect(next.find((r) => r.id === "dm")).toBe(rows[3]);
    expect(rows[1]!.display_order).toBeNull();
  });
});

describe("applyCategoryOrder", () => {
  it("puts the listed categories first and any other after, numbered from 0", () => {
    const next = applyCategoryOrder(
      [
        { id: "a", display_order: 0 },
        { id: "b", display_order: 1 },
        { id: "c", display_order: 2 },
      ],
      ["c", "a"],
    );
    expect(next).toEqual([
      { id: "c", display_order: 0 },
      { id: "a", display_order: 1 },
      { id: "b", display_order: 2 },
    ]);
  });
});
