import {
  highestRankedRole,
  type RankableRole,
  type TierPositions,
} from "./role-rank";
/**
 * The fixed set of colors a chapter role can wear (#3485).
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
 * or an error, and gold, which is Signet's own colour for the Ask surface.
 *
 * The API accepts only these values on `POST /v1/roles` and
 * `PATCH /v1/roles/{id}`, and clients render only these values (see
 * {@link roleColorOrNull}), so a legacy free-picked hex in the column paints
 * nothing rather than something unreadable.
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
 * The palette hex a stored value names, or `null` when it names none.
 *
 * Case-insensitive, because the column is free text and older writes may
 * differ in case. Anything outside the palette (including the pre-#3485 seeds
 * `#FFD700`, `#10B981` and `#6B7280`, and any hex the old web picker allowed)
 * is `null`, so a render path never paints a color nobody checked for contrast.
 */
export function roleColorOrNull(value: unknown): RoleColorHex | null {
  if (typeof value !== "string") return null;
  return BY_UPPER_HEX.get(value.trim().toUpperCase()) ?? null;
}

/** The fields {@link topRoleColor} reads from a role row. */
export interface RoleColorSource extends RankableRole {
  color: string | null;
}

/**
 * The color a member wears: that of their highest-ranked role that has a
 * palette color, or `null` when none of their roles has one.
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
): RoleColorHex | null {
  if (roleIds.length === 0) return null;
  const held = new Set(roleIds);
  const colored = roles.filter(
    (role) => held.has(role.id) && roleColorOrNull(role.color) !== null,
  );
  const best = highestRankedRole(colored, positions);
  return best ? roleColorOrNull(best.color) : null;
}
