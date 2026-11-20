import { describe, expect, it } from "vitest";
import { contrastRatio, parseHex } from "@repo/color";
import { signetDarkTokens } from "@repo/theme/signet";
import { meterGrooveOn, meterStyles } from "@/components/meter";
import { pageSurfaces, sheetSurfaces } from "@/lib/surfaces";

const tokens = signetDarkTokens;
const { surface } = tokens.color;
const ratio = (a: string, b: string) =>
  contrastRatio(parseHex(a)!, parseHex(b)!);

/**
 * The defect this exists for (#5695): on the softer 2026-11-19 ladder a
 * `--background` groove on a phone card (`--surface-1`) was 1.08:1, so an
 * empty week ring all but vanished. The old ladder's groove there was 1.17:1.
 */
describe("the meter's groove", () => {
  const STEPS = [
    surface.background,
    surface.surface1,
    surface.card,
    surface.popover,
  ];

  it("reads on every surface a meter can sit on, at least as well as the old ladder's 1.17:1", () => {
    for (const on of STEPS) {
      expect(ratio(meterGrooveOn(tokens, on), on), `on ${on}`).toBeGreaterThan(
        1.17,
      );
    }
  });

  it("serves a phone card and a sheet card, the two places cards sit", () => {
    for (const on of [pageSurfaces(tokens).card, sheetSurfaces(tokens).card]) {
      expect(ratio(meterGrooveOn(tokens, on), on)).toBeGreaterThan(1.17);
    }
  });

  it("is always a ladder step, so the accent fill clears 3:1 against it", () => {
    // The accent engine holds every chapter's fill to 3:1 on the four ladder
    // steps (`accent-engine.md` §8, `SIGNET_FILL_SURFACES`), so a groove that
    // is one of them inherits that floor.
    for (const on of STEPS) {
      expect(STEPS).toContain(meterGrooveOn(tokens, on));
    }
  });

  it("is painted by the recipe, so callers never pick it", () => {
    expect(meterStyles(tokens, surface.surface1).track.backgroundColor).toBe(
      meterGrooveOn(tokens, surface.surface1),
    );
  });
});
