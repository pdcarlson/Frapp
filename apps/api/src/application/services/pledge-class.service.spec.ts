import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PLEDGE_CLASSES_MAX } from '@repo/validation';
import { PledgeClassService } from './pledge-class.service';
import type { IPledgeClassRepository } from '#domain/repositories/pledge-class.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import type { PledgeClass } from '#domain/entities/pledge-class.entity';
import { memberFixture } from '#test/helpers/entity-fixtures';

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
  let memberRepo: jest.Mocked<IMemberRepository>;
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
    memberRepo = {
      findByChapter: jest.fn().mockResolvedValue([]),
    } as Partial<
      jest.Mocked<IMemberRepository>
    > as jest.Mocked<IMemberRepository>;
    service = new PledgeClassService(repo, memberRepo);
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
    beforeEach(() => {
      memberRepo.findByChapter.mockResolvedValue([
        memberFixture({ id: 'm1', chapter_id: CHAPTER }),
        memberFixture({ id: 'm2', chapter_id: CHAPTER }),
      ]);
      repo.findByChapter.mockResolvedValue([pledgeClass('a', 1)]);
    });

    it('writes every listed member in one call and returns what was stored', async () => {
      repo.assignMembers.mockResolvedValue([
        memberFixture({ id: 'm1', pledge_class_id: 'a', order_number: 2 }),
        memberFixture({ id: 'm2', pledge_class_id: null, order_number: 9 }),
      ]);
      const assignments = [
        { member_id: 'm1', pledge_class_id: 'a', order_number: 2 },
        { member_id: 'm2', pledge_class_id: null, order_number: 9 },
      ];

      const result = await service.assign(CHAPTER, assignments);

      expect(repo.assignMembers).toHaveBeenCalledTimes(1);
      expect(repo.assignMembers).toHaveBeenCalledWith(CHAPTER, assignments);
      expect(result).toEqual(assignments);
    });

    it('takes an order number with no class: a chapter may keep only a chapter-wide number', async () => {
      await service.assign(CHAPTER, [
        { member_id: 'm1', pledge_class_id: null, order_number: 41 },
      ]);

      expect(repo.assignMembers).toHaveBeenCalled();
    });

    it('answers 404 for a member who is not in the chapter, and writes nothing', async () => {
      await expect(
        service.assign(CHAPTER, [
          { member_id: 'm1', pledge_class_id: 'a', order_number: 1 },
          { member_id: 'stranger', pledge_class_id: 'a', order_number: 2 },
        ]),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.assignMembers).not.toHaveBeenCalled();
    });

    it('answers 400 for a class the chapter does not have, and writes nothing', async () => {
      await expect(
        service.assign(CHAPTER, [
          { member_id: 'm1', pledge_class_id: 'elsewhere', order_number: 1 },
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.assignMembers).not.toHaveBeenCalled();
    });

    it('answers 400 when a member is listed twice', async () => {
      await expect(
        service.assign(CHAPTER, [
          { member_id: 'm1', pledge_class_id: 'a', order_number: 1 },
          { member_id: 'm1', pledge_class_id: null, order_number: null },
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('sends the RPC only the three fields, whatever else the request carried', async () => {
      const assignment = {
        member_id: 'm1',
        pledge_class_id: 'a',
        order_number: 1,
        chapter_id: 'someone-else',
      };

      await service.assign(CHAPTER, [assignment]);

      expect(repo.assignMembers).toHaveBeenCalledWith(CHAPTER, [
        { member_id: 'm1', pledge_class_id: 'a', order_number: 1 },
      ]);
    });
  });
});
