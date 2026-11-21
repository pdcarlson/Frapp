import {
  AA_NORMAL,
  hexToOklch,
  meetsContrast,
  oklchToHex,
  parseHex,
  type Rgb,
} from "@repo/color";

import {
  highestRankedRole,
  type RankableRole,
  type TierPositions,
} from "./role-rank";
/**
 * The quick-pick colors a chapter role or group can wear (#3485), beside any
 * custom hue {@link roleColorForHue} makes (#5784).
 *
 * A role's color paints text: a chat author's name, and the dot on a role
 * chip. Text on Frapp's charcoal surfaces has to stay readable, so roles pick
 * from this list instead of a free hex picker. Every swatch clears WCAG AA for
 * normal text (4.5:1) on every resting surface a name sits on (lowest is
 * Violet at 5.13:1 on `--popover`). On a hovered row's `--card-hover`, Rose
 * and Violet rest at 4.49:1 and 4.42:1 since the 2026-11-12 surface ladder
 * (#3826) lightened it, a hair under AA; web lifts the painted name on hover so
 * it clears there too (`apps/web/components/roles/role-name-paint.ts`, #4387).
 * The stored value stays as listed: the API validates against it and shipped
 * mobile builds paint only exact palette values, so re-pitching a swatch would
 * orphan every role stored with it. `role-colors-contrast.spec.ts` guards the
 * resting palette against the token source and the lifted palette on hover.
 *
 * Two hue families are left out on purpose: red, which already means a mention
 * or an error, and gold, which is Signet's own colour for the Ask surface
 * ({@link ROLE_COLOR_RESERVED_BANDS}).
 *
 * Since #5784 a role may also wear any other hue, as long as it reads: the API
 * accepts a palette value or any color {@link isPaintableRoleColor} passes,
 * and clients paint the same set ({@link roleColorOrNull}), so a stored hex
 * nobody checked for contrast still paints nothing. Builds before #5784 paint
 * only these exact values, so a custom hue reads as no color there.
 */
export const ROLE_COLOR_PALETTE = [
  { key: "orange", label: "Orange", hex: "#F2994A" },
  { key: "rose", label: "Rose", hex: "#F47FA4" },
  { key: "violet", label: "Violet", hex: "#B392F0" },
  { key: "periwinkle", label: "Periwinkle", hex: "#8FA8FF" },
  { key: "sky", label: "Sky", hex: "#5CC8F0" },
  { key: "teal", label: "Teal", hex: "#3DD6C4" },
  { key: "green", label: "Green", hex: "#6FD08C" },
  { key: "lime", label: "Lime", hex: "#C5E06A" },
  { key: "sand", label: "Sand", hex: "#D9B99B" },
  { key: "slate", label: "Slate", hex: "#A9B4C2" },
] as const;

export type RoleColorSwatch = (typeof ROLE_COLOR_PALETTE)[number];
export type RoleColorKey = RoleColorSwatch["key"];
export type RoleColorHex = RoleColorSwatch["hex"];

/** The palette's hex values, in palette order, as the API validates them. */
export const ROLE_COLOR_HEXES: readonly RoleColorHex[] = ROLE_COLOR_PALETTE.map(
  (swatch) => swatch.hex,
);

const BY_KEY = Object.fromEntries(
  ROLE_COLOR_PALETTE.map((swatch) => [swatch.key, swatch.hex]),
) as Record<RoleColorKey, RoleColorHex>;

const BY_UPPER_HEX = new Map<string, RoleColorHex>(
  ROLE_COLOR_PALETTE.map((swatch) => [swatch.hex.toUpperCase(), swatch.hex]),
);

/** The hex for a palette key, e.g. `roleColor("orange")` → `"#F2994A"`. */
export function roleColor(key: RoleColorKey): RoleColorHex {
  return BY_KEY[key];
}

/**
 * The surfaces a role color paints text on, darkest to lightest: the chat
 * background, the rail, a card, a menu, and a hovered row (`--card-hover`).
 * A custom hue must read at AA as text on every one of them, the hovered row
 * included, so it needs no hover lift (the palette's Rose and Violet do,
 * #4387).
 *
 * Restated rather than imported, because `@repo/validation` runs in the API
 * and can't take the theme package; `apps/web/components/roles/
 * role-colors-contrast.spec.ts` fails if these drift from the token source.
 * Dark only: when a light theme lands (#4641), its surfaces join this list.
 */
export const ROLE_COLOR_SURFACES = {
  background: "#0B0A0D",
  surface1: "#151419",
  card: "#1F1D25",
  popover: "#2A2830",
  cardHover: "#34323A",
} as const;

/** The surfaces, parsed once. */
const SURFACE_RGBS: readonly Rgb[] = Object.values(ROLE_COLOR_SURFACES).map(
  (surface) => parseHex(surface)!,
);

/** A stored custom color is exactly `#RRGGBB`: the shape the API writes. */
const SIX_DIGIT_HEX = /^#[0-9A-F]{6}$/i;

