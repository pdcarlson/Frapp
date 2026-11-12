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
  INDISTINGUISHABLE,
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
    // 1.026:1 to 1.094:1 against the surface it sat on (`#FFFFFF` the best), so
    // the *best* case in the whole corpus is still no visible selection. On the
    // 2026-11-12 ladder's darker floor the best is 1.088:1.
    let best = 0;
    for (const seed of SEEDS) {
      const washed = applyAlpha(
        accentRolesFor(seed)["--primary"]!,
        0.05,
        WIZARD_SURFACE,
      );
      best = Math.max(best, ratio(washed, WIZARD_SURFACE));
    }
    expect(best).toBeLessThan(INDISTINGUISHABLE);
    expect(best).toBeCloseTo(1.088, 2);
  });

  it("would have caught `hover:bg-accent/50`, which was a colour over itself", () => {
    // `--accent` held `--popover`'s value (deleted, #3036). Inside the elevated
    // container that *is* that token the wash is exactly 1.000:1 — the alias
    // `components/shared/elevation-contrast.spec.ts` records. Here the card sits
    // on `--background`, so the failure is different and just as total: a
    // `--popover` wash at 50% over the app floor is a hover nobody sees as a
    // hover, because it is the same step the card already is not.
    //
    // (2026-11-12, #3826) The wider ladder makes this particular wash visible,
    // 1.18:1, so the measurement no longer convicts it on its own: what keeps
    // it out is that the alias is deleted and `elevation-call-sites.spec.ts`
    // bans the name. It stays pinned so a ladder change that narrows the steps
    // again shows up here.
    const washed = applyAlpha(SURFACE.popover, 0.5, WIZARD_SURFACE);
    expect(ratio(washed, WIZARD_SURFACE)).toBeCloseTo(1.183, 2);
  });

  it("separates selected from resting and from hover, under every seed", () => {
    // §5's two card-seated accent states, measured on **`--background`**.
    // `components/settings/settings-contrast.spec.ts` pins the same recipe on
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
    // `--secondary` held `--card`'s value (deleted, #3036) and a dialog is
    // `--popover`, so the strip composited to 1.044:1 against its own
    // container on the 2026-11-05 ladder (1.050:1, `#211E19`, when first
    // measured; 1.064:1 on the warm greenfield ladder). On the 2026-11-12
    // ladder it is 1.103:1, still under the perceptible bound.
    const washed = applyAlpha(SURFACE.card, 0.6, SURFACE.popover);
    expect(ratio(washed, SURFACE.popover)).toBeCloseTo(1.103, 2);
    expect(ratio(washed, SURFACE.popover)).toBeLessThan(INDISTINGUISHABLE);
  });

  it("rules out the accent tint, which is the obvious repair and is worse", () => {
    // The natural instinct is to recolour rather than to drop the fill. On the
    // 2026-11-05 ladder `--accent-subtle` on `--popover` topped out at 1.097:1
    // across every seed — the same washout in a new place, which is
    // `meter.ts`'s finding met from another direction. §10's answer is to drop
    // the fill and let the hairline carry the edge.
    //
    // (2026-11-12, #3826) Engine v3 takes the tint from step 5, so some seeds
    // now separate on `--popover`, but the neutral seeds' tint *is* `--popover`
    // (1.000:1): a fix that works for some chapters and vanishes for others is
    // still not a fix.
    let worst = Infinity;
    for (const seed of SEEDS) {
      worst = Math.min(
        worst,
        ratio(accentRolesFor(seed)["--accent-subtle"]!, SURFACE.popover),
      );
    }
    expect(worst).toBeLessThan(1.1);
    expect(worst).toBeCloseTo(1.0, 2);
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
      const borderTrack = applyAlpha(
        "#ffffff",
        HAIRLINE_ALPHA,
        SURFACE.background,
      );
      worstOnBorder = Math.min(worstOnBorder, ratio(fill, borderTrack));
      worstOnBackground = Math.min(
        worstOnBackground,
        ratio(fill, SURFACE.background),
      );
    }
    // Both worst cases were `#BF0A30`'s `#D83144`. Before the engine's fill
    // floor they were crimson's `#8B0000` at 1.528 and 1.869 (#2541), then
    // `#CC0000`'s lifted `#DA2017` at 3.060 and 3.742 until the floor took in
    // hover too (#2586) and lifted the dark fills further, then `#800000`'s
    // `#F42F22` at 3.844 and 4.701 until the neutral ladder and engine v2
    // (2026-11-05) lifted `#800000` too, then `#BF0A30`'s `#D83144` at 3.527 and
    // 4.188 until the 2026-11-12 ladder (#3826) raised every fill's floor; now
    // `#4B1A7E`'s `#9B70D9`. The ranking is the same throughout, and on
    // `--background` the fill clears the 3:1 non-text floor.
    expect(worstOnBackground).toBeGreaterThan(worstOnBorder);
    expect(worstOnBorder).toBeCloseTo(4.783, 2);
    expect(worstOnBackground).toBeCloseTo(5.545, 2);
  });
});

describe("the emerald notice `/join` shipped", () => {
  it("would have caught `text-emerald-900` on the dark floor", () => {
    // Tailwind's `emerald-900`. It travelled with a `dark:text-emerald-100`
    // that never applied — Signet is dark-only and nothing sets `.dark` — so
    // the tone that actually shipped was the light branch: near-black text on
    // the app floor. The family's last raw-palette colour and last inert `dark:`.
    expect(ratio("#064e3b", SURFACE.background)).toBeLessThan(AA_TEXT);
    expect(ratio("#064e3b", SURFACE.background)).toBeCloseTo(2.097, 2);
  });

  it("keeps the danger tone the rebuilt inline error uses above the gate", () => {
    // `/join` renders its 410/409 copy as field-level text on the app floor,
    // not on a tint — so §5's lift does not apply and the solid tone is the
    // correct one. Reaching for `--destructive-text` here would over-apply §1.
    expect(
      ratio(SEMANTIC.destructive, SURFACE.background),
    ).toBeGreaterThanOrEqual(AA_TEXT);
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
    // `--muted-foreground`. The assertion is the argument. (neutral ladder,
    // 2026-11-05: `--muted` was `#737373`, 4.175 there; the reference's
    // literal `#78716A` is 4.119. Both missed. The 2026-11-09 text ladder,
    // foundations.md §4, put `--muted` at `#9E9E9E`, 7.39 there, so the token
    // now clears and only the literal still misses: transcribing the board's
    // hex instead of the token is the defect this keeps.)
    expect(ratio("#78716A", SURFACE.background)).toBeLessThan(AA_TEXT);
    expect(ratio(TEXT.muted, SURFACE.background)).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
    expect(
      ratio(TEXT.mutedForeground, SURFACE.background),
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("keeps the gold footer links above the gate", () => {
    // The pre-auth text links ("Email me a magic link instead", "Join your chapter") are `--accent-text`.
    for (const seed of SEEDS) {
      expect(
        ratio(accentRolesFor(seed)["--accent-text"]!, SURFACE.background),
        seed,
      ).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });
});

describe("the profile identity header", () => {
  it("keeps the initials legible on the neutral avatar", () => {
    // s15 drew the avatar in the house-gold family, and it took the chapter
    // accent until 2026-11-05 (`foundations.md` §6: people's avatars are
    // neutral). It is now the chat avatar's recipe at 84px.
    expect(ratio(TEXT.mutedForeground, SURFACE.popover)).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
  });
});
