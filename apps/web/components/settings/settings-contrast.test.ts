import { describe, expect, it } from "vitest";
import {
  AA_TEXT,
  signetDarkTokens,
  accentFour,
  accentRolesFor,
  ratio,
  SEEDS,
  SEMANTIC,
  SURFACE,
  TEXT,
} from "@/tests/signet-contrast";

/**
 * The defect this file exists for.
 *
 * The capability matrix drew a held permission in `text-emerald-600
 * dark:text-emerald-400` and a missing one in `text-muted-foreground/40`.
 * Three faults in one class string, and only the first is obvious: `emerald`
 * is #916's conflicting green beside `--success`; the `dark:` variant was the
 * last one in the tree and had been inert since the shell slice made Signet
 * dark-only, so the tone that actually shipped was the *light* one; and the
 * 40% wash measures 2.184:1, on the one mark that tells an admin a role lacks a
 * capability.
 *
 * The near-miss is the reason this file exists rather than a comment. The
 * first fix reached for `--muted`, which reads like the token for absent
 * metadata — and is 3.568:1 on `--card`, under §6, which the chat slice
 * already recorded as "`--muted` is not usable as text anywhere on the
 * ladder". A `✓` and an `—` are characters, so the 4.5:1 text floor applies
 * and not the 3:1 glyph one. Caught by measuring rather than by reading the
 * token name, which is this epic's recurring lesson: a number in a comment is
 * not a measurement, and neither is a token name.
 *
 * Values are read from `signetDarkTokens` through `tests/signet-contrast.ts`,
 * never restated — a guard that hardcodes the palette it guards goes green
 * against values that no longer ship.
 */

/** Both matrix marks sit in a `<table>` inside a `CardContent`. */
const MATRIX_SURFACE = SURFACE.card;

