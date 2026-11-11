import { TestingModule } from '@nestjs/testing';
import { createUnguardedTestingModule } from '#test/helpers/guard-stubs.factory';
import { CustomRoleController } from './custom-role.controller';
import { SystemPermissions } from '#domain/constants/permissions';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';

describe('CustomRoleController', () => {
  let controller: CustomRoleController;

  beforeEach(async () => {
    const module: TestingModule = await createUnguardedTestingModule({
      controllers: [CustomRoleController],
    }).compile();

    controller = module.get<CustomRoleController>(CustomRoleController);
  });

  it('answers an empty list: custom roles are ordinary roles now (#4075)', () => {
    expect(controller.list()).toEqual([]);
  });

  it('keeps the read gate the shipped builds were made against', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, CustomRoleController)).toEqual([
      SystemPermissions.CHAPTER_CONFIG_VIEW,
    ]);
  });

  it('serves only GET: the writes are gone', () => {
    const methods = Object.getOwnPropertyNames(
      CustomRoleController.prototype,
    ).filter((name) => name !== 'constructor');
    expect(methods).toEqual(['list']);
  });
});
