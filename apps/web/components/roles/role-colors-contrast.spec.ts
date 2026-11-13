import { mixHex } from "@repo/color";
import { ROLE_COLOR_PALETTE } from "@repo/validation";
import { describe, expect, it } from "vitest";

import { AA_TEXT, CARD_HOVER, ratio, SURFACE } from "@/tests/signet-contrast";

import { ROLE_NAME_CLASS, ROLE_NAME_HOVER_LIFT } from "./role-name-paint";

/**
 * Role colors paint text: a chat author's name (#3485). Every swatch must read
 * at AA on every surface a name sits on, including a hovered row. The surfaces
 * come from the token source, so a later Signet change that lightens one
 * re-measures the palette instead of passing against frozen copies.
 */
const RESTING_SURFACES = {
  background: SURFACE.background,
  "surface-1": SURFACE.surface1,
  card: SURFACE.card,
  popover: SURFACE.popover,
};

/**
 * A hovered row (the channel member list and the notifications dropdown) lifts
 * to `--card-hover`, and `--card-hover` has to sit a perceptible step above
 * `--popover`. At the lowest value that does (`#3B3B3B`) the resting Rose and
 * Violet read 4.49:1 and 4.42:1, a hair under AA (#4387). Rather than re-pitch
 * the stored palette — which the API stores verbatim and shipped mobile builds
 * paint only exact matches of — web lifts the *painted* name on hover
 * (`role-name-paint.ts`): it mixes white into the role color while the row is
 * hovered. So the measurement that matters on `--card-hover` is the lifted
 * color, and there is no recorded exception left. This reads the mix out of the
 * class string so the two cannot drift.
 */
const HOVER_LIFT = (() => {
  const match = ROLE_NAME_CLASS.match(/var\(--role-name\)_(\d+)%,white/);
  const kept = match ? Number(match[1]) / 100 : NaN;
  // The class keeps `kept` of the role color; `ROLE_NAME_HOVER_LIFT` adds that
  // much white. They are the same lift expressed two ways; guard it.
  expect(kept).toBeCloseTo(1 - ROLE_NAME_HOVER_LIFT, 5);
  return ROLE_NAME_HOVER_LIFT;
})();

describe("role color palette contrast", () => {
  for (const swatch of ROLE_COLOR_PALETTE) {
    it.each(Object.entries(RESTING_SURFACES))(
      `${swatch.label} reads at AA as text on %s`,
      (_name, surface) => {
        expect(ratio(swatch.hex, surface)).toBeGreaterThanOrEqual(AA_TEXT);
      },
    );

    it(`${swatch.label} reads at AA on a hovered row (--card-hover), lifted`, () => {
      const painted = mixHex(swatch.hex, "#FFFFFF", HOVER_LIFT);
      expect(ratio(painted, CARD_HOVER)).toBeGreaterThanOrEqual(AA_TEXT);
    });
  }
});
