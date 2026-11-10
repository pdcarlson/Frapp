import { TestingModule } from '@nestjs/testing';
import { createUnguardedTestingModule } from '#test/helpers/guard-stubs.factory';
import { CustomRoleController } from './custom-role.controller';
import { CustomRoleService } from '../../application/services/custom-role.service';
import { SystemPermissions } from '#domain/constants/permissions';
import {
  PERMISSIONS_ANY_KEY,
  PERMISSIONS_KEY,
} from '../decorators/permissions.decorator';
import {
  CreateCustomRoleDto,
  UpdateCustomRoleDto,
} from '../dtos/custom-role.dto';

describe('CustomRoleController', () => {
  let controller: CustomRoleController;
  let service: jest.Mocked<
    Pick<CustomRoleService, 'findByChapter' | 'create' | 'update' | 'remove'>
  >;

  beforeEach(async () => {
    service = {
      findByChapter: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };

    const module: TestingModule = await createUnguardedTestingModule({
      controllers: [CustomRoleController],
      providers: [{ provide: CustomRoleService, useValue: service }],
    }).compile();

    controller = module.get<CustomRoleController>(CustomRoleController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('list', () => {
    it('lists chapter custom roles', async () => {
      const expected = [{ id: 'r1' }] as any;
      service.findByChapter.mockResolvedValue(expected);

      const result = await controller.list('chapter-1');

      expect(service.findByChapter).toHaveBeenCalledWith('chapter-1');
      expect(result).toEqual(expected);
    });
  });

  describe('create', () => {
    it('creates a custom role scoped to the chapter + actor', async () => {
      const dto: CreateCustomRoleDto = {
        key: 'pledge_educator',
        label: 'Pledge Educator',
        capabilities: ['members:view'],
      };
      const expected = { id: 'r1', ...dto } as any;
      service.create.mockResolvedValue(expected);

      const result = await controller.create('chapter-1', 'user-1', dto);

      expect(service.create).toHaveBeenCalledWith('chapter-1', 'user-1', dto);
      expect(result).toEqual(expected);
    });
  });

  // The class asks for chapter-config:view; each write adds :manage. Without
  // its own decorator a write would fall back to the class's view-only gate.
  // No any-of list and no wildcard: `PermissionsGuard` lets `*` through before
  // it reads any requirement, so naming it would be a second, dead path.
  describe.each(['create', 'update', 'remove'] as const)(
    'the %s route',
    (handler) => {
      it('requires chapter-config:manage and declares no any-of list', () => {
        expect(
          Reflect.getMetadata(PERMISSIONS_KEY, controller[handler]),
        ).toEqual([SystemPermissions.CHAPTER_CONFIG_MANAGE]);
        expect(
          Reflect.getMetadata(PERMISSIONS_ANY_KEY, controller[handler]),
        ).toBeUndefined();
      });
    },
  );

  describe('update', () => {
    it('updates a custom role', async () => {
      const dto: UpdateCustomRoleDto = { label: 'Renamed' };
      const expected = { id: 'r1', label: 'Renamed' } as any;
      service.update.mockResolvedValue(expected);

      const result = await controller.update('r1', 'chapter-1', 'user-1', dto);

      expect(service.update).toHaveBeenCalledWith(
        'r1',
        'chapter-1',
        'user-1',
        dto,
      );
      expect(result).toEqual(expected);
    });
  });

  describe('remove', () => {
    it('deletes a custom role', async () => {
      service.remove.mockResolvedValue({ success: true });

      const result = await controller.remove('r1', 'chapter-1', 'user-1');

      expect(service.remove).toHaveBeenCalledWith('r1', 'chapter-1', 'user-1');
      expect(result).toEqual({ success: true });
    });
  });
});
