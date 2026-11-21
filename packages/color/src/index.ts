/**
 * @repo/color — the one implementation of WCAG contrast math in this repo.
 *
 * Three copies of this arithmetic used to exist: one in `@repo/theme`, one in
 * `@repo/chapter-theme` (which inlined it deliberately, to avoid importing
 * theme's private helpers), and one in the API. The first two now import from
 * here (#797) — the resolver now at
 * `apps/web/components/settings/resolve-chapter-accent.ts` (#3227 moved it out
 * of `@repo/theme`) and `packages/chapter-theme/src/signet.ts`. The API's copy was deleted as dead
 * code once the contrast gate moved into `deriveSignetPalette`, so this is now
 * the only implementation, with no second copy to keep in agreement.
 *
 * No DOM, no dependencies. The API is a CommonJS consumer, so this package does
 * not declare `"type": "module"` and its `dist` is CJS.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type Rgb = { r: number; g: number; b: number };

/** WCAG AA for normal-size text. */
export const AA_NORMAL = 4.5;
/** WCAG AA for large text, and the floor for non-text UI. */
export const AA_LARGE = 3;

const HEX_PATTERN = /^#([0-9A-F]{3}|[0-9A-F]{6})$/i;

// ── Parsing ──────────────────────────────────────────────────────────────────

/**
 * Expands to `#RRGGBB` uppercase, or returns `""` when the input is not a hex
 * color. Empty-string-on-failure rather than throwing: every caller here is on
 * a render or a save path where a bad color must degrade, not crash.
 */
export function normalizeHex(input: string): string {
  const hex = input.trim();

  if (!HEX_PATTERN.test(hex)) {
    return "";
  }

  if (hex.length === 4) {
    return `#${hex
      .slice(1)
      .split("")
      .map((character) => `${character}${character}`)
      .join("")
      .toUpperCase()}`;
  }

  return hex.toUpperCase();
}

