import { describe, expect, it } from "vitest";
import { applyAlpha } from "@repo/color";
import {
  AA_NON_TEXT,
  AA_TEXT,
  accentFour,
  accentRolesFor,
  chromaShift,
  HAIRLINE_ALPHA,
  ratio,
  SEEDS,
  SURFACE,
  TEXT,
  INDISTINGUISHABLE,
} from "@/tests/signet-contrast";

/**
 * Contrast for the row states `components/ui/table.tsx` paints.
 *
 * This lives in `shared/` rather than in one family because four routes
 * composite the same `TableRow` — `/members`, `/points`, `/billing` and
 * `/events` — and the defect it exists for was invisible in all four at once.
 *
 * The defect: `hover:bg-accent` composited to **1.085:1** on a row inside a
 * `<Card>`, because `--accent` held the same value as `--popover` (deleted,
 * #3036). No hover at all, on the busiest table in the product.
 *
 * The reason this file is not two assertions long is the *fix* had the same
 * trap in it. components.md §2 says to highlight with the accent tint instead,
 * which reads like a contrast remedy and is not one: measured across the seeded
 * chapter directory, `--accent-subtle` sits 1.089–1.179:1 from `--card`, a range
 * that sits just above the neutral step (1.075:1) and mostly under the washout
 * ceiling rather than clearly beating it (on the warm ladder it was
 * 1.032–1.143:1 and straddled the step). What §2's recipe actually buys is
 * **hue**. So the assertions below pin the hue, the one-step
 * lift that separates selection from hover, and the text tone that carries
 * selection — and pin the near-equality that makes all three necessary, so a
 * later "simplification" back to a single tint fails loudly.
 *
 * Seed corpus and the shared helpers: `tests/signet-contrast.ts`.
 */

describe("the defect this file exists for", () => {
  it("would have caught `hover:bg-accent` on a card-seated row", () => {
    // `--accent` and `--popover` were the same value, so hovering a row inside
    // a card moved it one neutral step: no feedback a person could see.
    expect(ratio(SURFACE.popover, SURFACE.card)).toBeLessThan(
      INDISTINGUISHABLE,
    );
  });

  it("would have caught swapping the neutral step for the tint and stopping", () => {
    // The near-miss worth pinning. §2's accent tint is the right recipe and the
    // wrong *reason*: on a card row it is luminance-equivalent to the neutral
    // highlight it replaces (on the neutral ladder, 2026-11-05, at most 0.10
    // above it for every seed; on the warm ladder several were flatter). A
    // change that drops the selected state's one-step lift or its text tone on
    // the grounds that "the tint already separates it" is this assertion.
    const neutral = ratio(SURFACE.popover, SURFACE.card);
    for (const seed of SEEDS) {
      const tint = accentRolesFor(seed)["--accent-subtle"]!;
      expect(
        Math.abs(ratio(tint, SURFACE.card) - neutral),
        `${seed} accent-3 vs the neutral step on --card`,
      ).toBeLessThan(0.15);
    }
  });

  it("would have caught claiming the tint is *enough* on luminance", () => {
    // The first draft of the docblock said "no better than the neutral step",
    // which review caught as overstated in the other direction. The defensible
    // claim — and the one that actually motivates the design — is that the
    // tint cannot be *relied on* for luminance.
    //
    // (neutral ladder, 2026-11-05) This used to assert that a majority of
    // seeds land at or below the neutral step (13 of 19 on the warm ladder).
    // On the neutral ladder every seed's tint now edges above it, so "better
    // than neutral" is true and no longer the point; what still holds is that
    // a majority of tints read as the card's own colour, under the shared
    // washout ceiling (16 of 19). Asserted as "more than half" rather than the
    // exact count, which would fail on a derivation change that is not a
    // defect.
    const indistinct = SEEDS.filter(
      (seed) =>
        ratio(accentRolesFor(seed)["--accent-subtle"]!, SURFACE.card) <
        INDISTINGUISHABLE,
    ).length;
    expect(indistinct).toBeGreaterThan(SEEDS.length / 2);
  });
});

describe("row hover", () => {
  it("carries hue where it cannot carry luminance, for every chromatic seed", () => {
    // This is the mechanism §2 actually invokes. The neutral step shifts no
    // channel spread off `--card`; every chromatic chapter tint shifts more.
    //
    // (neutral ladder, 2026-11-05) The warm ladder's neutral step shifted 3
    // points, and the three achromatic seeds' tints shifted more than that, so
    // the argument held for every seed. On the pure-neutral ladder their tint
    // (`#222222`) is itself neutral and shifts nothing either, so for those
    // three the hover carries no hue at all: it is only a lighter grey than
    // the neutral step. Asserted as such, so the gap stays visible.
    const neutral = ratio(SURFACE.popover, SURFACE.card);
    const neutralShift = chromaShift(SURFACE.popover, SURFACE.card);
    expect(neutralShift).toBe(0);
    for (const seed of SEEDS) {
      const tint = accentRolesFor(seed)["--accent-subtle"]!;
      if (["#000000", "#C0C0C0", "#FFFFFF"].includes(seed)) {
        expect(chromaShift(tint, SURFACE.card), `${seed} hue shift`).toBe(0);
        expect(
          ratio(tint, SURFACE.card),
          `${seed} hover vs the neutral step`,
        ).toBeGreaterThan(neutral);
        continue;
      }
      expect(
        chromaShift(tint, SURFACE.card),
        `${seed} hover hue shift vs the neutral step`,
      ).toBeGreaterThan(neutralShift);
    }
  });
});

