import type { Role, RoleTier } from '#domain/entities/role.entity';
import type { Member } from '#domain/entities/member.entity';
import {
  effectivePermissions,
  holderRank,
  tierPositions,
} from '#domain/utils/role-rank';
import { flattenPermissionSets } from '#domain/utils/permissions';
import type { RankContext } from '../../src/application/services/rbac.service';

/**
 * A real chapter's shape for the rank rules (#4071): a President, four exec
 * officers, a dozen chairs, and the brothers. The chairs' tier is where most
 * of the chapter's officers sit, and the case the rules exist for is a chair
 * who was given `roles:manage` trying to promote themselves.
 *
 * Tiers are named the chapter's own way, so a test that passes cannot be
 * reading a tier's name.
 */
export const CHAPTER_ID = 'chapter-tiered';

export const TIER = {
  board: 'tier-board',
  chairs: 'tier-chairs',
  brothers: 'tier-brothers',
  pledges: 'tier-pledges',
} as const;

const tier = (
  id: string,
  position: number,
  name: string,
  permissions: string[],
): RoleTier => ({
  id,
  chapter_id: CHAPTER_ID,
  position,
  name,
  permissions,
  created_at: '2026-11-11T00:00:00Z',
  updated_at: '2026-11-11T00:00:00Z',
});

const OFFICER = [
  'announcements:post',
  'channels:create',
  'channels:manage',
  'members:view',
  'service:approve',
  'tasks:manage',
];

export function tieredChapterTiers(): RoleTier[] {
  return [
    tier(TIER.board, 1, 'Cabinet', [
      ...OFFICER,
      'chapter-config:manage',
      'chapter-config:view',
      'roles:manage',
    ]),
    tier(TIER.chairs, 2, 'Committee heads', OFFICER),
    tier(TIER.brothers, 3, 'Brothers', ['members:view', 'service:log']),
    tier(TIER.pledges, 4, 'Associates', ['members:view']),
  ];
}

const role = (
  id: string,
  name: string,
  tierId: string | null,
  overrides: Record<string, boolean> = {},
): Role => {
  const tiers = tieredChapterTiers();
  const tierPermissions =
    tiers.find((candidate) => candidate.id === tierId)?.permissions ?? [];
  return {
    id,
    chapter_id: CHAPTER_ID,
    name,
    system_key: null,
    permissions: effectivePermissions(tierPermissions, overrides),
    is_system: false,
    display_order: 0,
    color: null,
    mentionable: true,
    tier_id: tierId,
    permission_overrides: overrides,
    created_at: '2026-11-11T00:00:00Z',
  };
};

export const ROLE = {
  president: 'role-president',
  vicePresident: 'role-vp',
  treasurer: 'role-treasurer',
  riskChair: 'role-risk-chair',
  socialChair: 'role-social-chair',
  brother: 'role-brother',
  treasuryAssistant: 'role-treasury-assistant',
  pledge: 'role-pledge',
  alumni: 'role-alumni',
} as const;

export function tieredChapterRoles(): Role[] {
  return [
    role(ROLE.president, 'President', TIER.board, { '*': true }),
    role(ROLE.vicePresident, 'Vice President', TIER.board),
    role(ROLE.treasurer, 'Treasurer', TIER.board, {
      'billing:manage': true,
      'billing:view': true,
    }),
    // The chapter gave its risk chair roles:manage, so this chair can reach
    // the roles routes at all.
    role(ROLE.riskChair, 'Risk chair', TIER.chairs, {
      'roles:manage': true,
      'members:invite': true,
    }),
    role(ROLE.socialChair, 'Social chair', TIER.chairs),
    role(ROLE.brother, 'Brother', TIER.brothers),
    // Ranked with the brothers but holding something the chairs lack.
    role(ROLE.treasuryAssistant, 'Treasury assistant', TIER.brothers, {
      'billing:view': true,
    }),
    role(ROLE.pledge, 'Associate', TIER.pledges),
    role(ROLE.alumni, 'Alumni', null, {
      'alumni:post': true,
      'members:view': true,
    }),
  ];
}

export const MEMBER = {
  president: 'member-president',
  vicePresident: 'member-vp',
  riskChair: 'member-risk-chair',
  brother: 'member-brother',
} as const;

export const USER = {
  president: 'user-president',
  vicePresident: 'user-vp',
  riskChair: 'user-risk-chair',
  brother: 'user-brother',
} as const;

const member = (id: string, userId: string, roleIds: string[]): Member =>
  ({
    id,
    user_id: userId,
    chapter_id: CHAPTER_ID,
    role_ids: roleIds,
  }) as Member;

export function tieredChapterMembers(): Member[] {
  return [
    member(MEMBER.president, USER.president, [ROLE.president]),
    member(MEMBER.vicePresident, USER.vicePresident, [
      ROLE.vicePresident,
      ROLE.brother,
    ]),
    member(MEMBER.riskChair, USER.riskChair, [ROLE.riskChair, ROLE.brother]),
    member(MEMBER.brother, USER.brother, [ROLE.brother]),
  ];
}

/**
 * What `RbacService.getRankContext` answers for `userId` in this chapter, for
 * specs that mock it. `tiers` defaults to the fixture's.
 */
export function tieredRankContext(
  userId: string,
  tiers: RoleTier[] = tieredChapterTiers(),
): RankContext {
  const roles = tieredChapterRoles();
  const positions = tierPositions(tiers);
  const member = tieredChapterMembers().find((m) => m.user_id === userId);
  const held = roles.filter((role) => member?.role_ids.includes(role.id));
  const permissions = flattenPermissionSets(held.map((r) => r.permissions));
  return {
    reach: {
      memberId: member?.id ?? null,
      rank: holderRank(held, positions),
      permissions,
      wildcard: permissions.has('*'),
    },
    roles,
    tiers,
    positions,
  };
}