/**
 * The OKLCH hue bands a custom role color may not sit in, in degrees, `from`
 * inclusive and `to` exclusive (#5784, Paul's #5684 decision 6).
 *
 * Red covers `--destructive` (27°) and `--mention` (22°), which mean danger,
 * overdue and "you were mentioned"; it stops short of the palette's Rose (1°)
 * and Orange (60°). Gold covers house gold (82°) and pure yellow-gold
 * (`#FFD700`, 95°), Frapp's own brand color; it starts above Orange and ends
 * below Lime (120°). A color with less chroma than
 * {@link ROLE_COLOR_RESERVED_CHROMA} reads as a grey or a beige, not as red or
 * gold, so the bands don't apply to it (Sand sits at 65° with 0.055).
 */
export const ROLE_COLOR_RESERVED_BANDS = [
  {
    key: "red",
    from: 12,
    to: 45,
    reason: "Red is kept for alerts and mentions.",
  },
  {
    key: "gold",
    from: 65,
    to: 105,
    reason: "Gold is kept for Frapp's own color.",
  },
] as const;

export type ReservedRoleHue = (typeof ROLE_COLOR_RESERVED_BANDS)[number]["key"];

/** Below this OKLCH chroma a color is too grey to read as red or gold. */
export const ROLE_COLOR_RESERVED_CHROMA = 0.06;

/** The chroma a custom hue is painted at: the palette's own, about 0.13–0.15. */
export const ROLE_COLOR_CUSTOM_CHROMA = 0.14;

/** The lightness a custom hue starts from before it is lifted to read. */
const CUSTOM_START_LIGHTNESS = 0.7;
/** How far one lift raises OKLCH lightness while adjusting a color. */
const LIGHTNESS_STEP = 0.005;
/** How far past a band's edge a nudged hue lands, so hex rounding can't drift it back in. */
const BAND_MARGIN = 2;

function normalizedHue(hue: number): number {
  const finite = Number.isFinite(hue) ? hue : 0;
  return ((finite % 360) + 360) % 360;
}

type ReservedBand = (typeof ROLE_COLOR_RESERVED_BANDS)[number];

/** The band a hue falls in, `from` inclusive and `to` exclusive. */
function bandForHue(hue: number): ReservedBand | undefined {
  const h = normalizedHue(hue);
  return ROLE_COLOR_RESERVED_BANDS.find(
    (candidate) => h >= candidate.from && h < candidate.to,
  );
}

/** The reserved band a hue falls in, ignoring chroma. */
export function reservedBandForHue(hue: number): ReservedRoleHue | null {
  return bandForHue(hue)?.key ?? null;
}

/** The reserved band a color reads as, or `null` for any other color (and a non-color). */
export function reservedRoleHue(hex: string): ReservedRoleHue | null {
  const oklch = hexToOklch(hex);
  if (!oklch || oklch.c < ROLE_COLOR_RESERVED_CHROMA) return null;
  return reservedBandForHue(oklch.h);
}

/** The sentence a picker shows when a hue was moved out of a reserved band. */
export function reservedRoleHueReason(band: ReservedRoleHue): string {
  return ROLE_COLOR_RESERVED_BANDS.find((candidate) => candidate.key === band)!
    .reason;
}

/** The nearest hue outside every reserved band, with the band it left. */
function nudgeHue(hue: number): { hue: number; band: ReservedRoleHue | null } {
  const h = normalizedHue(hue);
  const band = bandForHue(h);
  if (!band) return { hue: h, band: null };
  const toLower = h - band.from;
  const toUpper = band.to - h;
  return {
    hue: toLower <= toUpper ? band.from - BAND_MARGIN : band.to + BAND_MARGIN,
    band: band.key,
  };
}

/** Which way leads out of the nearest band's edge: -1 below it, +1 above it. */
function awayFromBands(hue: number): -1 | 1 {
  let best: { distance: number; direction: -1 | 1 } = {
    distance: Infinity,
    direction: 1,
  };
  for (const band of ROLE_COLOR_RESERVED_BANDS) {
    const below = Math.abs(hue - band.from);
    const above = Math.abs(hue - band.to);
    if (below < best.distance) best = { distance: below, direction: -1 };
    if (above < best.distance) best = { distance: above, direction: 1 };
  }
  return best.direction;
}

/** WCAG AA for normal-size text (`AA_NORMAL`), which a name in chat is, on every surface. */
function readsOnEverySurface(rgb: Rgb): boolean {
  return SURFACE_RGBS.every((surface) =>
    meetsContrast(rgb, surface, { minimum: AA_NORMAL }),
  );
}

/**
 * Whether a stored color may paint: a palette value, or any color that reads
 * at AA on every {@link ROLE_COLOR_SURFACES} entry and sits outside the
 * reserved bands. The API accepts exactly this set, and every client paints
 * exactly this set.
 */
export function isPaintableRoleColor(value: unknown): boolean {
  return roleColorOrNull(value) !== null;
}

