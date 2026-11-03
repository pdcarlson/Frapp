import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CustomRoleService } from './custom-role.service';
import { ChapterAuditLogService } from './chapter-audit-log.service';
import { createAuditLogServiceMock } from '#test/helpers/audit-log.mock';
import {
  CUSTOM_ROLE_REPOSITORY,
  CustomRoleKeyConflictError,
  type ICustomRoleRepository,
} from '#domain/repositories/custom-role.repository.interface';

const CHAPTER_ID = 'chapter-1';
const ACTOR_ID = 'user-1';

/** See `createAuditLogServiceMock` for why the row shape is asserted elsewhere. */
const auditLog = createAuditLogServiceMock();

beforeEach(() => {
  auditLog.record.mockClear();
});

type RepoMock = { [K in keyof ICustomRoleRepository]: jest.Mock };

/**
 * A repository double. `create` echoes its payload back as the stored row
 * unless a test overrides it, so the payload the service built is what the
 * assertions read.
 */
function makeRepo(
  opts: {
    /** Row returned by `findById`, read before update/delete. */
    existingRole?: Record<string, unknown> | null;
    /** Rows returned by the list reads. */
    listRows?: unknown[];
  } = {},
): RepoMock {
  return {
    findByChapter: jest.fn().mockResolvedValue(opts.listRows ?? []),
    findByIds: jest.fn().mockResolvedValue(opts.listRows ?? []),
    findById: jest.fn().mockResolvedValue(opts.existingRole ?? null),
    create: jest.fn((row: Record<string, unknown>) =>
      Promise.resolve({ id: 'r-new', ...row }),
    ),
    update: jest.fn().mockResolvedValue(null),
    delete: jest.fn().mockResolvedValue(undefined),
  };
}

async function buildService(repo: RepoMock) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      CustomRoleService,
      { provide: CUSTOM_ROLE_REPOSITORY, useValue: repo },
      { provide: ChapterAuditLogService, useValue: auditLog },
    ],
  }).compile();
  return module.get(CustomRoleService);
}

