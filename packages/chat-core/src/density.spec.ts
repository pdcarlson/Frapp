import { describe, expect, it } from "vitest";
import {
  CHAT_DENSITIES,
  CHAT_DENSITY_OPTIONS,
  DEFAULT_CHAT_DENSITY,
  chatDensityLabel,
  parseChannelDensityMap,
  parseChatDensity,
  resolveChannelDensity,
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
