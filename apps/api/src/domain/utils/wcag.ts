/**
 * WCAG 2.1 contrast utilities.
 * Validates that colors meet WCAG AA requirements (4.5:1 for normal text).
 *
 * `@repo/color` is the canonical implementation of this math for the rest of the
 * monorepo, and this file deliberately does not import it. That package serves
 * its `require` condition from a gitignored `dist/`, and
 * `chapter.service.spec.ts` exercises the real gate rather than mocking it, so
 * depending on it here would break `npm test -w apps/api` on a clean clone.
 * Same formula, two call sites, pinned by both packages' tests.
 */

/**
 * Converts a hex color (#RRGGBB) to RGB values 0-255.
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const match = hex
    .replace(/^#/, '')
    .match(/^([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})$/);
  if (!match) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  return {
    r: parseInt(match[1], 16),
    g: parseInt(match[2], 16),
    b: parseInt(match[3], 16),
  };
}

/**
 * Converts sRGB channel (0-255) to linear luminance component.
 */
function srgbToLinear(c: number): number {
  const normalized = c / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

/**
 * Computes relative luminance for a hex color (WCAG formula).
 */
function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const rLin = srgbToLinear(r);
  const gLin = srgbToLinear(g);
  const bLin = srgbToLinear(b);
  return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
}

/**
 * Computes contrast ratio between two colors (WCAG formula).
 * Returns a value >= 1 (1:1 = same, 21:1 = max).
 */
function contrastRatio(color1: string, color2: string): number {
  const l1 = relativeLuminance(color1);
  const l2 = relativeLuminance(color2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * The light-mode surface an accent is validated against on save.
 *
 * Bone, matching `@repo/theme`'s `surface.canvas` — what the app actually
 * renders on. It was slate `#F8FAFC` until #600, a cool grey left over from the
 * navy era that no surface has used since the bone/bronze rebrand. Correcting it
 * tightens the gate by ~1% of RGB space; no color in
 * `supabase/seed/chapter_directory.csv` changes verdict, and the closest call is
 * the schema default `#2563EB`, which goes from 4.940:1 to 4.837:1 and still
 * passes.
 */
export const LIGHT_MODE_BACKGROUND = '#FAF7F2';

/**
 * Checks if the given foreground color meets WCAG AA contrast requirements
 * (4.5:1) against the specified background color.
 *
 * @param hexColor - Foreground color in hex format (#RRGGBB)
 * @param background - Background color in hex format (#RRGGBB), defaults to the light-mode surface
 * @returns true if contrast ratio >= 4.5
 */
export function checkWcagContrast(
  hexColor: string,
  background: string = LIGHT_MODE_BACKGROUND,
): boolean {
  const ratio = contrastRatio(hexColor, background);
  return ratio >= 4.5;
}

/*
 * Deliberately NOT extended to `branding.colors.accent`.
 *
 * #600 asked for this gate on that field too, on the reading that it is the
 * same thing as the column. Under Signet it is not: `branding.colors.accent` is
 * the accent engine's *seed*, and the raw seed never paints UI
 * (`spec/ui/design-system/accent-engine.md` §1). The engine derives a 12-step
 * scale from it and guarantees the contrast of the roles that DO paint, by
 * construction and with an assertion at generation time.
 *
 * Gating the seed also does not survive contact with real data: of the 50
 * chapters in `supabase/seed/chapter_directory.csv`, 49 have an accent that
 * fails 4.5:1 on the light surface — `#C9A56F` alone is 45 of them at 2.16:1.
 * Fraternity colors are frequently light golds, silvers, and whites. A gate
 * there would reject almost every real chapter's actual brand color while
 * protecting nothing the engine was not already protecting.
 *
 * The column keeps its gate because the column really is painted directly, by
 * `dashboard-shell.tsx` and mobile branding, until the web reskin removes it.
 */
