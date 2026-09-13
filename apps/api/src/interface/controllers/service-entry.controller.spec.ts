import { Test, TestingModule } from '@nestjs/testing';
import { InternalServerErrorException } from '@nestjs/common';
import { ServiceEntryController } from './service-entry.controller';
import { ServiceEntryService } from '../../application/services/service-entry.service';
import { RbacService } from '../../application/services/rbac.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequestProofUploadUrlDto } from '../dtos/service-entry.dto';

describe('ServiceEntryController', () => {
  let controller: ServiceEntryController;
  let service: jest.Mocked<Pick<ServiceEntryService, 'requestProofUploadUrl'>>;

  beforeEach(async () => {
    service = { requestProofUploadUrl: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ServiceEntryController],
      providers: [
        { provide: ServiceEntryService, useValue: service },
        {
          provide: RbacService,
          useValue: { memberHasAnyPermission: jest.fn() },
        },
      ],
    })
      .overrideGuard(SupabaseAuthGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideGuard(ChapterGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    controller = module.get<ServiceEntryController>(ServiceEntryController);
  });

  // #2130 — this 201 used to pass the camelCase service ticket straight
  // through with no response DTO, so OpenAPI documented it as empty and
  // service-page.tsx hand-narrowed `signedUrl` / `storagePath` off an untyped
  // body. These pin the mapping so a dropped field fails the suite.
  describe('requestProofUploadUrl', () => {
    const chapterId = 'chapter-123';
    const dto: RequestProofUploadUrlDto = {
      filename: 'receipt.pdf',
      content_type: 'application/pdf',
    };

    it('maps the camelCase service ticket onto the snake_case wire contract', async () => {
      service.requestProofUploadUrl.mockResolvedValue({
        signedUrl: 'https://storage.example/put',
        storagePath: 'chapters/chapter-123/service/proof-1/receipt.pdf',
        proofId: 'proof-1',
      });

      const result = await controller.requestProofUploadUrl(chapterId, dto);

      expect(service.requestProofUploadUrl).toHaveBeenCalledWith({
        chapterId,
        filename: dto.filename,
        contentType: dto.content_type,
        sizeBytes: undefined,
      });
      expect(result).toEqual({
        upload_url: 'https://storage.example/put',
        storage_path: 'chapters/chapter-123/service/proof-1/receipt.pdf',
        proof_id: 'proof-1',
      });
    });

    it('fails closed when the service omits the signed URL', async () => {
      service.requestProofUploadUrl.mockResolvedValue({
        signedUrl: '',
        storagePath: 'chapters/chapter-123/service/proof-1/receipt.pdf',
        proofId: 'proof-1',
      });

      await expect(
        controller.requestProofUploadUrl(chapterId, dto),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });

    it('fails closed when the service omits the storage path', async () => {
      service.requestProofUploadUrl.mockResolvedValue({
        signedUrl: 'https://storage.example/put',
        storagePath: '',
        proofId: 'proof-1',
      });

      await expect(
        controller.requestProofUploadUrl(chapterId, dto),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });
});
