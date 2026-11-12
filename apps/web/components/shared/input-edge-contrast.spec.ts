import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { applyAlpha } from "@repo/color";
import { describe, expect, it } from "vitest";

import {
  AA_NON_TEXT,
  ratio,
  signetDarkTokens,
  SURFACE,
} from "@/tests/signet-contrast";

/**
 * A control's edge identifies it (WCAG 2.2 SC 1.4.11: 3:1), so
 * `--control-edge` has to clear 3:1 on every seat a control sits on and
 * against the control's own fill (foundations.md §3, #4389). Controls drew the
 * quiet `--input` (0.14) until 2026-11-12: 1.14:1 for a field in a dialog.
 *
 * The alpha composites over the control's OWN fill, not the seat: the
 * background paints under the border (`background-clip: border-box`). Sampled
 * on the real screens, a field's edge is the same `#7A7A7A` on the page, in a
 * card and in a dialog. So each control is measured by its fill.
 */

/** The alpha of an `rgba(255,255,255,a)` token. Throws rather than guess. */
function whiteAlpha(token: string, name: string): number {
  const match = /^rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*([\d.]+)\s*\)$/.exec(
    token,
  );
  if (!match) {
    throw new Error(
      `${name} is "${token}", not rgba(255,255,255,a); this guard can't measure it`,
    );
  }
  return Number(match[1]);
}

const CONTROL_ALPHA = whiteAlpha(
  signetDarkTokens.color.border.control,
  "border.control",
);

const SEATS = {
  background: SURFACE.background,
  "surface-1": SURFACE.surface1,
  card: SURFACE.card,
  popover: SURFACE.popover,
};

/**
 * Every web site that draws a control's identifying edge, with the fill the
 * edge composites over. The source check below keeps it honest: each site
 * must still draw `border-control-edge` on that fill, and the primitives must
 * not fall back to the quiet `border-input`.
 */
const CONTROLS = [
  { file: "ui/input.tsx", fill: "bg-surface-1" },
  { file: "ui/textarea.tsx", fill: "bg-surface-1" },
  { file: "ui/select.tsx", fill: "bg-surface-1" },
  { file: "ui/segmented.tsx", fill: "bg-surface-1" },
  { file: "ui/button.tsx", fill: "bg-card" },
  { file: "ui/switch.tsx", fill: "bg-popover" },
  { file: "chat/composer.tsx", fill: "bg-surface-1" },
  { file: "chat/inline-message-editor.tsx", fill: "bg-surface-1" },
  { file: "chat/emoji-picker-panel.tsx", fill: "bg-surface-1" },
  { file: "layout/find-bar.tsx", fill: "bg-surface-1" },
  { file: "members/email-chips-input.tsx", fill: "bg-surface-1" },
] as const;

const FILL_HEX = {
  "bg-surface-1": SURFACE.surface1,
  "bg-card": SURFACE.card,
  "bg-popover": SURFACE.popover,
} as const;

const source = (file: string) =>
  readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "..", file),
    "utf8",
  );

describe("a control's edge (--control-edge) clears 3:1", () => {
  for (const { file, fill } of CONTROLS) {
    it(`${file} draws border-control-edge with ${fill}`, () => {
      const code = source(file);
      expect(code).toMatch(
        new RegExp(`border-control-edge[^"\`]*${fill.replace("-", "\\-")}`),
      );
      if (file.startsWith("ui/")) {
        expect(code, `${file} fell back to the quiet --input edge`).not.toMatch(
          /\bborder-input\b/,
        );
      }
    });
  }

  for (const [fillClass, fill] of Object.entries(FILL_HEX)) {
    const edge = applyAlpha("#FFFFFF", CONTROL_ALPHA, fill);

    it(`on ${fillClass}: against its own fill`, () => {
      expect(ratio(edge, fill)).toBeGreaterThanOrEqual(AA_NON_TEXT);
    });

    it.each(Object.entries(SEATS))(`on ${fillClass}: on %s`, (_seat, seat) => {
      expect(ratio(edge, seat)).toBeGreaterThanOrEqual(AA_NON_TEXT);
    });
  }

  it("is the lowest such alpha, to the hundredth", () => {
    // A field in a dialog is the worst seat. One step lighter fails it, so
    // the edge is no heavier than 3:1 needs.
    const worst = (alpha: number) =>
      Math.min(
        ...Object.values(SEATS).map((seat) =>
          ratio(applyAlpha("#FFFFFF", alpha, SURFACE.surface1), seat),
        ),
      );
    expect(worst(CONTROL_ALPHA)).toBeGreaterThanOrEqual(AA_NON_TEXT);
    expect(worst(CONTROL_ALPHA - 0.01)).toBeLessThan(AA_NON_TEXT);
  });

  it("is a step above the quiet --input edge, which stays for what recedes", () => {
    const quiet = whiteAlpha(
      signetDarkTokens.color.border.input,
      "border.input",
    );
    expect(quiet).toBeLessThan(CONTROL_ALPHA);
    // What the 0.14 edge measured for a field in a dialog: the defect.
    expect(
      ratio(applyAlpha("#FFFFFF", quiet, SURFACE.surface1), SURFACE.popover),
    ).toBeLessThan(AA_NON_TEXT);
  });
});
