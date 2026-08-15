/**
 * deriveSignetPalette — one chapter seed hex to the Signet accent role tokens.
 *
 * Implements `spec/ui/design-system/accent-engine.md`: the generator call in §1
 * with its parameters fixed, the role map in §2, the house default seed in §3,
 * and the by-construction contrast guarantee in §8.
 *
 * Coexists with `derivePalette` rather than replacing it. That one still feeds
 * the legacy web token map that `apps/web` reads from `chapters.theme_palette`.
 * Nothing persists the Signet map yet — no API caller invokes this function; it
 * is the engine, ready for the mobile rebuild and the recompute endpoint to
 * call. `accent-engine.md` §6 tracks that remaining wiring.
 *
 * DOM-free and CommonJS-safe, because the NestJS API calls it.
 */

import { contrastRatio, normalizeHex, parseHex } from "@repo/color";

import { generateRadixColors } from "./vendor/generate-radix-colors.js";

/**
 * Fixed for every chapter — only `accent` varies. `gray` and `background` are
 * the neutral-ladder constants from `spec/ui/design-system/foundations.md`;
 * `appearance` is always dark because Signet is dark-first.
 */
const GENERATOR_PARAMS = {
  appearance: "dark",
  gray: "#191919",
  background: "#0E0D0B",
} as const;

/** The house default seed (accent-engine.md §3). Not a separate palette — it runs the same pipeline. */
export const HOUSE_SEED = "#F2B72E";

/** WCAG AA for normal text, the floor the accent-derived text roles must clear. */
const MIN_TEXT_CONTRAST = 4.5;

/**
 * The role map (accent-engine.md §2). Components consume roles, never steps, so
 * these names — not scale indices — are what gets persisted and painted.
 *
 * Indices are zero-based into the 12-step scale, hence step N is `N - 1`.
 */
const ROLE_STEPS = {
  "accent-primary": 9,
  "accent-hover": 10,
  "accent-ring": 8,
  "accent-subtle-bg": 3,
  "accent-border": 7,
  "accent-text": 11,
} as const;

type SignetRole = keyof typeof ROLE_STEPS;

/** Every token `deriveSignetPalette` guarantees, as CSS custom properties. */
export interface SignetPalette {
  "--signet-accent-primary": string;
  "--signet-accent-hover": string;
  "--signet-accent-ring": string;
  "--signet-accent-subtle-bg": string;
  "--signet-accent-border": string;
  "--signet-accent-text": string;
  /** The generator's contrast color — text and icons on `accent-primary`. */
  "--signet-accent-on-primary": string;
  /** Translucent counterparts; alpha steps map 1:1 to their solid steps (§2). */
  "--signet-accent-primary-alpha": string;
  "--signet-accent-hover-alpha": string;
  "--signet-accent-ring-alpha": string;
  "--signet-accent-subtle-bg-alpha": string;
  "--signet-accent-border-alpha": string;
  "--signet-accent-text-alpha": string;
}

export interface SignetContrastCheck {
  /** The role whose contrast was measured. */
  role: string;
  /** What it was measured against. */
  against: string;
  ratio: number;
  passes: boolean;
}

export interface DeriveSignetPaletteResult {
  palette: SignetPalette;
  /** The seed actually used, after normalization and any substitution. */
  resolvedSeed: string;
  /**
   * Set when the requested seed was not a parseable hex and the house seed was
   * substituted. Same distinction `derivePalette` draws: this is always an
   * upstream data or plumbing bug, never an expected outcome.
   */
  invalidSeed: boolean;
  /**
   * The §8 gate, evaluated at generation time rather than asserted.
   *
   * The engine is supposed to guarantee these by construction, so a failure
   * means the generator's behavior changed under us — realistically a dependency
   * upgrade. Reported rather than thrown for the reason in the function doc.
   */
  contrastChecks: SignetContrastCheck[];
}

function ratio(foreground: string, background: string): number {
  const fg = parseHex(foreground);
  const bg = parseHex(background);
  if (!fg || !bg) return 0;
  return contrastRatio(fg, bg);
}

/**
 * The generator's contrast color, or black/white when its choice is illegible.
 *
 * accent-engine.md §8 promises `on-primary` is legible on `accent-primary` "by
 * construction". The generator does not actually deliver that for light seeds in
 * dark appearance: it returns `#FFFFFF` for `#C9A56F` (2.31:1) and `#FF69B4`
 * (2.65:1), where black would have scored 9.10 and 7.93. That is not a corner
 * case — `#C9A56F` is 45 of the 100 color values in
 * `supabase/seed/chapter_directory.csv`.
 *
 * Substituting the better of black and white makes the guarantee hold for every
 * possible seed rather than most of them. It cannot itself fail: the two curves
 * cross at luminance ≈0.179, where both score ≈4.58:1, so the better of the pair
 * is always ≥4.5:1 for any color. The generator's own choice is kept whenever it
 * is legible, which is the common case and kept for the house seed (`#2B2009`).
 */