describe("row selection", () => {
  it("sits a real step above both the card and the hover fill, for every seed", () => {
    for (const seed of SEEDS) {
      const roles = accentRolesFor(seed);
      const three = roles["--accent-subtle"]!;
      const four = accentFour(roles);
      expect(
        ratio(four, SURFACE.card),
        `${seed} selected vs --card`,
      ).toBeGreaterThan(ratio(three, SURFACE.card));
      expect(ratio(four, three), `${seed} selected vs hover`).toBeGreaterThan(
        1.1,
      );
    }
  });

  it("carries its real signal in the text tone, for every seed", () => {
    // The load-bearing half, the way `focus.ts` documents the border swap as the
    // load-bearing half of the focus ring. The fill is under the non-text floor;
    // the text is comfortably over the text floor.
    for (const seed of SEEDS) {
      const roles = accentRolesFor(seed);
      expect(
        ratio(roles["--accent-text"]!, accentFour(roles)),
        `${seed} --accent-text on the selected fill`,
      ).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it("records that no row-state fill clears the non-text floor", () => {
    // Deliberate, and stated rather than hidden. components.md §2 concedes the
    // neutral ladder cannot signal "this one" on luminance, and the accent
    // ladder's low steps cannot either. Hover is a pointer-only convenience
    // already redundant with the cursor. Selection carries information, so it is
    // redundant three ways — this fill, `--accent-text`, and (on every table
    // that offers selection) the checked row checkbox and the bulk-action bar
    // above the table. If a later change makes a fill clear 3:1 on its own, this
    // assertion is what says the redundancy can be reconsidered.
    for (const seed of SEEDS) {
      expect(
        ratio(accentFour(accentRolesFor(seed)), SURFACE.card),
        `${seed} selected fill vs --card`,
      ).toBeLessThan(AA_NON_TEXT);
    }
  });
});

describe("the hairline", () => {
  it("would have caught `divide-border/70`", () => {
    // Three lists in this slice thinned the divider to 70% of `--border`.
    // components.md §2 makes the hairline load-bearing precisely because the
    // ladder step under it is not, so thinning it spends the only separation
    // those rows have.
    for (const [name, bg] of Object.entries(SURFACE)) {
      const full = ratio(applyAlpha("#FFFFFF", HAIRLINE_ALPHA, bg), bg);
      const thinned = ratio(
        applyAlpha("#FFFFFF", HAIRLINE_ALPHA * 0.7, bg),
        bg,
      );
      expect(thinned, `thinned hairline over ${name}`).toBeLessThan(full);
      expect(full, `full hairline over ${name}`).toBeLessThan(AA_NON_TEXT);
    }
  });
});

describe("text the row states leave behind", () => {
  it("keeps the secondary tone legible on a selected row, for every seed", () => {
    // Only *uncolored* cell text inherits `--accent-text` on selection; a
    // sub-line that sets `text-muted-foreground` (the member's email, an
    // invoice's due date) keeps its own tone and lands on the selected fill.
    // That pair is neither the base surface nor the accent text, so neither of
    // the assertions above reaches it.
    for (const seed of SEEDS) {
      expect(
        ratio(TEXT.mutedForeground, accentFour(accentRolesFor(seed))),
        `${seed} --muted-foreground on the selected fill`,
      ).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it("keeps the bulk-action bar's own text legible, for every seed", () => {
    // The "N selected" bars on /members, /billing and /points are
    // `bg-accent-subtle` with plain `--foreground` text — an accent-tinted
    // surface that is not a row and not a badge.
    for (const seed of SEEDS) {
      const three = accentRolesFor(seed)["--accent-subtle"]!;
      expect(
        ratio(TEXT.foreground, three),
        `${seed} --foreground on the bulk-action bar`,
      ).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });
});

describe("table text", () => {
  it("keeps the header tone over every surface a table sits on", () => {
    // `TableHead` is `--muted-foreground`. `--muted` is one step quieter and
    // would read as the obvious choice for a column label; components.md §1
    // records that it clears the gate on nothing.
    for (const [name, bg] of Object.entries(SURFACE)) {
      expect(
        ratio(TEXT.mutedForeground, bg),
        `--muted-foreground over ${name}`,
      ).toBeGreaterThanOrEqual(AA_TEXT);
      expect(ratio(TEXT.muted, bg), `--muted over ${name}`).toBeLessThan(
        AA_TEXT,
      );
    }
  });
});
