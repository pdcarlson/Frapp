import { applyAlpha, contrastRatio, mixHex, parseHex } from "@repo/color";
import {
  deriveSignetPalette,
  HOUSE_SEED,
  signetAccentSemanticVars,
} from "@repo/chapter-theme";
import { signetDarkTokens } from "@repo/theme/signet";

/**
 * Shared fixtures for the Signet contrast guards.
 *
 * The seed corpus and the four thin wrappers around `@repo/color` started life
 * inline in `components/chat/chat-contrast.spec.ts`. The Directory & Finance
 * slice of #920 added two more guards and, with them, a second and third
 * byte-identical copy of a 19-element array whose whole purpose is to be the
 * *same* list everywhere — so a chapter colour added to two files and missed in
 * the third would silently narrow that file's coverage rather than fail. That
 * is precisely the drift class these guards exist to catch, so it lives here
 * once.
 *
 * A test helper rather than a component recipe, so it sits in `tests/`
 * alongside `chapter-subscription.ts` rather than under `components/`.
 */

/**
 * Every distinct color the chapter directory seed has carried, plus the house
 * default.
 *
 * Frozen in code rather than read from `supabase/seed/chapter_directory.csv`.
 * `packages/chapter-theme/src/signet.spec.ts` owns the canonical copy and gives
 * the reasoning: the seed file is real production data that gets edited (it was
 * repaired wholesale in #903), and a suite that read it would change what it
 * asserts whenever that data moved. #1225 is the case in point — it dropped the
 * dead `default_colors.dark` half, which is where 13 of these 18 came from, so
 * a list read from the CSV would now be 5 colors long.
 */
export const SEEDS = [
  "#000000",
  "#003087",
  "#006400",
  "#1F1A15",
  "#1F4E79",
  "#472B62",
  "#4B0082",
  "#4B1A7E",
  "#4B2E2E",
  "#800000",
  "#8B0000",
  "#8B4513",
  "#BF0A30",
  "#C0C0C0",
  "#C9A56F",
  "#CC0000",
  "#FF69B4",
  "#FFFFFF",
  HOUSE_SEED,
] as const;

/**
 * The fixed half of the palette, read from the token source rather than
 * restated. A guard that hardcodes the values it is guarding goes green against
 * constants that no longer ship.
 */
export const SURFACE = signetDarkTokens.color.surface;
export const TEXT = signetDarkTokens.color.text;
export const SEMANTIC = signetDarkTokens.color.semantic;

/**
 * `--destructive-text` is CSS-only (`packages/theme/src/signet.css`) with no
 * `signetDarkTokens` entry, so it is the one literal here.
 */
export const DESTRUCTIVE_TEXT = "#FF7B72";

/** The hairline's alpha, parsed from the token so the two cannot disagree. */
export const HAIRLINE_ALPHA = Number(
  /rgba\([^)]*,\s*([\d.]+)\)/.exec(signetDarkTokens.color.border.hairline)?.[1] ??
    "0.08",
);

/** README §6's two floors. */
/** Re-exported so a guard needs one import rather than four. */
export { HOUSE_SEED, signetDarkTokens };

export const AA_TEXT = 4.5;
export const AA_NON_TEXT = 3;

export const ratio = (fg: string, bg: string) =>
  contrastRatio(parseHex(fg)!, parseHex(bg)!);

/** The `bg-x/[.13]` recipe, composited over the surface it lands on. */
export const tint = (hue: string, over: string, alpha = 0.13) =>
  applyAlpha(hue, alpha, over);

export function accentRolesFor(seed: string) {
  return signetAccentSemanticVars(deriveSignetPalette(seed).palette);
}

/**
 * `--accent-subtle-hover` is a `color-mix(in srgb, var(--accent-border) 22%,
 * var(--accent-subtle))` in `signet.css`. CSS resolves it at paint time; here it
 * is recomputed from the same two roles and the same 22%, so a change to the mix
 * in the stylesheet has to be mirrored here to keep the guards green.
 */
export const accentFour = (roles: Record<string, string>) =>
  mixHex(roles["--accent-subtle"]!, roles["--accent-border"]!, 0.22);

/** The channel spread of a fill's delta from a surface — its hue shift. */
export function chromaShift(fill: string, base: string) {
  const a = parseHex(fill)!;
  const b = parseHex(base)!;
  const deltas = [a.r - b.r, a.g - b.g, a.b - b.b];
  return Math.max(...deltas) - Math.min(...deltas);
}