/** `null` when the input is not a hex color — the parse-or-branch counterpart to {@link normalizeHex}. */
export function parseHex(input: string): Rgb | null {
  const normalized = normalizeHex(input);
  if (!normalized) return null;

  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

// ── Contrast ─────────────────────────────────────────────────────────────────

function linearize(channel: number): number {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/**
 * The WCAG contrast ratio, **exact** — never rounded.
 *
 * Rounding is a *comparison policy* belonging to the caller, not a property of
 * the math, and the distinction is load-bearing. `resolveChapterAccentColor`
 * has always compared a 2dp-rounded ratio, which lets a value in `[4.495, 4.5)`
 * pass — 9,074 hex colors sit in that band against white, `#006FFB` among them,
 * and a different 9,686 against Signet's greenfield dark card (`#211E1A`; the card
 * is `#171717` since 2026-11-05 and the count was not re-run). The second band
 * is the one that matters today: the web Settings accent preview, the
 * resolver's one remaining caller, measures against that card, and chapters
 * choose arbitrary accents there, so silently tightening the comparison would
 * flip that preview's verdict on accents chapters already use. Callers opt in
 * via {@link meetsContrast}'s `round` option; see {@link roundRatio}.
 */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const luminanceA = relativeLuminance(a);
  const luminanceB = relativeLuminance(b);
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Two-decimal rounding, matching what the accent resolver reports to callers. */
export function roundRatio(ratio: number): number {
  return Number.parseFloat(ratio.toFixed(2));
}

export type MeetsContrastOptions = {
  /** Threshold to clear. Defaults to {@link AA_NORMAL}. */
  minimum?: number;
  /**
   * Round to 2dp before comparing. Defaults to `false` (exact).
   * The web Settings accent resolver
   * (`apps/web/components/settings/resolve-chapter-accent.ts`) passes `true` to
   * preserve its long-standing behavior; `packages/chapter-theme` leaves it `false` because its output is
   * persisted to `chapters.theme_palette`.
   */
  round?: boolean;
};

export function meetsContrast(
  foreground: Rgb,
  background: Rgb,
  options?: MeetsContrastOptions,
): boolean {
  const minimum = options?.minimum ?? AA_NORMAL;
  const ratio = contrastRatio(foreground, background);
  return (options?.round ? roundRatio(ratio) : ratio) >= minimum;
}

/**
 * First candidate that clears `minimum` against `background`, or `null` when
 * none do.
 *
 * `null` rather than a built-in last resort, because there is no answer that is
 * right for every caller and the fallback is not always reachable-by-luck: a
 * mid-tone background (say `#767676`) fails against both ink and bone, so a
 * ladder anchored at the extremes can still run dry. Each caller names its own
 * last resort at the call site, where the consequence is visible.
 */
export function pickAccessibleColor(
  candidates: readonly string[],
  background: Rgb,
  options?: MeetsContrastOptions,
): string | null {
  for (const candidate of candidates) {
    const normalized = normalizeHex(candidate);
    if (!normalized) continue;

    const rgb = parseHex(normalized);
    if (rgb && meetsContrast(rgb, background, options)) {
      return normalized;
    }
  }

  return null;
}

// ── Mixing ───────────────────────────────────────────────────────────────────

/** Linear blend: `ratio` 0 returns `a`, 1 returns `b`. Unparseable inputs contribute black. */
export function mixHex(a: string, b: string, ratio: number): string {
  const from = parseHex(a) ?? { r: 0, g: 0, b: 0 };
  const to = parseHex(b) ?? { r: 0, g: 0, b: 0 };

  return toHex({
    r: Math.round(from.r + (to.r - from.r) * ratio),
    g: Math.round(from.g + (to.g - from.g) * ratio),
    b: Math.round(from.b + (to.b - from.b) * ratio),
  });
}

/** Flattens `hex` at `alpha` over an opaque `background` — what CSS would composite. */
export function applyAlpha(hex: string, alpha: number, background: string): string {
  const foreground = parseHex(hex) ?? { r: 0, g: 0, b: 0 };
  const base = parseHex(background) ?? { r: 0, g: 0, b: 0 };

  return toHex({
    r: Math.round(foreground.r * alpha + base.r * (1 - alpha)),
    g: Math.round(foreground.g * alpha + base.g * (1 - alpha)),
    b: Math.round(foreground.b * alpha + base.b * (1 - alpha)),
  });
}

// ── OKLCH ────────────────────────────────────────────────────────────────────

/**
 * A color in OKLCH: perceptual lightness `l` (0–1), chroma `c` (0 to about
 * 0.37) and hue `h` in degrees (0–360). Hue is the one people mean by "a
 * color": a role color picker moves along it while lightness is set for
 * contrast (#5784).
 */
export type Oklch = { l: number; c: number; h: number };

// sRGB's own transfer curve (IEC 61966-2-1), for the OKLab round trip.
// `linearize` above keeps WCAG 2's 0.03928 knee, which contrast is defined
// with; the two differ only for channel values below 11/255.
function srgbToLinear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(value: number): number {
  const encoded =
    value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
  return encoded * 255;
}

/** `null` when the input is not a hex color. Achromatic colors report hue 0. */
export function hexToOklch(input: string): Oklch | null {
  const rgb = parseHex(input);
  if (!rgb) return null;
  const r = srgbToLinear(rgb.r);
  const g = srgbToLinear(rgb.g);
  const b = srgbToLinear(rgb.b);
  // Björn Ottosson's OKLab matrices (linear sRGB → LMS → OKLab).
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bAxis = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const chroma = Math.hypot(a, bAxis);
  const hue =
    chroma < 1e-6 ? 0 : ((Math.atan2(bAxis, a) * 180) / Math.PI + 360) % 360;
  return { l: lightness, c: chroma, h: hue };
}

/** Linear sRGB channels for an OKLCH color, unclamped (out of gamut reads < 0 or > 1). */
function oklchToLinear({ l, c, h }: Oklch): [number, number, number] {
  const radians = (h * Math.PI) / 180;
  const a = c * Math.cos(radians);
  const b = c * Math.sin(radians);
  const lPrime = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mPrime = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sPrime = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * lPrime - 3.3077115913 * mPrime + 0.2309699292 * sPrime,
    -1.2684380046 * lPrime + 2.6097574011 * mPrime - 0.3413193965 * sPrime,
    -0.0041960863 * lPrime - 0.7034186147 * mPrime + 1.707614701 * sPrime,
  ];
}

function inGamut(channels: readonly number[]): boolean {
  const EPSILON = 1e-4;
  return channels.every((value) => value >= -EPSILON && value <= 1 + EPSILON);
}

/**
 * The `#RRGGBB` for an OKLCH color. A color sRGB can't show keeps its
 * lightness and hue and loses chroma until it fits (the CSS Color 4 approach,
 * without its perceptual tolerance), so the result is always the nearest
 * displayable color of that lightness and hue.
 */
export function oklchToHex(color: Oklch): string {
  const l = Math.max(0, Math.min(1, Number.isFinite(color.l) ? color.l : 0));
  const h = Number.isFinite(color.h) ? ((color.h % 360) + 360) % 360 : 0;
  let c = Math.max(0, Number.isFinite(color.c) ? color.c : 0);
  if (!inGamut(oklchToLinear({ l, c, h }))) {
    let low = 0;
    let high = c;
    for (let step = 0; step < 24; step += 1) {
      const mid = (low + high) / 2;
      if (inGamut(oklchToLinear({ l, c: mid, h }))) low = mid;
      else high = mid;
    }
    c = low;
  }
  const [r, g, b] = oklchToLinear({ l, c, h });
  return toHex({
    r: linearToSrgb(Math.max(0, Math.min(1, r))),
    g: linearToSrgb(Math.max(0, Math.min(1, g))),
    b: linearToSrgb(Math.max(0, Math.min(1, b))),
  });
}

function toHex({ r, g, b }: Rgb): string {
  const channel = (value: number) => {
    // Clamping alone is not enough: `Math.min(255, NaN)` is `NaN`, whose
    // `toString(16)` is `"nan"` — three characters, so `padStart(2)` leaves it
    // — and the function would return `#NANNANNAN`. That is not a color, no
    // caller can detect it, and the accent engine would write it straight into
    // `chapters.theme_palette` for the clients to set as a custom property,
    // where it silently resolves to nothing. A non-finite channel means the
    // caller passed a non-finite ratio or alpha; treat it as 0 rather than
    // emitting a string that only looks like a color.
    const safe = Number.isFinite(value) ? value : 0;
    return Math.round(Math.max(0, Math.min(255, safe)))
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(r)}${channel(g)}${channel(b)}`.toUpperCase();
}

/*
 * Why `apps/api` does not import this package directly.
 *
 * It would resolve through `exports.require` to `./dist/index.js`, which is
 * gitignored and only exists after a build, so `npm test -w apps/api` on a clean
 * clone would fail before anything had been built. The API used to keep its own
 * copy of this math for that reason; that copy is gone, because the gate it
 * served moved into `@repo/chapter-theme`'s `deriveSignetPalette`. The API still
 * *surfaces* contrast — `chapter-palette.ts` filters the `contrastChecks` that
 * `deriveSignetPalette` returns, and the chapter response carries
 * `failedContrastChecks` — but it no longer computes any of it, so there is no
 * API-side copy to keep in agreement with this file. The build-order constraint
 * above still applies to any future direct import from `apps/api`.
 */
