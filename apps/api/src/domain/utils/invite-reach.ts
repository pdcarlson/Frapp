/**
 * Which roles an invite may grant (#4071, #4546, #1830), shared by invite
 * create and redeem (`InviteService`) and the chapter's default invite role
 * (`ChapterConfigService`).
 *
 * Paul, 2026-11-16 (#1830):
 * - No invite grants a role carrying `*`, the President's included. Presidency
 *   moves only through Transfer presidency, or a claim when it is orphaned
 *   (`spec/behavior/rbac.md` § Presidency Transfer).
 * - An invite may only grant a role ranked strictly below the inviter's own,
 *   never a peer's or a superior's. It is checked when the invite is made and
 *   again at redeem against the inviter's roles then, so a demoted inviter's
 *   old invites can't out-rank them.
 *
 * The inviter must also hold every permission the role carries, so an invite
 * into a junior role cannot bring in what the inviter lacks. What the
 * chapter's Everyone role carries is exempt: every member gets it.
 *
 * The Everyone role itself is exempt from the rank rule. It is the floor every
 * member holds, so joining with it grants nobody more than any member has,
 * and ranked strictly it would be out of reach of every inviter who ranks
 * there too.
 */
import type { Role } from '#domain/entities/role.entity';
import { SystemRoleKeys, WILDCARD } from '#domain/constants/permissions';
import {
  permissionsNotHeld,
  ranksAtOrAbove,
  roleRank,
} from '#domain/utils/role-rank';
import type { RankContext } from '#domain/utils/rank-context';

/** Why an invite can't grant a role carrying `*`. */
export const INVITE_PRESIDENT_REFUSAL =
  'An invite cannot grant the President role; use Transfer presidency.';

/** Why an invite can't grant a role at or above the inviter's rank. */
const INVITE_RANK_REFUSAL =
  'You can only invite people into a role ranked below your own.';

/** The chapter's Everyone role, by its rename-proof key. */
export function everyoneRoleOf(context: RankContext): Role | undefined {
  return context.roles.find((r) => r.system_key === SystemRoleKeys.EVERYONE);
}

/**
 * Why the actor in `context` may not invite someone into `role`, in plain
 * words, or null when they may. An absent role (a chapter with no Everyone
 * role to fall back to) refuses nothing.
 */
export function inviteRefusal(
  context: RankContext,
  role: Role | undefined,
): string | null {
  if (!role) return null;
  if (role.permissions.includes(WILDCARD)) return INVITE_PRESIDENT_REFUSAL;
  const { reach, positions } = context;
  const everyone = everyoneRoleOf(context);
  if (
    !reach.wildcard &&
    role.id !== everyone?.id &&
    ranksAtOrAbove(roleRank(role, positions), reach.rank)
  ) {
    return INVITE_RANK_REFUSAL;
  }
  const base = new Set(everyone?.permissions ?? []);
  const missing = permissionsNotHeld(reach, role.permissions).filter(
    (permission) => !base.has(permission),
  );
  if (missing.length > 0) {
    return `You can only invite people into a role whose permissions you hold: ${missing.join(', ')}.`;
  }
  return null;
}
