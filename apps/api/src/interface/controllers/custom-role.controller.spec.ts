import { Test, TestingModule } from '@nestjs/testing';
import { CustomRoleController } from './custom-role.controller';
import { CustomRoleService } from '../../application/services/custom-role.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { SystemPermissions } from '../../domain/constants/permissions';
import { PERMISSIONS_ANY_KEY } from '../decorators/permissions.decorator';
import {
  CreateCustomRoleDto,
  UpdateCustomRoleDto,
} from '../dtos/custom-role.dto';

describe('CustomRoleController', () => {
  let controller: CustomRoleController;
  let service: jest.Mocked<CustomRoleService>;

  beforeEach(async () => {
    service = {
      findByChapter: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CustomRoleController],
      providers: [{ provide: CustomRoleService, useValue: service }],
    })
      .overrideGuard(SupabaseAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ChapterGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

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

    it('requires chapter-config:manage (or wildcard) to write', () => {
      const anyOf = Reflect.getMetadata(PERMISSIONS_ANY_KEY, controller.create);
      expect(anyOf).toEqual([
        SystemPermissions.CHAPTER_CONFIG_MANAGE,
        SystemPermissions.WILDCARD,
      ]);
    });
  });

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
