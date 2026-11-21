import { DisplayNameLockService } from './display-name-lock.service';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import type { IChapterRepository } from '#domain/repositories/chapter.repository.interface';
import type { RbacService } from './rbac.service';
import type { ChapterAuditLogService } from './chapter-audit-log.service';

describe('DisplayNameLockService (#5801)', () => {
  const findByUser = jest.fn();
  const findByIds = jest.fn();
  const getEffectivePermissions = jest.fn();
  const record = jest.fn();
  const service = new DisplayNameLockService(
    { findByUser } as unknown as IMemberRepository,
    { findByIds } as unknown as IChapterRepository,
    { getEffectivePermissions } as unknown as RbacService,
    { record } as unknown as ChapterAuditLogService,
  );

  const NOW = new Date('2026-11-21T12:00:00Z');
  const membership = (
    chapter_id: string,
    has_completed_onboarding = true,
    created_at = '2026-11-01T00:00:00Z',
  ) => ({
    id: `m-${chapter_id}`,
    user_id: 'u-1',
    chapter_id,
    has_completed_onboarding,
    created_at,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    getEffectivePermissions.mockResolvedValue([]);
  });

  it('locks a settled member of a chapter that keeps names locked', async () => {
    findByUser.mockResolvedValue([membership('ch-1')]);
    findByIds.mockResolvedValue([{ id: 'ch-1' }]);
    await expect(service.isLocked('u-1', NOW)).resolves.toBe(true);
  });

  it('leaves it open where the chapter lets members rename', async () => {
    findByUser.mockResolvedValue([membership('ch-1')]);
    findByIds.mockResolvedValue([
      { id: 'ch-1', members_can_change_name: true },
    ]);
    await expect(service.isLocked('u-1', NOW)).resolves.toBe(false);
    expect(getEffectivePermissions).not.toHaveBeenCalled();
  });

  it('exempts a member holding roles:manage there, the wildcard included', async () => {
    findByUser.mockResolvedValue([membership('ch-1')]);
    findByIds.mockResolvedValue([{ id: 'ch-1' }]);
    getEffectivePermissions.mockResolvedValue(['roles:manage']);
    await expect(service.isLocked('u-1', NOW)).resolves.toBe(false);
    getEffectivePermissions.mockResolvedValue(['*']);
    await expect(service.isLocked('u-1', NOW)).resolves.toBe(false);
  });

  it('lets a member on the welcome screen name themselves for a day', async () => {
    findByIds.mockResolvedValue([{ id: 'ch-1' }]);
    findByUser.mockResolvedValue([
      membership('ch-1', false, '2026-11-21T08:00:00Z'),
    ]);
    await expect(service.isLocked('u-1', NOW)).resolves.toBe(false);
    // One who never finished the welcome screen is settled after a day.
    findByUser.mockResolvedValue([
      membership('ch-1', false, '2026-11-19T08:00:00Z'),
    ]);
    await expect(service.isLocked('u-1', NOW)).resolves.toBe(true);
  });

  it('never locks a member of two chapters, whom no officer may correct', async () => {
    findByUser.mockResolvedValue([membership('ch-1'), membership('ch-2')]);
    await expect(service.isLocked('u-1', NOW)).resolves.toBe(false);
    expect(findByIds).not.toHaveBeenCalled();
  });

  it('records a rename in every chapter the member is in', async () => {
    findByUser.mockResolvedValue([
      membership('ch-1'),
      membership('ch-2', false),
    ]);
    await service.recordRename(
      { id: 'u-1', email: 'ethan@example.com' },
      'Ethan Smith',
      'Paul',
    );
    expect(record).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenCalledWith({
      chapterId: 'ch-1',
      actorUserId: 'u-1',
      action: 'member_renamed',
      targetType: 'member',
      targetId: 'm-ch-1',
      diff: { display_name: { from: 'Ethan Smith', to: 'Paul' } },
    });
  });

  it("doesn't record a first name replacing the sign-in stand-in", async () => {
    findByUser.mockResolvedValue([membership('ch-1', false)]);
    for (const from of ['', 'Member', 'ethan']) {
      await service.recordRename(
        { id: 'u-1', email: 'ethan@example.com' },
        from,
        'Ethan Smith',
      );
    }
    expect(record).not.toHaveBeenCalled();
  });
});