describe("the capability matrix states held and missing in text tones", () => {
  it("clears §6's text floor for both marks, not the 3:1 glyph floor", () => {
    // `✓` / `—` / `n/a` are characters. 4.5:1, not 3.
    expect(ratio(SEMANTIC.success, MATRIX_SURFACE)).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
    expect(ratio(TEXT.mutedForeground, MATRIX_SURFACE)).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
  });

  it("would have caught the 40% wash the missing mark shipped in", () => {
    // `text-muted-foreground/40`, composited the way CSS does it. Pinned to
    // the measured value, not just to "under the floor": the first write of
    // this comment said 2.3:1 from memory and the review recomputed it at
    // 2.184. A number in a comment is not a measurement — so the number is an
    // assertion now, and the comment cites the assertion.
    const washed = ratio(
      mix(TEXT.mutedForeground, MATRIX_SURFACE, 0.4),
      MATRIX_SURFACE,
    );
    expect(washed).toBeLessThan(AA_TEXT);
    expect(washed).toBeCloseTo(2.184, 2);
  });

  it("rules out `--muted`, which reads like the right token and is not", () => {
    // The fix this file's own review rejected. Recorded so the next reader
    // does not re-derive it: 3.568:1 on the card the matrix sits in.
    expect(ratio(TEXT.muted, MATRIX_SURFACE)).toBeLessThan(AA_TEXT);
  });

  it("keeps success clear of the tab's own surface too", () => {
    // The matrix renders inside a card, but the sub-tabs can put it on the
    // page floor while the rail reflows at `lg`. Both steps, so a layout
    // change cannot quietly drop it under the gate.
    for (const surface of [SURFACE.background, SURFACE.card]) {
      expect(ratio(SEMANTIC.success, surface)).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });
});

describe("the archetype card's selected state, across every seeded chapter", () => {
  it("reads as selected on a card under all 19 seeds", () => {
    // §5 calls a selection accent-worthy, and `bg-primary/5` was a raw
    // opacity wash of the chapter hex — banned by README §2, and at 5%
    // invisible besides. The recipe is §2's two card-seated states, the ones
    // `shared/table-contrast.test.ts` pins; this asserts the pair holds for
    // the archetype grid's own surface rather than assuming it transfers.
    for (const seed of SEEDS) {
      const roles = accentRolesFor(seed);
      const selected = accentFour(roles);
      const hover = roles["--accent-subtle"]!;
      // Selected must be distinguishable from both the card and the hover.
      expect(ratio(selected, SURFACE.card), seed).toBeGreaterThan(1.1);
      expect(ratio(selected, hover), seed).toBeGreaterThan(1.05);
      // And its text has to be readable on it.
      expect(ratio(roles["--accent-text"]!, selected), seed).toBeGreaterThanOrEqual(
        AA_TEXT,
      );
    }
  });
});

/** `color-mix`-free alpha composite, matching how the browser paints `/40`. */
function mix(fg: string, bg: string, alpha: number): string {
  const parse = (hex: string) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  const [fr, fg_, fb] = parse(fg);
  const [br, bg_, bb] = parse(bg);
  const c = (f: number, b: number) =>
    Math.round(f * alpha + b * (1 - alpha))
      .toString(16)
      .padStart(2, "0");
  return `#${c(fr!, br!)}${c(fg_!, bg_!)}${c(fb!, bb!)}`;
}

describe("the accent preview's label tone, computed from the draft", () => {
  /*
   * Two different questions, and the screen used to ask only one.
   *
   * `resolveChapterAccentColor` asks whether the accent is legible *as text on
   * the card*. The preview swatch needs the other one: whether text is legible
   * *on the accent* — which is what a primary button is, and what this card's
   * description promises the colour will be used for. They diverge, and the
   * review found the band where: `#0080FD` passes the first (`reason: "ok"`,
   * no warning) and fails the second at 4.191:1.
   *
   * The first fix here made it worse in a quiet way — `pickAccessibleColor(...)
   * ?? gold.onHouse` reasserted the very tone the picker had just rejected, so
   * the swatch drew an illegible label and reported nothing.
   */
  const INK = [
    signetDarkTokens.color.gold.onHouse,
    signetDarkTokens.color.text.foreground,
  ] as const;

  const bestInk = (fill: string) =>
    INK.reduce((best, candidate) =>
      ratio(candidate, fill) > ratio(best, fill) ? candidate : best,
    );

  it("always picks the better of the two tones, never the first that passes", () => {
    // The property that makes the result defined for every input, including
    // the ones where neither tone clears AA. `pickAccessibleColor` returns the
    // first candidate over the bar and `null` when none is — which is a fine
    // contract, and the wrong one here, because `null` still has to render
    // something.
    for (const fill of [...SEEDS, "#0080FD", "#767676", "#FFFFFF", "#000000"]) {
      const ink = bestInk(fill);
      for (const other of INK) {
        expect(ratio(ink, fill), `${fill} vs ${other}`).toBeGreaterThanOrEqual(
          ratio(other, fill),
        );
      }
    }
  });

  it("does not claim every accent can carry legible label text", () => {
    /*
     * The claim the first fix made and could not keep. A two-tone ladder
     * cannot clear 4.5:1 against every fill — a mid-tone is far enough from
     * both ends to fail each. So the contract is not "always legible", it is
     * "always the best available, and say so when that is not enough", which
     * is what `previewInkFailsAA` drives.
     *
     * `#767676` is the mid-grey `pickAccessibleColor`'s own docstring names as
     * the case where "a ladder anchored at the extremes can still run dry".
     */
    expect(ratio(bestInk("#767676"), "#767676")).toBeLessThan(AA_TEXT);
  });

  it("would have caught the hex the review typed, which no seed covers", () => {
    // An admin-typed colour, not a directory seed: nothing in the 19-seed
    // corpus is in this luminance band, which is why the corpus missed it.
    const ink = bestInk("#0080FD");
    expect(ratio(ink, "#0080FD")).toBeLessThan(AA_TEXT);
    expect(ratio(ink, "#0080FD")).toBeCloseTo(4.191, 2);
  });
});
