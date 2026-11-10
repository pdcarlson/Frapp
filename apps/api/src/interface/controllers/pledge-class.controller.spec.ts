import { TestingModule } from '@nestjs/testing';
import { createUnguardedTestingModule } from '#test/helpers/guard-stubs.factory';
import { PledgeClassController } from './pledge-class.controller';
import { PledgeClassService } from '../../application/services/pledge-class.service';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { SystemPermissions } from '#domain/constants/permissions';

describe('PledgeClassController', () => {
  let controller: PledgeClassController;
  let service: jest.Mocked<
    Pick<
      PledgeClassService,
      'list' | 'create' | 'rename' | 'reorder' | 'remove' | 'assign'
    >
  >;

  beforeEach(async () => {
    service = {
      list: jest.fn(),
      create: jest.fn(),
      rename: jest.fn(),
      reorder: jest.fn(),
      remove: jest.fn(),
      assign: jest.fn(),
    };
    const module: TestingModule = await createUnguardedTestingModule({
      controllers: [PledgeClassController],
      providers: [{ provide: PledgeClassService, useValue: service }],
    }).compile();
    controller = module.get(PledgeClassController);
  });

  it('reads on the class-level members:view alone', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, PledgeClassController)).toEqual(
      [SystemPermissions.MEMBERS_VIEW],
    );
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        PledgeClassController.prototype.list,
      ),
    ).toBeUndefined();
  });

  it.each(['create', 'rename', 'reorder', 'remove', 'assign'] as const)(
    '%s also needs roles:manage',
    (handler) => {
      expect(
        Reflect.getMetadata(
          PERMISSIONS_KEY,
          PledgeClassController.prototype[handler],
        ),
      ).toEqual([SystemPermissions.ROLES_MANAGE]);
    },
  );

  it('scopes every call to the guard-resolved chapter', async () => {
    await controller.list('ch-1');
    await controller.create('ch-1', { name: 'Alpha' });
    await controller.rename('ch-1', 'class-1', { name: 'Beta' });
    await controller.reorder('ch-1', { ids: ['class-1'] });
    const assignments = [
      { member_id: 'm1', pledge_class_id: 'class-1', order_number: 1 },
    ];
    await controller.assign('ch-1', { assignments });

    expect(service.list).toHaveBeenCalledWith('ch-1');
    expect(service.create).toHaveBeenCalledWith('ch-1', 'Alpha');
    expect(service.rename).toHaveBeenCalledWith('class-1', 'ch-1', 'Beta');
    expect(service.reorder).toHaveBeenCalledWith('ch-1', ['class-1']);
    expect(service.assign).toHaveBeenCalledWith('ch-1', assignments);
  });

  it('remove answers success', async () => {
    await expect(controller.remove('ch-1', 'class-1')).resolves.toEqual({
      success: true,
    });
    expect(service.remove).toHaveBeenCalledWith('class-1', 'ch-1');
  });
});
