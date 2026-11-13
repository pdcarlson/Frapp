import { InternalServerErrorException } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import { createUnguardedTestingModule } from '#test/helpers/guard-stubs.factory';
import { ChapterDocumentController } from './chapter-document.controller';
import { ChapterDocumentService } from '../../application/services/chapter-document.service';
import { ChapterDocumentTypeService } from '../../application/services/chapter-document-type.service';
import { RequestDocumentUploadUrlDto } from '../dtos/chapter-document.dto';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { SystemPermissions } from '#domain/constants/permissions';

describe('ChapterDocumentController', () => {
  let controller: ChapterDocumentController;
  let service: ChapterDocumentService;

  const mockChapterDocumentService = {
    requestUploadUrl: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await createUnguardedTestingModule({
      controllers: [ChapterDocumentController],
      providers: [
        {
          provide: ChapterDocumentService,
          useValue: mockChapterDocumentService,
        },
        { provide: ChapterDocumentTypeService, useValue: {} },
      ],
    }).compile();

    controller = module.get(ChapterDocumentController);
    service = module.get(ChapterDocumentService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('requestUploadUrl', () => {
    const chapterId = 'chapter-123';
    const dto: RequestDocumentUploadUrlDto = {
      filename: 'bylaws.pdf',
      content_type: 'application/pdf',
    };

    it('maps the camelCase service ticket onto the snake_case wire contract', async () => {
      mockChapterDocumentService.requestUploadUrl.mockResolvedValue({
        signedUrl: 'https://storage.example/put',
        storagePath: 'chapters/chapter-123/documents/doc-1/bylaws.pdf',
        documentId: 'doc-1',
      });

      const result = await controller.requestUploadUrl(chapterId, dto);

      expect(service.requestUploadUrl).toHaveBeenCalledWith({
        chapterId,
        filename: dto.filename,
        contentType: dto.content_type,
      });
      expect(result).toEqual({
        upload_url: 'https://storage.example/put',
        storage_path: 'chapters/chapter-123/documents/doc-1/bylaws.pdf',
        document_id: 'doc-1',
      });
    });

    it('fails closed when the service omits the signed URL', async () => {
      mockChapterDocumentService.requestUploadUrl.mockResolvedValue({
        signedUrl: '',
        storagePath: 'chapters/chapter-123/documents/doc-1/bylaws.pdf',
        documentId: 'doc-1',
      });

      await expect(
        controller.requestUploadUrl(chapterId, dto),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });

  describe('pins and stars (#3934)', () => {
    // `PermissionsGuard` enforces whatever the metadata says; what can
    // silently regress is the metadata. Without `chapter_docs:manage` here,
    // any member holding the class floor (`members:view`) could pin for the
    // whole chapter.
    it.each([
      'pinFolder',
      'unpinFolder',
      'pinDocument',
      'unpinDocument',
    ] as const)(
      '%s requires chapter_docs:manage on top of the class floor',
      (handler) => {
        expect(
          Reflect.getMetadata(PERMISSIONS_KEY, controller[handler] as object),
        ).toEqual([SystemPermissions.CHAPTER_DOCS_MANAGE]);
      },
    );

    // A star is the member's own, so it needs only the class floor: a
    // method-level permission here would lock ordinary members out.
    it.each([
      'listStars',
      'starFolder',
      'unstarFolder',
      'starDocument',
      'unstarDocument',
    ] as const)('%s adds no permission beyond the class floor', (handler) => {
      expect(
        Reflect.getMetadata(PERMISSIONS_KEY, controller[handler] as object),
      ).toBeUndefined();
      expect(
        Reflect.getMetadata(PERMISSIONS_KEY, ChapterDocumentController),
      ).toEqual([SystemPermissions.MEMBERS_VIEW]);
    });
  });

  describe('document types (#3642)', () => {
    // Every member reads the list (the upload form and filters show it);
    // only document managers change it.
    it('listTypes adds no permission beyond the class floor', () => {
      expect(
        Reflect.getMetadata(PERMISSIONS_KEY, controller.listTypes as object),
      ).toBeUndefined();
    });

    it.each(['createType', 'updateType', 'deleteType'] as const)(
      '%s requires chapter_docs:manage',
      (handler) => {
        expect(
          Reflect.getMetadata(PERMISSIONS_KEY, controller[handler] as object),
        ).toEqual([SystemPermissions.CHAPTER_DOCS_MANAGE]);
      },
    );
  });
});
