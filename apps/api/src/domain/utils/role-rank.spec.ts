import {
  addedPermissions,
  canReach,
  effectivePermissions,
  holderRank,
  OUTSIDE_TIERS_RANK,
  permissionsNotHeld,
  ranksAtOrAbove,
  roleRank,
  tierPositions,
  WILDCARD_RANK,
  type ActorReach,
} from './role-rank';

// A chapter that renamed and reordered its tiers: nothing here may read a
// tier's name or assume there are four (#4068 decision 5).
const positions = tierPositions([
  { id: 'board', position: 1 },
  { id: 'chairs', position: 2 },
  { id: 'brothers', position: 3 },
]);

const role = (tier_id: string | null, permissions: string[] = []) => ({
  tier_id,
  permissions,
});

function actor(rank: number, permissions: string[] = []): ActorReach {
  return {
    memberId: 'm',
    rank,
    permissions: new Set(permissions),
    wildcard: permissions.includes('*'),
  };
}

describe('roleRank', () => {
  it("reads the chapter's own position for the role's tier", () => {
    expect(roleRank(role('chairs'), positions)).toBe(2);
  });

  it('ranks a role outside the tiers, or in a tier it cannot find, below every tier', () => {
    expect(roleRank(role(null), positions)).toBe(OUTSIDE_TIERS_RANK);
    expect(roleRank(role('deleted'), positions)).toBe(OUTSIDE_TIERS_RANK);
  });

  it('ranks a wildcard role above everything, wherever it sits', () => {
    expect(roleRank(role('brothers', ['*']), positions)).toBe(WILDCARD_RANK);
  });
});

describe('holderRank and ranksAtOrAbove', () => {
  it("takes the highest of a member's roles", () => {
    expect(
      holderRank([role('brothers'), role('chairs'), role(null)], positions),
    ).toBe(2);
    expect(holderRank([], positions)).toBe(OUTSIDE_TIERS_RANK);
  });

  it('answers whether A ranks at or above B', () => {
    expect(ranksAtOrAbove(1, 2)).toBe(true);
    expect(ranksAtOrAbove(2, 2)).toBe(true);
    expect(ranksAtOrAbove(3, 2)).toBe(false);
    expect(ranksAtOrAbove(OUTSIDE_TIERS_RANK, OUTSIDE_TIERS_RANK)).toBe(true);
  });
});

describe('canReach', () => {
  it('reaches only what ranks strictly below the actor', () => {
    const chair = actor(2);
    expect(canReach(chair, 3)).toBe(true);
    expect(canReach(chair, OUTSIDE_TIERS_RANK)).toBe(true);
    expect(canReach(chair, 2)).toBe(false);
    expect(canReach(chair, 1)).toBe(false);
    expect(canReach(chair, WILDCARD_RANK)).toBe(false);
  });

  it('reaches nothing from outside the tiers', () => {
    expect(canReach(actor(OUTSIDE_TIERS_RANK), OUTSIDE_TIERS_RANK)).toBe(false);
  });

  it('lets a wildcard holder reach everything', () => {
    expect(canReach(actor(WILDCARD_RANK, ['*']), WILDCARD_RANK)).toBe(true);
  });
});

describe('permissionsNotHeld', () => {
  it('lists what the actor would grant without holding, once each, sorted', () => {
    expect(
      permissionsNotHeld(actor(2, ['tasks:manage']), [
        'tasks:manage',
        'roles:manage',
        'billing:view',
        'roles:manage',
      ]),
    ).toEqual(['billing:view', 'roles:manage']);
  });

  it('is empty for a wildcard holder', () => {
    expect(permissionsNotHeld(actor(0, ['*']), ['roles:manage'])).toEqual([]);
  });
});

describe('effectivePermissions', () => {
  // The same rule as the database's role_effective_permissions.
  it("is the tier's list plus overrides that are on, minus those that are off", () => {
    expect(
      effectivePermissions(['members:view', 'polls:create'], {
        'polls:create': false,
        'service:approve': true,
      }),
    ).toEqual(['members:view', 'service:approve']);
  });
});

describe('addedPermissions', () => {
  it('lists what after holds that before does not', () => {
    expect(addedPermissions(['a', 'b'], ['b', 'c', 'c', 'a'])).toEqual(['c']);
  });
});
