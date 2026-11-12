import { TestingModule } from '@nestjs/testing';
import { createUnguardedTestingModule } from '#test/helpers/guard-stubs.factory';
import { ChapterGroupController } from './chapter-group.controller';
import { ChapterGroupService } from '../../application/services/chapter-group.service';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { SystemPermissions } from '#domain/constants/permissions';

describe('ChapterGroupController (#4076)', () => {
  let controller: ChapterGroupController;
  let service: jest.Mocked<
    Pick<
      ChapterGroupService,
      'list' | 'create' | 'update' | 'setMembers' | 'remove'
    >
  >;

  beforeEach(async () => {
    service = {
      list: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      setMembers: jest.fn(),
      remove: jest.fn(),
    };
    const module: TestingModule = await createUnguardedTestingModule({
      controllers: [ChapterGroupController],
      providers: [{ provide: ChapterGroupService, useValue: service }],
    }).compile();
    controller = module.get(ChapterGroupController);
  });

  it('reads on the class-level members:view alone', () => {
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, ChapterGroupController),
    ).toEqual([SystemPermissions.MEMBERS_VIEW]);
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        ChapterGroupController.prototype.list,
      ),
    ).toBeUndefined();
  });

  // Without it a write would need only members:view, which every member holds.
  it.each(['create', 'update', 'setMembers', 'remove'] as const)(
    '%s also needs groups:manage',
    (handler) => {
      expect(
        Reflect.getMetadata(
          PERMISSIONS_KEY,
          ChapterGroupController.prototype[handler],
        ),
      ).toEqual([SystemPermissions.GROUPS_MANAGE]);
    },
  );

  it('scopes every call to the guard-resolved chapter and the caller', async () => {
    await controller.list('ch-1');
    await controller.create('ch-1', 'u-1', { name: 'Live-ins' });
    await controller.update('ch-1', 'u-1', 'g-1', { mentionable: false });
    await controller.setMembers('ch-1', 'u-1', 'g-1', { member_ids: ['u-2'] });
    await expect(controller.remove('ch-1', 'u-1', 'g-1')).resolves.toEqual({
      success: true,
    });

    expect(service.list).toHaveBeenCalledWith('ch-1');
    expect(service.create).toHaveBeenCalledWith('ch-1', 'u-1', {
      name: 'Live-ins',
    });
    expect(service.update).toHaveBeenCalledWith('g-1', 'ch-1', 'u-1', {
      mentionable: false,
    });
    expect(service.setMembers).toHaveBeenCalledWith('g-1', 'ch-1', 'u-1', [
      'u-2',
    ]);
    expect(service.remove).toHaveBeenCalledWith('g-1', 'ch-1', 'u-1');
  });
});