describe('CustomRoleService', () => {
  describe('findByChapter', () => {
    it('returns chapter custom roles ordered by rank', async () => {
      const rows = [{ id: 'r1', rank: 1 }];
      const repo = makeRepo({ listRows: rows });
      const service = await buildService(repo);

      const result = await service.findByChapter(CHAPTER_ID);

      expect(result).toEqual(rows);
      expect(repo.findByChapter).toHaveBeenCalledWith(CHAPTER_ID);
    });
  });

  describe('create', () => {
    it('inserts a role and writes an audit row', async () => {
      const created = {
        id: 'r1',
        chapter_id: CHAPTER_ID,
        key: 'pledge_educator',
        label: 'Pledge Educator',
        rank: 9,
        capabilities: ['members:view'],
        core: false,
      };
      const repo = makeRepo();
      repo.create.mockResolvedValue(created);
      const service = await buildService(repo);

      const result = await service.create(CHAPTER_ID, ACTOR_ID, {
        key: 'pledge_educator',
        label: 'Pledge Educator',
        rank: 9,
        capabilities: ['members:view'],
      });

      expect(result).toEqual(created);
      // Insert defaults applied + chapter scoping.
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          chapter_id: CHAPTER_ID,
          key: 'pledge_educator',
          rank: 9,
          capabilities: ['members:view'],
          core: false,
        }),
      );
      // Audit emitted.
      expect(auditLog.record).toHaveBeenCalledTimes(1);
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          chapterId: CHAPTER_ID,
          actorUserId: ACTOR_ID,
          action: 'chapter_custom_role_created',
          targetType: 'chapter_custom_role',
          // targetId is the role id so the audit log filters by entity.
          targetId: created.id,
        }),
      );
      // Left unset so `record`'s default (true) applies — the row value is
      // pinned in chapter-audit-log.service.spec.ts. Asserted explicitly
      // because `objectContaining` tolerates extra keys, so a later
      // `memberVisible: false` here would otherwise pass every assertion
      // while silently dropping role changes out of `#chapter-audit`.
      expect(auditLog.record.mock.calls[0][0].memberVisible).toBeUndefined();
    });

    it('ignores a client-supplied core flag and always persists core: false', async () => {
      const repo = makeRepo();
      const service = await buildService(repo);

      // `core` is not part of CreateCustomRoleDto; even if a caller smuggles it
      // through, the insert must force core: false (only seeding sets core).
      await service.create(CHAPTER_ID, ACTOR_ID, {
        key: 'sneaky',
        label: 'Sneaky',
        core: true,
      } as never);

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ core: false }),
      );
    });

    it('maps a duplicate key to 409 Conflict and does not audit', async () => {
      const repo = makeRepo();
      repo.create.mockRejectedValue(new CustomRoleKeyConflictError());
      const service = await buildService(repo);

      await expect(
        service.create(CHAPTER_ID, ACTOR_ID, {
          key: 'dup',
          label: 'Dup',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(auditLog.record).not.toHaveBeenCalled();
    });

    it('lets any other repository failure through unmapped', async () => {
      const failure = new Error('connection reset');
      const repo = makeRepo();
      repo.create.mockRejectedValue(failure);
      const service = await buildService(repo);

      await expect(
        service.create(CHAPTER_ID, ACTOR_ID, { key: 'x', label: 'X' }),
      ).rejects.toBe(failure);
    });
  });

  describe('remove', () => {
    it('refuses to delete a core role', async () => {
      const repo = makeRepo({
        existingRole: { id: 'r1', chapter_id: CHAPTER_ID, core: true },
      });
      const service = await buildService(repo);

      await expect(
        service.remove('r1', CHAPTER_ID, ACTOR_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.delete).not.toHaveBeenCalled();
      expect(auditLog.record).not.toHaveBeenCalled();
    });

    it('deletes a non-core role and audits the deletion', async () => {
      const repo = makeRepo({
        existingRole: { id: 'r1', chapter_id: CHAPTER_ID, core: false },
      });
      const service = await buildService(repo);

      const result = await service.remove('r1', CHAPTER_ID, ACTOR_ID);

      expect(result).toEqual({ success: true });
      expect(repo.delete).toHaveBeenCalledWith('r1', CHAPTER_ID);
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'chapter_custom_role_deleted' }),
      );
    });

    it('throws 404 when the role is missing', async () => {
      const service = await buildService(makeRepo({ existingRole: null }));

      await expect(
        service.remove('missing', CHAPTER_ID, ACTOR_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('applies a partial patch and audits the change', async () => {
      const existing = {
        id: 'r1',
        chapter_id: CHAPTER_ID,
        label: 'Old',
        rank: 5,
        capabilities: [],
        core: false,
      };
      const updated = { ...existing, label: 'New' };
      const repo = makeRepo({ existingRole: existing });
      repo.update.mockResolvedValue(updated);
      const service = await buildService(repo);

      const result = await service.update('r1', CHAPTER_ID, ACTOR_ID, {
        label: 'New',
      });

      expect(result).toEqual(updated);
      expect(repo.update).toHaveBeenCalledWith('r1', CHAPTER_ID, {
        label: 'New',
      });
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'chapter_custom_role_updated' }),
      );
    });

    it('returns the existing role without auditing when the patch is empty', async () => {
      const existing = { id: 'r1', chapter_id: CHAPTER_ID, core: false };
      const repo = makeRepo({ existingRole: existing });
      const service = await buildService(repo);

      const result = await service.update('r1', CHAPTER_ID, ACTOR_ID, {});

      expect(result).toEqual(existing);
      expect(repo.update).not.toHaveBeenCalled();
      expect(auditLog.record).not.toHaveBeenCalled();
    });

    it('throws 404 when the write matches no row', async () => {
      const repo = makeRepo({
        existingRole: { id: 'r1', chapter_id: CHAPTER_ID, core: false },
      });
      repo.update.mockResolvedValue(null);
      const service = await buildService(repo);

      await expect(
        service.update('r1', CHAPTER_ID, ACTOR_ID, { label: 'New' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(auditLog.record).not.toHaveBeenCalled();
    });
  });

  // Custom-role capabilities enter permission enforcement (bridge model), so
  // the wildcard is refused at the write boundary: only the live President
  // role may carry `*`.
  describe('wildcard rejection', () => {
    it('rejects create with a wildcard capability and writes nothing', async () => {
      const repo = makeRepo();
      const service = await buildService(repo);

      await expect(
        service.create(CHAPTER_ID, ACTOR_ID, {
          key: 'shadow_president',
          label: 'Shadow President',
          capabilities: ['*', 'members:view'],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(repo.create).not.toHaveBeenCalled();
      expect(auditLog.record).not.toHaveBeenCalled();
    });

    it('rejects update with a wildcard capability before touching the row', async () => {
      const existing = { id: 'r1', chapter_id: CHAPTER_ID, core: false };
      const repo = makeRepo({ existingRole: existing });
      const service = await buildService(repo);

      await expect(
        service.update('r1', CHAPTER_ID, ACTOR_ID, {
          capabilities: ['*'],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(repo.findById).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
      expect(auditLog.record).not.toHaveBeenCalled();
    });
  });

  describe('findByIds', () => {
    it('reads the ids within the chapter', async () => {
      const rows = [{ id: 'r1', capabilities: ['members:view'] }];
      const repo = makeRepo({ listRows: rows });
      const service = await buildService(repo);

      const result = await service.findByIds(['r1'], CHAPTER_ID);

      expect(result).toEqual(rows);
      expect(repo.findByIds).toHaveBeenCalledWith(['r1'], CHAPTER_ID);
    });
  });
});
