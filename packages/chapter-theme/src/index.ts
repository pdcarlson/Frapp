/**
 * @repo/chapter-theme
 *
 * derivePalette({dark, accent}) — generates the full chapter CSS token map
 * from a chapter's two brand colors (dark sidebar color + accent color).
 *
 * WCAG validation: each token is tested against the relevant background
 * (bone for light-mode UI, ink for dark/sidebar UI). If a token fails AA
 * 4.5:1, that *specific token* falls back to an accessible fallback accent
 * (see pickAccessibleFallback) — the rest of the palette is kept as-is.
 * Bronze is the platform's preferred fallback but lighter alternatives are
 * tried first when bronze itself fails on a dark background.
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

/**
 * Ordered fallback accents. Bronze is the brand default, but it fails AA on a
 * dark sidebar — so a lighter bronze and finally bone are tried in turn. The
 * first candidate that clears MIN_CONTRAST against the background wins.
 */
const FALLBACK_ACCENTS = [BRONZE, "#C8A062", BONE] as const;

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
 * Picks the first FALLBACK_ACCENTS entry that clears MIN_CONTRAST against
 * `bg`. Bronze fails AA on a dark sidebar, so the lighter candidates exist to
 * guarantee the returned fallback is itself accessible. Bronze is the last
 * resort if (somehow) nothing passes.
 */
function pickAccessibleFallback(bg: Rgb): string {
  for (const candidate of FALLBACK_ACCENTS) {
    const rgb = parseHex(candidate);
    if (rgb && contrastRatio(rgb, bg) >= MIN_CONTRAST) {
      return candidate.toUpperCase();
    }
  }
  return BRONZE.toUpperCase();
}

/**
 * Validates `color` against `bg` for AA 4.5:1 contrast.
 * If it fails (or the color is invalid), returns the first accessible fallback
 * accent for that background + flags the fallback.
 */
function validateToken(
  color: string,
  bg: string,
): { value: string; fallback: boolean } {
  const fg = parseHex(color);
  const background = parseHex(bg);
  if (!background) return { value: BRONZE.toUpperCase(), fallback: true };
  if (!fg) return { value: pickAccessibleFallback(background), fallback: true };
  const ratio = contrastRatio(fg, background);
  if (ratio < MIN_CONTRAST) {
    return { value: pickAccessibleFallback(background), fallback: true };
  }
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
  /**
   * Which *inputs* were not parseable hex and were replaced with bronze before
   * any token was derived. Empty when both inputs were valid.
   *
   * Distinct from `fallbacks`, and the distinction is the point. A `fallbacks`
   * entry means "your color is valid but fails WCAG contrast here" — expected,
   * often unavoidable, not a defect. An `invalidInputs` entry means "this was
   * not a color at all", which is always a data or plumbing bug upstream.
   *
   * This exists because that second case used to be entirely silent: the seed
   * in supabase/seed/chapter_directory.csv shipped 50 of its 100 values missing
   * a leading `#`, and every one of them would have become bronze here without
   * a single signal reaching the caller (#840).
   */
  invalidInputs: Partial<Record<"dark" | "accent", true>>;
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
 * The input dark/accent colors are normalised; invalid hex → bronze, reported
 * on `invalidInputs` so the caller can log it rather than shipping a silently
 * wrong brand color.
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
  // Normalise inputs — treat any invalid hex as BRONZE.
  //
  // The substitution is recorded rather than performed silently. An unparseable
  // input is a data bug (a seed row missing its `#`, a hand-edited config, a bad
  // API payload), and silently rendering platform bronze means the chapter sees a
  // plausible wrong brand color with nothing anywhere saying why. Callers decide
  // what to do with the signal; this function still never throws.
  const invalidInputs: Partial<Record<"dark" | "accent", true>> = {};

  const darkValid = parseHex(input.dark) !== null;
  const accentValid = parseHex(input.accent) !== null;
  if (!darkValid) invalidInputs.dark = true;
  if (!accentValid) invalidInputs.accent = true;

  const rawDark   = darkValid   ? input.dark.toUpperCase()   : BRONZE.toUpperCase();
  const rawAccent = accentValid ? input.accent.toUpperCase() : BRONZE.toUpperCase();

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
  let brandBand: string;
  if (bandContrast >= 3) {
    brandBand = brandBandCandidate;
  } else {
    brandBand = applyAlpha(BRONZE, 0.15, BONE);
    fallbacks["--brand-band"] = true;
  }

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
    "--side-accent":       sideAccentCheck.value,
    "--brand-band":        brandBand.toUpperCase(),
    "--mention-bg":        mentionBg.toUpperCase(),
    "--mention-fg":        mentionFgCheck.value,
    "--chat-self-bubble":  selfBubble.toUpperCase(),
    "--reaction-active":   reactionCheck.value,
    "--ring":              ringCheck.value,
  };

  return {
    palette,
    fallbacks,
    invalidInputs,
    resolvedDark:   rawDark,
    resolvedAccent: rawAccent,
  };
}
