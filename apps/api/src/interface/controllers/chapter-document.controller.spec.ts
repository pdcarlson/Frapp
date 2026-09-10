import { InternalServerErrorException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ChapterDocumentController } from './chapter-document.controller';
import { ChapterDocumentService } from '../../application/services/chapter-document.service';
import { RequestDocumentUploadUrlDto } from '../dtos/chapter-document.dto';

describe('ChapterDocumentController', () => {
  let controller: ChapterDocumentController;
  let service: ChapterDocumentService;

  const mockChapterDocumentService = {
    requestUploadUrl: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChapterDocumentController],
      providers: [
        {
          provide: ChapterDocumentService,
          useValue: mockChapterDocumentService,
        },
        {
          provide: 'SUPABASE_CLIENT',
          useValue: {},
        },
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
});
