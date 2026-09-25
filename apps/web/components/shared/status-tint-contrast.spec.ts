import { describe, expect, it } from "vitest";
import {
  AA_TEXT,
  DESTRUCTIVE_TEXT,
  SEMANTIC,
  SURFACE,
  TEXT,
  ratio,
  tint,
} from "@/tests/signet-contrast";

/**
 * #2376: every text/fill pair the §5 status tints ship, on both paths a
 * browser can paint them.
 *
 * The `--*-tint` tokens are `color-mix()` values (signet.css). A current
 * engine composites the hue at 13% (20% for the hover) over whatever the fill
 * sits on, so that pair is measured on every ladder step. An engine below the
 * `color-mix` floor cannot parse the token, the declaration is invalid at
 * computed-value time, and the fill is transparent: the label sits on the bare
 * surface, so that pair is measured too. Neither path may paint the label's
 * own colour under it, which is what the alpha utility's fallback did.
 */

/** The labels the Next surfaces draw on a status tint, by the tint's hue. */
const LABELS: Array<[string, string, string, number]> = [
  ["--success", SEMANTIC.success, SEMANTIC.success, 0.13],
  ["--warning", SEMANTIC.warning, SEMANTIC.warning, 0.13],
  ["--destructive-text", DESTRUCTIVE_TEXT, SEMANTIC.destructive, 0.13],
  // The destructive button's and toast action's hover.
  ["--destructive-text (hover)", DESTRUCTIVE_TEXT, SEMANTIC.destructive, 0.2],
  // Notices that carry neutral text on the danger tint
  // (`chapter-nav-header`, `discord-import/connect-step`).
  ["--foreground", TEXT.foreground, SEMANTIC.destructive, 0.13],
  ["--muted-foreground", TEXT.mutedForeground, SEMANTIC.destructive, 0.13],
];

describe("the status tints", () => {
  it("put every shipped label over the gate where color-mix renders", () => {
    for (const [label, text, hue, alpha] of LABELS) {
      for (const [name, bg] of Object.entries(SURFACE)) {
        expect(
          ratio(text, tint(hue, bg, alpha)),
          `${label} on its ${alpha * 100}% tint over ${name}`,
        ).toBeGreaterThanOrEqual(AA_TEXT);
      }
    }
  });

  it("put every shipped label over the gate where the fill drops out", () => {
    for (const [label, text] of LABELS) {
      for (const [name, bg] of Object.entries(SURFACE)) {
        expect(
          ratio(text, bg),
          `${label} on bare ${name}`,
        ).toBeGreaterThanOrEqual(AA_TEXT);
      }
    }
  });

  it("need the lift for danger text on either path", () => {
    // Solid danger misses on its tint from `--surface-1` up, and on a bare
    // `--popover` too, which is where an unfilled tint in a dialog leaves it.
    // So danger text on a tint is always `--destructive-text`, at every call
    // site, and `status-tint-call-sites.spec.ts` holds them to it.
    expect(
      ratio(SEMANTIC.destructive, tint(SEMANTIC.destructive, SURFACE.card)),
    ).toBeLessThan(AA_TEXT);
    expect(ratio(SEMANTIC.destructive, SURFACE.popover)).toBeLessThan(AA_TEXT);
  });
});
