import * as caughtFailure from '../../infrastructure/observability/report-caught-failure';
import type { Role } from '#domain/entities/role.entity';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import {
  ChatMentionService,
  canPingAnyRole,
  mentionRoleViews,
} from './chat-mention.service';
import type { RbacService } from './rbac.service';
import type { ChapterPresenceReader } from './chapter-presence-reader.service';

/** A presence reader that answers `online` (or `null`, a failed read). */
function presenceOf(online: string[] | null = []) {
  const onlineUserIds = jest
    .fn()
    .mockResolvedValue(online === null ? null : new Set(online));
  return {
    reader: { onlineUserIds } as unknown as ChapterPresenceReader,
    onlineUserIds,
  };
}

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
  role('member', 'Everyone', {
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
      'everyone',
      'here',
    ]);
    expect(views[0].member_ids).toEqual(['u1']);
  });

  it('names the Everyone role @everyone and reaches every member with it (#4191)', () => {
    const everyone = mentionRoleViews(roles, members).find(
      (view) => view.role_id === 'member',
    );
    // Dee holds Brothers and Alumni, not the Everyone role, and is still in.
    expect(everyone).toMatchObject({
      name: 'everyone',
      member_ids: ['u1', 'u2', 'u3', 'u4'],
      open_to_all: false,
    });
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
      everyone: false,
      here: false,
    });
  });

  it('adds @here with the online members on the roster, on the Everyone switch', () => {
    const here = mentionRoleViews(roles, members, ['u2', 'u4', 'stranger']).at(
      -1,
    );
    expect(here).toMatchObject({
      name: 'here',
      member_ids: ['u2', 'u4'],
      open_to_all: false,
    });
    const opened = roles.map((r) =>
      r.id === 'member' ? { ...r, mentionable: true } : r,
    );
    expect(mentionRoleViews(opened, members).at(-1)?.open_to_all).toBe(true);
  });

  it('leaves out a role named Here, which @here now means', () => {
    const named = [...roles, role('h', 'Here', { display_order: 4 })];
    const views = mentionRoleViews(named, members);
    expect(views.filter((view) => view.name.toLowerCase() === 'here')).toEqual([
      expect.objectContaining({ name: 'here', role_id: 'member' }),
    ]);
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
    return new ChatMentionService(memberRepo, rbac, presenceOf().reader);
  }

  it('leaves out a role nobody holds, and gates one switched off', async () => {
    const list = await service(['members:view']).listMentionRoles('ch-1', 'u2');
    expect(list.map(({ name, mentionable }) => [name, mentionable])).toEqual([
      ['Officers', true],
      ['Brothers', true],
      ['everyone', false],
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
    online: string[] | null = [],
  ) {
    const memberRepo = {
      findChapterMemberIdentities: jest.fn().mockResolvedValue(chapterMembers),
    } as unknown as IMemberRepository;
    const getEffectivePermissions = jest.fn().mockResolvedValue(permissions);
    const rbac = {
      findByChapter: jest.fn().mockResolvedValue(chapterRoles),
      getEffectivePermissions,
    } as unknown as RbacService;
    const presence = presenceOf(online);
    return {
      mentions: new ChatMentionService(memberRepo, rbac, presence.reader),
      getEffectivePermissions,
      onlineUserIds: presence.onlineUserIds,
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

  describe('@everyone (#4191)', () => {
    it('reaches every member when an officer sends it', async () => {
      const officer = service(members, roles, ['channels:manage']);
      await expect(
        officer.mentions.resolveForSend('ch-1', 'u1', 'meeting at 8 @everyone'),
      ).resolves.toEqual(expect.arrayContaining(['u2', 'u3', 'u4']));
    });

    it('is not silenced by a member whose display name reads the same', async () => {
      const named = [
        ...members,
        { user_id: 'u9', display_name: 'Every One', role_ids: [] },
      ];
      const officer = service(named, roles, ['channels:manage']);
      await expect(
        officer.mentions.resolveForSend('ch-1', 'u1', '@everyone hi'),
      ).resolves.toEqual(expect.arrayContaining(['u2', 'u3', 'u4', 'u9']));
    });

    it('reaches nobody from a member until the chapter opens it', async () => {
      const member = service(members, roles, ['members:view']);
      await expect(
        member.mentions.resolveForSend('ch-1', 'u2', '@everyone hi'),
      ).resolves.toEqual([]);

      const opened = roles.map((r) =>
        r.id === 'member' ? { ...r, mentionable: true } : r,
      );
      const open = service(members, opened, ['members:view']);
      await expect(
        open.mentions.resolveForSend('ch-1', 'u2', '@everyone hi'),
      ).resolves.toEqual(expect.arrayContaining(['u1', 'u3', 'u4']));
    });
  });

  describe('@here', () => {
    it('reaches the members online now when an officer sends it', async () => {
      const officer = service(
        members,
        roles,
        ['channels:manage'],
        ['u1', 'u3'],
      );
      await expect(
        officer.mentions.resolveForSend('ch-1', 'u1', 'anyone free? @here'),
      ).resolves.toEqual(['u1', 'u3']);
      expect(officer.onlineUserIds).toHaveBeenCalledWith('ch-1');
    });

    it('reads who is online only when the body says @here', async () => {
      const officer = service(members, roles, ['channels:manage'], ['u3']);
      await officer.mentions.resolveForSend('ch-1', 'u1', '@Ann and @everyone');
      expect(officer.onlineUserIds).not.toHaveBeenCalled();
    });

    it('follows the Everyone switch: nobody from a member until it is on', async () => {
      const member = service(members, roles, ['members:view'], ['u1', 'u3']);
      await expect(
        member.mentions.resolveForSend('ch-1', 'u2', '@here'),
      ).resolves.toEqual([]);
      expect(member.getEffectivePermissions).toHaveBeenCalledTimes(1);

      const opened = roles.map((r) =>
        r.id === 'member' ? { ...r, mentionable: true } : r,
      );
      const open = service(members, opened, ['members:view'], ['u1', 'u3']);
      await expect(
        open.mentions.resolveForSend('ch-1', 'u2', '@here'),
      ).resolves.toEqual(['u1', 'u3']);
    });

    it('never falls through to a member when nobody is online or the read fails', async () => {
      const named = [
        ...members,
        { user_id: 'u8', display_name: 'Herenton', role_ids: [] },
      ];
      for (const online of [[], null]) {
        const officer = service(named, roles, ['channels:manage'], online);
        await expect(
          officer.mentions.resolveForSend('ch-1', 'u1', '@here'),
        ).resolves.toEqual([]);
      }
    });

    it('keeps the earlier mentions on an edit instead of reading again', async () => {
      const officer = service(members, roles, ['channels:manage'], ['u2']);
      await expect(
        officer.mentions.resolveForEdit(
          'ch-1',
          'u1',
          '@here (edited)',
          ['u3', 'u4'],
          null,
        ),
      ).resolves.toEqual(['u3', 'u4']);
      expect(officer.onlineUserIds).not.toHaveBeenCalled();
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
    const mentions = new ChatMentionService(
      memberRepo,
      rbac,
      presenceOf().reader,
    );

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
    const mentions = new ChatMentionService(
      memberRepo,
      rbac,
      presenceOf().reader,
    );
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
