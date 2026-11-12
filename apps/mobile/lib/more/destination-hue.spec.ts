import { describe, expect, it } from "vitest";
import { ROLE_COLOR_HEXES } from "@repo/validation";
import { signetDarkTokens } from "@repo/theme/signet";
import {
  destinationHue,
  YOU_DESTINATION_HUE_KEY,
  type YouDestination,
} from "./destination-hue";

/**
 * The You tab's tile hues (Paul, 2026-11-12; foundations.md §6, "A place's
 * hue"): one fixed hue per place, from the role palette.
 */
describe("the You tab's place hues", () => {
  const places = Object.keys(YOU_DESTINATION_HUE_KEY) as YouDestination[];

  it("draws every place in a role palette colour", () => {
    const palette: readonly string[] = ROLE_COLOR_HEXES;
    for (const place of places) {
      expect(palette, place).toContain(destinationHue(place));
    }
  });

  // The palette leaves gold and red out, so a tile can't read as the accent,
  // a mention or an error. Pinned here in case the palette ever gains one.
  it("never uses the accent's gold, the mention red or the error red", () => {
    const reserved = [
      signetDarkTokens.color.gold.house,
      signetDarkTokens.color.semantic.mention,
      signetDarkTokens.color.semantic.destructive,
    ].map((hex) => hex.toUpperCase());
    for (const place of places) {
      expect(reserved, place).not.toContain(
        destinationHue(place).toUpperCase(),
      );
    }
  });

  it("gives each place its own hue; only the two settings rows share one", () => {
    const byHue = new Map<string, YouDestination[]>();
    for (const place of places) {
      const hue = destinationHue(place);
      byHue.set(hue, [...(byHue.get(hue) ?? []), place]);
    }
    const shared = [...byHue.values()].filter((group) => group.length > 1);
    expect(shared).toEqual([["settings", "chapterSettings"]]);
  });
});
