import {
  can,
  isEveryoneRole,
  roleColorOrNull,
  WILDCARD_PERMISSION,
} from "@repo/validation";

/*
 * The shared reading of `useRoles()` (`GET /v1/roles`) for web and the phone
 * (#4164): the role pickers, filters and member role editors outside the
 * Roles pages read their rows here, with one `locked` rule. The endpoint
 * declares no response schema (#1049), so the payload is read defensively.
 * The Roles pages read the tier fields through `normalizeTieredRoles`
 * (`./role-tiers`).
 */

/** A chapter role as every surface outside the Roles pages reads it. */
export type ChapterRole = {
  id: string;
  name: string;
  /** A palette color, or `null` for a legacy or free-typed value. */
  color: ReturnType<typeof roleColorOrNull>;
  permissions: string[];
  is_system: boolean;
  /** The seeded role's rename-proof key (`MEMBER`, `PRESIDENT`), or `null`. */
  system_key: string | null;
  /** See {@link isLockedRole}. */
  locked: boolean;
  /**
   * The Everyone role (#4191): no picker, filter or column offers it, but it
   * is kept so a lookup from id to name, and a save's access question, still
   * find it.
   */
  everyone: boolean;
  /**
   * Holding it is enough to open chat, the roster and events: it grants
   * `members:view` (or `*`), the shared rule in `memberAccessRoleIds`.
   */
  grantsBase: boolean;
  /** Members add and remove it themselves (#4958). */
  selfAssignable: boolean;
};

/**
 * Whether a role is locked: nobody adds it to or removes it from a member
 * outside Transfer presidency. The rule is the API's: `PATCH
 * /v1/members/:id/roles` refuses any role that carries the wildcard `*`,
 * keyed on the permission and not on the seeded President row
 * (`spec/behavior/rbac.md` § Custom roles folded into roles, and § Presidency
 * Transfer), so a legacy non-system role still carrying a pre-validation `*`
 * is locked too. Offering it would only earn a 403.
 */
export function isLockedRole(permissions: readonly string[]): boolean {
  return permissions.includes(WILDCARD_PERMISSION);
}

/**
 * `GET /v1/roles` as {@link ChapterRole} rows, in the order the API returns
 * them. A row without a string `id` and `name` is dropped. A blank name is
 * kept, as the Roles pages keep it: the API accepts one, and hiding the role
 * would leave a member holding a role no editor can untick.
 */
export function parseChapterRoles(data: unknown): ChapterRole[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row: unknown): ChapterRole[] => {
    if (!row || typeof row !== "object") return [];
    const role = row as Record<string, unknown>;
    if (typeof role.id !== "string" || typeof role.name !== "string") {
      return [];
    }
    const permissions = Array.isArray(role.permissions)
      ? role.permissions.filter((p): p is string => typeof p === "string")
      : [];
    return [
      {
        id: role.id,
        name: role.name,
        color: roleColorOrNull(role.color),
        permissions,
        is_system: role.is_system === true,
        system_key:
          typeof role.system_key === "string" ? role.system_key : null,
        locked: isLockedRole(permissions),
        everyone: isEveryoneRole(role),
        grantsBase: can("members:view", permissions),
        selfAssignable: role.self_assignable === true,
      },
    ];
  });
}

/** A role as a picker or checklist offers it. */
export type RoleOption = {
  id: string;
  name: string;
  /**
   * Offered only where it is already set: the Everyone role, under `"hide"`
   * in {@link EveryoneRoleUse}.
   */
  hidden?: boolean;
};

/**
 * What a surface does with the chapter's Everyone role (#4191), which no list
 * or picker offers: `"drop"` leaves it out (pickers, filters, the default
 * invite role), `"keep"` keeps it (a lookup from id to name), `"hide"` keeps it
 * marked `hidden` (an attendance editor, which shows it only on an event
 * already set apart for it).
 */
export type EveryoneRoleUse = "drop" | "keep" | "hide";

/**
 * The roles payload as `{ id, name }` options, Everyone per `everyone`. A
 * picker that assigns a role (an invite's role, the default invite role)
 * passes `{ dropLocked: true }`, since the API refuses a {@link isLockedRole}
 * role there; a list that only names or filters roles keeps it.
 */
export function toRoleOptions(
  data: unknown,
  everyone: EveryoneRoleUse = "drop",
  { dropLocked = false }: { dropLocked?: boolean } = {},
): RoleOption[] {
  return parseChapterRoles(data).flatMap((role): RoleOption[] => {
    if (dropLocked && role.locked) return [];
    if (role.everyone) {
      if (everyone === "drop") return [];
      if (everyone === "hide") {
        return [{ id: role.id, name: role.name, hidden: true }];
      }
    }
    return [{ id: role.id, name: role.name }];
  });
}
