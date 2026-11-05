import { describe, expect, it } from "vitest";
import { applyAlpha } from "@repo/color";
import {
  AA_NON_TEXT,
  AA_TEXT,
  CARD_HOVER,
  HAIRLINE_ALPHA,
  ratio,
  SURFACE,
  TEXT,
  INDISTINGUISHABLE,
} from "@/tests/signet-contrast";

/**
 * Contrast for the row states `components/ui/table.tsx` paints.
 *
 * This lives in `shared/` rather than in one family because four routes
 * composite the same `TableRow` (`/members`, `/points`, `/billing` and
 * `/events`) and the defect it exists for was invisible in all four at once.
 *
 * The defect: `hover:bg-accent` composited to **1.085:1** on a row inside a
 * `<Card>`, because `--accent` held the same value as `--popover` (deleted,
 * #3036). No hover at all, on the busiest table in the product.
 *
 * The accent tint that fixed it is gone too (2026-11-05, `foundations.md` §6,
 * "Where the accent goes"): it painted every hovered row in the chapter color.
 * Both row states are now `--card-hover`, the step above the whole ladder, and
 * selection is carried by the row's checkbox and the "N selected" bar, not by
 * the fill. The assertions below pin that the neutral fill is a visible step,
 * that the text on it reads, and that it is still under the non-text floor, so
 * a later change that leans on the fill alone for selection fails loudly.
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
});

describe("row hover and selection", () => {
  it("is a visible step on every surface a table sits on", () => {
    // `--card-hover` sits above the whole ladder, so it reads as a state where
    // the ladder's own next step does not.
    for (const [name, bg] of Object.entries(SURFACE)) {
      expect(
        ratio(CARD_HOVER, bg),
        `--card-hover over ${name}`,
      ).toBeGreaterThan(INDISTINGUISHABLE);
    }
  });

  it("keeps both text tones legible on the fill", () => {
    // A selected row keeps `--foreground`; a sub-line that sets
    // `text-muted-foreground` (the member's email, an invoice's due date)
    // keeps its own tone and lands on the same fill.
    expect(ratio(TEXT.foreground, CARD_HOVER)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(ratio(TEXT.mutedForeground, CARD_HOVER)).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
  });

  it("records that the fill does not clear the non-text floor", () => {
    // Deliberate, and stated rather than hidden. Hover is a pointer-only
    // convenience already redundant with the cursor. Selection carries
    // information, so it is carried by the checked row checkbox and the
    // bulk-action bar above the table, never by the fill alone. If a later
    // change makes a fill clear 3:1 on its own, this assertion is what says
    // that redundancy can be reconsidered.
    expect(ratio(CARD_HOVER, SURFACE.card)).toBeLessThan(AA_NON_TEXT);
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

describe("the bulk-action bar", () => {
  it("keeps its text legible on its neutral fill", () => {
    // The "N selected" bars on /members, /events, /billing and /points are
    // `bg-popover` with `--foreground` and `--muted-foreground` text. They were
    // the accent tint until 2026-11-05.
    expect(ratio(TEXT.foreground, SURFACE.popover)).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
    expect(ratio(TEXT.mutedForeground, SURFACE.popover)).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
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
