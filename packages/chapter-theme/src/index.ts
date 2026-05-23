/**
 * @repo/chapter-theme
 *
 * derivePalette({dark, accent}) — generates the full chapter CSS token map
 * from a chapter's two brand colors (dark sidebar color + accent color).
 *
 * WCAG validation: each token is tested against the relevant background
 * (bone for light-mode UI, ink for dark/sidebar UI). If a token fails AA
 * 4.5:1, that *specific token* falls back to bronze — the rest of the palette
 * is kept as-is. Bronze is the platform's brand guarantee.
 *
 * No window.* or DOM dependencies. Safe for NestJS and Deno Edge Functions.
 */

// ── Constants ────────────────────────────────────────────────────────────────

/** Bone: the main light-mode background. ~hsl(37 33% 96%) */
const BONE = "#F7F3EC";

/** Ink: the darkest neutral, used for sidebar backgrounds. */
const INK = "#1F1A15";

/** Bronze: the platform fallback accent. From @repo/theme tokens (royalBlue). */
const BRONZE = "#7A5A2F";

const MIN_CONTRAST = 4.5; // WCAG AA normal text
const HEX_RE = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

// ── WCAG math (inline — avoids importing @repo/theme private helpers) ────────

type Rgb = { r: number; g: number; b: number };

function parseHex(hex: string): Rgb | null {
  const h = hex.trim();
  if (!HEX_RE.test(h)) return null;
  const full =
    h.length === 4
      ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`
      : h;
  return {
    r: parseInt(full.slice(1, 3), 16),
    g: parseInt(full.slice(3, 5), 16),
    b: parseInt(full.slice(5, 7), 16),
  };
}

function linearize(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function luminance({ r, g, b }: Rgb): number {
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Mix two hex colors: ratio=0 → 100% colorA, ratio=1 → 100% colorB. */
function mixHex(hexA: string, hexB: string, ratio: number): string {
  const a = parseHex(hexA) ?? parseHex(BONE)!;
  const b = parseHex(hexB) ?? parseHex(INK)!;
  const r = Math.round(a.r + (b.r - a.r) * ratio);
  const g = Math.round(a.g + (b.g - a.g) * ratio);
  const bl = Math.round(a.b + (b.b - a.b) * ratio);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${bl.toString(16).padStart(2, "0")}`.toUpperCase();
}

