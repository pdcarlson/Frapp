import { foldMentionName } from "./mentions";
import { can } from "./permissions";

/**
 * The chapter's Everyone role (#4191, Paul 2026-11-11: "@members should just
 * be @everyone in my opinion, and there should not be a member role").
 *
 * It is the role that used to be called Member, kept under its rename-proof
 * key (`roles.system_key = 'MEMBER'`) so every stored reference to it keeps
 * working: members' `role_ids`, invites, `default_invite_role_id`, channel
 * lists and mobile builds already in the store. It is held by exactly the
 * members who held Member and sits in the same tier, so nobody's access or
 * rank moved. What changed is that no list, chip, filter or picker offers it,
 * nobody assigns or removes it, and pinging it means `@everyone`
 * (`spec/behavior/rbac.md` § The Everyone role).
 */
export const EVERYONE_ROLE_SYSTEM_KEY = "MEMBER";

/** The Everyone role's name. Fixed: the API refuses to rename it. */
export const EVERYONE_ROLE_NAME = "Everyone";

/** How the mention picker writes it: `@everyone`, as Discord does. */
export const EVERYONE_MENTION_NAME = "everyone";

/**
 * Whether a role row is the chapter's Everyone role. Read defensively, since
 * `GET /v1/roles` declares no response schema.
 */
export function isEveryoneRole(role: unknown): boolean {
  return (
    !!role &&
    typeof role === "object" &&
    (role as Record<string, unknown>).system_key === EVERYONE_ROLE_SYSTEM_KEY
  );
}

/** `roles` without the Everyone role, in the same order. */
export function withoutEveryoneRole<T>(roles: readonly T[]): T[] {
  return roles.filter((role) => !isEveryoneRole(role));
}

/**
 * Whether `name` would read as `@everyone` in a message: another role named
 * so would make the token ambiguous, which reaches nobody (§ Role mentions),
 * so the API refuses it for any role but Everyone.
 */
export function isEveryoneRoleName(name: string): boolean {
  return foldMentionName(name) === EVERYONE_MENTION_NAME;
}

/** The seeded roles that rank below Everyone: making someone one of these
 * takes Everyone away, as unticking Member used to. */
const BELOW_EVERYONE_SYSTEM_KEYS: ReadonlySet<unknown> = new Set([
  "NEW_MEMBER",
  "ALUMNI",
]);

/** A role row as {@link rolesAfterSave} reads it. */
export interface EveryoneSaveRole {
  id: string;
  system_key?: string | null;
  permissions?: readonly string[] | null;
}

/**
 * The role ids a member ends up with when a save asks for `requested` (#4191).
 * Nobody ticks or unticks Everyone: the clients don't offer it, and a mobile
 * build already in the store draws it as a chip whose tap must not move it.
 * So whatever the save sent, Everyone follows what the save means:
 *
 * - **Given** when the save leaves the member with no role granting member
 *   access (`members:view` or `*`, as `memberAccessRoleIds` reads it), the way
 *   a redeem has always added it and the way Discord leaves a member with no
 *   roles holding `@everyone`. Taking New Member away is how an officer makes
 *   a new member a plain member now that Member is no longer a role to tick.
 * - **Taken away** when the save gives the member the New Member or Alumni
 *   role, which rank below it: graduating a member used to mean unticking
 *   Member and ticking Alumni, and an alumnus must not keep what members get.
 * - **Kept as held** otherwise, so a member promoted to a chair keeps it.
 *
 * A chapter with no Everyone role (the legacy `system_key` gap) gets
 * `requested` unchanged. The API applies this to every
 * `PATCH /v1/members/:id/roles`; web's member sheet and mobile's roles sheet
 * apply it before asking whether a save takes access away.
 */
export function rolesAfterSave(
  requested: readonly string[],
  held: readonly string[],
  roles: readonly EveryoneSaveRole[],
): string[] {
  const everyone = roles.find(isEveryoneRole);
  if (!everyone) return [...requested];
  const others = requested.filter((id) => id !== everyone.id);
  const byId = new Map(roles.map((role) => [role.id, role]));
  const givesAccess = others.some((id) =>
    can("members:view", byId.get(id)?.permissions),
  );
  if (!givesAccess) return [...others, everyone.id];
  const madeLower = others.some(
    (id) =>
      !held.includes(id) &&
      BELOW_EVERYONE_SYSTEM_KEYS.has(byId.get(id)?.system_key),
  );
  if (madeLower || !held.includes(everyone.id)) return others;
  // Kept where the save put it, or where the member had it.
  return requested.includes(everyone.id)
    ? [...requested]
    : [...others, everyone.id];
}
