import { MODULE_CATALOG } from '@repo/org-archetypes';
import { PERMISSION_MODULES, PERMISSION_REGISTRY } from '@repo/validation';
import { DEFAULT_SYSTEM_ROLES, SystemPermissions } from './permissions';

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
