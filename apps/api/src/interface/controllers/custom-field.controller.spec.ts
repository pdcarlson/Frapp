import { Test, TestingModule } from '@nestjs/testing';
import { CustomFieldController } from './custom-field.controller';
import { CustomFieldService } from '../../application/services/custom-field.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { SystemPermissions } from '../../domain/constants/permissions';
import { PERMISSIONS_ANY_KEY } from '../decorators/permissions.decorator';
import {
  CreateCustomFieldDto,
  UpdateCustomFieldDto,
} from '../dtos/custom-field.dto';

describe('CustomFieldController', () => {
  let controller: CustomFieldController;
  let service: jest.Mocked<CustomFieldService>;

  beforeEach(async () => {
    service = {
      findByChapter: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CustomFieldController],
      providers: [{ provide: CustomFieldService, useValue: service }],
    })
      .overrideGuard(SupabaseAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ChapterGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<CustomFieldController>(CustomFieldController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('list', () => {
    it('lists chapter custom fields', async () => {
      const expected = [{ id: 'f1' }] as any;
      service.findByChapter.mockResolvedValue(expected);

      const result = await controller.list('chapter-1');

      expect(service.findByChapter).toHaveBeenCalledWith('chapter-1');
      expect(result).toEqual(expected);
    });
  });

  describe('create', () => {
    it('creates a custom field scoped to the chapter + actor', async () => {
      const dto: CreateCustomFieldDto = {
        key: 'major',
        label: 'Major',
        type: 'text',
      };
      const expected = { id: 'f1', ...dto } as any;
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
    it('updates a custom field', async () => {
      const dto: UpdateCustomFieldDto = { label: 'Renamed' };
      const expected = { id: 'f1', label: 'Renamed' } as any;
      service.update.mockResolvedValue(expected);

      const result = await controller.update('f1', 'chapter-1', 'user-1', dto);

      expect(service.update).toHaveBeenCalledWith(
        'f1',
        'chapter-1',
        'user-1',
        dto,
      );
      expect(result).toEqual(expected);
    });
  });

  describe('remove', () => {
    it('deletes a custom field', async () => {
      service.remove.mockResolvedValue({ success: true });

      const result = await controller.remove('f1', 'chapter-1', 'user-1');

      expect(service.remove).toHaveBeenCalledWith('f1', 'chapter-1', 'user-1');
      expect(result).toEqual({ success: true });
    });
  });
});
