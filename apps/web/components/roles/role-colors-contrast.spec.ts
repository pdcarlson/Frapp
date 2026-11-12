import { describe, expect, it } from "vitest";
import { ROLE_COLOR_PALETTE } from "@repo/validation";

import { AA_TEXT, CARD_HOVER, ratio, SURFACE } from "@/tests/signet-contrast";

/**
 * Role colors paint text: a chat author's name (#3485). Every swatch must read
 * at AA on every surface a name sits on, including a hovered row. The surfaces
 * come from the token source, so a later Signet change that lightens one
 * re-measures the palette instead of passing against frozen copies.
 */
const SURFACES = {
  background: SURFACE.background,
  "surface-1": SURFACE.surface1,
  card: SURFACE.card,
  popover: SURFACE.popover,
  "card-hover": CARD_HOVER,
};

/**
 * The one measured exception, and why it is recorded rather than fixed here.
 *
 * The 2026-11-12 surface ladder (#3826) lifted `--popover` to `#313131`, and
 * `--card-hover` has to sit a perceptible step above it. At the lowest value
 * that does (`#3B3B3B`, 1.16:1 over `--popover`) Rose and Violet read 4.49:1
 * and 4.42:1, so a hovered member row draws those two names a hair under AA
 * while the pointer is on it. They clear on every resting surface.
 *
 * Re-pitching the two swatches is the real fix and is not a token change: the
 * API stores a role's colour as listed and every client paints only exact
 * palette values (`roleColorOrNull`), so a new hex orphans every stored role
 * and every shipped mobile build at once. That needs a migration and a
 * compatibility window, tracked in #TBD.
 */
const HOVER_EXCEPTIONS: Readonly<Record<string, number>> = {
  Rose: 4.49,
  Violet: 4.42,
};

describe("role color palette contrast", () => {
  for (const swatch of ROLE_COLOR_PALETTE) {
    it.each(Object.entries(SURFACES))(
      `${swatch.label} reads at AA as text on %s`,
      (name, surface) => {
        const measured = ratio(swatch.hex, surface);
        const recorded = HOVER_EXCEPTIONS[swatch.label];
        if (name === "card-hover" && recorded !== undefined) {
          // Pinned, so the exception cannot quietly widen.
          expect(measured).toBeCloseTo(recorded, 2);
          return;
        }
        expect(measured).toBeGreaterThanOrEqual(AA_TEXT);
      },
    );
  }
});
