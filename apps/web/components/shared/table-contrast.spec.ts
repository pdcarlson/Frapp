import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyAlpha } from "@repo/color";
import { codeWithoutComments, REPO } from "@/tests/source-scan";
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
 * Contrast for the row states `components/ui/table.tsx` paints, and the
 * selectable lists on `/members`, `/points`, `/billing` and `/events` that
 * paint the same recipe by hand.
 *
 * This lives in `shared/` rather than in one family because those routes all
 * drew the same row states, and the defect it exists for was invisible in all
 * of them at once.
 *
 * The defect: `hover:bg-accent` composited to **1.085:1** on a row inside a
 * `<Card>`, because `--accent` held the same value as `--popover` (deleted,
 * #3036). No hover at all, on the busiest table in the product.
 *
 * The accent tint that fixed it is gone too (2026-11-05, `foundations.md` §6,
 * "Where the accent goes"): it painted every hovered row in the chapter color.
 * Hover is now `--card-hover`, the step above the whole ladder; a selected row
 * rests on `--popover` a step under it, so a button inside a selected row still
 * lifts on hover. Selection is carried by the row's checkbox and the
 * "N selected" bar, not by the fill. The assertions below pin that hover is a
 * visible step over both, that the text on the fills reads, that neither fill
 * clears the non-text floor,
 * and they pin the call sites to that recipe, so a row that drifts back to the
 * accent tint fails here.
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

  it("lifts a hovered control above a selected row", () => {
    // A ghost or secondary button inside a selected row hovers to
    // `--card-hover`; on a `--card-hover` row it would hover to its own
    // surface, the defect `elevation-call-sites.spec.ts` names.
    expect(ratio(CARD_HOVER, SURFACE.popover)).toBeGreaterThan(
      INDISTINGUISHABLE,
    );
  });

  it("keeps both text tones legible on either fill", () => {
    // A selected row keeps `--foreground`; a sub-line that sets
    // `text-muted-foreground` (the member's email, an invoice's due date)
    // keeps its own tone and lands on the same fill.
    for (const fill of [CARD_HOVER, SURFACE.popover]) {
      expect(ratio(TEXT.foreground, fill)).toBeGreaterThanOrEqual(AA_TEXT);
      expect(ratio(TEXT.mutedForeground, fill)).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it("records that the fill does not clear the non-text floor", () => {
    // Deliberate, and stated rather than hidden. Hover is a pointer-only
    // convenience already redundant with the cursor. Selection carries
    // information, so it is carried by the checked row checkbox and the
    // bulk-action bar above the table, never by the fill alone. If a later
    // change makes a fill clear 3:1 on its own, this assertion is what says
    // that redundancy can be reconsidered.
    expect(ratio(CARD_HOVER, SURFACE.card)).toBeLessThan(AA_NON_TEXT);
    expect(ratio(SURFACE.popover, SURFACE.card)).toBeLessThan(AA_NON_TEXT);
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

describe("the call sites", () => {
  const WEB = join(REPO, "apps", "web");
  const SELECTABLE = [
    "components/members/members-directory.tsx",
    "components/events/events-page.tsx",
    "app/(dashboard)/points/page.tsx",
    "components/billing/invoice-list.tsx",
  ];

  it("paints TableRow's hover and selection neutral, hover winning a tie", () => {
    const table = codeWithoutComments(join(WEB, "components/ui/table.tsx"));
    expect(table).toContain('"hover:bg-card-hover"');
    expect(table).toContain("data-[state=selected]:bg-popover");
    expect(table).toContain("data-[state=selected]:hover:bg-card-hover");
    expect(table).not.toMatch(/accent-subtle/);
  });

  it.each(SELECTABLE)(
    "keeps the accent tint off %s's rows and selection bar",
    (path) => {
      // The accent stays on these lists only in the row checkboxes, which are
      // the shared checkbox control and not spelled here.
      const code = codeWithoutComments(join(WEB, path));
      expect(code).toMatch(/[sS]elected && "bg-popover"/);
      expect(code).not.toMatch(/accent-subtle|text-accent-text/);
    },
  );
});

describe("the bulk-action bar", () => {
  it("keeps its text legible on its neutral fill", () => {
    // The "N selected" bars on /members, /billing and /points are
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
