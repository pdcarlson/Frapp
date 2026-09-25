import { describe, expect, it } from "vitest";
import { coldLoadDefaultChannelId } from "./default-channel";

describe("coldLoadDefaultChannelId", () => {
  it("prefers #general, else the first row", () => {
    expect(
      coldLoadDefaultChannelId([
        { id: "a", name: "random" },
        { id: "g", name: "general" },
      ]),
    ).toBe("g");
    expect(coldLoadDefaultChannelId([{ id: "a", name: "random" }])).toBe("a");
    expect(coldLoadDefaultChannelId([])).toBeNull();
  });

  // #2303: hiding the open DM sends the shell here, so landing back on it (or
  // on another hidden one) would undo the hide on screen.
  it("never lands on a DM the member hid", () => {
    expect(
      coldLoadDefaultChannelId([
        { id: "dm", name: "dm-a-b", hidden: true },
        { id: "r", name: "random" },
      ]),
    ).toBe("r");
    expect(
      coldLoadDefaultChannelId([{ id: "dm", name: "dm-a-b", hidden: true }]),
    ).toBeNull();
  });
});
