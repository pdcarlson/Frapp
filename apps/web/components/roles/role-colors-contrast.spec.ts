import { mixHex } from "@repo/color";
import {
  ROLE_COLOR_PALETTE,
  ROLE_COLOR_SURFACES,
  roleColorForHue,
} from "@repo/validation";
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
 * to `--card-hover`, where Rose and Violet at full strength fall a hair under
 * AA (#4387; figures in `ROLE_COLOR_PALETTE`'s doc). Web lifts the painted name
 * on hover instead (`role-name-paint.ts`), so the measurement that matters on
 * `--card-hover` is the lifted color, and no exception is recorded. This reads
 * the mix out of the class string so the two cannot drift.
 */
const HOVER_LIFT = (() => {
  const match = ROLE_NAME_CLASS.match(/var\(--role-name\)_(\d+)%,white/);
  const kept = match ? Number(match[1]) / 100 : NaN;
  // The class keeps `kept` of the role color; `ROLE_NAME_HOVER_LIFT` adds that
  // much white. They are the same lift expressed two ways; guard it.
  expect(kept).toBeCloseTo(1 - ROLE_NAME_HOVER_LIFT, 5);
  return ROLE_NAME_HOVER_LIFT;
})();

describe("role name paint", () => {
  it("paints the role colour at rest, not only on hover", () => {
    // The inline style only sets --role-name; this token is what paints it.
    expect(ROLE_NAME_CLASS.split(" ")).toContain("text-(--role-name)");
  });
});

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

/**
 * A custom hue (#5784) is checked inside `@repo/validation` against
 * `ROLE_COLOR_SURFACES`, which that package restates because the API can't
 * import the theme. This pins the restatement to the token source, so a
 * Signet change re-measures custom hues instead of passing against stale
 * copies.
 */
describe("custom role colors", () => {
  it("measure against the surfaces the app ships", () => {
    expect(ROLE_COLOR_SURFACES).toEqual({
      background: SURFACE.background,
      surface1: SURFACE.surface1,
      card: SURFACE.card,
      popover: SURFACE.popover,
      cardHover: CARD_HOVER,
    });
  });

  it("read at AA on every surface, at rest and lifted on a hovered row", () => {
    for (let hue = 0; hue < 360; hue += 3) {
      const { hex } = roleColorForHue(hue);
      for (const [name, surface] of Object.entries(RESTING_SURFACES)) {
        expect(
          ratio(hex, surface),
          `${hue}° on ${name}`,
        ).toBeGreaterThanOrEqual(AA_TEXT);
      }
      expect(ratio(hex, CARD_HOVER), `${hue}° hovered`).toBeGreaterThanOrEqual(
        AA_TEXT,
      );
      const lifted = mixHex(hex, "#FFFFFF", HOVER_LIFT);
      expect(
        ratio(lifted, CARD_HOVER),
        `${hue}° lifted`,
      ).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });
});
