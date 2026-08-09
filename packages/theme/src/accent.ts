import { frappTokens } from "./tokens";

const HEX_COLOR_PATTERN = /^#([0-9A-F]{3}|[0-9A-F]{6})$/i;
const MIN_ACCENT_CONTRAST = 4.5;

/** The background assumed when a caller does not name one (web light mode). */
const DEFAULT_BACKGROUND = "#FFFFFF";

type RgbColor = { red: number; green: number; blue: number };

export type AccentValidationResult = {
  resolvedAccent: string;
  fallbackApplied: boolean;
  /**
   * Contrast of `resolvedAccent` against the background it was checked on —
   * `options.background`, or white when the caller did not name one.
   */
  contrastOnBackground: number;
  reason: "ok" | "invalid_format" | "insufficient_contrast";
};

export type ResolveChapterAccentOptions = {
  /**
   * Surface the accent is drawn on. Defaults to white, which is what the web
   * dashboard assumes; native dark mode must pass its own dark surface or a
   * legible-on-white accent would be waved through onto near-black.
   */
  background?: string;
  /**
   * Accent substituted when the chapter's own fails. Defaults to the light
   * brand token — a dark background needs its own mode's token, since the
   * light one is itself illegible there.
   */
  fallbackAccent?: string;
};

function normalizeHexColor(input: string): string {
  const hex = input.trim();

  if (!HEX_COLOR_PATTERN.test(hex)) {
    return "";
  }

  if (hex.length === 4) {
    const short = hex.slice(1);
    return `#${short
      .split("")
      .map((character) => `${character}${character}`)
      .join("")
      .toUpperCase()}`;
  }

  return hex.toUpperCase();
}

function hexToRgb(hexColor: string): RgbColor {
  const normalized = normalizeHexColor(hexColor);
  return {
    red: Number.parseInt(normalized.slice(1, 3), 16),
    green: Number.parseInt(normalized.slice(3, 5), 16),
    blue: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

function toRelativeLuminance(channelValue: number): number {
  const value = channelValue / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function getLuminance(color: RgbColor): number {
  const red = toRelativeLuminance(color.red);
  const green = toRelativeLuminance(color.green);
  const blue = toRelativeLuminance(color.blue);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function getContrastRatio(colorA: RgbColor, colorB: RgbColor): number {
  const luminanceA = getLuminance(colorA);
  const luminanceB = getLuminance(colorB);
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);
  return Number.parseFloat(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
}

export function resolveChapterAccentColor(
  inputAccent?: string,
  options?: ResolveChapterAccentOptions,
): AccentValidationResult {
  // A caller that hands us an unparseable background would otherwise poison
  // every ratio below, so it degrades to white rather than to NaN.
  const background =
    normalizeHexColor(options?.background ?? "") || DEFAULT_BACKGROUND;
  const fallbackAccent =
    normalizeHexColor(options?.fallbackAccent ?? "") ||
    frappTokens.color.brand.royalBlue;

  const backgroundRgb = hexToRgb(background);
  const fallback = (
    reason: AccentValidationResult["reason"],
  ): AccentValidationResult => ({
    resolvedAccent: fallbackAccent,
    fallbackApplied: true,
    contrastOnBackground: getContrastRatio(
      hexToRgb(fallbackAccent),
      backgroundRgb,
    ),
    reason,
  });

  if (!inputAccent) {
    return fallback("invalid_format");
  }

  const normalized = normalizeHexColor(inputAccent);

  if (!normalized) {
    return fallback("invalid_format");
  }

  const accentContrast = getContrastRatio(hexToRgb(normalized), backgroundRgb);
  if (accentContrast < MIN_ACCENT_CONTRAST) {
    return fallback("insufficient_contrast");
  }

  return {
    resolvedAccent: normalized,
    fallbackApplied: false,
    contrastOnBackground: accentContrast,
    reason: "ok",
  };
}
