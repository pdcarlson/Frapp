import {
  parseRoleMapping,
  readPermissionSlug,
  sameAsDiscordGate,
  uniqueReadPermission,
} from './discord-role-gates';

describe('Discord role gates (#2818)', () => {
  it('slugs a role name into its read permission', () => {
    expect(readPermissionSlug('Recording Secretary')).toBe(
      'recording-secretary',
    );
    expect(readPermissionSlug('  Rush Chair (2026)! ')).toBe('rush-chair-2026');
    expect(readPermissionSlug('Frère')).toBe('frere');
    expect(readPermissionSlug('🎉')).toBe('');
    expect(readPermissionSlug(`${'a'.repeat(47)} b`)).toBe('a'.repeat(47));
  });

  it('picks a read permission no role holds yet', () => {
    expect(uniqueReadPermission('Exec', new Set())).toBe('channels:read:exec');
    expect(
      uniqueReadPermission(
        'Exec',
        new Set(['channels:read:exec', 'channels:read:exec-2']),
      ),
    ).toBe('channels:read:exec-3');
    expect(uniqueReadPermission('🎉', new Set())).toBe('channels:read:role');
  });

  it('reads a mapping saved before #2818, or a malformed one, as granting nothing', () => {
    expect(
      parseRoleMapping([
        {
          discord_role_id: '1',
          discord_role_name: 'Exec',
          signet_role_key: 'PRESIDENT',
        },
        { discord_role_id: '2', action: 'existing', frapp_role_id: 'r-2' },
        { action: 'new' },
        'nonsense',
      ]),
    ).toEqual([
      {
        discord_role_id: '1',
        discord_role_name: 'Exec',
        action: 'ignore',
        frapp_role_id: null,
        new_role_name: null,
        read_permission: null,
      },
      {
        discord_role_id: '2',
        discord_role_name: '2',
        action: 'existing',
        frapp_role_id: 'r-2',
        new_role_name: null,
        read_permission: null,
      },
    ]);
    expect(parseRoleMapping(null)).toEqual([]);
  });

  it('gates on the mapped readers only, once each, in reader order', () => {
    const entry = (id: string, permission: string | null) => ({
      discord_role_id: id,
      discord_role_name: id,
      action: permission ? ('existing' as const) : ('ignore' as const),
      frapp_role_id: permission ? `role-${id}` : null,
      new_role_name: null,
      read_permission: permission,
    });
    const mapping = [
      entry('exec', 'channels:read:exec'),
      entry('brother', 'channels:read:member'),
      entry('active', 'channels:read:member'),
      entry('pledge', null),
    ];
    expect(
      sameAsDiscordGate(['pledge', 'active', 'exec', 'brother'], mapping),
    ).toEqual(['channels:read:member', 'channels:read:exec']);
    expect(sameAsDiscordGate(['pledge', 'unmapped'], mapping)).toEqual([]);
  });
});
