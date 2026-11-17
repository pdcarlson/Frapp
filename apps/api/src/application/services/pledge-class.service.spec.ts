import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PLEDGE_CLASSES_MAX } from '@repo/validation';
import { PledgeClassService } from './pledge-class.service';
import type { RbacService } from './rbac.service';
import type { IPledgeClassRepository } from '#domain/repositories/pledge-class.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import type { PledgeClass } from '#domain/entities/pledge-class.entity';
import type { Member } from '#domain/entities/member.entity';
import type { ChapterGroup } from '#domain/entities/chapter-group.entity';
import { SystemPermissions } from '#domain/constants/permissions';
import { memberFixture } from '#test/helpers/entity-fixtures';
import {
  createChapterGroupRepoMock,
  type ChapterGroupRepoMock,
} from '#test/helpers/chapter-group-repo.mock';
import {
  CHAPTER_ID,
  MEMBER,
  ROLE,
  USER,
  tieredChapterMembers,
  tieredRankContext,
} from '#test/helpers/tiered-chapter.fixture';

const CHAPTER = 'ch-1';

function pledgeClass(id: string, position: number, name = id): PledgeClass {
  return {
    id,
    chapter_id: CHAPTER,
    name,
    position,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

describe('PledgeClassService', () => {
  let repo: jest.Mocked<IPledgeClassRepository>;
  let memberRepo: { findByChapter: jest.Mock };
  let groupRepo: ChapterGroupRepoMock;
  let rbac: {
    getRankContext: jest.Mock;
    memberHasAnyPermission: jest.Mock;
  };
  let service: PledgeClassService;

  beforeEach(() => {
    repo = {
      findByChapter: jest.fn().mockResolvedValue([]),
      findById: jest.fn(),
      create: jest.fn(),
      rename: jest.fn(),
      reorder: jest.fn().mockResolvedValue([]),
      delete: jest.fn(),
      assignMembers: jest.fn().mockResolvedValue([]),
    };
    memberRepo = { findByChapter: jest.fn().mockResolvedValue([]) };
    groupRepo = createChapterGroupRepoMock();
    rbac = {
      getRankContext: jest.fn((_chapterId: string, userId: string) =>
        Promise.resolve(tieredRankContext(userId)),
      ),
      // What the fixture's roles hold, `*` included.
      memberHasAnyPermission: jest.fn(
        (_chapterId: string, userId: string, permissions: string[]) => {
          const held = tieredRankContext(userId).reach.permissions;
          return Promise.resolve(
            held.has('*') || permissions.some((p) => held.has(p)),
          );
        },
      ),
    };
    service = new PledgeClassService(
      repo,
      memberRepo as unknown as IMemberRepository,
      groupRepo,
      rbac as unknown as RbacService,
    );
  });

  describe('create', () => {
    it('adds the class after the last one, with the name trimmed', async () => {
      repo.findByChapter.mockResolvedValue([
        pledgeClass('a', 1),
        pledgeClass('b', 7),
      ]);
      repo.create.mockResolvedValue(pledgeClass('c', 8, 'Gamma'));

      await service.create(CHAPTER, '  Gamma ');

      expect(repo.create).toHaveBeenCalledWith({
        chapter_id: CHAPTER,
        name: 'Gamma',
        position: 8,
      });
    });

    it("starts a chapter's first class at position 1", async () => {
      repo.create.mockResolvedValue(pledgeClass('a', 1));

      await service.create(CHAPTER, 'Alpha');

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ position: 1 }),
      );
    });

    it('answers 409 when the chapter already has that name', async () => {
      repo.create.mockResolvedValue(null);

      await expect(service.create(CHAPTER, 'Alpha')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('refuses a class past the per-chapter cap', async () => {
      repo.findByChapter.mockResolvedValue(
        Array.from({ length: PLEDGE_CLASSES_MAX }, (_, i) =>
          pledgeClass(`c${i}`, i + 1),
        ),
      );

      await expect(service.create(CHAPTER, 'One more')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe('rename', () => {
    it('stores the name trimmed and returns the class', async () => {
      const renamed = pledgeClass('a', 1, 'Beta');
      repo.rename.mockResolvedValue(renamed);

      await expect(service.rename('a', CHAPTER, '  Beta ')).resolves.toBe(
        renamed,
      );
      expect(repo.rename).toHaveBeenCalledWith('a', CHAPTER, 'Beta');
    });

    it('answers 404 for a class the chapter does not have', async () => {
      repo.rename.mockResolvedValue(undefined);

      await expect(service.rename('x', CHAPTER, 'Beta')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('answers 409 when another class has the name', async () => {
      repo.rename.mockResolvedValue(null);

      await expect(service.rename('a', CHAPTER, 'Beta')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('reorder', () => {
    beforeEach(() => {
      repo.findByChapter.mockResolvedValue([
        pledgeClass('a', 1),
        pledgeClass('b', 2),
      ]);
    });

    it("applies a list that is exactly the chapter's classes", async () => {
      await service.reorder(CHAPTER, ['b', 'a']);

      expect(repo.reorder).toHaveBeenCalledWith(CHAPTER, ['b', 'a']);
    });

    it('answers 400 for a list that names a class twice, and writes nothing', async () => {
      await expect(service.reorder(CHAPTER, ['a', 'a'])).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(repo.reorder).not.toHaveBeenCalled();
    });

    it('takes an id in upper case as the same class', async () => {
      await service.reorder(CHAPTER, ['B', 'A']);

      expect(repo.reorder).toHaveBeenCalledWith(CHAPTER, ['b', 'a']);
    });

    it.each([
      ['a class is missing', ['a']],
      ['it names a class the chapter does not have', ['a', 'b', 'z']],
      ['it swaps one for a stranger', ['a', 'z']],
    ])('answers 409 and writes nothing when %s', async (_why, ids) => {
      await expect(service.reorder(CHAPTER, ids)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(repo.reorder).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('answers 404 for a class the chapter does not have', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.remove('x', CHAPTER)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it('deletes within the chapter', async () => {
      repo.findById.mockResolvedValue(pledgeClass('a', 1));

      await service.remove('a', CHAPTER);

      expect(repo.delete).toHaveBeenCalledWith('a', CHAPTER);
    });
  });

  describe('assign', () => {
    it('writes every listed member in one call and returns what was stored', async () => {
      repo.assignMembers.mockResolvedValue([
        memberFixture({ id: 'm1', pledge_class_id: 'a', order_number: 2 }),
        memberFixture({ id: 'm2', pledge_class_id: null, order_number: 9 }),
      ]);
      const assignments = [
        { member_id: 'm1', pledge_class_id: 'a', order_number: 2 },
        { member_id: 'm2', pledge_class_id: null, order_number: 9 },
      ];

      const result = await service.assign(CHAPTER, USER.president, assignments);

      expect(repo.assignMembers).toHaveBeenCalledTimes(1);
      expect(repo.assignMembers).toHaveBeenCalledWith(CHAPTER, assignments);
      expect(result).toEqual(assignments);
    });

    it('takes an order number with no class: a chapter may keep only a chapter-wide number', async () => {
      await service.assign(CHAPTER, USER.president, [
        { member_id: 'm1', pledge_class_id: null, order_number: 41 },
      ]);

      expect(repo.assignMembers).toHaveBeenCalled();
    });

    it('answers 404 when the write refuses a member who is not in the chapter', async () => {
      repo.assignMembers.mockResolvedValue('member_not_found');

      await expect(
        service.assign(CHAPTER, USER.president, [
          { member_id: 'stranger', pledge_class_id: null, order_number: 2 },
        ]),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('answers 400 when the write refuses a class the chapter does not have', async () => {
      repo.assignMembers.mockResolvedValue('class_not_found');

      await expect(
        service.assign(CHAPTER, USER.president, [
          { member_id: 'm1', pledge_class_id: 'elsewhere', order_number: 1 },
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it.each([
      ['in the same case', 'm1'],
      ['in a different case', 'M1'],
    ])(
      'answers 400 when a member is listed twice %s, and writes nothing',
      async (_why, second) => {
        await expect(
          service.assign(CHAPTER, USER.president, [
            { member_id: 'm1', pledge_class_id: 'a', order_number: 1 },
            { member_id: second, pledge_class_id: null, order_number: null },
          ]),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(repo.assignMembers).not.toHaveBeenCalled();
      },
    );

    it('sends the RPC only the three fields, whatever else the request carried', async () => {
      const assignment = {
        member_id: 'm1',
        pledge_class_id: 'a',
        order_number: 1,
        chapter_id: 'someone-else',
      };

      await service.assign(CHAPTER, USER.president, [assignment]);

      expect(repo.assignMembers).toHaveBeenCalledWith(CHAPTER, [
        { member_id: 'm1', pledge_class_id: 'a', order_number: 1 },
      ]);
    });

    describe('who may assign whom', () => {
      const pledge = {
        id: 'member-pledge',
        user_id: 'user-pledge',
        chapter_id: CHAPTER_ID,
        role_ids: [ROLE.pledge],
        pledge_class_id: null,
        order_number: null,
      } as unknown as Member;
      const withClass = (
        member: Member,
        pledge_class_id: string | null,
        order_number: number | null = null,
      ) => ({ ...member, pledge_class_id, order_number });
      const classGroup = (classId: string): ChapterGroup => ({
        id: `group-${classId}`,
        chapter_id: CHAPTER_ID,
        kind: 'pledge_class',
        name: classId,
        color: null,
        mentionable: true,
        pledge_class_id: classId,
        class_year: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      });
      let members: Member[];

      beforeEach(() => {
        members = [
          ...tieredChapterMembers().map((m) => withClass(m, 'class-old', 3)),
          pledge,
        ];
        memberRepo.findByChapter.mockImplementation(() =>
          Promise.resolve(members),
        );
        groupRepo.findByChapter.mockResolvedValue([
          classGroup('class-old'),
          classGroup('class-new'),
        ]);
      });

      it("lets a recruitment chair put this year's new members in their class", async () => {
        await service.assign(CHAPTER, USER.riskChair, [
          {
            member_id: pledge.id,
            pledge_class_id: 'class-new',
            order_number: 1,
          },
        ]);
        expect(repo.assignMembers).toHaveBeenCalled();
        // No channel names the class, so channels:manage was never asked.
        expect(rbac.memberHasAnyPermission).not.toHaveBeenCalled();
      });

      it('refuses a member ranked at or above the officer, and writes nothing', async () => {
        await expect(
          service.assign(CHAPTER, USER.riskChair, [
            {
              member_id: pledge.id,
              pledge_class_id: 'class-new',
              order_number: 1,
            },
            {
              member_id: MEMBER.vicePresident,
              pledge_class_id: null,
              order_number: 3,
            },
          ]),
        ).rejects.toThrow(
          'You can only set the class of members ranked below you, and your own.',
        );
        expect(repo.assignMembers).not.toHaveBeenCalled();
      });

      it('lets an officer set their own class, and the President anyone', async () => {
        await service.assign(CHAPTER, USER.riskChair, [
          {
            member_id: MEMBER.riskChair,
            pledge_class_id: 'class-new',
            order_number: 3,
          },
        ]);
        await service.assign(CHAPTER, USER.president, [
          {
            member_id: MEMBER.vicePresident,
            pledge_class_id: 'class-new',
            order_number: 9,
          },
        ]);
        expect(repo.assignMembers).toHaveBeenCalledTimes(2);
      });

      it('judges only the members whose class or number would change', async () => {
        await service.assign(CHAPTER, USER.riskChair, [
          {
            member_id: MEMBER.vicePresident.toUpperCase(),
            pledge_class_id: 'CLASS-OLD',
            order_number: 3,
          },
        ]);
        expect(repo.assignMembers).toHaveBeenCalled();
        expect(rbac.getRankContext).not.toHaveBeenCalled();
      });

      it("needs channels:manage to move someone into a class a channel's list names", async () => {
        groupRepo.isNamedOnChannelList.mockImplementation(
          (_chapterId: string, groupId: string) =>
            Promise.resolve(groupId === 'group-class-new'),
        );
        rbac.memberHasAnyPermission.mockResolvedValue(false);
        await expect(
          service.assign(CHAPTER, USER.riskChair, [
            {
              member_id: MEMBER.riskChair,
              pledge_class_id: 'class-new',
              order_number: 3,
            },
          ]),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(rbac.memberHasAnyPermission).toHaveBeenCalledWith(
          CHAPTER,
          USER.riskChair,
          [SystemPermissions.CHANNELS_MANAGE],
        );
        expect(repo.assignMembers).not.toHaveBeenCalled();
      });

      it('needs it to move someone out of one too', async () => {
        groupRepo.isNamedOnChannelList.mockImplementation(
          (_chapterId: string, groupId: string) =>
            Promise.resolve(groupId === 'group-class-old'),
        );
        rbac.memberHasAnyPermission.mockResolvedValue(false);
        await expect(
          service.assign(CHAPTER, USER.riskChair, [
            {
              member_id: MEMBER.brother,
              pledge_class_id: null,
              order_number: 3,
            },
          ]),
        ).rejects.toThrow(/only someone who can manage channels/);
      });

      it('lets a channels:manage holder move them, and anyone renumber within a class', async () => {
        groupRepo.isNamedOnChannelList.mockResolvedValue(true);
        // The risk chair's tier holds channels:manage.
        await service.assign(CHAPTER, USER.riskChair, [
          {
            member_id: pledge.id,
            pledge_class_id: 'class-new',
            order_number: 1,
          },
        ]);
        rbac.memberHasAnyPermission.mockResolvedValue(false);
        await service.assign(CHAPTER, USER.riskChair, [
          {
            member_id: MEMBER.brother,
            pledge_class_id: 'class-old',
            order_number: 12,
          },
        ]);
        expect(repo.assignMembers).toHaveBeenCalledTimes(2);
      });
    });
  });
});
