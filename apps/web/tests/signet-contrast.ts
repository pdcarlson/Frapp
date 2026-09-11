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
  /rgba\([^)]*,\s*([\d.]+)\)/.exec(
    signetDarkTokens.color.border.hairline,
  )?.[1] ?? "0.08",
);

/** README §6's two floors. */
/** Re-exported so a guard needs one import rather than four. */
export { HOUSE_SEED, signetDarkTokens };

export const AA_TEXT = 4.5;
export const AA_NON_TEXT = 3;

/**
 * The ceiling under which two large areas read as the same colour.
 *
 * Not a WCAG figure and not a spec floor — the gates above are the only two of
 * those. This is the perceptibility heuristic the washout guards assert
 * against: a fill whose contrast with its own container is under this is a
 * state nobody can see, which is the defect class `table-contrast`,
 * `elevation-contrast` and `profile-contrast` all exist to catch.
 *
 * It lives here as a constant because the greenfield surface ladder
 * (foundations.md §2) tripped four scattered `1.1` literals at once, without
 * any of the pairs becoming visible: `table-contrast:44` and
 * `elevation-contrast:56` (both 1.1046), `profile-contrast:59` (1.1007) and
 * `status-contrast:92` (1.1108). Literals that must move together are the
 * shape this file exists to collapse.
 *
 * **1.15, not 1.2.** The four measurements cluster at 1.10–1.11, so the bound
 * has to clear them; but it is kept as low as that allows, because every point
 * above them is discriminating power the guards lose. 1.2 was the first value
 * tried here, justified as "the bound `profile-contrast` already used" — that
 * was wrong on inspection: `profile-contrast:47`'s 1.2 bounds a composited
 * hover wash, not a ladder-step delta, so it was never precedent for this.
 *
 * The two `profile-contrast` assertions that measure composited washes
 * (1.0637 and 1.0994) keep their own `1.1` and are deliberately NOT on this
 * constant: they were passing, they measure a different quantity, and
 * loosening a passing assertion only costs coverage.
 *
 * The ladder did NOT uniformly widen. Measured old -> new:
 * `--surface-1`/`--background` 1.0660 -> 1.0751 and `--popover`/`--card`
 * 1.0847 -> 1.1046 both widened, but **`--card`/`--surface-1` went 1.0624 ->
 * 1.0486**, making it the ladder's tightest adjacency. A `Card` seated on
 * `--surface-1` is therefore *less* separable than before, and nothing here
 * asserts a floor on that — these constants are `toBeLessThan` pins recording
 * "these two alias", not a guarantee the ladder stays separable. Part of the
 * cause is that `--surface-1` is now achromatic `#1A1A1A` (it is the mark's
 * field) while the other three steps stayed warm, so the ladder is no longer
 * one hue family and a pure-luminance model understates the difference.
 */
export const INDISTINGUISHABLE = 1.15;

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
