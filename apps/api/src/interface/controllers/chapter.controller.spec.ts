import { Test, TestingModule } from '@nestjs/testing';
import { ChapterController } from './chapter.controller';
import { ChapterService } from '../../application/services/chapter.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { AuthSyncGuard } from '../guards/auth-sync.guard';
import {
  CreateChapterDto,
  UpdateChapterDto,
  LogoUploadUrlDto,
  ConfirmLogoDto,
} from '../dtos/chapter.dto';

describe('ChapterController', () => {
  let controller: ChapterController;
  let chapterService: jest.Mocked<ChapterService>;

  beforeEach(async () => {
    chapterService = {
      create: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      requestLogoUploadUrl: jest.fn(),
      confirmLogoUpload: jest.fn(),
      deleteLogo: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChapterController],
      providers: [{ provide: ChapterService, useValue: chapterService }],
    })
      .overrideGuard(SupabaseAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ChapterGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AuthSyncGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ChapterController>(ChapterController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should call chapterService.create with correct parameters', async () => {
      const userId = 'user-1';
      const dto: CreateChapterDto = { name: 'Test Chapter' };
      const expectedResult = { id: 'chapter-1', ...dto } as any;

      chapterService.create.mockResolvedValue(expectedResult);

      const result = await controller.create(userId, dto);

      expect(chapterService.create).toHaveBeenCalledWith(userId, dto);
      expect(result).toEqual(expectedResult);
    });
  });

  describe('getCurrent', () => {
    it('should call chapterService.findById with correct parameters', async () => {
      const chapterId = 'chapter-1';
      const expectedResult = { id: chapterId, name: 'Test Chapter' } as any;

      chapterService.findById.mockResolvedValue(expectedResult);

      const result = await controller.getCurrent(chapterId);

      expect(chapterService.findById).toHaveBeenCalledWith(chapterId);
      expect(result).toEqual(expectedResult);
    });
  });

  describe('update', () => {
    it('should call chapterService.update with correct parameters', async () => {
      const chapterId = 'chapter-1';
      const dto: UpdateChapterDto = { name: 'Updated Chapter' };
      const expectedResult = { id: chapterId, ...dto } as any;

      chapterService.update.mockResolvedValue(expectedResult);

      const result = await controller.update(chapterId, dto);

      expect(chapterService.update).toHaveBeenCalledWith(chapterId, dto);
      expect(result).toEqual(expectedResult);
    });
  });

  describe('requestLogoUploadUrl', () => {
    it('should call chapterService.requestLogoUploadUrl with correct parameters', async () => {
      const chapterId = 'chapter-1';
      const dto: LogoUploadUrlDto = {
        filename: 'logo.png',
        content_type: 'image/png',
      };
      const expectedResult = {
        upload_url: 'http://example.com/upload',
        storage_path: 'branding/logo.png',
      } as any;

      chapterService.requestLogoUploadUrl.mockResolvedValue(expectedResult);

      const result = await controller.requestLogoUploadUrl(chapterId, dto);

      expect(chapterService.requestLogoUploadUrl).toHaveBeenCalledWith(
        chapterId,
        dto.filename,
        dto.content_type,
      );
      expect(result).toEqual(expectedResult);
    });
  });

  describe('confirmLogoUpload', () => {
    it('should call chapterService.confirmLogoUpload with correct parameters', async () => {
      const chapterId = 'chapter-1';
      const dto: ConfirmLogoDto = { storage_path: 'branding/logo.png' };
      const expectedResult = {
        id: chapterId,
        branding: { logo_url: 'http://example.com/logo.png' },
      } as any;

      chapterService.confirmLogoUpload.mockResolvedValue(expectedResult);

      const result = await controller.confirmLogoUpload(chapterId, dto);

      expect(chapterService.confirmLogoUpload).toHaveBeenCalledWith(
        chapterId,
        dto.storage_path,
      );
      expect(result).toEqual(expectedResult);
    });
  });

  describe('deleteLogo', () => {
    it('should call chapterService.deleteLogo with correct parameters', async () => {
      const chapterId = 'chapter-1';
      const expectedResult = { id: chapterId, branding: {} } as any;

      chapterService.deleteLogo.mockResolvedValue(expectedResult);

      const result = await controller.deleteLogo(chapterId);

      expect(chapterService.deleteLogo).toHaveBeenCalledWith(chapterId);
      expect(result).toEqual(expectedResult);
    });
  });
});
