import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ChapterGroupService, withMembers } from './chapter-group.service';
import type { IChapterGroupRepository } from '#domain/repositories/chapter-group.repository.interface';
import type { IRoleRepository } from '#domain/repositories/role.repository.interface';
import type { IRoleTierRepository } from '#domain/repositories/role-tier.repository.interface';
import type { ChapterGroup } from '#domain/entities/chapter-group.entity';
import {
  createChapterGroupRepoMock,
  type ChapterGroupRepoMock,
} from '#test/helpers/chapter-group-repo.mock';
import {
  createAuditLogServiceMock,
  type AuditLogServiceMock,
} from '#test/helpers/audit-log.mock';

const CHAPTER = 'ch-1';
const ACTOR = 'u-actor';

function group(
  id: string,
  name: string,
  extra: Partial<ChapterGroup> = {},
): ChapterGroup {
  return {
    id,
    chapter_id: CHAPTER,
    kind: 'manual',
    name,
    color: null,
    mentionable: true,
    pledge_class_id: null,
    class_year: null,
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
    ...extra,
  };
}

describe('ChapterGroupService (#4076)', () => {
  let repo: ChapterGroupRepoMock;
  let audit: AuditLogServiceMock;
  let roles: { findByChapter: jest.Mock };
  let tiers: { findByChapter: jest.Mock };
  let service: ChapterGroupService;

  beforeEach(() => {
    repo = createChapterGroupRepoMock();
    audit = createAuditLogServiceMock();
    roles = {
      findByChapter: jest
        .fn()
        .mockResolvedValue([{ chapter_id: CHAPTER, name: 'Officers' }]),
    };
    tiers = {
      findByChapter: jest
        .fn()
        .mockResolvedValue([{ chapter_id: CHAPTER, name: 'Exec board' }]),
    };
    service = new ChapterGroupService(
      repo,
      roles as unknown as IRoleRepository,
      tiers as unknown as IRoleTierRepository,
      audit as never,
    );
  });

  describe('list', () => {
    it('lists manual groups first and leaves out an automatic group nobody is in', async () => {
      repo.findByChapter.mockResolvedValue([
        group('y', 'Class of 2027', { kind: 'class_year', class_year: 2027 }),
        group('p', 'Alpha', { kind: 'pledge_class', pledge_class_id: 'pc' }),
        group('e', 'Empty class', {
          kind: 'pledge_class',
          pledge_class_id: 'q',
        }),
        group('m', 'Third floor'),
      ]);
      repo.findMemberships.mockResolvedValue([
        { chapter_id: CHAPTER, group_id: 'y', user_id: 'u2' },
        { chapter_id: CHAPTER, group_id: 'p', user_id: 'u1' },
      ]);

      const list = await service.list(CHAPTER);

      expect(list.map((g) => [g.id, g.member_ids])).toEqual([
        ['m', []],
        ['p', ['u1']],
        ['y', ['u2']],
      ]);
    });
  });

  describe('create', () => {
    beforeEach(() => {
      repo.create.mockImplementation(async (data) =>
        group('new', data.name, { color: data.color }),
      );
    });

    it('creates a group with its first members and audits both', async () => {
      repo.setMembers.mockResolvedValue(['u1', 'u2']);

      const created = await service.create(CHAPTER, ACTOR, {
        name: '  Live-ins ',
        member_ids: ['u2', 'u1'],
      });

      expect(repo.create).toHaveBeenCalledWith({
        chapter_id: CHAPTER,
        name: 'Live-ins',
        color: null,
        mentionable: true,
      });
      expect(created.member_ids).toEqual(['u1', 'u2']);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'chapter_group_created',
          targetId: 'new',
          diff: {
            group: { from: null, to: { name: 'Live-ins', color: null } },
            members: { from: [], to: ['u1', 'u2'] },
          },
        }),
      );
    });

    it.each([
      ['a role', 'officers!'],
      ['a tier', 'Exec Board'],
      ['another group', 'THIRD FLOOR'],
    ])(
      'refuses a name %s already has, as a mention compares',
      async (_, name) => {
        repo.findByChapter.mockResolvedValue([group('m', 'Third floor')]);

        await expect(service.create(CHAPTER, ACTOR, { name })).rejects.toThrow(
          ConflictException,
        );
        expect(repo.create).not.toHaveBeenCalled();
      },
    );

    it.each(['everyone', '@Here', '---'])(
      'refuses %s, which is no name a mention can reach on its own',
      async (name) => {
        await expect(service.create(CHAPTER, ACTOR, { name })).rejects.toThrow(
          BadRequestException,
        );
      },
    );

    it('deletes the new group again when a picked member left the chapter', async () => {
      repo.setMembers.mockResolvedValue('member_not_found');

      await expect(
        service.create(CHAPTER, ACTOR, { name: 'Live-ins', member_ids: ['x'] }),
      ).rejects.toThrow(BadRequestException);
      expect(repo.delete).toHaveBeenCalledWith('new', CHAPTER);
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('reports a name taken in a race as a conflict', async () => {
      repo.create.mockResolvedValue(null);

      await expect(
        service.create(CHAPTER, ACTOR, { name: 'Live-ins' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('refuses renaming an automatic group, and lets its color and switch change', async () => {
      const auto = group('p', 'Alpha', {
        kind: 'pledge_class',
        pledge_class_id: 'pc',
      });
      repo.findByChapter.mockResolvedValue([auto]);

      await expect(
        service.update('p', CHAPTER, ACTOR, { name: 'Beta' }),
      ).rejects.toThrow(BadRequestException);

      repo.update.mockResolvedValue({ ...auto, mentionable: false });
      const updated = await service.update('p', CHAPTER, ACTOR, {
        name: 'Alpha',
        mentionable: false,
      });
      expect(repo.update).toHaveBeenCalledWith('p', CHAPTER, {
        mentionable: false,
      });
      expect(updated.mentionable).toBe(false);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'chapter_group_updated',
          diff: { mentionable: { from: true, to: false } },
        }),
      );
    });

    it('writes nothing when nothing changed', async () => {
      repo.findByChapter.mockResolvedValue([group('m', 'Third floor')]);

      await service.update('m', CHAPTER, ACTOR, {
        name: 'Third floor',
        mentionable: true,
      });

      expect(repo.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it("misses another chapter's group", async () => {
      repo.findByChapter.mockResolvedValue([]);

      await expect(
        service.update('m', CHAPTER, ACTOR, { mentionable: false }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('setMembers', () => {
    it('replaces the list and audits who it was before and after', async () => {
      repo.findById.mockResolvedValue(group('m', 'Third floor'));
      repo.findMemberships.mockResolvedValue([
        { chapter_id: CHAPTER, group_id: 'm', user_id: 'u1' },
      ]);
      repo.setMembers.mockResolvedValue(['u2']);

      const view = await service.setMembers('m', CHAPTER, ACTOR, ['u2']);

      expect(view.member_ids).toEqual(['u2']);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'chapter_group_members_set',
          diff: { members: { from: ['u1'], to: ['u2'] } },
        }),
      );
    });

    it('refuses an automatic group, whose members follow their data', async () => {
      repo.findById.mockResolvedValue(
        group('y', 'Class of 2027', { kind: 'class_year', class_year: 2027 }),
      );

      await expect(
        service.setMembers('y', CHAPTER, ACTOR, ['u1']),
      ).rejects.toThrow(BadRequestException);
      expect(repo.setMembers).not.toHaveBeenCalled();
    });

    it('refuses the whole list when someone in it left the chapter', async () => {
      repo.findById.mockResolvedValue(group('m', 'Third floor'));
      repo.setMembers.mockResolvedValue('member_not_found');

      await expect(
        service.setMembers('m', CHAPTER, ACTOR, ['gone']),
      ).rejects.toThrow(BadRequestException);
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes a manual group and audits it', async () => {
      repo.findById.mockResolvedValue(group('m', 'Third floor'));

      await service.remove('m', CHAPTER, ACTOR);

      expect(repo.delete).toHaveBeenCalledWith('m', CHAPTER);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'chapter_group_deleted' }),
      );
    });

    it('refuses an automatic group', async () => {
      repo.findById.mockResolvedValue(
        group('p', 'Alpha', { kind: 'pledge_class', pledge_class_id: 'pc' }),
      );

      await expect(service.remove('p', CHAPTER, ACTOR)).rejects.toThrow(
        BadRequestException,
      );
      expect(repo.delete).not.toHaveBeenCalled();
    });
  });
});

describe('withMembers', () => {
  it('orders class years by year', () => {
    const views = withMembers(
      [
        group('b', 'Class of 2028', { kind: 'class_year', class_year: 2028 }),
        group('a', 'Class of 2026', { kind: 'class_year', class_year: 2026 }),
      ],
      [],
    );
    expect(views.map((v) => v.id)).toEqual(['a', 'b']);
  });
});
