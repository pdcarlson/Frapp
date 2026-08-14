import {
  contrastRatio,
  normalizeHex,
  parseHex,
  pickAccessibleColor,
  roundRatio,
  type Rgb,
} from "@repo/color";

import { frappTokens } from "./tokens";

const MIN_ACCENT_CONTRAST = 4.5;

/** The background assumed when a caller does not name one (web light mode). */
const DEFAULT_BACKGROUND = "#FFFFFF";

/**
 * Tried in order when the caller's own fallback is illegible on the background
 * it was asked about (#797). The caller's fallback always goes first, so a
 * correct caller — every one of them today — never reaches these.
 *
 * Ink and bone anchor the ends, but they do not make the ladder exhaustive: a
 * mid-tone background such as `#767676` clears neither. When nothing passes the
 * resolver keeps the caller's requested fallback, which is exactly what it
 * emitted before #797 — no worse, and the `fallbackApplied` flag plus the
 * reported ratio still tell the caller what happened.
 */
const FALLBACK_LADDER = [
  frappTokens.color.brand.royalBlue,
  "#C8A062",
  "#1F1A15",
  "#FAF7F2",
] as const;

export type AccentValidationResult = {
  resolvedAccent: string;
  fallbackApplied: boolean;
  /**
   * Contrast of `resolvedAccent` against the background it was checked on —
   * `options.background`, or white when the caller did not name one.
   */
  contrastOnBackground: number;
  reason: "ok" | "invalid_format" | "insufficient_contrast";
};

export type ResolveChapterAccentOptions = {
  /**
   * Surface the accent is drawn on. Defaults to white, which is what the web
   * dashboard assumes; native dark mode must pass its own dark surface or a
   * legible-on-white accent would be waved through onto near-black.
   */
  background?: string;
  /**
   * Accent substituted when the chapter's own fails. Defaults to the light
   * brand token — pass your own mode's token on a dark background, since the
   * light one is itself illegible there.
   *
   * This is a preference, not the last word: it is checked against `background`
   * like any other candidate, and a value that fails AA there is escalated past
   * rather than emitted (#797). So a wrong fallback degrades to a legible color
   * instead of an unreadable one — but it still will not be the one you asked
   * for, so pass the right one.
   */
  fallbackAccent?: string;
};

/**
 * Contrast, rounded to 2dp before anyone looks at it.
 *
 * The rounding is deliberate and long-standing: it is what this resolver has
 * always compared against 4.5, and it is what `contrastOnBackground` reports.
 * Roughly 9,000 hex colors score in `[4.495, 4.5)` and pass only because of it,
 * so tightening to exact comparison would repaint live chapter accents. The
 * shared math in `@repo/color` is exact; the rounding lives here, with the
 * caller whose behavior depends on it.
 */
function ratioOn(color: Rgb, background: Rgb): number {
  return roundRatio(contrastRatio(color, background));
}

/** Only ever called with an already-normalized hex, so the parse cannot fail. */
function toRgb(normalizedHex: string): Rgb {
  return parseHex(normalizedHex) ?? { r: 0, g: 0, b: 0 };
}

export function resolveChapterAccentColor(
  inputAccent?: string,
  options?: ResolveChapterAccentOptions,
): AccentValidationResult {
  // A caller that hands us an unparseable background would otherwise poison
  // every ratio below, so it degrades to white rather than to NaN.
  const background =
    normalizeHex(options?.background ?? "") || DEFAULT_BACKGROUND;
  const requestedFallback =
    normalizeHex(options?.fallbackAccent ?? "") ||
    frappTokens.color.brand.royalBlue;

  const backgroundRgb = toRgb(background);

  // #797: the substitute is validated too. Rejecting a chapter's accent for
  // failing AA and then emitting something that fails worse is the defect this
  // closes — the light brand token scores 2.63:1 on the native dark card, below
  // inputs it would replace. The requested fallback is tried first, so a caller
  // passing its own mode's token (all of them do today) is unaffected.
  const fallbackAccent =
    pickAccessibleColor([requestedFallback, ...FALLBACK_LADDER], backgroundRgb, {
      minimum: MIN_ACCENT_CONTRAST,
      round: true,
    }) ?? requestedFallback;

  const fallback = (
    reason: AccentValidationResult["reason"],
  ): AccentValidationResult => ({
    resolvedAccent: fallbackAccent,
    fallbackApplied: true,
    contrastOnBackground: ratioOn(toRgb(fallbackAccent), backgroundRgb),
    reason,
  });

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
