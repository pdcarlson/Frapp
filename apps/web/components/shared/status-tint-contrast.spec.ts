import { describe, expect, it } from "vitest";
import {
  AA_TEXT,
  DESTRUCTIVE_TEXT,
  SEMANTIC,
  STATUS_TINT,
  TEXT,
  cssToken,
  ratio,
} from "@/tests/signet-contrast";

/**
 * #2376: every text/fill pair the §5 status tints ship, measured on the fill
 * that actually renders.
 *
 * The tints are opaque literals, so there is no second path to measure: the
 * pair a browser without `color-mix` paints is the pair every browser paints.
 * The first test is what makes that true, and it is the one that fails if a
 * tint is ever rewritten as a `color-mix()` or a `var()` read, which would
 * bring back a floor where the fallback is not this colour.
 */

const LITERAL = /^#[0-9A-F]{6}$/i;

describe("the status tints", () => {
  it.each([
    "--success-tint",
    "--warning-tint",
    "--destructive-tint",
    "--destructive-tint-hover",
  ])("%s is an opaque literal, so it has no color-mix fallback", (token) => {
    expect(cssToken(token)).toMatch(LITERAL);
  });

  it("puts every shipped label over the gate on its tint", () => {
    const pairs: Array<[string, string, string]> = [
      ["--success on --success-tint", SEMANTIC.success, STATUS_TINT.success],
      ["--warning on --warning-tint", SEMANTIC.warning, STATUS_TINT.warning],
      [
        "--destructive-text on --destructive-tint",
        DESTRUCTIVE_TEXT,
        STATUS_TINT.destructive,
      ],
      [
        "--destructive-text on --destructive-tint-hover",
        DESTRUCTIVE_TEXT,
        STATUS_TINT.destructiveHover,
      ],
      // Notices that carry neutral text on the danger tint
      // (`chapter-nav-header`, `discord-import/connect-step`).
      [
        "--foreground on --destructive-tint",
        TEXT.foreground,
        STATUS_TINT.destructive,
      ],
      [
        "--muted-foreground on --destructive-tint",
        TEXT.mutedForeground,
        STATUS_TINT.destructive,
      ],
    ];
    for (const [label, text, fill] of pairs) {
      expect(ratio(text, fill), label).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it("records the fallback the alpha recipe used to paint", () => {
    // Below the color-mix floor, `bg-x/[.13]` painted the solid hue. These are
    // the numbers that made it #2376: the label in its own colour, on itself.
    expect(ratio(SEMANTIC.success, SEMANTIC.success)).toBe(1);
    expect(ratio(SEMANTIC.warning, SEMANTIC.warning)).toBe(1);
    expect(ratio(DESTRUCTIVE_TEXT, SEMANTIC.destructive)).toBeLessThan(1.5);
  });
});
