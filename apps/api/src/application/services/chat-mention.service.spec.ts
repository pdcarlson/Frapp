import * as caughtFailure from '../../infrastructure/observability/report-caught-failure';
import type { Role } from '#domain/entities/role.entity';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import {
  ChatMentionService,
  canPingAnyRole,
  mentionRoleViews,
} from './chat-mention.service';
import type { RbacService } from './rbac.service';

function role(id: string, name: string, extra: Partial<Role> = {}): Role {
  return {
    id,
    chapter_id: 'ch-1',
    name,
    system_key: null,
    permissions: [],
    is_system: false,
    display_order: 1,
    color: null,
    mentionable: true,
    tier_id: null,
    permission_overrides: {},
    created_at: '2026-11-06T00:00:00Z',
    ...extra,
  };
}

const members = [
  { user_id: 'u1', display_name: 'Ann', role_ids: ['member', 'officers'] },
  { user_id: 'u2', display_name: 'Ben', role_ids: ['member'] },
  { user_id: 'u3', display_name: 'Cal', role_ids: ['member', 'brothers'] },
  { user_id: 'u4', display_name: 'Dee', role_ids: ['brothers', 'alumni'] },
];

const roles = [
  role('member', 'Member', {
    system_key: 'MEMBER',
    display_order: 5,
    mentionable: false,
  }),
  role('officers', 'Officers', { display_order: 1, color: 'blue' }),
  role('brothers', 'Brothers', { display_order: 3 }),
  role('empty', 'Rush Chair', { display_order: 2 }),
];

describe('mentionRoleViews', () => {
  it('lists roles in role order with their holders', () => {
    const views = mentionRoleViews(roles, members);
    expect(views.map((view) => view.name)).toEqual([
      'Officers',
      'Rush Chair',
      'Brothers',
      'Member',
    ]);
    expect(views[0].member_ids).toEqual(['u1']);
  });

  it('carries the switch of each role, on unless an officer turned it off', () => {
    const open = Object.fromEntries(
      mentionRoleViews(roles, members).map((view) => [
        view.name,
        view.open_to_all,
      ]),
    );
    expect(open).toEqual({
      Officers: true,
      'Rush Chair': true,
      Brothers: true,
      Member: false,
    });
  });

  it('reads a role with no stored switch as on', () => {
    const legacy = { ...roles[1], mentionable: undefined } as unknown as Role;
    expect(mentionRoleViews([legacy], members)[0].open_to_all).toBe(true);
  });
});

describe('canPingAnyRole', () => {
  it('admits channels:manage, roles:manage and the wildcard only', () => {
    expect(canPingAnyRole(['channels:manage'])).toBe(true);
    expect(canPingAnyRole(['roles:manage'])).toBe(true);
    expect(canPingAnyRole(['*'])).toBe(true);
    expect(canPingAnyRole(['members:view', 'polls:view_all'])).toBe(false);
  });
});

describe('ChatMentionService.listMentionRoles', () => {
  function service(permissions: string[]) {
    const memberRepo = {
      findChapterMemberIdentities: jest.fn().mockResolvedValue(members),
    } as unknown as IMemberRepository;
    const rbac = {
      findByChapter: jest.fn().mockResolvedValue(roles),
      getEffectivePermissions: jest.fn().mockResolvedValue(permissions),
    } as unknown as RbacService;
    return new ChatMentionService(memberRepo, rbac);
  }

  it('leaves out a role nobody holds, and gates one switched off', async () => {
    const list = await service(['members:view']).listMentionRoles('ch-1', 'u2');
    expect(list.map(({ name, mentionable }) => [name, mentionable])).toEqual([
      ['Officers', true],
      ['Brothers', true],
      ['Member', false],
    ]);
  });

  it('lets an officer ping every role', async () => {
    const list = await service(['channels:manage']).listMentionRoles(
      'ch-1',
      'u1',
    );
    expect(list.every((view) => view.mentionable)).toBe(true);
  });
});

