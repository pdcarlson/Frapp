/**
 * Self-assignable roles (#4958): roles members join and leave themselves, as
 * Discord's onboarding questions and reaction-role bots (Carl-bot) hand out
 * interest roles. Officers holding `roles:manage` choose which.
 *
 * Nobody may pick their way into power, so a role is pickable only while it
 * is safe (`spec/behavior/rbac.md` § Self-assignable roles):
 *
 * - **no system key**: never President, Everyone, New Member or Alumni;
 * - **outside the tiers**: a role there ranks below every tier, so it is never
 *   above Everyone and never a presidency claim-walk candidate, and no tier
 *   edit or reorder hands it a permission or lifts it;
 * - **no permission beyond seeing its channels**: none at all, or only
 *   `channels:read:<slug>` keys (what a Discord import gives its roles). What
 *   it opens is the channels whose who-can-see and who-can-post lists name it.
 *
 * The database holds a second copy (`role_self_assignable_safe`, migration
 * `20261114043300`), whose constraint refuses any write that leaves a marked
 * role unsafe. This copy is what the API answers 400 with and what clients
 * explain a disabled switch by. Each copy is tested on its own against the
 * same cases and nothing compares them, so change both together.
 */

/** The one permission prefix a self-assignable role may carry. */
const SELF_ASSIGNABLE_PERMISSION_PREFIX = "channels:read:";

/** A keyed role (President, Everyone, New Member, Alumni): 400. */
export const SELF_ASSIGNABLE_KEYED_CODE = "role.self_assignable_keyed";
/** A role in a tier: 400. */
export const SELF_ASSIGNABLE_TIERED_CODE = "role.self_assignable_tiered";
/** A role holding a permission beyond `channels:read:<slug>`: 400. */
export const SELF_ASSIGNABLE_PERMISSIONS_CODE =
  "role.self_assignable_permissions";
/** Joining or leaving a role that isn't marked, or isn't safe: 403. */
export const NOT_SELF_ASSIGNABLE_CODE = "role.not_self_assignable";

/** Why a role can't be made self-assignable, as the API's error code says. */
export type SelfAssignableRefusal =
  | typeof SELF_ASSIGNABLE_KEYED_CODE
  | typeof SELF_ASSIGNABLE_TIERED_CODE
  | typeof SELF_ASSIGNABLE_PERMISSIONS_CODE;

/** The fields of a role the rule reads; `GET /v1/roles` rows carry them. */
export interface SelfAssignableRoleFields {
  system_key?: string | null;
  tier_id?: string | null;
  permissions?: readonly string[] | null;
}

/** Whether `permission` is one a self-assignable role may carry. */
function isSelfAssignablePermission(permission: string): boolean {
  return (
    permission.startsWith(SELF_ASSIGNABLE_PERMISSION_PREFIX) &&
    permission.length > SELF_ASSIGNABLE_PERMISSION_PREFIX.length
  );
}

/**
 * The first rule a role breaks, or `null` when it may be self-assignable.
 * Checked in this order, so a keyed role in a tier reads as keyed.
 */
export function selfAssignableRefusal(
  role: SelfAssignableRoleFields,
): SelfAssignableRefusal | null {
  // `!= null`, as the database's `is null`: an empty string is still a key.
  if (role.system_key != null) return SELF_ASSIGNABLE_KEYED_CODE;
  if (role.tier_id != null) return SELF_ASSIGNABLE_TIERED_CODE;
  if ((role.permissions ?? []).some((p) => !isSelfAssignablePermission(p))) {
    return SELF_ASSIGNABLE_PERMISSIONS_CODE;
  }
  return null;
}

/** What each refusal tells the officer, on the API's 400 and in the clients. */
export const SELF_ASSIGNABLE_REFUSAL_COPY: Record<
  SelfAssignableRefusal,
  string
> = {
  [SELF_ASSIGNABLE_KEYED_CODE]:
    "Built-in roles like President, Everyone, New Member and Alumni are always given by officers.",
  [SELF_ASSIGNABLE_TIERED_CODE]:
    "Roles members pick themselves sit outside the tiers, since a tier carries rank. Move it out, or turn off Non-chapter business.",
  [SELF_ASSIGNABLE_PERMISSIONS_CODE]:
    "Roles members pick themselves only open channels, so they can't carry permissions. Turn its permissions off, or turn off Non-chapter business.",
};
