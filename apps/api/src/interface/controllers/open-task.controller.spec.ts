import { BadRequestException } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import { createUnguardedTestingModule } from '#test/helpers/guard-stubs.factory';
import { OpenTaskController } from './open-task.controller';
import { OpenTaskService } from '../../application/services/open-task.service';
import { RbacService } from '../../application/services/rbac.service';
import { SystemPermissions } from '#domain/constants/permissions';

describe('OpenTaskController (2026-11-18)', () => {
  let controller: OpenTaskController;
  let openTasks: Record<
    'list' | 'create' | 'update' | 'delete' | 'claim' | 'assign',
    jest.Mock
  >;
  let rbac: { memberHasAnyPermission: jest.Mock };

  beforeEach(async () => {
    openTasks = {
      list: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'posting-1' }),
      update: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
      claim: jest.fn().mockResolvedValue({ id: 'task-1' }),
      assign: jest.fn().mockResolvedValue({ id: 'task-1' }),
    };
    rbac = { memberHasAnyPermission: jest.fn().mockResolvedValue(false) };
    const module: TestingModule = await createUnguardedTestingModule({
      controllers: [OpenTaskController],
      providers: [
        { provide: OpenTaskService, useValue: openTasks },
        { provide: RbacService, useValue: rbac },
      ],
    }).compile();
    controller = module.get(OpenTaskController);
  });

  it('lists every posting for a tasks:manage holder, claimable ones otherwise', async () => {
    await controller.list('ch-1', 'u-1');
    expect(rbac.memberHasAnyPermission).toHaveBeenCalledWith('ch-1', 'u-1', [
      SystemPermissions.TASKS_MANAGE,
    ]);
    expect(openTasks.list).toHaveBeenCalledWith('ch-1', 'u-1', false);
  });

  it.each([
    [{}, { kind: 'chapter' }],
    [{ role_id: 'r-1' }, { kind: 'role', id: 'r-1' }],
    [{ group_id: 'g-1' }, { kind: 'group', id: 'g-1' }],
    [{ user_ids: ['a', 'b'] }, { kind: 'people', userIds: ['a', 'b'] }],
  ])('reads who may claim it from %j', async (scope, target) => {
    await controller.create('ch-1', 'officer-1', {
      title: 'Drive to the store',
      due_date: '2026-11-21',
      ...scope,
    });
    expect(openTasks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        chapter_id: 'ch-1',
        created_by: 'officer-1',
        description: null,
        due_at: null,
        point_reward: null,
        target,
      }),
    );
  });

  it('refuses more than one scope', async () => {
    await expect(
      controller.create('ch-1', 'officer-1', {
        title: 'A',
        due_date: '2026-11-21',
        role_id: 'r-1',
        group_id: 'g-1',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(openTasks.create).not.toHaveBeenCalled();
  });

  it('claims as the caller and assigns to whom the officer names', async () => {
    await controller.claim('ch-1', 'u-1', 'posting-1');
    expect(openTasks.claim).toHaveBeenCalledWith('ch-1', 'posting-1', 'u-1');
    await controller.assign('ch-1', 'officer-1', 'posting-1', {
      assignee_id: 'u-2',
    });
    expect(openTasks.assign).toHaveBeenCalledWith(
      'ch-1',
      'posting-1',
      'officer-1',
      'u-2',
    );
  });

  it('deletes', async () => {
    await expect(controller.delete('ch-1', 'posting-1')).resolves.toEqual({
      success: true,
    });
  });
});