/**
 * The `#RRGGBB` a stored value paints as, or `null` when it may not paint.
 *
 * Case-insensitive, because the column is free text and older writes may
 * differ in case. A palette value comes back exactly as listed, so the ten
 * quick picks paint as they always have. Any other `#RRGGBB` (six digits, as
 * the API stores it; a short `#RGB` is refused) comes back uppercase when it
 * reads at AA on every surface and isn't red or gold; anything else
 * (including the pre-#3485 seed `#FFD700`, gold, and `#6B7280`, too dark) is
 * `null`, so a render path never paints a color nobody checked for contrast.
 */
export function roleColorOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const palette = BY_UPPER_HEX.get(value.trim().toUpperCase());
  if (palette) return palette;
  const hex = value.trim().toUpperCase();
  if (!SIX_DIGIT_HEX.test(hex)) return null;
  if (reservedRoleHue(hex) !== null) return null;
  return readsOnEverySurface(parseHex(hex)!) ? hex : null;
}

/**
 * The nearest paintable color to `hex` (#5784), the step behind
 * {@link roleColorForHue}, which is how the picker reaches it.
 *
 * The color keeps its hue and chroma, its hue moves just past the nearer edge of a reserved band
 * it sits in (`nudged` names that band, for the picker's one line of why), and
 * its OKLCH lightness rises until it reads at AA on every surface. Lifting is
 * always enough on Frapp's dark surfaces: at full lightness every color is
 * white, which reads on all of them. `null` only for a non-color.
 */
export function adjustRoleColor(
  input: string,
): { hex: string; nudged: ReservedRoleHue | null } | null {
  const oklch = hexToOklch(input);
  if (!oklch) return null;
  const grey = oklch.c < ROLE_COLOR_RESERVED_CHROMA;
  const { hue, band } = grey ? { hue: oklch.h, band: null } : nudgeHue(oklch.h);
  // Gamut clipping and hex rounding move the hue a fraction of a degree, which
  // near a band's edge can land it back inside; each retry steps further out.
  const away = awayFromBands(hue);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const h = hue + away * BAND_MARGIN * attempt;
    for (let l = oklch.l; l < 1 + LIGHTNESS_STEP; l += LIGHTNESS_STEP) {
      const hex = oklchToHex({ l: Math.min(l, 1), c: oklch.c, h });
      if (roleColorOrNull(hex) === hex) return { hex, nudged: band };
    }
  }
  return { hex: "#FFFFFF", nudged: band };
}

/**
 * The color a hue picker paints for `hue` (0–360, OKLCH degrees): that hue at
 * the palette's chroma, lifted until it reads, moved out of a reserved band
 * when it sits in one. Every result passes {@link isPaintableRoleColor}.
 */
export function roleColorForHue(hue: number): {
  hex: string;
  nudged: ReservedRoleHue | null;
} {
  // Nudged here, on the exact hue, rather than left to the adjustment: a hue
  // on a band's edge can round across it once it is a hex, and the picker's
  // line of why should follow where the slider sits.
  const { hue: allowed, band } = nudgeHue(hue);
  const { hex } = adjustRoleColor(
    oklchToHex({
      l: CUSTOM_START_LIGHTNESS,
      c: ROLE_COLOR_CUSTOM_CHROMA,
      h: allowed,
    }),
  )!;
  return { hex, nudged: band };
}

/**
 * The OKLCH hue of a color, for placing a picker's slider on a stored custom
 * color; `null` for a non-color or a grey with no meaningful hue.
 */
export function roleColorHue(hex: string): number | null {
  const oklch = hexToOklch(hex);
  if (!oklch || oklch.c < ROLE_COLOR_RESERVED_CHROMA) return null;
  return oklch.h;
}

/** Whether a paintable value is one of the ten quick picks rather than a custom hue. */
export function isPaletteRoleColor(value: string): value is RoleColorHex {
  return BY_UPPER_HEX.has(value.trim().toUpperCase());
}

/** The fields {@link topRoleColor} reads from a role row. */
export interface RoleColorSource extends RankableRole {
  color: string | null;
}

/**
 * The color a member wears: that of their highest-ranked role that has a
 * paintable color, or `null` when none of their roles has one.
 *
 * "Highest-ranked" is {@link compareRolesByRank}: the wildcard role, then
 * tier position, then the role's order inside its tier, the same rank that
 * names a member's title. A role with no color is skipped rather than
 * winning with nothing, so a Treasurer who is also a plain Member still reads
 * as Treasurer. Without `positions` every role counts as outside the tiers,
 * which falls back to `display_order`.
 */
export function topRoleColor(
  roles: readonly RoleColorSource[],
  roleIds: readonly string[],
  positions: TierPositions = new Map(),
): string | null {
  if (roleIds.length === 0) return null;
  const held = new Set(roleIds);
  const colored = roles.filter(
    (role) => held.has(role.id) && roleColorOrNull(role.color) !== null,
  );
  const best = highestRankedRole(colored, positions);
  return best ? roleColorOrNull(best.color) : null;
}
