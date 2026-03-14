import { frappTokens } from "./tokens";

const HEX_COLOR_PATTERN = /^#([0-9A-F]{3}|[0-9A-F]{6})$/i;
const MIN_ACCENT_ON_WHITE_CONTRAST = 4.5;

type RgbColor = { red: number; green: number; blue: number };

export type AccentValidationResult = {
  resolvedAccent: string;
  fallbackApplied: boolean;
  contrastOnWhite: number;
  reason: "ok" | "invalid_format" | "insufficient_contrast";
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

export function resolveChapterAccentColor(inputAccent?: string): AccentValidationResult {
  const fallbackAccent = frappTokens.color.brand.royalBlue;
  const whiteRgb = hexToRgb("#FFFFFF");

  if (!inputAccent) {
    return {
      resolvedAccent: fallbackAccent,
      fallbackApplied: true,
      contrastOnWhite: getContrastRatio(hexToRgb(fallbackAccent), whiteRgb),
      reason: "invalid_format",
    };
  }

  const normalized = normalizeHexColor(inputAccent);

  if (!normalized) {
    return {
      resolvedAccent: fallbackAccent,
      fallbackApplied: true,
      contrastOnWhite: getContrastRatio(hexToRgb(fallbackAccent), whiteRgb),
      reason: "invalid_format",
    };
  }

  const accentContrast = getContrastRatio(hexToRgb(normalized), whiteRgb);
  if (accentContrast < MIN_ACCENT_ON_WHITE_CONTRAST) {
    return {
      resolvedAccent: fallbackAccent,
      fallbackApplied: true,
      contrastOnWhite: getContrastRatio(hexToRgb(fallbackAccent), whiteRgb),
      reason: "insufficient_contrast",
    };
  }

  return {
    resolvedAccent: normalized,
    fallbackApplied: false,
    contrastOnWhite: accentContrast,
    reason: "ok",
  };
}
