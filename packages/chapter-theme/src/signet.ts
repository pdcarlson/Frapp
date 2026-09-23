/**
 * deriveSignetPalette — one chapter seed hex to the Signet accent role tokens.
 *
 * Implements `spec/ui/design-system/accent-engine.md`: the generator call in §1
 * with its parameters fixed, the role map in §2, the house default seed in §3,
 * and the by-construction contrast guarantees in §8 — AA on the text roles, and
 * 3:1 for the `accent-primary` fill and its `accent-hover` shade on every
 * ladder surface (#2541, #2586).
 *
 * The only chapter accent engine. It superseded the legacy two-colour
 * `derivePalette` map, which the #920 slice-9 cutover deleted once every
 * surface had stopped reading it.
 *
 * Its output is persisted to `chapters.theme_palette` by `buildChapterPalette`
 * (`apps/api/src/application/services/chapter-palette.ts`) and produced for
 * **every** chapter, including one that supplied no colours — §3 defines the
 * no-accent case as the house seed run through this same pipeline, not as an
 * absent palette. Rows written before this map existed carry none of these keys
 * and render the house defaults until a save or recompute refreshes them
 * (the backfill is tracked separately).
 *
 * DOM-free and CommonJS-safe, because the NestJS API calls it.
 */

import {
  AA_LARGE,
  AA_NORMAL,
  contrastRatio,
  normalizeHex,
  parseHex,
} from "@repo/color";
import Color from "colorjs.io";

import type { SignetPalette } from "./accent-vars.js";
import { generateRadixColors } from "./vendor/generate-radix-colors.js";

// Re-exported from its original home so consumers need not know it moved.
export type { SignetPalette };

/**
 * The Signet neutral ladder (foundations.md §2), darkest to lightest: every
 * surface `accent-primary` and its hover shade paint on, and so what the §8
 * fill floor is measured against. Restated here rather than imported from
 * `@repo/theme`, which depends on this package, not the reverse;
 * `packages/theme/src/signet.css.spec.ts`
 * fails if it stops matching `signetDarkTokens` and `signet.css`, since a lift
 * measured against a stale ladder would clear 3:1 on surfaces that no longer
 * ship. `--background` is also the generator's `background` parameter.
 */
export const SIGNET_FILL_SURFACES = {
  "--background": "#131211",
  "--surface-1": "#1A1A1A",
  "--card": "#211E1A",
  "--popover": "#2A2621",
} as const;

/**
 * Fixed for every chapter — only `accent` varies. `gray` and `background` are
 * the neutral-ladder constants from `spec/ui/design-system/foundations.md`;
 * `appearance` is always dark because Signet is dark-first.
 */
const GENERATOR_PARAMS = {
  appearance: "dark",
  gray: "#191919",
  background: SIGNET_FILL_SURFACES["--background"],
} as const;

/** The house default seed (accent-engine.md §3). Not a separate palette — it runs the same pipeline. */
export const HOUSE_SEED = "#DDB844";

/** WCAG AA for normal text, the floor the accent-derived text roles must clear. */
const MIN_TEXT_CONTRAST = AA_NORMAL;

/**
 * WCAG 1.4.11 non-text contrast, the floor the `accent-primary` fill and its
 * `accent-hover` shade must clear (accent-engine.md §8). The fill is the only
 * cue for a state in several consumers — the switch track, the active tab
 * underline, the focus ring border, poll selection — so a legible label on a
 * button is not enough. Hover is held too because pointing at a filled control
 * swaps its fill for the hover shade while the state still has to read: the
 * voted poll option is a `default` Button, whose hover is `accent-hover`.
 */
const MIN_FILL_CONTRAST = AA_LARGE;

/**
 * How far one lift step raises the failing fill's OKLCH lightness. Small enough that the
 * lift stops within one step of the smallest one `scaleClears` accepts, which
 * keeps the brand shift to the minimum §8 requires. Where that minimum lands
 * is `scaleClears`' doing, not this step's: for the corpus's dark seeds it is
 * the label check, which leaves the fill near 3.8:1 on `--popover`.
 */
const LIFT_STEP = 0.002;

