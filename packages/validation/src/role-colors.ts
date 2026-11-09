/**
 * The fixed set of colors a chapter role can wear (#3485).
 *
 * A role's color paints text: a chat author's name, and the dot on a role
 * chip. Text on Frapp's charcoal surfaces has to stay readable, so roles pick
 * from this list instead of a free hex picker. Every swatch clears WCAG AA for
 * normal text (4.5:1) on every surface a name sits on, a hovered row's
 * `--card-hover` included (lowest is Violet at 4.95:1 there, 5.9:1 on the
 * popover). `apps/web/components/roles/role-colors-contrast.spec.ts` guards it
 * against the token source.
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
export interface RoleColorSource {
  id: string;
  color: string | null;
  display_order: number;
}

/**
 * The color a member wears: that of their highest-ranked role that has a
 * palette color, or `null` when none of their roles has one.
 *
 * "Highest-ranked" is the lowest `display_order`, the order the Roles page
 * lists them in and the one the presidency fallback ranks by. A role with no
 * color is skipped rather than winning with nothing, so a Treasurer who is
 * also a plain Member still reads as Treasurer. Ties on `display_order` fall
 * back to the role id, so the answer does not depend on row order.
 */
export function topRoleColor(
  roles: readonly RoleColorSource[],
  roleIds: readonly string[],
): RoleColorHex | null {
  if (roleIds.length === 0) return null;
  const held = new Set(roleIds);
  let best: { order: number; id: string; hex: RoleColorHex } | null = null;
  for (const role of roles) {
    if (!held.has(role.id)) continue;
    const hex = roleColorOrNull(role.color);
    if (!hex) continue;
    if (
      !best ||
      role.display_order < best.order ||
      (role.display_order === best.order && role.id < best.id)
    ) {
      best = { order: role.display_order, id: role.id, hex };
    }
  }
  return best?.hex ?? null;
}

/** One role as a member's profile draws it: a chip with its color dot. */
export interface MemberRoleChip {
  id: string;
  name: string;
  /** The role's palette color, or `null` for a plain chip. */
  color: RoleColorHex | null;
}

function roleRows(data: unknown): Record<string, unknown>[] {
  if (!Array.isArray(data)) return [];
  return data.filter(
    (row): row is Record<string, unknown> =>
      typeof row === "object" && row !== null && !Array.isArray(row),
  );
}

/**
 * `role_ids` → role chips, resolved off `GET /v1/roles` and ordered the way
 * the chapter ranks its roles (`display_order`, then name), so the member's
 * top role leads, the same rank that picks their name color (#3485, #3710).
 * Both clients' member profiles draw from it (web's sheet since #3726).
 *
 * That endpoint declares no response schema (`openapi-typescript` infers
 * `never`), so it is read defensively rather than cast. A role id with no
 * match (a since-deleted role, or the list still loading) is dropped rather
 * than rendered as a raw id, and a duplicate id (the API does not dedupe
 * `role_ids`) contributes its chip only once.
 */
export function resolveRoleChips(
  rolesData: unknown,
  roleIds: readonly string[],
): MemberRoleChip[] {
  if (roleIds.length === 0) return [];
  const held = new Set(roleIds);
  const chips: Array<MemberRoleChip & { order: number }> = [];
  for (const row of roleRows(rolesData)) {
    const id = typeof row.id === "string" ? row.id : null;
    const name = typeof row.name === "string" && row.name ? row.name : null;
    if (!id || !name || !held.has(id)) continue;
    held.delete(id);
    chips.push({
      id,
      name,
      color: roleColorOrNull(row.color),
      order:
        typeof row.display_order === "number" &&
        Number.isFinite(row.display_order)
          ? row.display_order
          : Number.MAX_SAFE_INTEGER,
    });
  }
  return chips
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    .map(({ id, name, color }) => ({ id, name, color }));
}

/**
 * `custom_role_ids` → custom role labels, resolved off `GET /v1/custom-roles`
 * — a `chapter-config:view`-gated read, unlike `GET /v1/roles`. The caller
 * passes `undefined` when the viewer cannot resolve it (rather than fetching
 * a 403), so this degrades to nothing shown, never a raw id.
 */
export function resolveCustomRoleNames(
  customRolesData: readonly { id: string; label: string }[] | undefined,
  customRoleIds: readonly string[],
): string[] {
  if (customRoleIds.length === 0 || !customRolesData) return [];
  const byId = new Map(customRolesData.map((role) => [role.id, role.label]));
  return [...new Set(customRoleIds)]
    .map((id) => byId.get(id))
    .filter((label): label is string => !!label);
}
