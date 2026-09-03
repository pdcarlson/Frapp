/**
 * @repo/color — the one implementation of WCAG contrast math in this repo.
 *
 * Three copies of this arithmetic used to exist: `packages/theme/src/accent.ts`,
 * `packages/chapter-theme/src/index.ts` (which inlined it deliberately, to avoid
 * importing theme's private helpers), and a copy in the API. The first two now
 * import from here (#797). The API's copy was deleted as dead code once the
 * contrast gate moved into `@repo/chapter-theme`'s `deriveSignetPalette`, so
 * this is now the only implementation, with no second copy to keep in agreement.
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
 * pass — 9,074 hex colors sit in that band against white, `#006FFB` among them.
 * Those accents render today on the web dashboard and in the mobile app, and
 * chapters choose arbitrary accents in Settings, so silently tightening the
 * comparison would repaint live chapters. Callers opt in via
 * {@link meetsContrast}'s `round` option; see {@link roundRatio}.
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
   * `packages/theme`'s accent resolver passes `true` to preserve its long-standing
   * behavior; `packages/chapter-theme` leaves it `false` because its output is
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
 * copy of this math for that reason; that copy is gone, because the contrast gate
 * it served moved into `@repo/chapter-theme`'s `deriveSignetPalette` and the API
 * no longer computes contrast at all. The build-order constraint above still
 * applies to any future direct import from `apps/api`.
 */
