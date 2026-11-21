import { TestingModule } from '@nestjs/testing';
import { createUnguardedTestingModule } from '#test/helpers/guard-stubs.factory';
import { RoleTierController } from './role-tier.controller';
import { RoleTierService } from '../../application/services/role-tier.service';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { SystemPermissions } from '#domain/constants/permissions';

/**
 * The route gates of `/v1/role-tiers` (#4071). The rank rules live in
 * `RoleTierService`; these keep a brother holding only `members:view` off the
 * writes before any rank is read.
 */
describe('RoleTierController', () => {
  let controller: RoleTierController;
  let service: jest.Mocked<
    Pick<RoleTierService, 'list' | 'create' | 'update' | 'reorder' | 'delete'>
  >;

  beforeEach(async () => {
    service = {
      list: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      reorder: jest.fn(),
      delete: jest.fn(),
    };
    const module: TestingModule = await createUnguardedTestingModule({
      controllers: [RoleTierController],
      providers: [{ provide: RoleTierService, useValue: service }],
    }).compile();
    controller = module.get(RoleTierController);
  });

  it('reads on the class-level members:view alone', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, RoleTierController)).toEqual([
      SystemPermissions.MEMBERS_VIEW,
    ]);
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, RoleTierController.prototype.list),
    ).toBeUndefined();
  });

  it.each(['create', 'reorder', 'update', 'delete'] as const)(
    '%s adds roles:manage',
    (handler) => {
      expect(
        Reflect.getMetadata(
          PERMISSIONS_KEY,
          RoleTierController.prototype[handler],
        ),
      ).toEqual([SystemPermissions.ROLES_MANAGE]);
    },
  );

  it('passes the guard-resolved chapter and caller through', async () => {
    await controller.reorder('chapter-1', 'user-1', { tier_ids: ['t1'] });
    expect(service.reorder).toHaveBeenCalledWith('chapter-1', 'user-1', ['t1']);
    await expect(
      controller.delete('tier-1', 'chapter-1', 'user-1'),
    ).resolves.toEqual({ success: true });
    expect(service.delete).toHaveBeenCalledWith(
      'tier-1',
      'chapter-1',
      'user-1',
    );
  });
});
