import { describe, expect, it } from "vitest";
import { applyAlpha, contrastRatio, mixHex, parseHex } from "@repo/color";
import {
  deriveSignetPalette,
  HOUSE_SEED,
  signetAccentSemanticVars,
} from "@repo/chapter-theme";
import { signetDarkTokens } from "@repo/theme/signet";

/**
 * Contrast for the row states `components/ui/table.tsx` paints.
 *
 * This lives in `shared/` rather than in one family because four routes
 * composite the same `TableRow` — `/members`, `/points`, `/billing` and
 * `/events` — and the defect it exists for was invisible in all four at once.
 *
 * The defect: `hover:bg-accent` composited to **1.085:1** on a row inside a
 * `<Card>`, because `--accent` holds the same value as `--popover`. No hover at
 * all, on the busiest table in the product.
 *
 * The reason this file is not two assertions long is the *fix* had the same
 * trap in it. components.md §2 says to highlight with the accent tint instead,
 * which reads like a contrast remedy and is not one: measured across the seeded
 * chapter directory, `--accent-subtle` sits 1.032–1.143:1 from `--card` — no
 * better than the neutral step, and worse for the dark red seeds. What §2's
 * recipe actually buys is **hue**. So the assertions below pin the hue, the
 * one-step lift that separates selection from hover, and the text tone that
 * carries selection — and pin the near-equality that makes all three necessary,
 * so a later "simplification" back to a single tint fails loudly.
 */

/**
 * The frozen seed corpus. `packages/chapter-theme/src/signet.spec.ts` owns it
 * and explains why it is copied rather than read from
 * `supabase/seed/chapter_directory.csv`: the seed file is production data that
 * gets edited, and a suite reading it would change what it asserts whenever
 * that data moves — or silently narrow its own coverage.
 */
const SEEDS = [
  "#000000",
  "#003087",
  "#006400",
  "#1F1A15",
  "#1F4E79",
  "#472B62",
  "#4B0082",
  "#4B1A7E",
  "#4B2E2E",
  "#800000",
  "#8B0000",
  "#8B4513",
  "#BF0A30",
  "#C0C0C0",
  "#C9A56F",
  "#CC0000",
  "#FF69B4",
  "#FFFFFF",
  HOUSE_SEED,
] as const;

/** Read from the token source; a guard that restates its values guards nothing. */
const SURFACE = signetDarkTokens.color.surface;
const TEXT = signetDarkTokens.color.text;

/** The hairline's alpha, parsed from the token so the two cannot disagree. */
const HAIRLINE_ALPHA = Number(
  /rgba\([^)]*,\s*([\d.]+)\)/.exec(signetDarkTokens.color.border.hairline)?.[1] ??
    "0.08",
);

const AA_TEXT = 4.5;
/** README §6's non-text floor. */
const AA_NON_TEXT = 3;

const ratio = (fg: string, bg: string) =>
  contrastRatio(parseHex(fg)!, parseHex(bg)!);

function accentRolesFor(seed: string) {
  return signetAccentSemanticVars(deriveSignetPalette(seed).palette);
}

/**
 * `--accent-subtle-hover` is a `color-mix(in srgb, var(--accent-border) 22%,
 * var(--accent-subtle))` in `signet.css`. CSS resolves it at paint time; here it
 * is recomputed from the same two roles and the same 22%, so a change to the
 * mix in the stylesheet has to be mirrored here to keep these green.
 */
const accentFour = (roles: Record<string, string>) =>
  mixHex(roles["--accent-subtle"]!, roles["--accent-border"]!, 0.22);

/** The channel spread of a fill's delta from a surface — its hue shift. */
function chromaShift(fill: string, base: string) {
  const a = parseHex(fill)!;
  const b = parseHex(base)!;
  const deltas = [a.r - b.r, a.g - b.g, a.b - b.b];
  return Math.max(...deltas) - Math.min(...deltas);
}

describe("the defect this file exists for", () => {
  it("would have caught `hover:bg-accent` on a card-seated row", () => {
    // `--accent` and `--popover` are the same value, so hovering a row inside a
    // card moved it one neutral step: no feedback a person could see.
    expect(ratio(SURFACE.popover, SURFACE.card)).toBeLessThan(1.1);
  });

  it("would have caught swapping the neutral step for the tint and stopping", () => {
    // The near-miss worth pinning. §2's accent tint is the right recipe and the
    // wrong *reason*: on a card row it is luminance-equivalent to the neutral
    // highlight it replaces, and for several seeds it is measurably flatter. A
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
});

describe("row hover", () => {
  it("carries hue where it cannot carry luminance, for every seed", () => {
    // This is the mechanism §2 actually invokes. The neutral step shifts 3
    // points of channel spread off `--card`; every chapter tint shifts more,
    // including the three achromatic seeds, which are the ones that decide
    // whether the argument holds at all.
    const neutralShift = chromaShift(SURFACE.popover, SURFACE.card);
    for (const seed of SEEDS) {
      const tint = accentRolesFor(seed)["--accent-subtle"]!;
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
      expect(ratio(four, SURFACE.card), `${seed} selected vs --card`).toBeGreaterThan(
        ratio(three, SURFACE.card),
      );
      expect(ratio(four, three), `${seed} selected vs hover`).toBeGreaterThan(1.1);
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
      const thinned = ratio(applyAlpha("#FFFFFF", HAIRLINE_ALPHA * 0.7, bg), bg);
      expect(thinned, `thinned hairline over ${name}`).toBeLessThan(full);
      expect(full, `full hairline over ${name}`).toBeLessThan(AA_NON_TEXT);
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
      expect(ratio(TEXT.muted, bg), `--muted over ${name}`).toBeLessThan(AA_TEXT);
    }
  });
});
