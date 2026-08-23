import { describe, expect, it } from "vitest";
import { applyAlpha } from "@repo/color";
import {
  AA_TEXT,
  accentFour,
  accentRolesFor,
  HAIRLINE_ALPHA,
  ratio,
  SEEDS,
  SEMANTIC,
  signetDarkTokens,
  SURFACE,
  TEXT,
} from "@/tests/signet-contrast";

/**
 * The defects this file exists for — the Profile & pre-auth family, #920 slice 8.
 *
 * Three of the four were a token that reads correct at the call site, which is
 * this epic's recurring shape. Values come from `signetDarkTokens` through
 * `tests/signet-contrast.ts` and are never restated: a guard that hardcodes the
 * palette it guards goes green against values that no longer ship.
 *
 * Every number below is asserted, not written in a comment. Slice 7 learned
 * that the hard way when a remembered "2.3:1" turned out to be 2.184.
 */

/** The wizard renders as a full-screen overlay on `--background`, not on a card. */
const WIZARD_SURFACE = SURFACE.background;

describe("the archetype card's selected state", () => {
  it("would have caught `bg-primary/5`, which did not render at all", () => {
    // A raw opacity wash of the chapter hex — banned outright by
    // `spec/ui/design-system/README.md` §2 — and at 5% it is not even a dim
    // version of the right answer. Measured across all 19 seeds it spans
    // 1.005:1 to 1.106:1 against the surface it sat on, so the *best* case in
    // the whole corpus is still no visible selection.
    let best = 0;
    for (const seed of SEEDS) {
      const washed = applyAlpha(
        accentRolesFor(seed)["--primary"]!,
        0.05,
        WIZARD_SURFACE,
      );
      best = Math.max(best, ratio(washed, WIZARD_SURFACE));
    }
    expect(best).toBeLessThan(1.2);
    expect(best).toBeCloseTo(1.106, 2);
  });

  it("would have caught `hover:bg-accent/50`, which was a colour over itself", () => {
    // `--accent` holds `--popover`'s value. Inside the elevated container that
    // *is* that token the wash is exactly 1.000:1 — the alias
    // `components/shared/elevation-contrast.test.ts` pins. Here the card sits
    // on `--background`, so the failure is different and just as total: a
    // `--popover` wash at 50% over the app floor is a hover nobody sees as a
    // hover, because it is the same step the card already is not.
    const washed = applyAlpha(SURFACE.popover, 0.5, WIZARD_SURFACE);
    expect(ratio(washed, WIZARD_SURFACE)).toBeLessThan(1.1);
  });

  it("separates selected from resting and from hover, under every seed", () => {
    // §5's two card-seated accent states, measured on **`--background`**.
    // `components/settings/settings-contrast.test.ts` pins the same recipe on
    // `--card` for the Settings archetype grid; that guard does not transfer,
    // because this grid lives on a full-screen overlay one step lower.
    for (const seed of SEEDS) {
      const roles = accentRolesFor(seed);
      const selected = accentFour(roles);
      const hover = roles["--accent-subtle"]!;
      expect(ratio(selected, WIZARD_SURFACE), seed).toBeGreaterThan(1.25);
      expect(ratio(selected, hover), seed).toBeGreaterThan(1.05);
      expect(
        ratio(roles["--accent-text"]!, selected),
        `${seed} label on the selected card`,
      ).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });
});

describe("the tutorial's step strip, and the fix that would have been a second defect", () => {
  it("would have caught `bg-secondary/60` inside a DialogContent", () => {
    // `--secondary` holds `--card`'s value and a dialog is `--popover`, so the
    // strip composited to `#211E19` — 1.050:1 against its own container.
    const washed = applyAlpha(SURFACE.card, 0.6, SURFACE.popover);
    expect(ratio(washed, SURFACE.popover)).toBeCloseTo(1.05, 2);
    expect(ratio(washed, SURFACE.popover)).toBeLessThan(1.1);
  });

  it("rules out the accent tint, which is the obvious repair and is worse", () => {
    // The natural instinct is to recolour rather than to drop the fill. Across
    // every seed `--accent-subtle` on `--popover` tops out at 1.054:1 — the
    // same washout in a new place, which is `meter.ts`'s finding met from
    // another direction. §10's answer is to drop the fill and let the hairline
    // carry the edge.
    let best = 0;
    for (const seed of SEEDS) {
      best = Math.max(
        best,
        ratio(accentRolesFor(seed)["--accent-subtle"]!, SURFACE.popover),
      );
    }
    expect(best).toBeLessThan(1.1);
    expect(best).toBeCloseTo(1.054, 2);
  });

  it("shows dropping the fill improves the boundary rather than costing one", () => {
    // The assertion that should fail if someone "restores the fill for
    // consistency": the hairline over `--popover` separates better than the
    // washed fill ever did.
    const hairline = applyAlpha("#ffffff", HAIRLINE_ALPHA, SURFACE.popover);
    expect(ratio(hairline, SURFACE.popover)).toBeGreaterThan(1.25);
  });
});

describe("the step indicator's track", () => {
  it("prefers `--background` over `--border`, on the relationship that carries the data", () => {
    // Both step indicators drew their remaining steps in `bg-border`.
    // `components/shared/meter.ts` measured this class of choice already; the
    // numbers for *this* pair are asserted rather than inherited, because the
    // wizard's indicator sits on `--background` and the tutorial's inside a
    // dialog, neither of which that module's call sites cover.
    let worstOnBorder = Infinity;
    let worstOnBackground = Infinity;
    for (const seed of SEEDS) {
      const fill = accentRolesFor(seed)["--primary"]!;
      const borderTrack = applyAlpha("#ffffff", HAIRLINE_ALPHA, SURFACE.background);
      worstOnBorder = Math.min(worstOnBorder, ratio(fill, borderTrack));
      worstOnBackground = Math.min(worstOnBackground, ratio(fill, SURFACE.background));
    }
    expect(worstOnBackground).toBeGreaterThan(worstOnBorder);
    expect(worstOnBorder).toBeCloseTo(1.486, 2);
    expect(worstOnBackground).toBeCloseTo(1.774, 2);
  });
});

describe("the emerald notice `/join` shipped", () => {
  it("would have caught `text-emerald-900` on the dark floor", () => {
    // Tailwind's `emerald-900`. It travelled with a `dark:text-emerald-100`
    // that never applied — Signet is dark-only and nothing sets `.dark` — so
    // the tone that actually shipped was the light branch: near-black text on
    // `#0E0D0B`. The family's last raw-palette colour and last inert `dark:`.
    expect(ratio("#064e3b", SURFACE.background)).toBeLessThan(AA_TEXT);
    expect(ratio("#064e3b", SURFACE.background)).toBeCloseTo(1.999, 2);
  });

  it("keeps the danger tone the rebuilt inline error uses above the gate", () => {
    // `/join` renders its 410/409 copy as field-level text on the app floor,
    // not on a tint — so §5's lift does not apply and the solid tone is the
    // correct one. Reaching for `--destructive-text` here would over-apply §1.
    expect(ratio(SEMANTIC.destructive, SURFACE.background)).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

describe("the pre-auth screens have no tenant, so nothing on them takes the accent slot", () => {
  it("keeps the mark's glyph legible on house gold", () => {
    // `brand-identity.md` §2: the mark MUST NOT take the chapter accent, ever.
    // Read from the token pair rather than from s01's literals, so a change to
    // house gold moves the assertion with it.
    const gold = signetDarkTokens.color.gold;
    expect(ratio(gold.onHouse, gold.house)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(ratio(gold.onHouse, gold.house)).toBeCloseTo(8.696, 2);
  });

  it("would have caught the reference's `#78716A` captions transcribed literally", () => {
    // s01, s02 and s15 all draw their captions in `--muted`. `--background` is
    // that token's *most forgiving* step on the whole ladder and it still
    // misses §6's text gate, which is why every one of them lifts to
    // `--muted-foreground`. The assertion is the argument.
    expect(ratio(TEXT.muted, SURFACE.background)).toBeLessThan(AA_TEXT);
    expect(ratio(TEXT.muted, SURFACE.background)).toBeCloseTo(4.041, 2);
    expect(ratio(TEXT.mutedForeground, SURFACE.background)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("keeps the gold footer links above the gate", () => {
    // "New here? Join your chapter" and s02's "‹ Back" are `--accent-text`.
    for (const seed of SEEDS) {
      expect(
        ratio(accentRolesFor(seed)["--accent-text"]!, SURFACE.background),
        seed,
      ).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });
});

describe("the profile identity header", () => {
  it("keeps s15's initials legible on the accent tint under every seed", () => {
    // s15 draws the avatar `#251E0E` / `#6B5619` / `#F4CB63`, which is the
    // house-gold family — but the Canvas header says the demo tenant runs the
    // house-gold accent, so the board draws one seed where the engine ships
    // nineteen. `/profile` is inside a chapter, so the accent roles are what
    // generalise, and the measurement decides the other eighteen.
    for (const seed of SEEDS) {
      const roles = accentRolesFor(seed);
      expect(
        ratio(roles["--accent-text"]!, roles["--accent-subtle"]!),
        seed,
      ).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });
});
