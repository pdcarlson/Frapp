import { describe, expect, it } from "vitest";
import {
  AA_TEXT,
  DESTRUCTIVE_TEXT,
  SEMANTIC,
  STATUS_TINT,
  SURFACE,
  TEXT,
  ratio,
  tint,
} from "@/tests/signet-contrast";

/**
 * #2376: every text/fill pair the §5 status tints ship, on every surface they
 * can land on.
 *
 * The `--*-tint` tokens are `rgba()` literals, so there is one path to
 * measure: every engine composites the same hue at the same alpha over the
 * surface under it. (The alpha utility they replaced had a second path, below
 * the `color-mix` floor, where the fill was the solid hue and the label read
 * 1.00:1; `status-tint-call-sites.spec.ts` keeps it out.) The hue and alpha are
 * read from the tokens (`STATUS_TINT`), so a changed token is re-measured here.
 *
 * `SURFACE` is every ladder step. The destructive toast, which floats over
 * page content rather than a step, paints `--popover` under its tint for this
 * reason, and so is covered by the `popover` row (`components/ui/toast.tsx`).
 */

const LABELS: Array<[string, string, keyof typeof STATUS_TINT]> = [
  ["--success", SEMANTIC.success, "success"],
  ["--warning", SEMANTIC.warning, "warning"],
  ["--destructive-text", DESTRUCTIVE_TEXT, "destructive"],
  // The destructive button's hover.
  ["--destructive-text", DESTRUCTIVE_TEXT, "destructiveHover"],
  // Notices that carry neutral text on the danger tint
  // (`chapter-nav-header`, `discord-import/connect-step`).
  ["--foreground", TEXT.foreground, "destructive"],
  ["--muted-foreground", TEXT.mutedForeground, "destructive"],
  // And on the warning tint (`chat/block-list-notice`).
  ["--foreground", TEXT.foreground, "warning"],
  ["--muted-foreground", TEXT.mutedForeground, "warning"],
];

describe("the status tints", () => {
  it("are their hue at 13%, and 20% for the danger hover", () => {
    // The composite the alpha utility painted in a current engine, so the
    // move to tokens changed no rendering there.
    expect(STATUS_TINT.success).toEqual({ hue: SEMANTIC.success, alpha: 0.13 });
    expect(STATUS_TINT.warning).toEqual({ hue: SEMANTIC.warning, alpha: 0.13 });
    expect(STATUS_TINT.destructive).toEqual({
      hue: SEMANTIC.destructive,
      alpha: 0.13,
    });
    expect(STATUS_TINT.destructiveHover).toEqual({
      hue: SEMANTIC.destructive,
      alpha: 0.2,
    });
  });

  it("put every shipped label over the gate on every surface", () => {
    for (const [label, text, key] of LABELS) {
      const { hue, alpha } = STATUS_TINT[key];
      for (const [name, bg] of Object.entries(SURFACE)) {
        expect(
          ratio(text, tint(hue, bg, alpha)),
          `${label} on --${key} over ${name}`,
        ).toBeGreaterThanOrEqual(AA_TEXT);
      }
    }
  });

  it("need the lift for danger text", () => {
    // Solid danger misses on its own tint from `--surface-1` up, so danger
    // text on a tint is always `--destructive-text`, at every call site, and
    // `status-tint-call-sites.spec.ts` holds them to it.
    const { hue, alpha } = STATUS_TINT.destructive;
    expect(
      ratio(SEMANTIC.destructive, tint(hue, SURFACE.card, alpha)),
    ).toBeLessThan(AA_TEXT);
  });
});
