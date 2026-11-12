import { BadRequestException } from '@nestjs/common';
import type { IChapterGroupRepository } from '#domain/repositories/chapter-group.repository.interface';
import { createChapterGroupRepoMock } from '#test/helpers/chapter-group-repo.mock';
import type { Role } from '#domain/entities/role.entity';
import type { IRoleRepository } from '#domain/repositories/role.repository.interface';
import type { IRoleTierRepository } from '#domain/repositories/role-tier.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import type { IChatCategoryRepository } from '#domain/repositories/chat.repository.interface';
import { ChannelAccessListService } from './channel-access-list.service';

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
    created_at: '2026-11-12T00:00:00Z',
    ...extra,
  };
}

describe('ChannelAccessListService.listOptions', () => {
  it('marks only the Everyone role hidden, so no list offers to add it (#4191)', async () => {
    const service = new ChannelAccessListService(
      {
        findByChapter: jest
          .fn()
          .mockResolvedValue([
            role('r-everyone', 'Everyone', { system_key: 'MEMBER' }),
            role('r-chair', 'Rush Chair'),
          ]),
      } as unknown as IRoleRepository,
      {
        findByChapter: jest.fn().mockResolvedValue([]),
      } as unknown as IRoleTierRepository,
      {
        findByChapter: jest
          .fn()
          .mockResolvedValue([
            { chapter_id: 'ch-1', user_id: 'u1', role_ids: ['r-everyone'] },
          ]),
      } as unknown as IMemberRepository,
      {} as IChatCategoryRepository,
      createChapterGroupRepoMock(),
    );

    const options = await service.listOptions('ch-1');
    expect(
      Object.fromEntries(options.map((option) => [option.name, option.hidden])),
    ).toEqual({ Everyone: true, 'Rush Chair': false });
  });
});

describe('ChannelAccessListService.listOptions — groups (#4076)', () => {
  it('offers groups after tiers and roles with who is in them, hiding an automatic one nobody is in and every class year', async () => {
    const groups = createChapterGroupRepoMock();
    const group = (id: string, name: string, kind: string) => ({
      id,
      chapter_id: 'ch-1',
      kind,
      name,
      color: null,
      mentionable: true,
      pledge_class_id: kind === 'pledge_class' ? `pc-${id}` : null,
      class_year: null,
      created_at: '2026-11-12T00:00:00Z',
      updated_at: '2026-11-12T00:00:00Z',
    });
    groups.findByChapter.mockImplementation(async () => [
      group('g-year', 'Class of 2027', 'class_year'),
      group('g-class', 'Alpha', 'pledge_class'),
      group('g-empty', 'Beta', 'pledge_class'),
      group('g-floor', 'Third floor', 'manual'),
      { ...group('g-other', 'Elsewhere', 'manual'), chapter_id: 'ch-2' },
    ]);
    groups.findMemberships.mockResolvedValue([
      {
        chapter_id: 'ch-1',
        group_id: 'g-class',
        user_id: 'u2',
        kind: 'pledge_class',
      },
      {
        chapter_id: 'ch-1',
        group_id: 'g-class',
        user_id: 'u1',
        kind: 'pledge_class',
      },
      {
        chapter_id: 'ch-1',
        group_id: 'g-year',
        user_id: 'u1',
        kind: 'class_year',
      },
    ]);
    const service = new ChannelAccessListService(
      {
        findByChapter: jest.fn().mockResolvedValue([role('r-chair', 'Chair')]),
      } as unknown as IRoleRepository,
      {
        findByChapter: jest.fn().mockResolvedValue([]),
      } as unknown as IRoleTierRepository,
      {
        findByChapter: jest.fn().mockResolvedValue([]),
      } as unknown as IMemberRepository,
      {} as IChatCategoryRepository,
      groups,
    );

    const options = await service.listOptions('ch-1');

    expect(
      options.map(({ entry, kind, user_ids, hidden }) => ({
        entry,
        kind,
        user_ids,
        hidden,
      })),
    ).toEqual([
      { entry: 'role:r-chair', kind: 'role', user_ids: [], hidden: false },
      { entry: 'group:g-floor', kind: 'group', user_ids: [], hidden: false },
      {
        entry: 'group:g-class',
        kind: 'group',
        user_ids: ['u1', 'u2'],
        hidden: false,
      },
      { entry: 'group:g-empty', kind: 'group', user_ids: [], hidden: true },
    ]);
  });
});

describe('ChannelAccessListService.normalize — groups (#4076)', () => {
  const FLOOR = '00000000-0000-4000-8000-0000000000f1';
  const YEAR = '00000000-0000-4000-8000-0000000000f2';
  const FOREIGN = '00000000-0000-4000-8000-0000000000f3';
  const service = () => {
    const groups = createChapterGroupRepoMock();
    groups.findByChapter.mockResolvedValue([
      { id: FLOOR, chapter_id: 'ch-1', kind: 'manual', name: 'Third floor' },
      {
        id: YEAR,
        chapter_id: 'ch-1',
        kind: 'class_year',
        name: 'Class of 2027',
      },
      { id: FOREIGN, chapter_id: 'ch-2', kind: 'manual', name: 'Elsewhere' },
    ]);
    return new ChannelAccessListService(
      {} as IRoleRepository,
      {} as IRoleTierRepository,
      {} as IMemberRepository,
      {} as IChatCategoryRepository,
      groups,
    );
  };

  it("keeps a chapter group's entry", async () => {
    await expect(
      service().normalize('ch-1', { who_can_see: [`group:${FLOOR}`] }),
    ).resolves.toEqual({ who_can_see: [`group:${FLOOR}`] });
  });

  it("refuses another chapter's group", async () => {
    await expect(
      service().normalize('ch-1', { who_can_post: [`group:${FOREIGN}`] }),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses a class year, whose members set their own year', async () => {
    await expect(
      service().normalize('ch-1', { who_can_see: [`group:${YEAR}`] }),
    ).rejects.toThrow(/class year/);
  });
});