describe('ChatMentionService.resolveForSend', () => {
  function service(
    chapterMembers: typeof members,
    chapterRoles: Role[],
    permissions: string[] = [],
  ) {
    const memberRepo = {
      findChapterMemberIdentities: jest.fn().mockResolvedValue(chapterMembers),
    } as unknown as IMemberRepository;
    const getEffectivePermissions = jest.fn().mockResolvedValue(permissions);
    const rbac = {
      findByChapter: jest.fn().mockResolvedValue(chapterRoles),
      getEffectivePermissions,
    } as unknown as RbacService;
    return {
      mentions: new ChatMentionService(memberRepo, rbac),
      getEffectivePermissions,
    };
  }

  describe('names with spaces (#3825)', () => {
    const spaced = [
      ...members,
      { user_id: 'u5', display_name: 'Winston Hewitt', role_ids: ['vp'] },
      { user_id: 'u6', display_name: 'Winston Park', role_ids: ['member'] },
    ];

    it('resolves a two-word name to its member', async () => {
      const { mentions } = service(spaced, roles);
      await expect(
        mentions.resolveForSend('ch-1', 'u2', 'ask @Winston Hewitt, please'),
      ).resolves.toEqual(['u5']);
      // The first name alone is two members, so it still reaches nobody.
      await expect(
        mentions.resolveForSend('ch-1', 'u2', 'ask @Winston'),
      ).resolves.toEqual([]);
    });

    it('reads permissions for a held switched-off role an empty role would hide', async () => {
      // "Rush" is off and held; "Rush Chair" (in `roles`) is held by nobody.
      const rush = role('rush', 'Rush', { mentionable: false });
      const held = [
        ...members,
        { user_id: 'u7', display_name: 'Eli', role_ids: ['rush'] },
      ];
      const officer = service(held, [...roles, rush], ['roles:manage']);
      await expect(
        officer.mentions.resolveForSend('ch-1', 'u2', '@Rush chair needs help'),
      ).resolves.toEqual(['u7']);
      expect(officer.getEffectivePermissions).toHaveBeenCalledTimes(1);
    });

    it("reads the sender's permissions for a switched-off role named with its space", async () => {
      const vp = role('vp', 'Vice President', { mentionable: false });
      const member = service(spaced, [...roles, vp]);
      await expect(
        member.mentions.resolveForSend('ch-1', 'u2', '@Vice President'),
      ).resolves.toEqual([]);
      expect(member.getEffectivePermissions).toHaveBeenCalledTimes(1);

      const officer = service(spaced, [...roles, vp], ['roles:manage']);
      await expect(
        officer.mentions.resolveForSend('ch-1', 'u2', '@Vice President'),
      ).resolves.toEqual(['u5']);
    });
  });

  it('still resolves member mentions when the roles read fails', async () => {
    const memberRepo = {
      findChapterMemberIdentities: jest.fn().mockResolvedValue(members),
    } as unknown as IMemberRepository;
    const rbac = {
      findByChapter: jest.fn().mockRejectedValue(new Error('roles down')),
      getEffectivePermissions: jest.fn(),
    } as unknown as RbacService;
    const mentions = new ChatMentionService(memberRepo, rbac);

    const reported = jest.spyOn(caughtFailure, 'reportCaughtFailure');

    await expect(
      mentions.resolveForSend('ch-1', 'u2', '@Ann and @Officers'),
    ).resolves.toEqual(['u1']);
    expect(reported).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        level: 'warning',
        site: 'chat-mention-roles-read',
      }),
    );
    reported.mockRestore();
  });

  it('sends without mentions, and reports it at error level, when members cannot be read (#4096)', async () => {
    const memberRepo = {
      findChapterMemberIdentities: jest
        .fn()
        .mockRejectedValue(new Error('column members.role_ids does not exist')),
    } as unknown as IMemberRepository;
    const rbac = {
      findByChapter: jest.fn().mockResolvedValue([]),
      getEffectivePermissions: jest.fn(),
    } as unknown as RbacService;
    const mentions = new ChatMentionService(memberRepo, rbac);
    const reported = jest.spyOn(caughtFailure, 'reportCaughtFailure');

    await expect(
      mentions.resolveForSend('ch-1', 'u2', '@Ann'),
    ).resolves.toEqual([]);
    expect(reported).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        level: 'error',
        site: 'chat-mention-resolve',
        error: expect.any(Error),
      }),
    );
    reported.mockRestore();
  });
});