function onPrimaryFor(generatedContrast: string, primary: string): string {
  if (ratio(generatedContrast, primary) >= MIN_TEXT_CONTRAST) {
    return generatedContrast;
  }
  return ratio("#000000", primary) >= ratio("#FFFFFF", primary)
    ? "#000000"
    : "#FFFFFF";
}

/**
 * Generates the Signet accent role tokens for one chapter seed.
 *
 * **Never throws**, matching `derivePalette`. That is load-bearing rather than
 * stylistic: `ChapterOnboardingService.buildPalette` wraps its palette call in a
 * try/catch that returns `null`, so a throw here would not surface as an error —
 * it would silently onboard a chapter with no palette at all. An unusable seed
 * therefore falls back to the house seed and says so on `invalidSeed`.
 *
 * @example
 * deriveSignetPalette("#8B0000")   // crimson chapter
 * deriveSignetPalette()            // house gold
 */
export function deriveSignetPalette(
  seed?: string | null,
): DeriveSignetPaletteResult {
  // "No seed" and "not a color" both end at the house seed but mean different
  // things: a chapter that never picked an accent is the expected case, while an
  // unparseable value is always an upstream bug. Only the second sets the flag.
  const provided = (seed ?? "").trim();
  const normalized = normalizeHex(provided);
  const invalidSeed = provided !== "" && normalized === "";
  const resolvedSeed = normalized || HOUSE_SEED;

  const generated = generateRadixColors({
    ...GENERATOR_PARAMS,
    accent: resolvedSeed,
  });

  // The generator returns fourteen fields — wide-gamut variants, full gray and
  // surface scales, the background it was given. Signet consumes three of them;
  // the rest are deliberately dropped rather than persisted, since every key
  // here is written to every chapter row.
  const solid = generated.accentScale;
  const alpha = generated.accentScaleAlpha;

  // Solid steps go through normalizeHex, not toUpperCase: the generator emits
  // shorthand for some colors (`accentContrast` is `#fff` on a dark seed), and a
  // stored token that is sometimes 3-digit and sometimes 6-digit is a trap for
  // every consumer that slices it. Alpha steps are 8-digit `#RRGGBBAA`, which
  // normalizeHex rejects by design, so those are only uppercased.
  const solidValue = (hex: string | undefined): string =>
    normalizeHex(hex ?? "") || resolvedSeed;
  const step = (role: SignetRole): string => solidValue(solid[ROLE_STEPS[role] - 1]);
  const alphaStep = (role: SignetRole): string =>
    (alpha[ROLE_STEPS[role] - 1] ?? resolvedSeed).toUpperCase();

  const primary = step("accent-primary");

  const palette: SignetPalette = {
    "--signet-accent-primary": primary,
    "--signet-accent-hover": step("accent-hover"),
    "--signet-accent-ring": step("accent-ring"),
    "--signet-accent-subtle-bg": step("accent-subtle-bg"),
    "--signet-accent-border": step("accent-border"),
    "--signet-accent-text": step("accent-text"),
    "--signet-accent-on-primary": onPrimaryFor(
      solidValue(generated.accentContrast),
      primary,
    ),
    "--signet-accent-primary-alpha": alphaStep("accent-primary"),
    "--signet-accent-hover-alpha": alphaStep("accent-hover"),
    "--signet-accent-ring-alpha": alphaStep("accent-ring"),
    "--signet-accent-subtle-bg-alpha": alphaStep("accent-subtle-bg"),
    "--signet-accent-border-alpha": alphaStep("accent-border"),
    "--signet-accent-text-alpha": alphaStep("accent-text"),
  };

  // §8: accent-derived TEXT roles must clear AA on the surfaces they are
  // specified for. Only text is gated — the tinted-background and border roles
  // are not text and are not held to 4.5:1.
  const contrastChecks: SignetContrastCheck[] = [
    {
      role: "--signet-accent-text",
      against: GENERATOR_PARAMS.background,
      ratio: ratio(palette["--signet-accent-text"], GENERATOR_PARAMS.background),
      passes: false,
    },
    {
      role: "--signet-accent-text",
      against: "--signet-accent-subtle-bg",
      ratio: ratio(
        palette["--signet-accent-text"],
        palette["--signet-accent-subtle-bg"],
      ),
      passes: false,
    },
    {
      role: "--signet-accent-on-primary",
      against: "--signet-accent-primary",
      ratio: ratio(
        palette["--signet-accent-on-primary"],
        palette["--signet-accent-primary"],
      ),
      passes: false,
    },
  ].map((check) => ({ ...check, passes: check.ratio >= MIN_TEXT_CONTRAST }));

  return { palette, resolvedSeed, invalidSeed, contrastChecks };
}
