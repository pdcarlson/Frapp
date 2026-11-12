import { asArray } from "@/lib/utils";

/**
 * A role as the Roles pages read it from `GET /v1/roles`, which declares no
 * response schema, so it is read defensively, like `normalizeRoleOptions`.
 */
export type TieredRole = {
  id: string;
  name: string;
  color: string | null;
  permissions: string[];
  is_system: boolean;
  display_order: number;
  mentionable: boolean;
  /** The role's tier, or `null` for a role outside the tiers. */
  tier_id: string | null;
  /** Permission to `true` (on whatever the tier says) or `false` (off). */
  permission_overrides: Record<string, boolean>;
};

export type TierRow = {
  id: string;
  name: string;
  /** 1 is highest. */
  position: number;
  permissions: string[];
};

export function normalizeTieredRoles(data: unknown): TieredRole[] {
  return asArray<Record<string, unknown>>(data)
    .filter(
      (role) => typeof role.id === "string" && typeof role.name === "string",
    )
    .map((role) => ({
      id: String(role.id),
      name: String(role.name),
      color: typeof role.color === "string" ? role.color : null,
      permissions: Array.isArray(role.permissions)
        ? role.permissions.map(String)
        : [],
      is_system: Boolean(role.is_system),
      display_order: Number(role.display_order ?? 0),
      mentionable: role.mentionable !== false,
      tier_id: typeof role.tier_id === "string" ? role.tier_id : null,
      permission_overrides: readOverrides(role.permission_overrides),
    }));
}

function readOverrides(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, boolean> = {};
  for (const [key, on] of Object.entries(value as Record<string, unknown>)) {
    if (typeof on === "boolean") out[key] = on;
  }
  return out;
}

export function normalizeTiers(data: unknown): TierRow[] {
  return asArray<Record<string, unknown>>(data)
    .filter((tier) => typeof tier.id === "string")
    .map((tier) => ({
      id: String(tier.id),
      name: String(tier.name ?? ""),
      position: Number(tier.position ?? 0),
      permissions: Array.isArray(tier.permissions)
        ? tier.permissions.map(String)
        : [],
    }))
    .sort((a, b) => a.position - b.position);
}

/** Roles in list order: the order officers set, then by name. */
export function byDisplayOrder(a: TieredRole, b: TieredRole): number {
  return a.display_order - b.display_order || a.name.localeCompare(b.name);
}

export function isWildcardRole(role: Pick<TieredRole, "permissions">): boolean {
  return role.permissions.includes("*");
}

/*
 * The rank rules, as the API enforces them (`apps/api/src/domain/utils/
 * role-rank.ts`, #4071), mirrored here only to disable controls that would
 * 403 and say why. The API stays the authority: a refusal it sends still
 * lands as a toast.
 *
 * A rank is a tier position: lower is higher. A role holding `*` ranks above
 * every tier; a role outside the tiers ranks below every tier.
 */
const WILDCARD_RANK = 0;
const OUTSIDE_TIERS_RANK = Number.POSITIVE_INFINITY;

function roleRank(role: TieredRole, positions: ReadonlyMap<string, number>) {
  if (isWildcardRole(role)) return WILDCARD_RANK;
  if (role.tier_id === null) return OUTSIDE_TIERS_RANK;
  return positions.get(role.tier_id) ?? OUTSIDE_TIERS_RANK;
}

export type Reach = {
  /** Holds `*`: reaches everything. */
  wildcard: boolean;
  /** Whether the caller's own roles have been read, so `rank` is real. */
  known: boolean;
  /** The caller's own rank; they reach only what ranks strictly below it. */
  rank: number;
  /** What the caller holds, for the "never grant what you lack" rule. */
  held: ReadonlySet<string>;
};

export function callerReach(
  myRoleIds: readonly string[] | null,
  myPermissions: readonly string[],
  roles: readonly TieredRole[],
  tiers: readonly TierRow[],
): Reach {
  const positions = new Map(tiers.map((tier) => [tier.id, tier.position]));
  let rank = OUTSIDE_TIERS_RANK;
  for (const role of roles) {
    if (myRoleIds?.includes(role.id)) {
      rank = Math.min(rank, roleRank(role, positions));
    }
  }
  const wildcard = myPermissions.includes("*");
  return {
    wildcard,
    // Until the caller's own roles are read, their rank is unknown, and a
    // control that looks refused would be a guess.
    known: wildcard || myRoleIds !== null,
    rank,
    held: new Set(myPermissions),
  };
}

/** Whether the caller may edit a tier: only one ranked below their own. */
export function reachesTier(reach: Reach, tier: TierRow): boolean {
  return reach.wildcard || tier.position > reach.rank;
}

/**
 * Whether the caller may edit a role: below their own rank, and never a `*`
 * role, which moves only through Transfer presidency.
 */
export function reachesRole(
  reach: Reach,
  role: TieredRole,
  tiers: readonly TierRow[],
): boolean {
  if (isWildcardRole(role)) return false;
  if (reach.wildcard) return true;
  const positions = new Map(tiers.map((tier) => [tier.id, tier.position]));
  return roleRank(role, positions) > reach.rank;
}

/**
 * Whether the caller may put a role outside the tiers: that ranks below every
 * tier, so anyone who sits in a tier reaches it.
 */
export function reachesOutside(reach: Reach): boolean {
  return reach.wildcard || reach.rank < OUTSIDE_TIERS_RANK;
}

/** Whether the caller may switch this permission on for someone else. */
export function mayGrant(reach: Reach, permission: string): boolean {
  return reach.wildcard || reach.held.has(permission);
}

/**
 * The chapter's word for a tier, as a heading ("Tier") and in running text
 * ("tier"), with a plural. The word is the chapter's own (`tier` vocabulary,
 * #4068 decision 5), so this never assumes it is "Tier".
 */
export function tierWords(word: string) {
  const singular = word.trim() || "Tier";
  const plural = /s$/i.test(singular) ? singular : `${singular}s`;
  const lower = (text: string) =>
    // Keep a chapter's acronym ("NME") as written.
    text === text.toUpperCase() ? text : text.toLowerCase();
  return {
    Singular: singular.charAt(0).toUpperCase() + singular.slice(1),
    Plural: plural.charAt(0).toUpperCase() + plural.slice(1),
    singular: lower(singular),
    plural: lower(plural),
  };
}
