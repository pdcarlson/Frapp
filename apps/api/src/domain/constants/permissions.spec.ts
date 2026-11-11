import { MODULE_CATALOG } from '@repo/org-archetypes';
import { PERMISSION_MODULES, PERMISSION_REGISTRY } from '@repo/validation';
import {
  DEFAULT_SYSTEM_ROLES,
  STARTING_ROLE_TIERS,
  SystemPermissions,
} from './permissions';

describe('DEFAULT_SYSTEM_ROLES', () => {
  it('includes members:view on Vice President and Secretary for PollController / PointsController class guards', () => {
    for (const name of ['Vice President', 'Secretary'] as const) {
      const role = DEFAULT_SYSTEM_ROLES.find((r) => r.name === name);
      expect(role).toBeDefined();
      expect(role!.permissions).toContain(SystemPermissions.MEMBERS_VIEW);
      expect(role!.permissions).toContain(SystemPermissions.POLLS_VIEW_ALL);
    }
  });
});

// #4071: tiers arrived without changing what a new chapter's roles can do.
// The lists are spelled out as they stood before tiers (Member with the
// recruitment keys #4070 gave it) so that a change to a
// starting tier or a seeded role fails here and has to be meant. Beside its
// wildcard the President now also lists its tier's two permissions, which the
// wildcard already covered.
describe('DEFAULT_SYSTEM_ROLES permissions', () => {
  it('gives each seeded role what it held before tiers', () => {
    expect(
      Object.fromEntries(
        DEFAULT_SYSTEM_ROLES.map((role) => [
          role.system_key,
          [...role.permissions].sort(),
        ]),
      ),
    ).toEqual({
      PRESIDENT: ['*', 'members:view', 'polls:view_all'],
      TREASURER: [
        'billing:manage',
        'billing:view',
        'events:create',
        'events:update',
        'members:view',
        'points:adjust',
        'points:view_all',
        'polls:view_all',
        'reports:export',
      ],
      VICE_PRESIDENT: ['members:view', 'polls:view_all'],
      SECRETARY: ['members:view', 'polls:view_all'],
      MEMBER: [
        'backwork:upload',
        'members:view',
        'polls:create',
        'rush:add',
        'rush:bid',
        'rush:notes',
        'rush:view',
        'rush:view_results',
        'rush:vote',
        'service:log',
      ],
      NEW_MEMBER: ['backwork:upload', 'members:view'],
      ALUMNI: ['alumni:post', 'members:view'],
    });
  });

  it('never puts the wildcard on a starting tier', () => {
    for (const tier of STARTING_ROLE_TIERS) {
      expect(tier.permissions).not.toContain(SystemPermissions.WILDCARD);
    }
  });
});

// #3485: the seeded role colors the owner picked. Spelled out rather than read
// from DEFAULT_SYSTEM_ROLES so a change to a default fails here, and the
// migration 20261105200000_role_color_palette_defaults.sql carries the same
// values for existing chapters.
describe('DEFAULT_SYSTEM_ROLES colors', () => {
  it('seeds the palette defaults, and none for Member and New Member', () => {
    const colors = Object.fromEntries(
      DEFAULT_SYSTEM_ROLES.map((role) => [role.system_key, role.color]),
    );
    expect(colors).toEqual({
      PRESIDENT: '#F2994A',
      TREASURER: '#6FD08C',
      VICE_PRESIDENT: '#8FA8FF',
      SECRETARY: '#F47FA4',
      MEMBER: null,
      NEW_MEMBER: null,
      ALUMNI: '#A9B4C2',
    });
  });
});

// #4069: the guards enforce `SystemPermissions`; the words for each entry live
// in `PERMISSION_REGISTRY` (`@repo/validation`). One list without the other is
// either a permission no screen can name or a row that gates nothing.
describe('SystemPermissions and PERMISSION_REGISTRY', () => {
  it('list the same permission strings', () => {
    expect(PERMISSION_REGISTRY.map((entry) => entry.permission).sort()).toEqual(
      [...Object.values(SystemPermissions)].sort(),
    );
  });

  it('files every permission under a module catalog key, or chapter', () => {
    const moduleKeys = new Set(MODULE_CATALOG.map((module) => module.key));
    for (const module of PERMISSION_MODULES) {
      if (module.key === 'chapter') continue;
      expect(moduleKeys).toContain(module.key);
    }
  });
});
