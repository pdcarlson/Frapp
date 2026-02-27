import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ChapterDocumentService } from './chapter-document.service';
import { CHAPTER_DOCUMENT_REPOSITORY } from '../../domain/repositories/chapter-document.repository.interface';
import type { IChapterDocumentRepository } from '../../domain/repositories/chapter-document.repository.interface';
import { STORAGE_PROVIDER } from '../../domain/adapters/storage.interface';
import type { IStorageProvider } from '../../domain/adapters/storage.interface';
import type { ChapterDocument } from '../../domain/entities/chapter-document.entity';

describe('ChapterDocumentService', () => {
  let service: ChapterDocumentService;
  let mockDocumentRepo: jest.Mocked<IChapterDocumentRepository>;
  let mockStorageProvider: jest.Mocked<IStorageProvider>;

  const baseDocument: ChapterDocument = {
    id: 'doc-1',
    chapter_id: 'ch-1',
    title: 'Bylaws 2025',
    description: 'Chapter bylaws',
    folder: 'Governance',
    storage_path: 'chapters/ch-1/documents/doc-1/bylaws.pdf',
    uploaded_by: 'user-1',
    created_at: '2026-01-01T00:00:00.000Z',
  };

  beforeEach(async () => {
    mockDocumentRepo = {
      findById: jest.fn(),
      findByChapter: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      moveToRoot: jest.fn(),
    };

    mockStorageProvider = {
      getSignedUploadUrl: jest.fn(),
      getSignedDownloadUrl: jest.fn(),
      deleteFile: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChapterDocumentService,
        {
          provide: CHAPTER_DOCUMENT_REPOSITORY,
          useValue: mockDocumentRepo,
        },
        { provide: STORAGE_PROVIDER, useValue: mockStorageProvider },
      ],
    }).compile();

    service = module.get(ChapterDocumentService);
  });

  describe('requestUploadUrl', () => {
    it('should return signed URL and storage path', async () => {
      mockStorageProvider.getSignedUploadUrl.mockResolvedValue(
        'https://storage.supabase.co/upload/signed',
      );

      const result = await service.requestUploadUrl({
        chapterId: 'ch-1',
        filename: 'bylaws.pdf',
        contentType: 'application/pdf',
      });

      expect(result.signedUrl).toBe(
        'https://storage.supabase.co/upload/signed',
      );
      expect(result.storagePath).toContain(
        'chapters/ch-1/documents/',
      );
      expect(result.storagePath).toContain('bylaws.pdf');
      expect(result.documentId).toBeDefined();
    });
  });

  describe('confirmUpload', () => {
    it('should create document with full metadata', async () => {
      mockDocumentRepo.create.mockResolvedValue(baseDocument);

      const result = await service.confirmUpload({
        chapter_id: 'ch-1',
        title: 'Bylaws 2025',
        description: 'Chapter bylaws',
        folder: 'Governance',
        storage_path: 'chapters/ch-1/documents/doc-1/bylaws.pdf',
        uploaded_by: 'user-1',
      });

      expect(result).toEqual(baseDocument);
      expect(mockDocumentRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          chapter_id: 'ch-1',
          title: 'Bylaws 2025',
          folder: 'Governance',
        }),
      );
    });

    it('should create document with minimal metadata (no folder)', async () => {
      mockDocumentRepo.create.mockResolvedValue({
        ...baseDocument,
        folder: null,
        description: null,
      });

      await service.confirmUpload({
        chapter_id: 'ch-1',
        title: 'Agenda',
        storage_path: 'chapters/ch-1/documents/doc-2/agenda.pdf',
        uploaded_by: 'user-1',
      });

      expect(mockDocumentRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          folder: null,
          description: null,
        }),
      );
    });
  });

  describe('findByChapter', () => {
    it('should return documents with folder filter', async () => {
      mockDocumentRepo.findByChapter.mockResolvedValue([baseDocument]);

      const result = await service.findByChapter('ch-1', {
        folder: 'Governance',
      });

      expect(mockDocumentRepo.findByChapter).toHaveBeenCalledWith('ch-1', {
        folder: 'Governance',
      });
      expect(result).toHaveLength(1);
    });

    it('should return all documents without filter', async () => {
      mockDocumentRepo.findByChapter.mockResolvedValue([baseDocument]);

      const result = await service.findByChapter('ch-1');

      expect(mockDocumentRepo.findByChapter).toHaveBeenCalledWith(
        'ch-1',
        undefined,
      );
      expect(result).toHaveLength(1);
    });
  });

  describe('findById', () => {
    it('should return document with download URL', async () => {
      mockDocumentRepo.findById.mockResolvedValue(baseDocument);
      mockStorageProvider.getSignedDownloadUrl.mockResolvedValue(
        'https://storage.supabase.co/download/signed',
      );

      const result = await service.findById('doc-1', 'ch-1');

      expect(result.downloadUrl).toBe(
        'https://storage.supabase.co/download/signed',
      );
      expect(result.id).toBe('doc-1');
    });

    it('should throw NotFoundException when document not found', async () => {
      mockDocumentRepo.findById.mockResolvedValue(null);

      await expect(service.findById('doc-x', 'ch-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('delete', () => {
    it('should delete document and storage file', async () => {
      mockDocumentRepo.findById.mockResolvedValue(baseDocument);
      mockStorageProvider.deleteFile.mockResolvedValue();
      mockDocumentRepo.delete.mockResolvedValue();

      await service.delete('doc-1', 'ch-1');

      expect(mockStorageProvider.deleteFile).toHaveBeenCalledWith(
        'documents',
        baseDocument.storage_path,
      );
      expect(mockDocumentRepo.delete).toHaveBeenCalledWith('doc-1', 'ch-1');
    });

    it('should throw NotFoundException when document not found', async () => {
      mockDocumentRepo.findById.mockResolvedValue(null);

      await expect(service.delete('doc-x', 'ch-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deleteFolder', () => {
    it('should move documents to root level', async () => {
      mockDocumentRepo.moveToRoot.mockResolvedValue();

      await service.deleteFolder('Governance', 'ch-1');

      expect(mockDocumentRepo.moveToRoot).toHaveBeenCalledWith(
        'Governance',
        'ch-1',
      );
    });
  });
});
