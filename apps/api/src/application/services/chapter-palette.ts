import { deriveSignetPalette } from '@repo/chapter-theme';

/**
 * The brand colors a chapter stores. `accent` is the accent engine's seed, and
 * it is the only one — the second colour (`dark`) existed solely to feed the
 * legacy web token map and went with it in the #920 slice-9 cutover.
 */
export type ChapterBrandColors = { accent?: string };

export type ChapterPaletteBuild = {
  /** The Signet accent role map, keyed `--signet-*`. */
  palette: Record<string, string>;
  /** True when the accent seed failed to parse and house gold was substituted. */
  invalidSeed: boolean;
  /** Signet contrast checks that came back below AA. Empty in the normal case. */
  failedContrastChecks: { role: string; against: string; ratio: number }[];
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