/** Fine steps per coarse step in the lift search (see `liftAccent`). */
const LIFT_COARSE = 10;

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

/**
 * The fills the §8 floor holds: the resting fill, and the hover shade that
 * replaces it under a pointer. Pressed is not one of them. It is hover with 8%
 * black (`--primary-pressed` in `packages/theme/src/signet.css`), shown only
 * while the pointer is down, and §8 says why it is left under the floor.
 */
const FLOORED_FILLS = [
  "--signet-accent-primary",
  "--signet-accent-hover",
] as const;

/** The two floored fills of one generation, or of one palette. */
export type SignetFills = Pick<SignetPalette, (typeof FLOORED_FILLS)[number]>;

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
   * substituted. Always an upstream data or plumbing bug, never an expected
   * outcome — an absent seed is normal and does not set this.
   */
  invalidSeed: boolean;
  /**
   * The §8 fill gate: `accent-primary`, then `accent-hover`, against each
   * ladder surface at 3:1.
   *
   * Kept apart from `contrastChecks` on purpose: that list is the text-role
   * gate at 4.5:1, which the API reports as `failedContrastChecks` and the
   * Settings page describes check by check. The fill is held by construction,
   * so a failure here, like one there, means the generator changed under us,
   * and the API logs it the same way (`logChapterPaletteWarnings`).
   */
  fillChecks: SignetContrastCheck[];
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
 * case — `#C9A56F` is the accent of 45 of the 50 chapters in
 * `supabase/seed/chapter_directory.csv`.
 *
 * Substituting the better of black and white makes the guarantee hold for every
 * possible seed rather than most of them. It cannot itself fail: the two curves
 * cross at luminance ≈0.179, where both score ≈4.58:1, so the better of the pair
 * is always ≥4.5:1 for any color. The generator's own choice is kept whenever it
 * is legible, which is the common case and kept for the house seed (`#292109`).
 */
function onPrimaryFor(generatedContrast: string, primary: string): string {
  if (ratio(generatedContrast, primary) >= MIN_TEXT_CONTRAST) {
    return generatedContrast;
  }
  return ratio("#000000", primary) >= ratio("#FFFFFF", primary)
    ? "#000000"
    : "#FFFFFF";
}

export type Generated = ReturnType<typeof generateRadixColors>;

function generate(accent: string): Generated {
  return generateRadixColors({ ...GENERATOR_PARAMS, accent });
}

/**
 * The step-9 fill and step-10 hover the generator actually produced, which is
 * what paints. Either can differ from the colour the generator was handed.
 */
function generatedFills(generated: Generated): SignetFills {
  const at = (role: SignetRole) =>
    normalizeHex(generated.accentScale[ROLE_STEPS[role] - 1] ?? "");
  return {
    "--signet-accent-primary": at("accent-primary"),
    "--signet-accent-hover": at("accent-hover"),
  };
}

/**
 * The §8 fill floor for a fill and its hover shade: each one's ratio on each
 * ladder surface and whether that clears 3:1, the fill's four checks first.
 * `deriveSignetPalette` reports it as `fillChecks`, and the lift judges every
 * candidate by it, so the two cannot disagree.
 */
export function signetFillChecks(fills: SignetFills): SignetContrastCheck[] {
  return FLOORED_FILLS.flatMap((role) =>
    Object.entries(SIGNET_FILL_SURFACES).map(([name, surface]) => {
      const fillRatio = ratio(fills[role], surface);
      return {
        role,
        against: name,
        ratio: fillRatio,
        passes: fillRatio >= MIN_FILL_CONTRAST,
      };
    }),
  );
}

/** The label the engine puts on a generation's fill: its `on-primary`. */
function onPrimaryOf(generated: Generated): string {
  return onPrimaryFor(
    normalizeHex(generated.accentContrast ?? ""),
    generatedFills(generated)["--signet-accent-primary"],
  );
}

