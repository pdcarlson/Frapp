import { describe, expect, it } from "vitest";
import { applyAlpha } from "@repo/color";
import {
  AA_NON_TEXT,
  AA_TEXT,
  accentRolesFor,
  DESTRUCTIVE_TEXT,
  HAIRLINE_ALPHA,
  HOUSE_SEED,
  ratio,
  SEEDS,
  SEMANTIC,
  signetDarkTokens,
  SURFACE,
  TEXT,
  tint,
} from "@/tests/signet-contrast";

/**
 * Contrast on the surfaces chat actually composites.
 *
 * A token name is not a contrast measurement. Every defect the Signet cutover
 * has produced so far came from a pairing that read fine as two token names and
 * failed as pixels — the near-white chat fills slice 1 caught, the danger text
 * on its own tint slice 2 caught, and, in this slice, muted text on a `--primary`
 * button fill (1.9:1) and a `bg-card` bubble inside a `bg-card` pane (1:1). So
 * these assert the *composited* pairs, including the ones that only exist after
 * an alpha tint lands on a specific ladder step.
 *
 * The accent-varying pairs are measured against every distinct colour in the
 * seeded chapter directory, not just house gold: `--primary` is per-tenant, so a
 * bubble that passes under gold and fails under `#FFFFFF` is a defect 1 chapter
 * in 50 would see and nobody testing locally ever would. Seed corpus and the
 * shared helpers: `tests/signet-contrast.ts`.
 */

describe("chat bubbles", () => {
  it("does not paint the incoming bubble in its own pane's fill", () => {
    // The regression this exists for: the pane used to be a `<Card>`, so the
    // §11 bubble fill was `#1E1B17` on `#1E1B17` — 1.00:1, no bubble at all.
    // The pane is `--background` now.
    const step = ratio(SURFACE.card, SURFACE.background);
    expect(step).toBeGreaterThan(1.1);
  });

  it("relies on the hairline for the bubble's edge, not on the ladder step", () => {
    // Worth stating as a measurement rather than a belief: one step of the
    // neutral ladder is ~1.12:1 and the composited hairline over it reaches
    // ~1.4:1 — both under the 3:1 non-text floor. That is not a defect here,
    // it is why §11 specs a hairline on the incoming bubble at all, and why
    // components.md §2 says the ladder "cannot carry 'this one' on luminance
    // alone". A change that drops `border-border` from the incoming bubble
    // leaves a shape delineated by 1.12:1, so the border is load-bearing.
    const hairline = applyAlpha("#FFFFFF", HAIRLINE_ALPHA, SURFACE.card);
    const step = ratio(SURFACE.card, SURFACE.background);
    const edge = ratio(hairline, SURFACE.background);
    expect(edge).toBeGreaterThan(step);
    expect(step).toBeLessThan(AA_NON_TEXT);
  });

  it("holds on the thread rail too, not just the centre pane", () => {
    // The miss this exists for: the centre pane was moved to `--background` so
    // the `--card` bubble could read, and the *right rail* — which renders the
    // same `MessageItem` for a thread — was left on `--surface-1`, where the
    // same bubble is 1.08:1. A bubble is only as visible as the surface
    // whichever pane happens to host it, so both are asserted.
    const onSurface1 = ratio(SURFACE.card, SURFACE.surface1);
    const onBackground = ratio(SURFACE.card, SURFACE.background);
    expect(onSurface1).toBeLessThan(1.1);
    expect(onBackground).toBeGreaterThan(onSurface1);
  });

  it("keeps incoming body text well clear of AA on the card fill", () => {
    expect(ratio(TEXT.foreground, SURFACE.card)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("keeps the self bubble's text/fill pair AA for every chapter seed", () => {
    for (const seed of SEEDS) {
      const roles = accentRolesFor(seed);
      const fill = roles["--primary"]!;
      const text = roles["--primary-foreground"]!;
      expect(ratio(text, fill), `${seed} self bubble`).toBeGreaterThanOrEqual(
        AA_TEXT,
      );
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
    // The reference draws the meta line in `--muted` (#78716A) and it measures
    // **4.04:1** on the thread background — under the 4.5:1 floor, and worse on
    // every step above it. components.md §1 already grants the remedy and names
    // this exact token: "`--muted` on the surface ladder is 3.3–4.0:1, so tab
    // labels and input placeholders take `--muted-foreground`". Chat's captions
    // — the meta line, the delivery state, the rail's section headings — take
    // the same lift, and the sender name keeps its separation by weight rather
    // than by a second tone, which is what s05 draws anyway.
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

describe("semantic text on its own 13% tint", () => {
  const surfaces = Object.entries(SURFACE);

  it("lifts danger text, because the unlifted hue misses on the raised steps", () => {
    for (const [name, bg] of surfaces) {
      const over = tint(SEMANTIC.destructive, bg);
      expect(
        ratio(DESTRUCTIVE_TEXT, over),
        `--destructive-text on danger tint over ${name}`,
      ).toBeGreaterThanOrEqual(AA_TEXT);
    }

    // The measurement that forced the lift, kept so a "simplification" back to
    // `text-destructive` fails here rather than in review.
    expect(
      ratio(SEMANTIC.destructive, tint(SEMANTIC.destructive, SURFACE.card)),
    ).toBeLessThan(AA_TEXT);
  });

  it("keeps warning and success legible unlifted on every step", () => {
    for (const [name, bg] of surfaces) {
      expect(
        ratio(SEMANTIC.warning, tint(SEMANTIC.warning, bg)),
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
