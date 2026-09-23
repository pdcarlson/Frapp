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

import { TestingModule } from '@nestjs/testing';
import { createUnguardedTestingModule } from '#test/helpers/guard-stubs.factory';
import { InternalServerErrorException } from '@nestjs/common';
import { ChapterController } from './chapter.controller';
import { ChapterService } from '../../application/services/chapter.service';
import { ChapterOnboardingService } from '../../application/services/chapter-onboarding.service';
import { AuthSyncInterceptor } from '../interceptors/auth-sync.interceptor';
import {
  PERMISSIONS_ANY_KEY,
  PERMISSIONS_KEY,
} from '../decorators/permissions.decorator';
import { CHAPTER_PROFILE_PERMISSIONS } from '@repo/validation';
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

    const module: TestingModule = await createUnguardedTestingModule({
      controllers: [ChapterController],
      providers: [
        { provide: ChapterService, useValue: chapterService },
        {
          provide: ChapterOnboardingService,
          useValue: chapterOnboardingService,
        },
      ],
    })
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

  describe('profile and logo write permissions (#2575)', () => {
    // `CHAPTER_PROFILE_PERMISSIONS` (`@repo/validation`) is the one spelling of
    // who may edit the chapter's profile, accent and logo; the Settings page
    // gates its saves on the same constant. These routes used to admit
    // `roles:manage` or `billing:manage` while the page gated on
    // `chapter-config:manage`, so each side allowed a save the other refused.
    it.each([
      'update',
      'requestLogoUploadUrl',
      'confirmLogoUpload',
      'deleteLogo',
    ] as const)(
      '%s requires exactly CHAPTER_PROFILE_PERMISSIONS',
      (handler) => {
        const route = ChapterController.prototype[handler];
        // `PermissionsGuard` ANDs this list, so equality is the whole rule.
        expect(Reflect.getMetadata(PERMISSIONS_KEY, route)).toEqual([
          ...CHAPTER_PROFILE_PERMISSIONS,
        ]);
        expect(Reflect.getMetadata(PERMISSIONS_ANY_KEY, route)).toBeUndefined();
        // No class-level gate adds to or loosens it.
        expect(
          Reflect.getMetadata(PERMISSIONS_KEY, ChapterController),
        ).toBeUndefined();
        expect(
          Reflect.getMetadata(PERMISSIONS_ANY_KEY, ChapterController),
        ).toBeUndefined();
      },
    );

    it('is chapter-config:view and chapter-config:manage', () => {
      expect([...CHAPTER_PROFILE_PERMISSIONS].sort()).toEqual([
        'chapter-config:manage',
        'chapter-config:view',
      ]);
    });
  });

  describe('update', () => {
    it('should call chapterService.update with correct parameters', async () => {
      const chapterId = 'chapter-1';
      const dto: UpdateChapterDto = { name: 'Updated Chapter' };
      const expectedChapter = { id: chapterId, ...dto } as any;

      chapterService.update.mockResolvedValue({
        chapter: expectedChapter,
        failedContrastChecks: [],
      });

      const result = await controller.update(chapterId, 'user-1', dto);

      // The actor is forwarded so the save can be attributed in
      // `chapter_audit_log` (#486) — an audit row with a null actor would read
      // as a system write rather than an officer's edit.
      expect(chapterService.update).toHaveBeenCalledWith(
        chapterId,
        dto,
        'user-1',
      );
      expect(result).toEqual({ ...expectedChapter, failedContrastChecks: [] });
    });

    it('projects the write response onto the member-safe view (#930)', async () => {
      // `CHAPTER_PROFILE_PERMISSIONS` does not imply `billing:view`, so a role
      // carrying only those would otherwise read the billing identifiers out
      // of the *write* response — the same leak as `getCurrent`, one verb over.
      const chapterId = 'chapter-1';
      const dto: UpdateChapterDto = { name: 'Updated Chapter' };
      chapterService.update.mockResolvedValue({
        chapter: {
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
        } as any,
        failedContrastChecks: [],
      });

      const result = await controller.update(chapterId, 'user-1', dto);

      expect(result).not.toHaveProperty('stripe_customer_id');
      expect(result).not.toHaveProperty('subscription_id');
      expect(result).not.toHaveProperty('last_stripe_webhook_at');
      expect(result).not.toHaveProperty('legal_accepted_by');
      expect(JSON.stringify(result)).not.toContain('SENSITIVE');
      // The entitlement mirror still round-trips on a write.
      expect(result.subscription_status).toBe('active');
    });

    it('surfaces failedContrastChecks from the service alongside the projected chapter (#1183)', async () => {
      const chapterId = 'chapter-1';
      const dto: UpdateChapterDto = { accent_color: '#8B0000' };
      const failedContrastChecks = [
        { role: '--signet-accent-text', against: '#0E0D0B', ratio: 3.21 },
      ];
      chapterService.update.mockResolvedValue({
        chapter: { id: chapterId, name: 'Updated Chapter' } as any,
        failedContrastChecks,
      });

      const result = await controller.update(chapterId, 'user-1', dto);

      expect(result.failedContrastChecks).toEqual(failedContrastChecks);
    });

    it('returns an empty failedContrastChecks array in the normal case', async () => {
      const chapterId = 'chapter-1';
      const dto: UpdateChapterDto = { accent_color: '#7FD1AE' };
      chapterService.update.mockResolvedValue({
        chapter: { id: chapterId, name: 'Updated Chapter' } as any,
        failedContrastChecks: [],
      });

      const result = await controller.update(chapterId, 'user-1', dto);

      expect(result.failedContrastChecks).toEqual([]);
    });
  });

  describe('requestLogoUploadUrl', () => {
    const chapterId = 'chapter-1';
    const dto: LogoUploadUrlDto = {
      filename: 'logo.png',
      content_type: 'image/png',
    };

    // The previous version of this block mocked `{ upload_url, storage_path }`
    // — a shape the service never returned — and asserted the controller
    // echoed it back. It would have passed no matter what the wire names
    // were. These assert the real service ticket mapping onto the documented
    // DTO, so dropping a field fails the suite.
    it('maps the camelCase service ticket onto the snake_case wire contract', async () => {
      chapterService.requestLogoUploadUrl.mockResolvedValue({
        signedUrl: 'https://storage.example/put',
        storagePath: 'chapters/chapter-1/branding/logo.png',
      });

      const result = await controller.requestLogoUploadUrl(chapterId, dto);

      expect(chapterService.requestLogoUploadUrl).toHaveBeenCalledWith(
        chapterId,
        dto.filename,
        dto.content_type,
      );
      expect(result).toEqual({
        upload_url: 'https://storage.example/put',
        storage_path: 'chapters/chapter-1/branding/logo.png',
      });
    });

    it('fails closed when the service omits the signed URL', async () => {
      chapterService.requestLogoUploadUrl.mockResolvedValue({
        signedUrl: '',
        storagePath: 'chapters/chapter-1/branding/logo.png',
      });

      await expect(
        controller.requestLogoUploadUrl(chapterId, dto),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });

    it('fails closed when the service omits the storage path', async () => {
      chapterService.requestLogoUploadUrl.mockResolvedValue({
        signedUrl: 'https://storage.example/put',
        storagePath: '',
      });

      await expect(
        controller.requestLogoUploadUrl(chapterId, dto),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });

  /**
   * The raw `chapters` row the logo writes return, billing identifiers
   * included. The logo routes share `update`'s permissions, which do not imply
   * `billing:view`, so their responses are projected the same way (#930).
   */
  const rawChapterRow = (logoPath: string | null) =>
    ({
      id: 'chapter-1',
      name: 'Alpha',
      university: 'State U',
      subscription_status: 'active',
      past_due_since: null,
      stripe_customer_id: 'cus_SENSITIVE',
      subscription_id: 'sub_SENSITIVE',
      last_stripe_webhook_at: '2026-08-02T00:00:00.000Z',
      legal_accepted_by: 'user-legal-signer',
      accent_color: null,
      logo_path: logoPath,
      donation_url: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    }) as any;

  const expectMemberSafe = (result: object) => {
    expect(result).not.toHaveProperty('stripe_customer_id');
    expect(result).not.toHaveProperty('subscription_id');
    expect(result).not.toHaveProperty('last_stripe_webhook_at');
    expect(result).not.toHaveProperty('legal_accepted_by');
  };

  describe('confirmLogoUpload', () => {
    it('passes the chapter, path and actor to the service', async () => {
      const dto: ConfirmLogoDto = {
        storage_path: 'chapters/chapter-1/branding/logo.png',
      };
      chapterService.confirmLogoUpload.mockResolvedValue(
        rawChapterRow(dto.storage_path),
      );

      await controller.confirmLogoUpload('chapter-1', 'user-1', dto);

      expect(chapterService.confirmLogoUpload).toHaveBeenCalledWith(
        'chapter-1',
        dto.storage_path,
        'user-1',
      );
    });

    it('projects the response onto the member-safe view (#930)', async () => {
      const dto: ConfirmLogoDto = {
        storage_path: 'chapters/chapter-1/branding/logo.png',
      };
      chapterService.confirmLogoUpload.mockResolvedValue(
        rawChapterRow(dto.storage_path),
      );

      const result = await controller.confirmLogoUpload(
        'chapter-1',
        'user-1',
        dto,
      );

      expectMemberSafe(result);
      expect(result).toMatchObject({
        id: 'chapter-1',
        logo_path: dto.storage_path,
      });
    });
  });

  describe('deleteLogo', () => {
    it('passes the chapter and actor to the service', async () => {
      chapterService.deleteLogo.mockResolvedValue(rawChapterRow(null));

      await controller.deleteLogo('chapter-1', 'user-1');

      expect(chapterService.deleteLogo).toHaveBeenCalledWith(
        'chapter-1',
        'user-1',
      );
    });

    it('projects the response onto the member-safe view (#930)', async () => {
      chapterService.deleteLogo.mockResolvedValue(rawChapterRow(null));

      const result = await controller.deleteLogo('chapter-1', 'user-1');

      expectMemberSafe(result);
      expect(result).toMatchObject({ id: 'chapter-1', logo_path: null });
    });
  });
});
