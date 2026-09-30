import { describe, expect, it } from "vitest";
import { applyAlpha } from "@repo/color";
import {
  AA_NON_TEXT,
  AA_TEXT,
  accentRolesFor,
  DESTRUCTIVE_TEXT,
  HAIRLINE_ALPHA,
  HOUSE_SEED,
  MENTION_CHIP,
  ratio,
  SEEDS,
  SEMANTIC,
  signetDarkTokens,
  SURFACE,
  TEXT,
  statusTint,
  tint,
} from "@/tests/signet-contrast";

/**
 * Contrast on the surfaces chat actually composites.
 *
 * A token name is not a contrast measurement. Every defect the Signet cutover
 * has produced so far came from a pairing that read fine as two token names and
 * failed as pixels — the near-white chat fills slice 1 caught, the danger text
 * on its own tint slice 2 caught, and, in this slice, muted text on a `--primary`
 * button fill (1.9:1) and a `bg-card` bubble inside a `bg-card` pane (1:1; the
 * bubble is gone since #2873, and the rule now guards the cards). So
 * these assert the *composited* pairs, including the ones that only exist after
 * an alpha tint lands on a specific ladder step.
 *
 * The accent-varying pairs are measured against every distinct colour in the
 * seeded chapter directory, not just house gold: the accent is per-tenant, so a
 * pair that passes under gold and fails under `#FFFFFF` is a defect 1 chapter
 * in 50 would see and nobody testing locally ever would. Seed corpus and the
 * shared helpers: `tests/signet-contrast.ts`.
 */

/**
 * The compact message row (`components.md` §11, #2873): text straight on the
 * thread's `--background`, a hovered row lifted to `--surface-1`, and a card
 * posted into the thread on `--card`. It replaced the §11 bubble, whose pairs
 * this block used to pin (the incoming `--card` fill, the per-chapter
 * `--primary` self fill).
 */
