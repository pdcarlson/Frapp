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

  const membership = (chapter_id: string, has_completed_onboarding = true) => ({
    id: `m-${chapter_id}`,
    user_id: 'u-1',
    chapter_id,
    has_completed_onboarding,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    getEffectivePermissions.mockResolvedValue([]);
  });

  it('locks a joined member of a chapter that keeps names locked', async () => {
    findByUser.mockResolvedValue([membership('ch-1')]);
    findByIds.mockResolvedValue([{ id: 'ch-1' }]);
    await expect(service.isLocked('u-1')).resolves.toBe(true);
  });

  it('leaves it open where the chapter lets members rename', async () => {
    findByUser.mockResolvedValue([membership('ch-1')]);
    findByIds.mockResolvedValue([
      { id: 'ch-1', members_can_change_name: true },
    ]);
    await expect(service.isLocked('u-1')).resolves.toBe(false);
    expect(getEffectivePermissions).not.toHaveBeenCalled();
  });

  it('exempts a member holding roles:manage there, the wildcard included', async () => {
    findByUser.mockResolvedValue([membership('ch-1')]);
    findByIds.mockResolvedValue([{ id: 'ch-1' }]);
    getEffectivePermissions.mockResolvedValue(['roles:manage']);
    await expect(service.isLocked('u-1')).resolves.toBe(false);
    getEffectivePermissions.mockResolvedValue(['*']);
    await expect(service.isLocked('u-1')).resolves.toBe(false);
  });

  it('never locks a member still on the welcome screen', async () => {
    findByUser.mockResolvedValue([membership('ch-1', false)]);
    await expect(service.isLocked('u-1')).resolves.toBe(false);
    expect(findByIds).not.toHaveBeenCalled();
  });

  it('locks when any joined chapter locks it', async () => {
    findByUser.mockResolvedValue([membership('ch-1'), membership('ch-2')]);
    findByIds.mockResolvedValue([
      { id: 'ch-1', members_can_change_name: true },
      { id: 'ch-2', members_can_change_name: false },
    ]);
    await expect(service.isLocked('u-1')).resolves.toBe(true);
  });

  it('records a rename in each joined chapter only', async () => {
    findByUser.mockResolvedValue([
      membership('ch-1'),
      membership('ch-2', false),
    ]);
    await service.recordRename('u-1', 'Ethan Smith', 'Paul');
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith({
      chapterId: 'ch-1',
      actorUserId: 'u-1',
      action: 'member_renamed',
      targetType: 'member',
      targetId: 'm-ch-1',
      diff: { display_name: { from: 'Ethan Smith', to: 'Paul' } },
    });
  });
});
