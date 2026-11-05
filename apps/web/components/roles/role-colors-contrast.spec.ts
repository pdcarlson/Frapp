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

describe("role color palette contrast", () => {
  for (const swatch of ROLE_COLOR_PALETTE) {
    it.each(Object.entries(SURFACES))(
      `${swatch.label} reads at AA as text on %s`,
      (_name, surface) => {
        expect(ratio(swatch.hex, surface)).toBeGreaterThanOrEqual(AA_TEXT);
      },
    );
  }
});
