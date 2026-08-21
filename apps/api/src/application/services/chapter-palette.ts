import { derivePalette, deriveSignetPalette } from '@repo/chapter-theme';

/**
 * The two brand colors a chapter stores. `accent` is the accent engine's seed;
 * `dark` only feeds the legacy web map.
 */
export type ChapterBrandColors = { dark?: string; accent?: string };

export type ChapterPaletteBuild = {
  /**
   * The legacy web token map merged with the Signet accent map. Signet keys are
   * namespaced `--signet-*`, so a legacy reader — and `use-chapter-theme.ts`
   * iterates *every* key of this object onto `:root` — cannot see them.
   */
  palette: Record<string, string>;
  /** Legacy brand colors that failed to parse and were substituted with bronze. */
  invalidLegacyInputs: string[];
  /** True when the accent seed failed to parse and house gold was substituted. */
  invalidSeed: boolean;
  /** Signet contrast checks that came back below AA. Empty in the normal case. */
  failedContrastChecks: { role: string; against: string; ratio: number }[];
  /** Set when `derivePalette` threw; the Signet half is still present. */
  legacyFailed: boolean;
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
 * **The Signet map is always produced.** `accent-engine.md` §3 defines the
 * no-accent case as the house seed run through the same pipeline, not as an
 * absent palette, and `deriveSignetPalette` resolves an absent or unparseable
 * seed to house gold on its own. The legacy map is still only produced when a
 * brand color was actually supplied, preserving the behaviour onboarding had.
 *
 * **Never throws.** `ChapterOnboardingService.buildPalette` wraps its call in a
 * try/catch that returns `null`, so a throw here would not surface as an error
 * — it would silently onboard a chapter with no palette at all.
 */
export function buildChapterPalette(
  colors: ChapterBrandColors,
): ChapterPaletteBuild {
  const signet = deriveSignetPalette(colors.accent);
  const build: ChapterPaletteBuild = {
    palette: { ...signet.palette },
    invalidLegacyInputs: [],
    invalidSeed: signet.invalidSeed,
    failedContrastChecks: signet.contrastChecks
      .filter((check) => !check.passes)
      .map(({ role, against, ratio }) => ({ role, against, ratio })),
    legacyFailed: false,
  };

  if (!colors.dark && !colors.accent) {
    return build;
  }

  try {
    const legacy = derivePalette({
      dark: colors.dark ?? '#1F1A15',
      accent: colors.accent ?? '#7A5A2F',
    });
    // `?? {}` is load-bearing rather than defensive habit: a result missing the
    // field (a stale @repo/chapter-theme build, a test double written against
    // the older shape) would throw here, and this whole block is the one the
    // callers' try/catch used to swallow into a dropped palette.
    build.invalidLegacyInputs = Object.keys(legacy.invalidInputs ?? {});
    build.palette = { ...legacy.palette, ...signet.palette };
  } catch {
    // The Signet half is independent and already resolved, so keep it rather
    // than dropping both. The caller decides how loudly to say so.
    build.legacyFailed = true;
  }

  return build;
}
