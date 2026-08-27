// The chapter controller imports ChapterOnboardingService, which imports the
// ESM-only @repo packages. Mock them so the module graph loads under jest.
jest.mock('@repo/org-archetypes', () => ({
  buildChapterConfigFromArchetype: jest.fn(() => ({
    archetype: 'ifc',
    modules: {},
    rolePack: 'ifc_standard',
    vocabulary: {},
    customFields: [],
    workflows: [],
    dues: {},
  })),
  getArchetype: jest.fn((key: string) => ({ key })),
}));
jest.mock('@repo/chapter-theme', () => ({
  // Mirrors the real DeriveSignetPaletteResult shape. `buildChapterPalette`
  // reads `invalidSeed` and iterates `contrastChecks`, so a partial double
  // would throw if any test here ever reached the palette path.
  deriveSignetPalette: jest.fn(() => ({
    palette: {},
    resolvedSeed: '#F2B72E',
    invalidSeed: false,
    contrastChecks: [],
  })),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { ChapterController } from './chapter.controller';
import { ChapterService } from '../../application/services/chapter.service';
import { ChapterOnboardingService } from '../../application/services/chapter-onboarding.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { AuthSyncInterceptor } from '../interceptors/auth-sync.interceptor';
import {
  CreateChapterDto,
  UpdateChapterDto,
  LogoUploadUrlDto,
  ConfirmLogoDto,
} from '../dtos/chapter.dto';

describe('ChapterController', () => {
  let controller: ChapterController;
  let chapterService: jest.Mocked<ChapterService>;
  let chapterOnboardingService: { onboard: jest.Mock };

  beforeEach(async () => {
    chapterService = {
      create: jest.fn(),
      listForUser: jest.fn(),
      findById: jest.fn(),
      findByIdWithLogoUrl: jest.fn(),
      update: jest.fn(),
      requestLogoUploadUrl: jest.fn(),
      confirmLogoUpload: jest.fn(),
      deleteLogo: jest.fn(),
    } as any;
    chapterOnboardingService = { onboard: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChapterController],
      providers: [
        { provide: ChapterService, useValue: chapterService },
        {
          provide: ChapterOnboardingService,
          useValue: chapterOnboardingService,
        },
      ],
    })
      .overrideGuard(SupabaseAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ChapterGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .overrideInterceptor(AuthSyncInterceptor)
      .useValue({ intercept: (context: any, next: any) => next.handle() })
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

  describe('onboard', () => {
    it('should call chapterOnboardingService.onboard with the session user and dto', async () => {
      const userId = 'user-1';
      const dto = {
        name: 'Sigma Phi Epsilon',
        university: 'UCLA',
        org_archetype: 'ifc',
      } as any;
      const expectedResult = { id: 'chapter-1' } as any;
      chapterOnboardingService.onboard.mockResolvedValue(expectedResult);

      const result = await controller.onboard(userId, dto);

      expect(chapterOnboardingService.onboard).toHaveBeenCalledWith(
        userId,
        dto,
      );
      expect(result).toEqual(expectedResult);
    });
  });

  describe('getCurrent', () => {
    it('should return the chapter with its signed logo_url', async () => {
      const chapterId = 'chapter-1';
      const expectedResult = {
        id: chapterId,
        name: 'Test Chapter',
        logo_url: 'https://signed-download.url',
      } as any;

      chapterService.findByIdWithLogoUrl.mockResolvedValue(expectedResult);

      const result = await controller.getCurrent(chapterId);

      // The plain findById is deliberately not used here: the branding bucket
      // is private, so a payload without a signed URL renders no logo.
      expect(chapterService.findByIdWithLogoUrl).toHaveBeenCalledWith(
        chapterId,
      );
      expect(chapterService.findById).not.toHaveBeenCalled();
      expect(result).toEqual(expectedResult);
    });
  });

  describe('listForCurrentUser', () => {
    it('should call chapterService.listForUser with correct parameters', async () => {
      const userId = 'user-1';
      const expectedResult = [
        {
          chapter: { id: 'chapter-1', name: 'Test Chapter' },
          membership: { id: 'member-1' },
        },
      ] as any;

      chapterService.listForUser.mockResolvedValue(expectedResult);

      const result = await controller.listForCurrentUser(userId);

      expect(chapterService.listForUser).toHaveBeenCalledWith(userId);
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

    it('projects the write response onto the member-safe view (#930)', async () => {
      // This route admits `roles:manage` OR `billing:manage`, so a custom role
      // carrying `roles:manage` without `billing:view` would otherwise read the
      // billing identifiers out of the *write* response — the same leak as
      // `getCurrent`, one verb over. The client discards this body and
      // refetches, so nothing depends on it being the full row.
      const chapterId = 'chapter-1';
      const dto: UpdateChapterDto = { name: 'Updated Chapter' };
      chapterService.update.mockResolvedValue({
        id: chapterId,
        name: 'Updated Chapter',
        university: 'State U',
        subscription_status: 'active',
        past_due_since: null,
        stripe_customer_id: 'cus_SENSITIVE',
        subscription_id: 'sub_SENSITIVE',
        last_stripe_webhook_at: '2026-08-02T00:00:00.000Z',
        legal_accepted_by: 'user-legal-signer',
        accent_color: null,
        logo_path: null,
        donation_url: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      });

      const result = await controller.update(chapterId, dto);

      expect(result).not.toHaveProperty('stripe_customer_id');
      expect(result).not.toHaveProperty('subscription_id');
      expect(result).not.toHaveProperty('last_stripe_webhook_at');
      expect(result).not.toHaveProperty('legal_accepted_by');
      expect(JSON.stringify(result)).not.toContain('SENSITIVE');
      // The entitlement mirror still round-trips on a write.
      expect(result.subscription_status).toBe('active');
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
