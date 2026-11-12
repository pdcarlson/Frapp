import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { applyAlpha } from "@repo/color";
import { describe, expect, it } from "vitest";

import {
  AA_NON_TEXT,
  AA_TEXT,
  ratio,
  signetDarkTokens,
  SURFACE,
  TEXT,
} from "@/tests/signet-contrast";

/**
 * A control's edge identifies it (WCAG 2.2 SC 1.4.11: 3:1), so `--input` has to
 * clear 3:1 on every seat a control sits on and against the control's own fill
 * (foundations.md §3, #4389). It was 0.14 until 2026-11-12, which drew a
 * field's edge at 1.14:1 inside a dialog.
 *
 * The alpha composites over the control's OWN fill, not the seat: the
 * background paints under the border (`background-clip: border-box`). Sampled
 * on the real screens, a field's edge is the same `#7A7A7A` on the page, in a
 * card and in a dialog. So each control is measured by its fill.
 */

const alphaOf = (token: string, fallback: string) =>
  Number(/rgba\([^)]*,\s*([\d.]+)\)/.exec(token)?.[1] ?? fallback);

const INPUT_ALPHA = alphaOf(signetDarkTokens.color.border.input, "0.42");
const NEUTRAL_FILL_ALPHA = alphaOf(signetDarkTokens.color.fill.neutral, "0.14");

const SEATS = {
  background: SURFACE.background,
  "surface-1": SURFACE.surface1,
  card: SURFACE.card,
  popover: SURFACE.popover,
};

/**
 * Every primitive that draws `border-input`, with the fill it draws it on.
 * The source check below keeps this list honest: if a primitive's fill
 * changes, the measurement here would be of a control that no longer ships.
 */
const CONTROLS = [
  { file: "ui/input.tsx", fillClass: "bg-surface-1", fill: SURFACE.surface1 },
  {
    file: "ui/textarea.tsx",
    fillClass: "bg-surface-1",
    fill: SURFACE.surface1,
  },
  { file: "ui/select.tsx", fillClass: "bg-surface-1", fill: SURFACE.surface1 },
  {
    file: "ui/segmented.tsx",
    fillClass: "bg-surface-1",
    fill: SURFACE.surface1,
  },
  {
    file: "ui/button.tsx",
    fillClass: "border-input bg-card",
    fill: SURFACE.card,
  },
  {
    file: "ui/switch.tsx",
    fillClass: "data-[state=unchecked]:bg-popover",
    fill: SURFACE.popover,
  },
] as const;

const source = (file: string) =>
  readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "..", file),
    "utf8",
  );

describe("a control's edge (--input) clears 3:1", () => {
  for (const { file, fillClass } of CONTROLS) {
    it(`${file} draws border-input on ${fillClass}`, () => {
      const code = source(file);
      expect(code).toContain("border-input");
      expect(code).toContain(fillClass);
    });
  }

  for (const { file, fill } of CONTROLS) {
    const edge = applyAlpha("#FFFFFF", INPUT_ALPHA, fill);

    it(`${file}: against its own fill`, () => {
      expect(ratio(edge, fill)).toBeGreaterThanOrEqual(AA_NON_TEXT);
    });

    it.each(Object.entries(SEATS))(`${file}: on %s`, (_seat, seat) => {
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
    expect(worst(INPUT_ALPHA)).toBeGreaterThanOrEqual(AA_NON_TEXT);
    expect(worst(INPUT_ALPHA - 0.01)).toBeLessThan(AA_NON_TEXT);
  });
});

describe("the neutral wash fill (--neutral-fill) keeps its text", () => {
  it("would have failed on the raised edge token: why the fill was split off", () => {
    // The secondary badge drew `bg-input`; at 0.42 its text drops under AA.
    const onRaised = applyAlpha("#FFFFFF", INPUT_ALPHA, SURFACE.surface1);
    expect(ratio(TEXT.foreground, onRaised)).toBeLessThan(AA_TEXT);
  });

  it.each(Object.entries(SEATS))(
    "foreground reads at AA on it over %s",
    (_seat, seat) => {
      const fill = applyAlpha("#FFFFFF", NEUTRAL_FILL_ALPHA, seat);
      expect(ratio(TEXT.foreground, fill)).toBeGreaterThanOrEqual(AA_TEXT);
    },
  );
});