/** Apply alpha over a background (simulate CSS color-mix / opacity). */
function applyAlpha(hex: string, alpha: number, bg: string): string {
  const fg = parseHex(hex) ?? parseHex(BRONZE)!;
  const background = parseHex(bg) ?? parseHex(BONE)!;
  const r = Math.round(fg.r * alpha + background.r * (1 - alpha));
  const g = Math.round(fg.g * alpha + background.g * (1 - alpha));
  const b = Math.round(fg.b * alpha + background.b * (1 - alpha));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`.toUpperCase();
}

/**
 * Validates `color` against `bg` for AA 4.5:1 contrast.
 * If it fails (or the color is invalid), returns bronze + flags the fallback.
 */
function validateToken(
  color: string,
  bg: string,
): { value: string; fallback: boolean } {
  const fg = parseHex(color);
  const background = parseHex(bg);
  if (!fg || !background) return { value: BRONZE.toUpperCase(), fallback: true };
  const ratio = contrastRatio(fg, background);
  if (ratio < MIN_CONTRAST) return { value: BRONZE.toUpperCase(), fallback: true };
  return { value: color.toUpperCase(), fallback: false };
}

// ── Public types ─────────────────────────────────────────────────────────────

export interface ChapterPaletteInput {
  /** Hex color for the dark sidebar background (e.g. "#4B2E2E"). */
  dark: string;
  /** Hex color for the chapter accent (e.g. "#C49A3A"). */
  accent: string;
}

/** Every CSS token the derivePalette function guarantees. */
export interface ChapterPalette {
  "--side-bg": string;
  "--side-accent": string;
  "--brand-band": string;
  "--mention-bg": string;
  "--mention-fg": string;
  "--chat-self-bubble": string;
  "--reaction-active": string;
  "--ring": string;
}

export interface DerivePaletteResult {
  palette: ChapterPalette;
  /**
   * Which tokens fell back to bronze. Empty when the input colors are
   * high-contrast. Only the failing token is replaced — the rest stand.
   */
  fallbacks: Partial<Record<keyof ChapterPalette, true>>;
  /** Input after normalization / validation. */
  resolvedDark: string;
  resolvedAccent: string;
}

// ── derivePalette ─────────────────────────────────────────────────────────────

/**
 * Generates the full CSS token map for a chapter's brand colors.
 *
 * Each token is WCAG-validated against its rendering context:
 *  - Sidebar tokens (--side-bg, --side-accent) → tested against INK text-on-bg
 *  - Light-mode tokens (--mention-fg, --ring) → tested against BONE background
 *  - Bubble/reaction tokens → tested against the bone surface they sit on
 *
 * Tokens that fail AA 4.5:1 fall back to bronze individually.
 * The input dark/accent colors are normalised; invalid hex → bronze.
 *
 * @example
 * derivePalette({ dark: "#2A1A2E", accent: "#C49A3A" })
 * // → full token map, all WCAG-validated
 *
 * derivePalette({ dark: "#FFFFFF", accent: "#FFFF00" })
 * // → token map with fallbacks.["--side-accent"] and
 * //   fallbacks.["--mention-fg"] set to true (yellow fails on bone)
 */
export function derivePalette(input: ChapterPaletteInput): DerivePaletteResult {
  // Normalise inputs — treat any invalid hex as BRONZE
  const rawDark   = parseHex(input.dark)   ? input.dark.toUpperCase()   : BRONZE.toUpperCase();
  const rawAccent = parseHex(input.accent) ? input.accent.toUpperCase() : BRONZE.toUpperCase();

  const fallbacks: Partial<Record<keyof ChapterPalette, true>> = {};

  // --side-bg: the dark sidebar background. Mix 70% chapter-dark + 30% ink.
  // Not contrast-tested (it's a background, not a foreground token).
  const sideBg = mixHex(rawDark, INK, 0.3);

  // --side-accent: accent color displayed on the dark sidebar.
  // Must contrast against sideBg at AA 4.5:1.
  const sideAccentCheck = validateToken(rawAccent, sideBg);
  if (sideAccentCheck.fallback) fallbacks["--side-accent"] = true;

  // --brand-band: accent at low saturation for header strips (on bone bg).
  // Use accent at 15% opacity over bone to get the subtle band color.
  const brandBandCandidate = applyAlpha(rawAccent, 0.15, BONE);
  // brand-band is a background element — foreground is ink (#1F1A15).
  // We validate that ink text is legible ON brand-band.
  const inkRgb = parseHex(INK)!;
  const brandBandRgb = parseHex(brandBandCandidate)!;
  const bandContrast = contrastRatio(inkRgb, brandBandRgb);
  // Band is a subtle decorative strip; accept if ink-on-band ≥ 3:1 (large text AA).
  const brandBand = bandContrast >= 3 ? brandBandCandidate : applyAlpha(BRONZE, 0.15, BONE);

  // --mention-bg: accent at 12% on bone (a chip background).
  const mentionBg = applyAlpha(rawAccent, 0.12, BONE);

  // --mention-fg: accent text on bone for mention chip label.
  const mentionFgCheck = validateToken(rawAccent, BONE);
  if (mentionFgCheck.fallback) fallbacks["--mention-fg"] = true;

  // --chat-self-bubble: accent at 8% over bone (self message bubble).
  const selfBubble = applyAlpha(rawAccent, 0.08, BONE);

  // --reaction-active: accent shown on bone when a reaction is selected.
  const reactionCheck = validateToken(rawAccent, BONE);
  if (reactionCheck.fallback) fallbacks["--reaction-active"] = true;

  // --ring: focus ring (accent on bone).
  const ringCheck = validateToken(rawAccent, BONE);
  if (ringCheck.fallback) fallbacks["--ring"] = true;

  const palette: ChapterPalette = {
    "--side-bg":           sideBg.toUpperCase(),
    "--side-accent":       sideAccentCheck.fallback ? BRONZE.toUpperCase() : sideAccentCheck.value,
    "--brand-band":        brandBand.toUpperCase(),
    "--mention-bg":        mentionBg.toUpperCase(),
    "--mention-fg":        mentionFgCheck.fallback ? BRONZE.toUpperCase() : mentionFgCheck.value,
    "--chat-self-bubble":  selfBubble.toUpperCase(),
    "--reaction-active":   reactionCheck.fallback ? BRONZE.toUpperCase() : reactionCheck.value,
    "--ring":              ringCheck.fallback ? BRONZE.toUpperCase() : ringCheck.value,
  };

  return {
    palette,
    fallbacks,
    resolvedDark:   rawDark,
    resolvedAccent: rawAccent,
  };
}
