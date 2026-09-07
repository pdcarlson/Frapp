import { deriveSignetPalette } from '@repo/chapter-theme';

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
 * `Chapter.branding` is the persisted `Record<string, unknown>` jsonb column;
 * this is the typed subset the two writers actually read, and it lives beside
 * {@link ChapterBrandColors} because the colours half is the part that reaches
 * the palette. The interface layer's `BrandingDto` is the validated wire shape
 * and stays there — the application layer may not import it (dependency-cruiser
 * `api-application-not-to-interface`), and the controllers are where the two
 * meet.
 */
export type ChapterBrandingInput = {
  greek_letters?: string;
  designation?: string;
  school_short?: string;
  founded_at?: number;
  colors?: ChapterBrandColors;
};

/** One Signet §8 text-contrast check that came back below the 4.5:1 AA floor. */
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
 * **Never throws.** `ChapterOnboardingService.buildPalette` wraps its call in a
 * try/catch that returns `null`, so a throw here would not surface as an error
 * — it would silently onboard a chapter with no palette at all.
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
  };
}

/**
 * Logs the two by-construction problems a build can report — never throws,
 * since the palette written is still valid either way (#840, §8).
 *
 * Shared by every writer that already has a `chapterId` (the config PATCH /
 * recompute endpoint and the Settings accent save) so a change to the wording
 * or logging strategy has one place to land — this file's own docstring above
 * names the three-shapes drift that duplicating it independently caused once
 * already. Onboarding logs its own `invalidSeed` message instead: it has no
 * `chapterId` yet at that point, so the message shape genuinely differs.
 */
export function logChapterPaletteWarnings(
  logger: { warn: (message: string) => void },
  chapterId: string,
  attemptedAccent: string | undefined,
  build: ChapterPaletteBuild,
): void {
  if (build.invalidSeed) {
    logger.warn(
      `Invalid accent seed for chapter ${chapterId}: accent="${attemptedAccent}" — substituted house gold. Expected #RRGGBB.`,
    );
  }
  // The engine guarantees these by construction (accent-engine.md §8), so a
  // failure means either an unusual hex or the vendored generator changed
  // behaviour under us — worth a log trace either way (#1183).
  if (build.failedContrastChecks.length > 0) {
    logger.warn(
      `Signet accent contrast below AA for chapter ${chapterId}: ${build.failedContrastChecks
        .map((c) => `${c.role} on ${c.against} = ${c.ratio.toFixed(2)}:1`)
        .join(', ')}`,
    );
  }
}
