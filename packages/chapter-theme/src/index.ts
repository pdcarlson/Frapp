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
 * No window.* or DOM dependencies — this runs inside the NestJS API, which is
 * where both callers live (chapter onboarding and chapter-config recompute).
 */

import {
  applyAlpha,
  contrastRatio,
  mixHex,
  parseHex,
  pickAccessibleColor,
  type Rgb,
} from "@repo/color";

// The Signet accent engine. Additive: `derivePalette` below still generates the
// legacy web token map, and both are written to `chapters.theme_palette` until
// `apps/web` reskins. See spec/ui/design-system/accent-engine.md §6.
export {
  deriveSignetPalette,
  HOUSE_SEED,
  type DeriveSignetPaletteResult,
  type SignetContrastCheck,
  type SignetPalette,
} from "./signet.js";

// ── Constants ────────────────────────────────────────────────────────────────

/** Bone: the main light-mode background. ~hsl(37 33% 96%) */
const BONE = "#F7F3EC";

/** Ink: the darkest neutral, used for sidebar backgrounds. */
const INK = "#1F1A15";

/** Bronze: the platform fallback accent. Mirrors `@repo/theme`'s `brand.bronze`. */
const BRONZE = "#7A5A2F";

const MIN_CONTRAST = 4.5; // WCAG AA normal text

/**
 * Ordered fallback accents. Bronze is the brand default, but it fails AA on a
 * dark sidebar — so a lighter bronze and finally bone are tried in turn. The
 * first candidate that clears MIN_CONTRAST against the background wins.
 */
const FALLBACK_ACCENTS = [BRONZE, "#C8A062", BONE] as const;

// ── WCAG math ────────────────────────────────────────────────────────────────
//
// Shared with `packages/theme` via `@repo/color` (#797). It used to be inlined
// here to avoid reaching into theme's private helpers; the helpers are now their
// own zero-dependency package, so both callers agree by construction instead of
// by coincidence. Note this side compares the EXACT ratio — theme's resolver
// rounds first, and that difference is deliberate: these values are persisted to
// `chapters.theme_palette`, so they must not drift with a display convention.

/**
 * Picks the first FALLBACK_ACCENTS entry that clears MIN_CONTRAST against
 * `bg`. Bronze fails AA on a dark sidebar, so the lighter candidates exist to
 * guarantee the returned fallback is itself accessible. Bronze is the last
 * resort if nothing passes — reachable on a mid-tone background, where neither
 * a dark nor a light candidate clears 4.5:1.
 */
function pickAccessibleFallback(bg: Rgb): string {
  return (
    pickAccessibleColor(FALLBACK_ACCENTS, bg, { minimum: MIN_CONTRAST }) ??
    BRONZE.toUpperCase()
  );
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
