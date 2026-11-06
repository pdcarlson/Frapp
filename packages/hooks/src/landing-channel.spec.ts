import { describe, expect, it } from "vitest";
import {
  landingChannelId,
  lastChannelLandingId,
  lastChannelStorageKey,
} from "./landing-channel";

describe("landingChannelId", () => {
  it("prefers #general, else the first row", () => {
    expect(
      landingChannelId([
        { id: "a", name: "random" },
        { id: "g", name: "general" },
      ]),
    ).toBe("g");
    expect(landingChannelId([{ id: "a", name: "random" }])).toBe("a");
    expect(landingChannelId([])).toBeNull();
  });

  it("opens the last channel when it is still listed", () => {
    const channels = [
      { id: "g", name: "general" },
      { id: "r", name: "random" },
    ];
    expect(landingChannelId(channels, "r")).toBe("r");
    // Deleted, or no longer visible to the member: falls through.
    expect(landingChannelId(channels, "gone")).toBe("g");
  });

  // #2303: hiding the open DM sends the shell here, so landing back on it (or
  // on another hidden one) would undo the hide on screen.
  it("never lands on a DM the member hid, remembered or not", () => {
    expect(
      landingChannelId([
        { id: "dm", name: "dm-a-b", hidden: true },
        { id: "r", name: "random" },
      ]),
    ).toBe("r");
    expect(
      landingChannelId(
        [
          { id: "dm", name: "dm-a-b", hidden: true },
          { id: "r", name: "random" },
        ],
        "dm",
      ),
    ).toBe("r");
    expect(
      landingChannelId([{ id: "dm", name: "dm-a-b", hidden: true }]),
    ).toBeNull();
  });
});

describe("landingChannelId and the chapter default", () => {
  const channels = [
    { id: "g", name: "general" },
    { id: "a", name: "announcements", is_default: true },
    { id: "r", name: "random" },
  ];

  it("opens the chapter default ahead of #general when there is no last channel", () => {
    expect(landingChannelId(channels)).toBe("a");
    expect(landingChannelId(channels, "gone")).toBe("a");
  });

  it("still lets the member's last channel win", () => {
    expect(landingChannelId(channels, "r")).toBe("r");
  });

  it("falls back to #general when the default is not visible to the member", () => {
    // A private or role-gated default is absent from this member's list.
    expect(landingChannelId(channels.filter((c) => c.id !== "a"))).toBe("g");
  });
});

describe("lastChannelLandingId", () => {
  it("has no fallback", () => {
    const channels = [{ id: "g", name: "general" }];
    expect(lastChannelLandingId(channels, "g")).toBe("g");
    expect(lastChannelLandingId(channels, "x")).toBeNull();
    expect(lastChannelLandingId(channels, null)).toBeNull();
  });
});

describe("lastChannelStorageKey", () => {
  it("scopes to the member and the chapter", () => {
    expect(lastChannelStorageKey("u1", "c1")).not.toBe(
      lastChannelStorageKey("u2", "c1"),
    );
    expect(lastChannelStorageKey("u1", "c1")).not.toBe(
      lastChannelStorageKey("u1", "c2"),
    );
  });
});
