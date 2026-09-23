import { contrastRatio, parseHex } from "@repo/color";
import { signetDarkTokens } from "@repo/theme/signet";

/** The two label tones the Accent card's "Preview" swatch chooses between. */
export const ACCENT_PREVIEW_INK = [
  signetDarkTokens.color.gold.onHouse,
  signetDarkTokens.color.text.foreground,
] as const;

/**
 * The better of the two tones on `fill`, and its ratio. Always the better one
 * rather than the first that clears AA, so the result is defined for every
 * input, including a fill where neither tone clears it (the caller then says
 * so). `null` when `fill` is not a hex colour.
 *
 * Its own module so `settings-contrast.spec.ts` measures the ink the page
 * renders, not a copy of the ladder.
 */
export function previewInkFor(
  fill: string,
): { ink: string; ratio: number } | null {
  const fillRgb = parseHex(fill);
  if (!fillRgb) return null;
  let best: { ink: string; ratio: number } | null = null;
  for (const ink of ACCENT_PREVIEW_INK) {
    const inkRatio = contrastRatio(parseHex(ink)!, fillRgb);
    if (!best || inkRatio > best.ratio) best = { ink, ratio: inkRatio };
  }
  return best;
}

/**
 * A failing ratio for the warning, to one decimal and truncated, not rounded:
 * the sentence says the figure is under 4.5:1, and rounding would print a
 * 4.4954 as "4.5:1, under the 4.5:1 minimum". The epsilon keeps a ratio whose
 * float sits a hair under a tenth (4.3 as 4.2999…) from dropping a tenth.
 */
export function formatInkRatio(ratio: number): string {
  return (Math.floor(ratio * 10 + 1e-9) / 10).toFixed(1);
}
