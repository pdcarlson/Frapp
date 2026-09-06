import { describe, expect, it } from "vitest";
import { applyAlpha } from "@repo/color";
import {
  AA_NON_TEXT,
  AA_TEXT,
  HAIRLINE_ALPHA,
  ratio,
  SEMANTIC,
  SURFACE,
  signetDarkTokens,
  tint,
} from "@/tests/signet-contrast";

/**
 * The defect this file exists for.
 *
 * Chapter Ops shipped two fills that composited to **exactly 1.000:1** — not
 * the 1.085:1 near-miss `components/shared/table-contrast.spec.ts` pins for a
 * card-seated row, but a container's own colour washed over itself. Both
 * survived review twice because the class names read fine: `bg-accent/40` on a
 * dialog and `bg-secondary/40` on a card are only wrong once you know that
 * `--accent` is an alias of `--popover` and `--secondary` an alias of `--card`.
 *
 * That aliasing is the trap, so it is asserted from `signetDarkTokens` rather
 * than restated — a guard that hardcodes the values it guards goes green
 * against constants that no longer ship.
 *
 * It lives in `shared/` for `table-contrast.spec.ts`'s reason: four families
 * composited the same ladder mistake here, and the families whose #920 slice
 * has not landed will inherit it.
 */

/** `signet.css` is the token source; these read it rather than restating it. */
const ALIASES = signetDarkTokens.color.surface;

describe("the aliases that made two fills invisible", () => {
  it("holds --accent at --popover's value, so bg-accent inside a dialog is nothing", () => {
    // `event-editor-dialog`'s role rows were `hover:bg-accent/40` inside a
    // `DialogContent`, which *is* `--popover`.
    const composited = applyAlpha(ALIASES.popover, 0.4, ALIASES.popover);
    expect(ratio(composited, ALIASES.popover)).toBeCloseTo(1, 3);
  });

  it("holds --secondary at --card's value, so bg-secondary inside a card is nothing", () => {
    // `geofences-admin-page`'s coordinate list was `bg-secondary/40` inside a
    // `CardContent`. `shared/subscription-gate.tsx` records the same pair.
    const composited = applyAlpha(ALIASES.card, 0.4, ALIASES.card);
    expect(ratio(composited, ALIASES.card)).toBeCloseTo(1, 3);
  });
});

describe("a state cannot elevate above the step it renders in", () => {
  it("would have caught the attendance panel's card inside a sheet", () => {
    // `--popover` is the top of the ladder, so a `--card` panel inside a
    // `SheetContent` is a step DOWN — it reads as a hole, not as elevation.
    expect(ratio(SURFACE.card, SURFACE.popover)).toBeLessThan(1.1);
  });

  it("shows that dropping the fill improves the boundary rather than costing one", () => {
    // This is the whole argument for `nested-states` over a `<Card>` here, and
    // it is the assertion that should fail if someone "restores the Card for
    // consistency": the hairline over `--popover` separates better from
    // `--popover` than the card's own hairline does.
    const hairlineOverCard = applyAlpha(
      "#ffffff",
      HAIRLINE_ALPHA,
      SURFACE.card,
    );
    const hairlineOverPopover = applyAlpha(
      "#ffffff",
      HAIRLINE_ALPHA,
      SURFACE.popover,
    );
    const withFill = ratio(hairlineOverCard, SURFACE.popover);
    const withoutFill = ratio(hairlineOverPopover, SURFACE.popover);
    expect(withFill).toBeLessThan(withoutFill);
    expect(withoutFill).toBeGreaterThan(1.25);
  });

  it("keeps a nested state's fill off its container entirely", () => {
    // The `Card > CardContent > EmptyState` case, four of which this family
    // shipped: `--card` on `--card`.
    expect(ratio(SURFACE.card, SURFACE.card)).toBeCloseTo(1, 3);
  });
});

describe("hairlines are load-bearing, so their alpha is not a free parameter", () => {
  it("would have caught divide-border/70", () => {
    // Five row lists diluted the token to 0.056. §2 makes the hairline the
    // edge once elevation is ~1.12:1, and §3 rule 3 bans one-off values.
    const atToken = ratio(
      applyAlpha("#ffffff", HAIRLINE_ALPHA, SURFACE.card),
      SURFACE.card,
    );
    const diluted = ratio(
      applyAlpha("#ffffff", HAIRLINE_ALPHA * 0.7, SURFACE.card),
      SURFACE.card,
    );
    expect(diluted).toBeLessThan(atToken);
    // Neither clears §6's 3:1 non-text floor and at this ladder neither can —
    // recorded so the numbers are not mistaken for a passing grade.
    expect(atToken).toBeLessThan(AA_NON_TEXT);
  });
});

describe("the amber notices were a light-mode island", () => {
  it("would have caught bg-amber-50 shipping on the dark shell", () => {
    // Nothing sets `.dark`, so the `dark:` half never applied and the light
    // branch painted on `--popover`.
    expect(ratio("#fffbeb", SURFACE.popover)).toBeGreaterThan(10);
  });

  it("puts the warning tint's text over the gate on both surfaces it lands on", () => {
    // The replacement, matching `shared/subscription-gate.tsx`'s definite
    // branch. Unlifted, per components.md §5 — only danger needs §1's lift.
    for (const name of ["card", "popover"] as const) {
      expect(
        ratio(SEMANTIC.warning, tint(SEMANTIC.warning, SURFACE[name])),
        `--warning on its own tint over ${name}`,
      ).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });
});
