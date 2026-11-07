import { describe, expect, it } from "vitest";
import {
  CHAT_DENSITIES,
  CHAT_DENSITY_OPTIONS,
  DEFAULT_CHAT_DENSITY,
  chatDensityLabel,
  parseChatDensity,
} from "./density";

describe("parseChatDensity", () => {
  it("keeps a stored density", () => {
    expect(parseChatDensity("compact")).toBe("compact");
    expect(parseChatDensity("cozy")).toBe("cozy");
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
  });
});