describe("chat message rows", () => {
  const ROW_SURFACES = {
    rest: SURFACE.background,
    hovered: SURFACE.surface1,
  } as const;

  it("keeps body text AA on the row at rest and hovered", () => {
    for (const [state, bg] of Object.entries(ROW_SURFACES)) {
      expect(ratio(TEXT.foreground, bg), state).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it("keeps the viewer's own accent name AA on the row, for every chapter seed", () => {
    // The one place a message row takes the chapter accent. accent-11 is the
    // engine's text role, gated at 4.5:1 on the neutral ladder; this pins that
    // the two surfaces a row actually paints are among the ones it holds on.
    for (const seed of SEEDS) {
      const name = accentRolesFor(seed)["--accent-text"]!;
      for (const [state, bg] of Object.entries(ROW_SURFACES)) {
        expect(ratio(name, bg), `${seed} ${state}`).toBeGreaterThanOrEqual(
          AA_TEXT,
        );
      }
    }
  });

  it("lifts the hovered row by a step too small to carry information", () => {
    // components.md §11: the hover fill is pointer feedback, so its ~1.1:1 is
    // acceptable precisely because nothing is lost without it. Pinned so the
    // doc's reasoning cannot quietly start leaning on the fill for meaning.
    const step = ratio(ROW_SURFACES.hovered, ROW_SURFACES.rest);
    expect(step).toBeGreaterThan(1);
    expect(step).toBeLessThan(AA_NON_TEXT);
  });

  it("does not paint a card in the thread's own fill", () => {
    // The regression this exists for: the pane used to be a `<Card>`, so the
    // §11 bubble fill was `#1E1B17` on `#1E1B17` — 1.00:1, no bubble at all.
    // The pane is `--background` now, and the cards posted into it are `--card`.
    const step = ratio(SURFACE.card, SURFACE.background);
    expect(step).toBeGreaterThan(1.1);
  });

  it("relies on the hairline for a card's edge, not on the ladder step", () => {
    // One step of the neutral ladder is ~1.12:1 and the composited hairline
    // over it reaches ~1.4:1 — both under the 3:1 non-text floor. That is why
    // components.md §2 keeps the hairline on a card in the thread: a card that
    // drops `border-border` is delineated by 1.12:1, and on a hovered row by
    // less, so the border is load-bearing.
    const hairline = applyAlpha("#FFFFFF", HAIRLINE_ALPHA, SURFACE.card);
    for (const [state, bg] of Object.entries(ROW_SURFACES)) {
      const step = ratio(SURFACE.card, bg);
      const edge = ratio(hairline, bg);
      expect(edge, state).toBeGreaterThan(step);
      expect(step, state).toBeLessThan(AA_NON_TEXT);
    }
  });

  it("would have caught muted text on the accent fill", () => {
    // The poll card did exactly this. Kept as a regression assertion rather
    // than a comment, because the class that caused it (`text-muted-foreground`
    // inside a filled Button) is one autocomplete away from returning.
    const fill = accentRolesFor(HOUSE_SEED)["--primary"]!;
    expect(ratio(TEXT.mutedForeground, fill)).toBeLessThan(AA_TEXT);
  });

  it("lifts every caption off `--muted`, which misses AA on the whole ladder", () => {
    // The reference draws the author line's time in `--muted` (#78716A) and it measures
    // **4.04:1** on the thread background — under the 4.5:1 floor, and worse on
    // every step above it. components.md §1 already grants the remedy and names
    // this exact token: "`--muted` on the surface ladder is 3.3–4.0:1, so tab
    // labels and input placeholders take `--muted-foreground`". Chat's captions
    // — the time, the trailing markers, the delivery state, the rail's section
    // headings — take the same lift.
    for (const [name, bg] of Object.entries(SURFACE)) {
      expect(ratio(TEXT.muted, bg), `--muted over ${name}`).toBeLessThan(AA_TEXT);
      expect(
        ratio(TEXT.mutedForeground, bg),
        `--muted-foreground over ${name}`,
      ).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });
});

describe("reaction chips", () => {
  it("keeps accent chip text AA on its own tint for every chapter seed", () => {
    for (const seed of SEEDS) {
      const roles = accentRolesFor(seed);
      const text = roles["--accent-text"]!;
      const fill = roles["--accent-subtle"]!;
      expect(ratio(text, fill), `${seed} reacted chip`).toBeGreaterThanOrEqual(
        AA_TEXT,
      );
    }
  });

  it("keeps the neutral chip's text AA on the elevated step", () => {
    expect(
      ratio(TEXT.mutedForeground, SURFACE.popover),
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("separates the accent chip from the neutral one by more than luminance", () => {
    // Both chips sit in the same row. If they only differed by ladder step they
    // would be ~1.1:1 apart — components.md §2's reason for separating menu
    // highlights by hue. The accent chip's *border* is what carries it.
    for (const seed of SEEDS) {
      const roles = accentRolesFor(seed);
      expect(
        ratio(roles["--accent-border"]!, roles["--accent-subtle"]!),
        `${seed} chip border`,
      ).toBeGreaterThan(1.2);
    }
  });
});

describe("the mention badge", () => {
  /**
   * **A known AA miss, recorded rather than papered over.** White on `#E5484D`
   * measures **3.91:1**, under README §6's 4.5:1 text floor.
   *
   * This slice ships it anyway and files it, because the pair is not this
   * surface's to change: the value and its white foreground are fixed by
   * foundations.md §5, locked in `packages/theme/src/signet.ts`, asserted by
   * `packages/theme/src/signet.spec.ts` against that doc, drawn that way in
   * `canvas-screens.dc.html` s04, and already shipped by
   * `apps/mobile/components/chat/channel-row.tsx`. Changing the hue on web
   * alone would break the one thing the token exists to guarantee — that "you
   * were addressed" reads identically everywhere — to fix 0.6 of a contrast
   * point. §1's usual remedy (lift the text one step) is unavailable: the text
   * is already white.
   *
   * Tracked as #1190, which owns the decision (darken the fill for both
   * platforms, or record an explicit exemption).
   *
   * The assertion is pinned to the measured value, so this fails the moment
   * either half of the pair moves — including if it is *fixed*, at which point
   * this test is what tells the next person to delete the exception.
   */
  it("is a recorded AA exception at 3.91:1, not an accident", () => {
    const measured = ratio(SEMANTIC.mentionForeground, SEMANTIC.mention);
    expect(measured).toBeCloseTo(3.91, 2);
    expect(measured).toBeLessThan(AA_TEXT);
  });

  it("is never accent-derived, under any chapter seed", () => {
    // foundations §5 / accent-engine §5: red states one fact and must read
    // identically in every chapter, so no seed may produce it.
    for (const seed of SEEDS) {
      const roles = accentRolesFor(seed);
      expect(roles["--primary"]!.toUpperCase(), seed).not.toBe(SEMANTIC.mention);
    }
  });

  it("clears the non-text floor against the rail it sits on", () => {
    // The badge as an *object* — its fill against the rail — is what tells the
    // eye a row is flagged, and that half does clear 3:1.
    expect(ratio(SEMANTIC.mention, SURFACE.surface1)).toBeGreaterThanOrEqual(
      AA_NON_TEXT,
    );
  });
});

describe("the in-body mention chip", () => {
  /**
   * §11's TODO-DESIGN for the in-body mention highlight, settled as an
   * **opaque** chip. It was argued from the self bubble, where a 13% tint over
   * the per-chapter `--primary` fill measured 1.94:1 at best and 1.03:1 at
   * worst across the seed corpus. The compact layout (#2873) removed that
   * surface; the chip now sits on the row, which is `--background` at rest and
   * `--surface-1` hovered, and it stays opaque so one pair covers both.
   */
  it("keeps chip text AA on the chip's own fill", () => {
    // Pinned to the measured value, not just to the floor: `components.md` §11
    // quotes this number, and a ratio asserted only as ">= 4.5" lets the doc's
    // figure go quietly wrong the next time either half of the pair moves.
    const measured = ratio(MENTION_CHIP.text, MENTION_CHIP.fill);
    expect(measured).toBeCloseTo(5.54, 2);
    expect(measured).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("would give two figures as an alpha tint, one per row state", () => {
    // Why it stays opaque: the §5 tint recipe composites over whatever is
    // under it, and hovering a row changes what is under it. Measured, so the
    // spec's reason cannot outlive the numbers behind it.
    const atRest = ratio(
      MENTION_CHIP.text,
      tint(MENTION_CHIP.text, SURFACE.background),
    );
    const hovered = ratio(
      MENTION_CHIP.text,
      tint(MENTION_CHIP.text, SURFACE.surface1),
    );
    expect(atRest).not.toBeCloseTo(hovered, 2);
  });

  it("is not the mention red, which has no lifted tone to render as text", () => {
    // foundations §5: mention red is a badge fill carrying white text, and "a
    // future surface that renders mention red as text needs a lifted tone
    // first; it does not have one today". This surface renders as text.
    expect(MENTION_CHIP.text.toUpperCase()).not.toBe(
      SEMANTIC.mention.toUpperCase(),
    );
    expect(MENTION_CHIP.fill.toUpperCase()).not.toBe(
      SEMANTIC.mention.toUpperCase(),
    );
  });

  it("is never accent-derived, under any chapter seed", () => {
    // Same rule as the red badge above: "you were addressed" reads identically
    // in every chapter, so no seed may produce either half of the chip.
    for (const seed of SEEDS) {
      const roles = accentRolesFor(seed);
      for (const role of ["--primary", "--accent-subtle", "--accent-text"]) {
        expect(roles[role]!.toUpperCase(), `${seed} ${role}`).not.toBe(
          MENTION_CHIP.fill.toUpperCase(),
        );
        expect(roles[role]!.toUpperCase(), `${seed} ${role}`).not.toBe(
          MENTION_CHIP.text.toUpperCase(),
        );
      }
    }
  });

  it("separates the handle from the body text around it", () => {
    // The chip's job inside a message: `@Name` must not read as more prose.
    // The fill is a subtle step off the row by design (§5's tint look), so the
    // separation is carried by the text tone — which is why THAT is the half
    // asserted, and why a change that keeps the fill and neutralises the text
    // would fail here rather than pass on the fill alone.
    expect(MENTION_CHIP.text.toUpperCase()).not.toBe(
      TEXT.foreground.toUpperCase(),
    );
    for (const bg of [SURFACE.background, SURFACE.surface1]) {
      expect(ratio(MENTION_CHIP.text, bg)).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });
});

describe("semantic text on its own 13% tint", () => {
  const surfaces = Object.entries(SURFACE);

  it("lifts danger text, because the unlifted hue misses on the raised steps", () => {
    for (const [name, bg] of surfaces) {
      const over = statusTint("destructive", bg);
      expect(
        ratio(DESTRUCTIVE_TEXT, over),
        `--destructive-text on danger tint over ${name}`,
      ).toBeGreaterThanOrEqual(AA_TEXT);
    }

    // The measurement that forced the lift, kept so a "simplification" back to
    // `text-destructive` fails here rather than in review.
    expect(
      ratio(SEMANTIC.destructive, statusTint("destructive", SURFACE.card)),
    ).toBeLessThan(AA_TEXT);
  });

  it("keeps warning and success legible unlifted on every step", () => {
    for (const [name, bg] of surfaces) {
      expect(
        ratio(SEMANTIC.warning, statusTint("warning", bg)),
        `--warning over ${name}`,
      ).toBeGreaterThanOrEqual(AA_TEXT);
      expect(
        ratio(SEMANTIC.success, bg),
        `--success over ${name}`,
      ).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });
});

describe("the channel rail", () => {
  it("keeps a read row's title legible against the rail fill", () => {
    // The read/unread distinction is carried by weight and tone, so the quieter
    // of the two tones still has to clear AA — otherwise "read" reads as
    // "disabled".
    expect(
      ratio(TEXT.mutedForeground, SURFACE.surface1),
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("keeps the selected row's accent text AA on its tint, per seed", () => {
    for (const seed of SEEDS) {
      const roles = accentRolesFor(seed);
      expect(
        ratio(roles["--accent-text"]!, roles["--accent-subtle"]!),
        `${seed} selected channel`,
      ).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it("keeps the neutral unread badge AA on the rail", () => {
    // `bg-input` is `rgba(255,255,255,.14)` — an alpha fill, so it has to be
    // composited before it can be measured at all.
    const fill = applyAlpha(
      "#FFFFFF",
      Number(
        /rgba\([^)]*,\s*([\d.]+)\)/.exec(signetDarkTokens.color.border.input)?.[1] ??
          "0.14",
      ),
      SURFACE.surface1,
    );
    expect(ratio(TEXT.foreground, fill)).toBeGreaterThanOrEqual(AA_TEXT);
  });
});
