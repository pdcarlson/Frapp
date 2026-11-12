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

// #4071: what a new chapter's seeded roles hold, spelled out so that a change
// to a starting tier or a seeded role fails here and has to be meant. The
// exec roles carry the officer defaults Paul set on 2026-11-10 (#4068
// decision 9). Since #3709 (social trust) every tier but New members also
// carries what any member can do, events:create among it, so an officer can
// do what the members they lead can, and the Exec board edits and deletes any
// event, which is what makes one required or worth points.
const MEMBER = [
  'backwork:upload',
  'events:create',
  'members:view',
  'polls:create',
  'rush:add',
  'rush:bid',
  'rush:notes',
  'rush:view',
  'rush:view_results',
  'rush:vote',
  'service:log',
];
const EXEC_BOARD = [
  ...MEMBER,
  'announcements:post',
  'channels:create',
  'channels:manage',
  'chapter-config:manage',
  'chapter-config:view',
  'events:delete',
  'events:update',
  'polls:view_all',
  'roles:manage',
  'service:approve',
  'tasks:manage',
].sort();

describe('DEFAULT_SYSTEM_ROLES permissions', () => {
  it('gives each seeded role its tier plus its own', () => {
    expect(
      Object.fromEntries(
        DEFAULT_SYSTEM_ROLES.map((role) => [
          role.system_key,
          [...role.permissions].sort(),
        ]),
      ),
    ).toEqual({
      PRESIDENT: ['*', ...EXEC_BOARD],
      TREASURER: [
        ...EXEC_BOARD,
        'billing:manage',
        'billing:view',
        'points:adjust',
        'points:view_all',
        'reports:export',
      ].sort(),
      VICE_PRESIDENT: EXEC_BOARD,
      SECRETARY: EXEC_BOARD,
      MEMBER,
      NEW_MEMBER: ['backwork:upload', 'members:view'],
      ALUMNI: ['alumni:post', 'members:view'],
    });
  });

  // #4068 decision 9: the top two starting tiers approve service hours, post
  // announcements and manage tasks and channels; only the top one manages
  // roles and chapter settings.
  it('gives the officer defaults to the top two starting tiers only', () => {
    const officer = [
      'announcements:post',
      'channels:create',
      'channels:manage',
      'service:approve',
      'tasks:manage',
    ];
    const [exec, chairs, members, newMembers] = STARTING_ROLE_TIERS.map(
      (tier) => new Set<string>(tier.permissions),
    );
    for (const permission of officer) {
      expect(exec.has(permission)).toBe(true);
      expect(chairs.has(permission)).toBe(true);
      expect(members.has(permission)).toBe(false);
      expect(newMembers.has(permission)).toBe(false);
    }
    for (const permission of [
      'roles:manage',
      'chapter-config:view',
      'chapter-config:manage',
    ]) {
      expect(exec.has(permission)).toBe(true);
      expect(chairs.has(permission)).toBe(false);
    }
  });

  // #3709: every member can create an event and upload backwork, whatever
  // tier their role sits in, but only an events:update holder makes anyone
  // required or attaches points: of the starting tiers, the Exec board only.
  it('lets every tier but New members create events, and only the Exec board edit them', () => {
    const [exec, chairs, members, newMembers] = STARTING_ROLE_TIERS.map(
      (tier) => new Set<string>(tier.permissions),
    );
    for (const tier of [exec, chairs, members]) {
      expect(tier.has('events:create')).toBe(true);
      expect(tier.has('backwork:upload')).toBe(true);
    }
    expect(exec.has('events:update')).toBe(true);
    expect(exec.has('events:delete')).toBe(true);
    for (const tier of [chairs, members, newMembers]) {
      expect(tier.has('events:update')).toBe(false);
      expect(tier.has('events:delete')).toBe(false);
    }
    expect(newMembers.has('events:create')).toBe(false);
    expect(newMembers.has('backwork:upload')).toBe(true);
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
