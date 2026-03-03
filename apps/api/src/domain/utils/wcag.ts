/**
 * WCAG 2.1 contrast utilities.
 * Validates that colors meet WCAG AA requirements (4.5:1 for normal text).
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
 * Checks if the given foreground color meets WCAG AA contrast requirements
 * (4.5:1) against the specified background color.
 *
 * @param hexColor - Foreground color in hex format (#RRGGBB)
 * @param background - Background color in hex format (#RRGGBB), defaults to light mode slate
 * @returns true if contrast ratio >= 4.5
 */
export function checkWcagContrast(
  hexColor: string,
  background: string = '#F8FAFC',
): boolean {
  const ratio = contrastRatio(hexColor, background);
  return ratio >= 4.5;
}