/**
 * Whether one generation meets everything the lift is for (accent-engine.md
 * §8): its fill and hover clear 3:1 on every ladder surface, and its label
 * clears 4.5:1 on the hover shade as well as on the fill, since the label does
 * not change when the pointer does.
 *
 * The label check is what sets how far a dark seed moves. The generator makes
 * hover darker than a fill this light, by about a fifth in luminance, so no
 * label clears 4.5:1 on both at the lift where hover first reaches 3:1: white
 * fails on the fill, and black on the hover. The lift runs on until black
 * clears the hover too. It can also start a lift on its own, for a mid-tone
 * whose fill and hover already clear 3:1 but whose black label misses 4.5:1 on
 * the hover (`#9966CC` moves to `#9D6AD0`); those shifts are small.
 *
 * Exported only so `signet.spec.ts` can judge a candidate by the same measure
 * the lift does.
 */
export function scaleClears(generated: Generated): boolean {
  const fills = generatedFills(generated);
  return (
    signetFillChecks(fills).every((check) => check.passes) &&
    ratio(onPrimaryOf(generated), fills["--signet-accent-hover"]) >=
      MIN_TEXT_CONTRAST
  );
}

/**
 * `fill` with its OKLCH lightness raised by `steps` lift steps, hue and chroma
 * kept, gamut-mapped into sRGB (CSS Color 4 mapping, which gives up chroma
 * before lightness or hue) and returned as 6-digit hex.
 */
function liftedAt(fill: string, steps: number): string {
  const [l, c, h] = new Color(fill).to("oklch").coords;
  const lifted = new Color("oklch", [
    Math.min(1, (l ?? 0) + steps * LIFT_STEP),
    c ?? 0,
    h ?? Number.NaN,
  ]);
  return normalizeHex(
    lifted.toGamut({ space: "srgb" }).to("srgb").toString({ format: "hex" }),
  );
}

/**
 * Lifts a generated fill until the scale the generator produces from the
 * lifted colour clears `scaleClears`: fill and hover at 3:1 on every ladder
 * surface, and the label legible on both (accent-engine.md §8).
 *
 * The lift starts from the fill the seed produced, not from the seed. The two
 * are the same colour for most seeds, since the generator returns the seed as
 * step 9. They differ when the seed sits close to the dark step 1: then
 * `getStep9Colors` swaps in the scale's own step 9 (`#4B0082` paints
 * `#901FED`), and lifting the seed instead would walk it out of that swap and
 * trade the vivid fill the chapter already sees for a duller one. Lifting the
 * fill keeps the hue and chroma that were painting and changes only lightness.
 *
 * Every candidate is still judged by the **generated** steps 9 and 10, not by
 * the lifted input: the same swap can apply to the lifted colour, and hover
 * exists only as the generator derives it.
 *
 * The generator costs a few milliseconds a call and a deep crimson needs over
 * a hundred fine steps, so the search walks coarse steps of `LIFT_COARSE` fine
 * steps to the first one that clears, then walks back through that last
 * interval one fine step at a time. It returns the smallest clearing lift on
 * the fine grid, except that a clearing window narrower than one coarse step
 * that is followed by failures could be skipped; that costs a slightly larger
 * lift, never a failing scale. Returns `null` if even full lightness never
 * clears, which no sRGB seed reaches: a white fill clears the ladder at 15:1,
 * and its hover, `#F6F6F6`, takes a black label at over 18:1.
 *
 * `generateFrom` is the generator, a parameter only so `signet.spec.ts` can
 * hand it one that swaps step 9 or step 10 and prove a candidate is judged by
 * what paints.
 */
export function liftAccent(
  fill: string,
  generateFrom: (accent: string) => Generated = generate,
): { accent: string; generated: Generated } | null {
  const maxSteps = Math.ceil(1 / LIFT_STEP);
  let previous = 0;
  for (let coarse = LIFT_COARSE; ; coarse += LIFT_COARSE) {
    const steps = Math.min(coarse, maxSteps);
    const accent = liftedAt(fill, steps);
    const generated = generateFrom(accent);
    if (scaleClears(generated)) {
      for (let fine = previous + 1; fine < steps; fine += 1) {
        const fineAccent = liftedAt(fill, fine);
        const fineGenerated = generateFrom(fineAccent);
        if (scaleClears(fineGenerated)) {
          return { accent: fineAccent, generated: fineGenerated };
        }
      }
      return { accent, generated };
    }
    if (steps >= maxSteps) return null;
    previous = steps;
  }
}

