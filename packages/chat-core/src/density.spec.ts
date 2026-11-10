import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_DENSITIES,
  CHAT_DENSITY_OPTIONS,
  DEFAULT_CHAT_DENSITY,
  FORMAL_CHAT_DENSITY,
  channelDensityDetail,
  chatDensityLabel,
  getLockedChannels,
  parseChannelDensityMap,
  parseChatDensity,
  resetLockedChannelsForTests,
  resolveChannelDensity,
  setChannelLocked,
  subscribeLockedChannels,
  syncLockedChannels,
  withChannelDensity,
} from "./density";

describe("parseChatDensity", () => {
  it("keeps a stored density", () => {
    expect(parseChatDensity("compact")).toBe("compact");
    expect(parseChatDensity("cozy")).toBe("cozy");
    expect(parseChatDensity("bubbles")).toBe("bubbles");
  });

  it("reads anything else as the default", () => {
    for (const raw of [null, undefined, "", "Compact", "dense", 1, {}]) {
      expect(parseChatDensity(raw)).toBe(DEFAULT_CHAT_DENSITY);
    }
  });
});

describe("CHAT_DENSITY_OPTIONS", () => {
  it("offers every density once, in order", () => {
    expect(CHAT_DENSITY_OPTIONS.map((option) => option.value)).toEqual([
      ...CHAT_DENSITIES,
    ]);
  });

  it("labels each density", () => {
    expect(chatDensityLabel("cozy")).toBe("Cozy");
    expect(chatDensityLabel("compact")).toBe("Compact");
    expect(chatDensityLabel("bubbles")).toBe("Bubbles");
  });

  it("keeps cozy as the default, never bubbles", () => {
    expect(DEFAULT_CHAT_DENSITY).toBe("cozy");
  });
});

describe("channel overrides", () => {
  it("reads a stored map, dropping entries that are not densities", () => {
    expect(
      parseChannelDensityMap(
        JSON.stringify({ a: "bubbles", b: "dense", c: 3, d: "compact" }),
      ),
    ).toEqual({ a: "bubbles", d: "compact" });
  });

  it("reads anything malformed as no overrides", () => {
    for (const raw of [null, undefined, "", "{", "[]", "3", 1]) {
      expect(parseChannelDensityMap(raw)).toEqual({});
    }
  });

  it("sets and clears one channel without touching the others", () => {
    const set = withChannelDensity({ a: "compact" }, "b", "bubbles");
    expect(set).toEqual({ a: "compact", b: "bubbles" });
    expect(withChannelDensity(set, "a", null)).toEqual({ b: "bubbles" });
  });

  it("resolves a channel to its override, else the default", () => {
    const map = { a: "bubbles" } as const;
    expect(resolveChannelDensity("cozy", map, "a")).toBe("bubbles");
    expect(resolveChannelDensity("compact", map, "b")).toBe("compact");
    expect(resolveChannelDensity("compact", map, null)).toBe("compact");
  });
});

describe("Always formal (#3787)", () => {
  afterEach(() => resetLockedChannelsForTests());

  it("draws the formal display in a locked channel, over the member's own pick", () => {
    expect(FORMAL_CHAT_DENSITY).toBe("cozy");
    const map = { a: "bubbles" } as const;
    expect(resolveChannelDensity("compact", map, "a", true)).toBe("cozy");
    expect(resolveChannelDensity("bubbles", {}, "b", true)).toBe("cozy");
    // Unlocked, the override is still there.
    expect(resolveChannelDensity("compact", map, "a", false)).toBe("bubbles");
  });

  it("names the lock on the menu row", () => {
    expect(channelDensityDetail("bubbles", true)).toBe("Formal");
    expect(channelDensityDetail(null, false)).toBe("Default");
  });

  it("copies the locked ids from a channel list and notifies only on a change", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLockedChannels(listener);

    syncLockedChannels([
      { id: "a", display_locked: true },
      { id: "b", display_locked: false },
      { id: "c" },
    ]);
    expect([...getLockedChannels()]).toEqual(["a"]);
    expect(listener).toHaveBeenCalledTimes(1);

    const before = getLockedChannels();
    syncLockedChannels([{ id: "a", display_locked: true }]);
    expect(getLockedChannels()).toBe(before);
    expect(listener).toHaveBeenCalledTimes(1);

    syncLockedChannels([]);
    expect(getLockedChannels().size).toBe(0);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("marks one channel ahead of the list's refetch", () => {
    setChannelLocked("a", true);
    expect(getLockedChannels().has("a")).toBe(true);
    setChannelLocked("a", false);
    expect(getLockedChannels().has("a")).toBe(false);
  });
});
