import type { IRoleTierRepository } from '#domain/repositories/role-tier.repository.interface';
import type { IChapterGroupRepository } from '#domain/repositories/chapter-group.repository.interface';
import { createChapterGroupRepoMock } from '#test/helpers/chapter-group-repo.mock';
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
    self_assignable: false,
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

/** No tiers and no groups (#4076): the role-only tests read the chapter as before. */
function noSets(): [IRoleTierRepository, IChapterGroupRepository] {
  return [
    {
      findByChapter: jest.fn().mockResolvedValue([]),
    } as unknown as IRoleTierRepository,
    createChapterGroupRepoMock(),
  ];
}

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

  it('adds an empty @here on the Everyone switch', () => {
    expect(mentionRoleViews(roles, members).at(-1)).toMatchObject({
      name: 'here',
      member_ids: [],
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

  it('keeps @here for officers only in a chapter with no Everyone role', () => {
    const legacy = roles.filter((r) => r.id !== 'member');
    expect(mentionRoleViews(legacy, members).at(-1)).toMatchObject({
      name: 'here',
      open_to_all: false,
    });
  });

  it('has no @here when no roles were read', () => {
    expect(mentionRoleViews([], members)).toEqual([]);
  });

  describe('tiers and groups (#4076)', () => {
    const tier = (id: string, name: string, position: number) => ({
      id,
      chapter_id: 'ch-1',
      name,
      position,
      permissions: [],
      mentionable: true,
      created_at: '2026-11-06T00:00:00Z',
      updated_at: '2026-11-06T00:00:00Z',
    });
    const group = (
      id: string,
      name: string,
      kind: 'manual' | 'pledge_class' | 'class_year' = 'manual',
    ) => ({
      id,
      chapter_id: 'ch-1',
      kind,
      name,
      color: null,
      mentionable: true,
      pledge_class_id: kind === 'pledge_class' ? 'pc-1' : null,
      class_year: kind === 'class_year' ? 2027 : null,
      created_at: '2026-11-06T00:00:00Z',
      updated_at: '2026-11-06T00:00:00Z',
    });
    const tiered = roles.map((r) =>
      r.id === 'officers' || r.id === 'empty'
        ? { ...r, tier_id: 't-exec' }
        : r.id === 'brothers'
          ? { ...r, tier_id: 't-members' }
          : r,
    );

    it('reaches every holder of any role in a tier, once each', () => {
      const views = mentionRoleViews(tiered, members, {
        tiers: [tier('t-members', 'Members', 3), tier('t-exec', 'Exec', 1)],
      });
      const tiers = views.filter((view) => view.kind === 'tier');
      expect(tiers.map((view) => [view.name, view.member_ids])).toEqual([
        ['Exec', ['u1']],
        ['Members', ['u3', 'u4']],
      ]);
    });

    it("carries a tier's own switch", () => {
      const views = mentionRoleViews(tiered, members, {
        tiers: [{ ...tier('t-exec', 'Exec', 1), mentionable: false }],
      });
      expect(views.find((view) => view.kind === 'tier')?.open_to_all).toBe(
        false,
      );
    });

    it("makes a tier holding the Everyone role follow @everyone's switch (#4191)", () => {
      const withEveryone = tiered.map((r) =>
        r.id === 'member' ? { ...r, tier_id: 't-members' } : r,
      );
      const members_ = (everyoneOn: boolean) =>
        mentionRoleViews(
          withEveryone.map((r) =>
            r.id === 'member' ? { ...r, mentionable: everyoneOn } : r,
          ),
          members,
          { tiers: [tier('t-members', 'Members', 3)] },
        ).find((view) => view.kind === 'tier');

      // Off (the default): @Members is officers-only, as @everyone is.
      expect(members_(false)).toMatchObject({
        open_to_all: false,
        member_ids: ['u1', 'u2', 'u3', 'u4'],
      });
      // A chapter that opened @everyone opens it too.
      expect(members_(true)?.open_to_all).toBe(true);
    });

    it('reaches the members of a group now, before @here', () => {
      const views = mentionRoleViews(roles, members, {
        groups: [group('g-floor', 'Third floor')],
        memberships: [
          {
            chapter_id: 'ch-1',
            group_id: 'g-floor',
            user_id: 'u2',
            kind: 'manual',
          },
          {
            chapter_id: 'ch-1',
            group_id: 'g-floor',
            user_id: 'u4',
            kind: 'manual',
          },
        ],
      });
      expect(views.find((view) => view.kind === 'group')).toMatchObject({
        role_id: 'g-floor',
        name: 'Third floor',
        member_ids: ['u2', 'u4'],
        open_to_all: true,
      });
      expect(views.at(-1)?.name).toBe('here');
    });

    it('leaves out an automatic group nobody is in, and keeps an empty manual one', () => {
      const views = mentionRoleViews(roles, members, {
        groups: [
          group('g-new', 'Live-ins'),
          group('g-class', 'Alpha', 'pledge_class'),
        ],
        memberships: [],
      });
      expect(
        views.filter((view) => view.kind === 'group').map((v) => v.name),
      ).toEqual(['Live-ins']);
    });

    it('leaves out a tier or group whose name reads as @everyone or @here', () => {
      const views = mentionRoleViews(tiered, members, {
        tiers: [tier('t-exec', 'Everyone', 1)],
        groups: [group('g-here', 'here')],
        memberships: [
          {
            chapter_id: 'ch-1',
            group_id: 'g-here',
            user_id: 'u1',
            kind: 'manual',
          },
        ],
      });
      expect(views.filter((view) => view.kind !== 'role')).toEqual([]);
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
    return new ChatMentionService(
      memberRepo,
      rbac,
      presenceOf().reader,
      ...noSets(),
    );
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
      mentions: new ChatMentionService(
        memberRepo,
        rbac,
        presence.reader,
        ...noSets(),
      ),
      getEffectivePermissions,
      onlineUserIds: presence.onlineUserIds,
    };
  }

  describe('@tier and @group (#4076)', () => {
    function withSets(
      tiers: unknown[],
      groups: unknown[],
      memberships: unknown[],
      permissions: string[] = [],
    ) {
      const memberRepo = {
        findChapterMemberIdentities: jest.fn().mockResolvedValue(members),
      } as unknown as IMemberRepository;
      const rbac = {
        findByChapter: jest
          .fn()
          .mockResolvedValue(
            roles.map((r) =>
              r.id === 'brothers' ? { ...r, tier_id: 't-1' } : r,
            ),
          ),
        getEffectivePermissions: jest.fn().mockResolvedValue(permissions),
      } as unknown as RbacService;
      const tierRepo = {
        findByChapter: jest.fn().mockResolvedValue(tiers),
      } as unknown as IRoleTierRepository;
      const groupRepo = createChapterGroupRepoMock();
      groupRepo.findByChapter.mockResolvedValue(groups);
      groupRepo.findMemberships.mockResolvedValue(memberships);
      return new ChatMentionService(
        memberRepo,
        rbac,
        presenceOf().reader,
        tierRepo,
        groupRepo,
      );
    }
    const tier = {
      id: 't-1',
      chapter_id: 'ch-1',
      name: 'Members',
      position: 3,
      permissions: [],
      mentionable: true,
      created_at: '2026-11-06T00:00:00Z',
      updated_at: '2026-11-06T00:00:00Z',
    };
    const floor = {
      id: 'g-1',
      chapter_id: 'ch-1',
      kind: 'manual',
      name: 'Third floor',
      color: null,
      mentionable: true,
      pledge_class_id: null,
      class_year: null,
      created_at: '2026-11-06T00:00:00Z',
      updated_at: '2026-11-06T00:00:00Z',
    };

    it('reaches every holder of a role in the tier', async () => {
      await expect(
        withSets([tier], [], []).resolveForSend('ch-1', 'u2', 'hi @Members'),
      ).resolves.toEqual(['u3', 'u4']);
    });

    it("reaches a group's members now", async () => {
      await expect(
        withSets(
          [],
          [floor],
          [
            {
              chapter_id: 'ch-1',
              group_id: 'g-1',
              user_id: 'u1',
              kind: 'manual',
            },
          ],
        ).resolveForSend('ch-1', 'u2', '@Third floor quiet hours'),
      ).resolves.toEqual(['u1']);
    });

    it('reaches nobody through a group switched off, unless an officer sends', async () => {
      const off = { ...floor, mentionable: false };
      const rows = [
        { chapter_id: 'ch-1', group_id: 'g-1', user_id: 'u1', kind: 'manual' },
      ];
      await expect(
        withSets([], [off], rows).resolveForSend('ch-1', 'u2', '@Third floor'),
      ).resolves.toEqual([]);
      await expect(
        withSets([], [off], rows, ['channels:manage']).resolveForSend(
          'ch-1',
          'u2',
          '@Third floor',
        ),
      ).resolves.toEqual(['u1']);
    });
  });

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
        ['u1', 'u3', 'not-in-this-chapter'],
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
      // Nobody it could reach, so nothing waits on reading who is online.
      expect(member.onlineUserIds).not.toHaveBeenCalled();

      const opened = roles.map((r) =>
        r.id === 'member' ? { ...r, mentionable: true } : r,
      );
      const open = service(members, opened, ['members:view'], ['u1', 'u3']);
      await expect(
        open.mentions.resolveForSend('ch-1', 'u2', '@here'),
      ).resolves.toEqual(['u1', 'u3', 'u2']);
    });

    it('reaches the sender even when the presence read misses them', async () => {
      // They are here, sending it (Paul, 2026-11-13). Only their own row
      // lights: the push and the badge skip a sender's own message.
      const officer = service(members, roles, ['channels:manage'], ['u3']);
      await expect(
        officer.mentions.resolveForSend('ch-1', 'u1', '@here'),
      ).resolves.toEqual(['u3', 'u1']);
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
        ).resolves.toEqual(['u1']);
      }
    });

    it('keeps who the earlier @here reached on an edit instead of reading again', async () => {
      const officer = service(members, roles, ['channels:manage'], ['u2']);
      await expect(
        officer.mentions.resolveForEdit(
          'ch-1',
          'u1',
          '@here (edited)',
          ['u3', 'u4'],
          null,
          '@here',
        ),
      ).resolves.toEqual(['u3', 'u4']);
      expect(officer.onlineUserIds).not.toHaveBeenCalled();
    });

    it('reads the earlier body with its picks when working out who @here reached (#3835)', async () => {
      // Sent "@Ben Stone @here" with a pick for Ben Stone (u9), who has
      // left; @here reached Ben (u2). Read without the pick, the earlier
      // body's `@Ben Stone` is `@Ben`, which would count Ben as named and
      // take his @here mention away on the edit.
      const officer = service(members, roles, ['channels:manage']);
      const picks = [{ user_id: 'u9', label: 'Ben Stone' }];
      await expect(
        officer.mentions.resolveForEdit(
          'ch-1',
          'u1',
          '@Ben Stone @here (edited)',
          ['u2'],
          null,
          '@Ben Stone @here',
          { previous: picks, next: picks },
        ),
      ).resolves.toEqual(['u2']);
    });

    it('drops a name the edit removes, though the message keeps @here', async () => {
      // Sent "@Dee @here" with Ann and Cal online: Dee by name, Ann and Cal
      // by @here. Editing Dee out for Ben takes her mention away.
      const officer = service(members, roles, ['channels:manage']);
      await expect(
        officer.mentions.resolveForEdit(
          'ch-1',
          'u1',
          '@Ben @here',
          ['u4', 'u1', 'u3'],
          null,
          '@Dee @here',
        ),
      ).resolves.toEqual(['u2', 'u1', 'u3']);
    });

    it('reaches nobody new when an edit adds @here', async () => {
      const officer = service(members, roles, ['channels:manage'], ['u2']);
      await expect(
        officer.mentions.resolveForEdit(
          'ch-1',
          'u1',
          '@Ann @here',
          ['u1'],
          null,
          '@Ann',
        ),
      ).resolves.toEqual(['u1']);
    });

    it('adds not even the sender when an edit adds @here', async () => {
      // The send stored no @here, so the edit keeps what it stored: the
      // sender's row does not start lighting on an edit.
      const officer = service(members, roles, ['channels:manage'], ['u1']);
      await expect(
        officer.mentions.resolveForEdit(
          'ch-1',
          'u1',
          'lunch? @here',
          [],
          null,
          'lunch?',
        ),
      ).resolves.toEqual([]);
    });

    it('keeps member mentions when the roles read fails', async () => {
      const memberRepo = {
        findChapterMemberIdentities: jest.fn().mockResolvedValue(members),
      } as unknown as IMemberRepository;
      const getEffectivePermissions = jest
        .fn()
        .mockRejectedValue(new Error('roles down'));
      const rbac = {
        findByChapter: jest.fn().mockRejectedValue(new Error('roles down')),
        getEffectivePermissions,
      } as unknown as RbacService;
      const presence = presenceOf(['u3']);
      const mentions = new ChatMentionService(
        memberRepo,
        rbac,
        presence.reader,
        ...noSets(),
      );
      await expect(
        mentions.resolveForSend('ch-1', 'u1', '@Ben @here'),
      ).resolves.toEqual(['u2']);
      expect(getEffectivePermissions).not.toHaveBeenCalled();
      expect(presence.onlineUserIds).not.toHaveBeenCalled();
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
      ...noSets(),
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
      ...noSets(),
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