/**
 * Generates the Signet accent role tokens for one chapter seed.
 *
 * **Never throws.** That is load-bearing rather than stylistic: every API
 * writer calls it bare, and onboarding calls it before the chapter row exists,
 * so a throw here fails chapter creation outright
 * (`apps/api/src/application/services/chapter-palette.ts` records the call
 * sites). An unusable seed therefore falls back to the house seed and says so
 * on `invalidSeed`, and the fill lift only ever converts a normalized hex.
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

  // §8 fill floor: derive as the seed asks, and only when that scale fails
  // `scaleClears` (its fill or hover under 3:1 on the ladder, or its label
  // under 4.5:1 on hover), re-run the generator with the fill lightened as its
  // accent, so hover, the alpha steps and on-primary all derive from the fill
  // that actually paints.
  let generated = generate(resolvedSeed);
  let generatorAccent = resolvedSeed;
  const seedFill = generatedFills(generated)["--signet-accent-primary"];
  // `seedFill` is empty only if the generator returned no step 9, which it never
  // does; the guard keeps an unparseable colour out of `liftAccent` regardless,
  // since this function must not throw.
  if (seedFill && !scaleClears(generated)) {
    const lift = liftAccent(seedFill);
    if (lift) {
      generated = lift.generated;
      generatorAccent = lift.accent;
    }
  }

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
    normalizeHex(hex ?? "") || generatorAccent;
  const step = (role: SignetRole): string =>
    solidValue(solid[ROLE_STEPS[role] - 1]);
  const alphaStep = (role: SignetRole): string =>
    (alpha[ROLE_STEPS[role] - 1] ?? generatorAccent).toUpperCase();

  const primary = step("accent-primary");

  const palette: SignetPalette = {
    "--signet-accent-primary": primary,
    "--signet-accent-hover": step("accent-hover"),
    "--signet-accent-ring": step("accent-ring"),
    "--signet-accent-subtle-bg": step("accent-subtle-bg"),
    "--signet-accent-border": step("accent-border"),
    "--signet-accent-text": step("accent-text"),
    // The label the lift judged, so the two cannot disagree.
    "--signet-accent-on-primary": onPrimaryOf(generated),
    "--signet-accent-primary-alpha": alphaStep("accent-primary"),
    "--signet-accent-hover-alpha": alphaStep("accent-hover"),
    "--signet-accent-ring-alpha": alphaStep("accent-ring"),
    "--signet-accent-subtle-bg-alpha": alphaStep("accent-subtle-bg"),
    "--signet-accent-border-alpha": alphaStep("accent-border"),
    "--signet-accent-text-alpha": alphaStep("accent-text"),
  };

  // §8: accent-derived TEXT roles must clear AA on the surfaces they are
  // specified for. Only text is held to 4.5:1 here; the 3:1 floor on the fill
  // and its hover is `fillChecks` below, and the tinted-background and border
  // roles are held to no ratio.
  const contrastChecks: SignetContrastCheck[] = [
    {
      role: "--signet-accent-text",
      against: GENERATOR_PARAMS.background,
      ratio: ratio(
        palette["--signet-accent-text"],
        GENERATOR_PARAMS.background,
      ),
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
    // The same label on the hover shade, which is what it sits on while the
    // pointer is over a primary button (#2586).
    {
      role: "--signet-accent-on-primary",
      against: "--signet-accent-hover",
      ratio: ratio(
        palette["--signet-accent-on-primary"],
        palette["--signet-accent-hover"],
      ),
      passes: false,
    },
  ].map((check) => ({ ...check, passes: check.ratio >= MIN_TEXT_CONTRAST }));

  const fillChecks = signetFillChecks(palette);

  return {
    palette,
    resolvedSeed,
    invalidSeed,
    fillChecks,
    contrastChecks,
  };
}

/**
 * The role → semantic-name bridge lives in `./accent-vars.ts`, which has no
 * runtime dependency on this file: browsers import it directly rather than
 * pulling the generator and `colorjs.io` into a bundle to rename seven keys.
 * Re-exported here so server callers keep one import.
 */
export { signetAccentSemanticVars } from "./accent-vars.js";
