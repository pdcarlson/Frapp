import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { RoleTierService } from './role-tier.service';
import type { RbacService } from './rbac.service';
import type { IRoleTierRepository } from '#domain/repositories/role-tier.repository.interface';
import type { RoleTier } from '#domain/entities/role.entity';
import {
  createAuditLogServiceMock,
  type AuditLogServiceMock,
} from '#test/helpers/audit-log.mock';
import {
  CHAPTER_ID,
  TIER,
  USER,
  tieredChapterTiers,
  tieredRankContext,
} from '#test/helpers/tiered-chapter.fixture';

/** The rank rules on the tier routes (#4071), over a real chapter's shape. */
describe('RoleTierService', () => {
  let tiers: RoleTier[];
  let repo: jest.Mocked<IRoleTierRepository>;
  let audit: AuditLogServiceMock;
  let service: RoleTierService;

  beforeEach(() => {
    tiers = tieredChapterTiers();
    repo = {
      findByChapter: jest.fn().mockResolvedValue(tiers),
      createMany: jest.fn(),
      create: jest.fn(async (data) => ({
        ...(data as RoleTier),
        id: 'tier-new',
      })),
      update: jest.fn(async (id, _chapterId, changes) => ({
        ...tiers.find((tier) => tier.id === id)!,
        ...changes,
      })),
      reorder: jest.fn(
        async (
          _chapterId: string,
          ids: string[],
          _fixedIds: string[],
        ): Promise<RoleTier[] | 'stale'> =>
          ids.map((id, index) => ({
            ...tiers.find((tier) => tier.id === id)!,
            position: index + 1,
          })),
      ),
      delete: jest.fn().mockResolvedValue('deleted'),
    };
    audit = createAuditLogServiceMock();
    const rbac = {
      getRankContext: jest.fn(async (_chapterId: string, userId: string) =>
        tieredRankContext(userId, tiers),
      ),
    } as unknown as RbacService;
    service = new RoleTierService(repo, rbac, audit as never);
  });

  describe('a chair holding roles:manage', () => {
    it("cannot rename or re-permission the chairs' own tier or the one above", async () => {
      for (const tierId of [TIER.chairs, TIER.board]) {
        await expect(
          service.update(tierId, CHAPTER_ID, USER.riskChair, {
            permissions: ['members:view'],
          }),
        ).rejects.toBeInstanceOf(ForbiddenException);
      }
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('edits a tier below them, granting only what they hold', async () => {
      await expect(
        service.update(TIER.brothers, CHAPTER_ID, USER.riskChair, {
          permissions: ['members:view', 'service:log', 'roles:manage'],
        }),
      ).resolves.toBeDefined();
      await expect(
        service.update(TIER.brothers, CHAPTER_ID, USER.riskChair, {
          permissions: ['members:view', 'billing:view'],
        }),
      ).rejects.toThrow(/billing:view/);
    });

    it('cannot lift a tier to or above their own', async () => {
      await expect(
        service.reorder(CHAPTER_ID, USER.riskChair, [
          TIER.board,
          TIER.brothers,
          TIER.chairs,
          TIER.pledges,
        ]),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.reorder).not.toHaveBeenCalled();
    });

    it('reorders the tiers below them, holding the ones above fixed in the database', async () => {
      const order = [TIER.board, TIER.chairs, TIER.pledges, TIER.brothers];
      const result = await service.reorder(CHAPTER_ID, USER.riskChair, order);
      expect(repo.reorder).toHaveBeenCalledWith(CHAPTER_ID, order, [
        TIER.board,
        TIER.chairs,
      ]);
      expect(result.map((tier) => tier.id)).toEqual(order);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'role_tiers_reordered' }),
      );
    });

    it('adds a tier at the bottom, below everyone', async () => {
      await service.create(CHAPTER_ID, USER.riskChair, {
        name: '  Probationary  ',
        permissions: ['members:view'],
      });
      expect(repo.create).toHaveBeenCalledWith({
        chapter_id: CHAPTER_ID,
        name: 'Probationary',
        position: 5,
        permissions: ['members:view'],
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'role_tier_created' }),
      );
    });
  });

  it('refuses a new tier holding a permission the caller lacks', async () => {
    await expect(
      service.create(CHAPTER_ID, USER.brother, {
        name: 'Probationary',
        permissions: ['tasks:manage'],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a member outside every tier', async () => {
    await expect(
      service.create(CHAPTER_ID, 'user-stranger', { name: 'Anything' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets the President reorder every tier, with nothing held fixed', async () => {
    const order = [TIER.chairs, TIER.board, TIER.brothers, TIER.pledges];
    await service.reorder(CHAPTER_ID, USER.president, order);
    expect(repo.reorder).toHaveBeenCalledWith(CHAPTER_ID, order, []);
  });

  it('refuses a reorder that does not list every tier once', async () => {
    await expect(
      service.reorder(CHAPTER_ID, USER.president, [TIER.board, TIER.board]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('answers a reorder the database found stale with 409', async () => {
    repo.reorder.mockResolvedValueOnce('stale');
    await expect(
      service.reorder(CHAPTER_ID, USER.president, [
        TIER.chairs,
        TIER.board,
        TIER.brothers,
        TIER.pledges,
      ]),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('never puts the wildcard on a tier', async () => {
    await expect(
      service.update(TIER.pledges, CHAPTER_ID, USER.president, {
        permissions: ['*'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to delete a tier that still has roles, and deletes an empty one', async () => {
    await expect(
      service.delete(TIER.pledges, CHAPTER_ID, USER.president),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.delete).not.toHaveBeenCalled();

    tiers.push({ ...tiers[3], id: 'tier-empty', position: 5 });
    await service.delete('tier-empty', CHAPTER_ID, USER.president);
    expect(repo.delete).toHaveBeenCalledWith('tier-empty', CHAPTER_ID);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'role_tier_deleted',
        targetId: 'tier-empty',
      }),
    );
  });

  it("stops a chair deleting their own tier or one above, even when it's empty", async () => {
    // The top tier, emptied: the board's roles now sit in none.
    tiers[0] = { ...tiers[0], id: 'tier-empty-top' };
    for (const tierId of ['tier-empty-top', TIER.chairs]) {
      await expect(
        service.delete(tierId, CHAPTER_ID, USER.riskChair),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('answers a tier someone else just deleted with 404, and records nothing', async () => {
    tiers.push({ ...tiers[3], id: 'tier-empty', position: 5 });
    repo.delete.mockResolvedValueOnce('missing');
    await expect(
      service.delete('tier-empty', CHAPTER_ID, USER.president),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('records a rename and a permission change as one tier_updated row', async () => {
    await service.update(TIER.pledges, CHAPTER_ID, USER.president, {
      name: 'Pledges',
      permissions: ['members:view', 'backwork:upload'],
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'role_tier_updated',
        diff: {
          name: { from: 'Associates', to: 'Pledges' },
          permissions: { added: ['backwork:upload'], removed: [] },
        },
      }),
    );
  });

  it('answers a taken name with 409', async () => {
    repo.update.mockResolvedValueOnce(null);
    await expect(
      service.update(TIER.pledges, CHAPTER_ID, USER.president, {
        name: 'Brothers',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
