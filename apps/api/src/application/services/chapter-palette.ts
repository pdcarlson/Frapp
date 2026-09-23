import { deriveSignetPalette } from '@repo/chapter-theme';
import type { ChapterBranding } from '@repo/validation';

/**
 * The brand colors a chapter stores. `accent` is the accent engine's seed, and
 * it is the only one — the second colour (`dark`) existed solely to feed the
 * legacy web token map and went with it in the #920 slice-9 cutover.
 */
export type ChapterBrandColors = { accent?: string };

/**
 * The branding block a chapter submits at onboarding or through the config
 * PATCH, as the application layer reads it.
 *
 * Reused from `@repo/validation` rather than restated: `ChapterBrandingSchema`
 * is what web and mobile already parse `chapters.branding` with, so this binds
 * the two writers here to the same declaration the clients use. `NonNullable`
 * because that schema is `.optional()` at its use site and the optionality
 * belongs to the field, not the shape. `Chapter.branding` stays the untyped
 * `Record<string, unknown>` jsonb column it is persisted as.
 *
 * The interface layer's `BrandingDto` remains the request-time class-validator
 * surface — the application layer may not import it (dependency-cruiser
 * `api-application-not-to-interface`), and the controllers are where the two
 * meet; `interface/dtos/service-input-coverage.ts` is what proves the DTO's
 * keys are all present here.
 *
 * **Known divergence, not introduced here:** `ChapterBrandingSchema` accepts a
 * 3-digit hex accent (`#ABC`); `BrandingColorsDto`'s `HEX_COLOR_PATTERN`
 * requires 6. A client that validates locally against the schema can therefore
 * send an accent the API rejects with a 400. The shapes agree, so this type
 * reuse is sound; the regexes are a separate decision about which spellings
 * Frapp accepts.
 */
export type ChapterBrandingInput = NonNullable<ChapterBranding>;

/**
 * One Signet §8 check that came back below its floor: 4.5:1 for a text role
 * (`failedContrastChecks`), 3:1 for the `accent-primary` fill
 * (`failedFillChecks`).
 */
export type FailedContrastCheck = {
  role: string;
  against: string;
  ratio: number;
};

export type ChapterPaletteBuild = {
  /** The Signet accent role map, keyed `--signet-*`. */
  palette: Record<string, string>;
  /** True when the accent seed failed to parse and house gold was substituted. */
  invalidSeed: boolean;
  /** Signet contrast checks that came back below AA. Empty in the normal case. */
  failedContrastChecks: FailedContrastCheck[];
  /**
   * `accent-primary` fill checks that came back below the §8 3:1 floor (#2541).
   * Always empty unless the generator changed under the engine, so it is logged
   * and never sent to a client: nothing the officer chose caused it. Every
   * route that returns a build picks the fields it discloses, as
   * `ChapterConfigService.recomputeAndPersistPalette` does.
   */
  failedFillChecks: FailedContrastCheck[];
};

/**
 * Builds a chapter's complete `theme_palette` from its brand colors.
 *
 * One implementation for all three writers — onboarding, the config PATCH /
 * recompute endpoint, and the Settings accent save. They had drifted into
 * three shapes with three different notions of when a palette gets written,
 * which is how `theme_palette` ended up frozen at its onboarding value for
 * every chapter that later edited its accent from Settings.
 *
 * **The map is always produced.** `accent-engine.md` §3 defines the no-accent
 * case as the house seed run through the same pipeline, not as an absent
 * palette, and `deriveSignetPalette` resolves an absent or unparseable seed to
 * house gold on its own. There is no longer a conditional half: before slice 9
 * the legacy map was produced only when a brand colour was supplied, so a
 * palette could hold one map or both.
 *
 * **Never throws, and nothing catches it if it did.** All three writers call it
 * bare: `ChapterOnboardingService.buildPalette`,
 * `ChapterConfigService.recomputePalette`, and `ChapterService`'s accent save.
 * Onboarding is the worst of the three — its call runs *before*
 * `ChapterService.create`, so a throw here fails chapter creation outright
 * rather than degrading the palette. (This paragraph used to claim onboarding
 * wrapped the call in a try/catch returning `null`; it never has — corrected
 * 2026-09-07. The rule is unchanged, only the consequence it names.)
 */
export function buildChapterPalette(
  colors: ChapterBrandColors,
): ChapterPaletteBuild {
  const signet = deriveSignetPalette(colors.accent);

  return {
    palette: { ...signet.palette },
    invalidSeed: signet.invalidSeed,
    failedContrastChecks: signet.contrastChecks
      .filter((check) => !check.passes)
      .map(({ role, against, ratio }) => ({ role, against, ratio })),
    failedFillChecks: signet.fillChecks
      .filter((check) => !check.passes)
      .map(({ role, against, ratio }) => ({ role, against, ratio })),
  };
}

/**
 * Logs the by-construction problems a build can report — never throws,
 * since the palette written is still valid either way (#840, §8).
 *
 * Shared by all three writers so a change to the wording or logging strategy
 * has one place to land — this file's own docstring above names the
 * three-shapes drift that duplicating it independently caused once already.
 * `where` says which chapter: `for chapter <id>`, or `during onboarding`, which
 * builds the palette before the chapter has an id. (Onboarding used to log only
 * `invalidSeed` for that reason, so a failed contrast or fill check there went
 * unrecorded.)
 */
/**
 * A failing ratio to two decimals, truncated rather than rounded: the line says
 * the check fell below its floor, and rounding would log a 4.4954 as "4.50:1"
 * under "below AA". The epsilon keeps a float a hair under a hundredth from
 * losing it. The Settings page truncates the same ratios for the same reason.
 */
function belowFloor(ratio: number): string {
  return (Math.floor(ratio * 100 + 1e-9) / 100).toFixed(2);
}

export function logChapterPaletteWarnings(
  logger: { warn: (message: string) => void },
  where: string,
  attemptedAccent: string | undefined,
  build: ChapterPaletteBuild,
): void {
  if (build.invalidSeed) {
    logger.warn(
      `Invalid accent seed ${where}: accent="${attemptedAccent}" — substituted house gold. Expected #RRGGBB.`,
    );
  }
  // The engine guarantees these by construction (accent-engine.md §8), so a
  // failure means either an unusual hex or the vendored generator changed
  // behaviour under us — worth a log trace either way (#1183).
  if (build.failedContrastChecks.length > 0) {
    logger.warn(
      `Signet accent contrast below AA ${where}: ${build.failedContrastChecks
        .map((c) => `${c.role} on ${c.against} = ${belowFloor(c.ratio)}:1`)
        .join(', ')}`,
    );
  }
  // Same reasoning for the fill floor (#2541): the engine lifts the fill until
  // it clears, so a failure here means the lift itself stopped working.
  if (build.failedFillChecks.length > 0) {
    logger.warn(
      `Signet accent fill below 3:1 ${where}: ${build.failedFillChecks
        .map((c) => `${c.role} on ${c.against} = ${belowFloor(c.ratio)}:1`)
        .join(', ')}`,
    );
  }
}
