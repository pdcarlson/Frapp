import {
  contrastRatio,
  normalizeHex,
  parseHex,
  pickAccessibleColor,
  roundRatio,
  type Rgb,
} from "@repo/color";
import { signetDarkTokens } from "@repo/theme/signet";

/**
 * Re-validates a chapter's stored accent against the surface it is drawn on,
 * for the Settings accent preview, its one caller (`settings-accent-tab.tsx`).
 *
 * It lived in `@repo/theme` as `@repo/theme/accent` until #3227, when it was the
 * last reader of that package's legacy bronze palette and had this one caller
 * left. Moving it here deleted the white-background and bronze-fallback
 * defaults with it: the caller always passed both, so neither ever fired.
 */

const MIN_ACCENT_CONTRAST = 4.5;

/**
 * Tried in order when the caller's own fallback is illegible on the background
 * it was asked about (#797). The caller's fallback always goes first, so the
 * Settings preview, which passes house gold on the dark card, never reaches
 * these.
 *
 * Signet's own values: house gold, then the lightest and darkest neutrals,
 * which anchor the ends. They do not make the ladder exhaustive: a mid-tone
 * background such as `#767676` clears neither end. When nothing passes the
 * resolver keeps the caller's requested fallback, which is exactly what it
 * emitted before #797 — no worse, and the `fallbackApplied` flag plus the
 * reported ratio still tell the caller what happened.
 */
const FALLBACK_LADDER = [
  signetDarkTokens.color.gold.house,
  signetDarkTokens.color.text.foreground,
  signetDarkTokens.color.surface.background,
] as const;

export type AccentValidationResult = {
  resolvedAccent: string;
  fallbackApplied: boolean;
  /** Contrast of `resolvedAccent` against `options.background`. */
  contrastOnBackground: number;
  reason: "ok" | "invalid_format" | "insufficient_contrast";
};

export type ResolveChapterAccentOptions = {
  /**
   * Surface the accent is drawn on, as a hex colour: the Settings preview
   * passes the dark card. Throws when it doesn't parse, since every ratio
   * below would be measured against nothing.
   */
  background: string;
  /**
   * Accent substituted when the chapter's own fails, as a hex colour; throws
   * when it doesn't parse. Pass one legible on `background`: the Settings
   * preview passes house gold.
   *
   * This is a preference, not the last word: it is checked against `background`
   * like any other candidate, and a value that fails AA there is escalated past
   * rather than emitted (#797). So a wrong fallback degrades to a legible color
   * instead of an unreadable one — but it still will not be the one you asked
   * for, so pass the right one.
   */
  fallbackAccent: string;
};

/**
 * Contrast, rounded to 2dp before anyone looks at it.
 *
 * The rounding is deliberate and long-standing: it is what this resolver has
 * always compared against 4.5, and it is what `contrastOnBackground` reports.
 * Against the dark card the Settings preview passes (`#211E1A`), 9,686 hex
 * colors score in `[4.495, 4.5)` and pass only because of it, so tightening to
 * exact comparison would flip the preview's verdict on accents chapters
 * already use. The shared math in `@repo/color` is exact;
 * the rounding lives here, with the caller whose behavior depends on it.
 */
function ratioOn(color: Rgb, background: Rgb): number {
  return roundRatio(contrastRatio(color, background));
}

/** Only ever called with an already-normalized hex, so the parse cannot fail. */
function toRgb(normalizedHex: string): Rgb {
  return parseHex(normalizedHex) ?? { r: 0, g: 0, b: 0 };
}

export function resolveChapterAccentColor(
  inputAccent: string | undefined,
  options: ResolveChapterAccentOptions,
): AccentValidationResult {
  // Both are the caller's constants, not user input, so a value that doesn't
  // parse is a programming error to surface, not a case to paper over.
  const background = normalizeHex(options.background);
  if (!background) {
    throw new TypeError(
      `resolveChapterAccentColor: background ${JSON.stringify(options.background)} is not a hex colour`,
    );
  }
  const requestedFallback = normalizeHex(options.fallbackAccent);
  if (!requestedFallback) {
    throw new TypeError(
      `resolveChapterAccentColor: fallbackAccent ${JSON.stringify(options.fallbackAccent)} is not a hex colour`,
    );
  }

  const backgroundRgb = toRgb(background);

  // #797: the substitute is validated too. Rejecting a chapter's accent for
  // failing AA and then emitting something that fails worse is the defect this
  // closes: the old light brand token scored 2.63:1 on the native dark card,
  // below inputs it would replace. The requested fallback is tried first, so a
  // caller passing a fallback legible on its surface is unaffected.
  // Resolved lazily, inside the closure: this runs on every render of the
  // web Settings accent preview, its one remaining caller, and walking the
  // ladder is several contrast evaluations whose result is thrown away
  // whenever the chapter's own accent passes — which is the normal case.
  const fallback = (
    reason: AccentValidationResult["reason"],
  ): AccentValidationResult => {
    const fallbackAccent =
      pickAccessibleColor(
        [requestedFallback, ...FALLBACK_LADDER],
        backgroundRgb,
        { minimum: MIN_ACCENT_CONTRAST, round: true },
      ) ?? requestedFallback;

    return {
      resolvedAccent: fallbackAccent,
      fallbackApplied: true,
      contrastOnBackground: ratioOn(toRgb(fallbackAccent), backgroundRgb),
      reason,
    };
  };

  if (!inputAccent) {
    return fallback("invalid_format");
  }

  const normalized = normalizeHex(inputAccent);

  if (!normalized) {
    return fallback("invalid_format");
  }

  const accentContrast = ratioOn(toRgb(normalized), backgroundRgb);
  if (accentContrast < MIN_ACCENT_CONTRAST) {
    return fallback("insufficient_contrast");
  }

  return {
    resolvedAccent: normalized,
    fallbackApplied: false,
    contrastOnBackground: accentContrast,
    reason: "ok",
  };
}
