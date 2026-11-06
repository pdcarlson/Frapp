import type { Role } from '#domain/entities/role.entity';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import {
  ChatMentionService,
  canPingWholeChapter,
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
  role('member', 'Member', { system_key: 'MEMBER', display_order: 5 }),
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
    expect(views[0]!.member_ids).toEqual(['u1']);
  });

  it('marks the Member role and a role over half the chapter as whole-chapter', () => {
    const wide = Object.fromEntries(
      mentionRoleViews(roles, members).map((view) => [
        view.name,
        view.chapter_wide,
      ]),
    );
    // Brothers is exactly half (2 of 4), which is not more than half.
    expect(wide).toEqual({
      Officers: false,
      'Rush Chair': false,
      Brothers: false,
      Member: true,
    });
  });
});

describe('canPingWholeChapter', () => {
  it('admits channels:manage and the wildcard only', () => {
    expect(canPingWholeChapter(['channels:manage'])).toBe(true);
    expect(canPingWholeChapter(['*'])).toBe(true);
    expect(canPingWholeChapter(['members:view', 'roles:manage'])).toBe(false);
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

  it('leaves out a role nobody holds, and gates the whole-chapter one', async () => {
    const list = await service(['members:view']).listMentionRoles(
      'ch-1',
      'u2',
    );
    expect(
      list.map(({ name, mentionable }) => [name, mentionable]),
    ).toEqual([
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
