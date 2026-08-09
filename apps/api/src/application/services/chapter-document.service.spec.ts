import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ChapterDocumentService } from './chapter-document.service';
import { CHAPTER_DOCUMENT_REPOSITORY } from '../../domain/repositories/chapter-document.repository.interface';
import type { IChapterDocumentRepository } from '../../domain/repositories/chapter-document.repository.interface';
import { CHAPTER_DOCUMENT_FOLDER_REPOSITORY } from '../../domain/repositories/chapter-document-folder.repository.interface';
import type { IChapterDocumentFolderRepository } from '../../domain/repositories/chapter-document-folder.repository.interface';
import { STORAGE_PROVIDER } from '../../domain/adapters/storage.interface';
import type { IStorageProvider } from '../../domain/adapters/storage.interface';
import type {
  ChapterDocument,
  ChapterDocumentFolder,
} from '../../domain/entities/chapter-document.entity';

describe('ChapterDocumentService', () => {
  let service: ChapterDocumentService;
  let mockDocumentRepo: jest.Mocked<IChapterDocumentRepository>;
  let mockFolderRepo: jest.Mocked<IChapterDocumentFolderRepository>;
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

  const baseFolder: ChapterDocumentFolder = {
    id: 'folder-1',
    chapter_id: 'ch-1',
    name: 'Governance',
    sort_order: 0,
    created_at: '2026-01-01T00:00:00.000Z',
  };

  beforeEach(async () => {
    mockDocumentRepo = {
      findById: jest.fn(),
      findByChapter: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      moveToRoot: jest.fn(),
      renameFolder: jest.fn(),
    };

    mockFolderRepo = {
      findByChapter: jest.fn().mockResolvedValue([]),
      findById: jest.fn(),
      findByName: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(baseFolder),
      update: jest.fn(),
      delete: jest.fn(),
    };

    mockStorageProvider = {
      getSignedUploadUrl: jest.fn(),
      getSignedDownloadUrl: jest.fn(),
      uploadFile: jest.fn(),
      downloadFile: jest.fn(),
      deleteFile: jest.fn(),
      listFiles: jest.fn(),
      listObjects: jest.fn().mockResolvedValue([]),
      listFolders: jest.fn().mockResolvedValue([]),
      deleteFiles: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChapterDocumentService,
        {
          provide: CHAPTER_DOCUMENT_REPOSITORY,
          useValue: mockDocumentRepo,
        },
        {
          provide: CHAPTER_DOCUMENT_FOLDER_REPOSITORY,
          useValue: mockFolderRepo,
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
      expect(result.storagePath).toContain('chapters/ch-1/documents/');
      expect(result.storagePath).toContain('bylaws.pdf');
      expect(result.documentId).toBeDefined();
    });

    it('should throw BadRequestException if file extension is blocked', async () => {
      await expect(
        service.requestUploadUrl({
          chapterId: 'ch-1',
          filename: 'script.sh',
          contentType: 'text/plain',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if content type is not allowed', async () => {
      await expect(
        service.requestUploadUrl({
          chapterId: 'ch-1',
          filename: 'video.mp4',
          contentType: 'video/mp4',
        }),
      ).rejects.toThrow(BadRequestException);
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
      expect(mockFolderRepo.create).not.toHaveBeenCalled();
    });

    it('should register a folder that does not exist yet', async () => {
      mockFolderRepo.findByName.mockResolvedValue(null);
      mockDocumentRepo.create.mockResolvedValue(baseDocument);

      await service.confirmUpload({
        chapter_id: 'ch-1',
        title: 'Bylaws 2025',
        folder: 'Governance',
        storage_path: 'chapters/ch-1/documents/doc-1/bylaws.pdf',
        uploaded_by: 'user-1',
      });

      expect(mockFolderRepo.create).toHaveBeenCalledWith({
        chapter_id: 'ch-1',
        name: 'Governance',
        sort_order: 0,
      });
    });

    it('should reuse an existing folder rather than duplicating it', async () => {
      mockFolderRepo.findByName.mockResolvedValue(baseFolder);
      mockDocumentRepo.create.mockResolvedValue(baseDocument);

      await service.confirmUpload({
        chapter_id: 'ch-1',
        title: 'Bylaws 2025',
        folder: 'Governance',
        storage_path: 'chapters/ch-1/documents/doc-1/bylaws.pdf',
        uploaded_by: 'user-1',
      });

      expect(mockFolderRepo.create).not.toHaveBeenCalled();
    });

    it('should treat a whitespace-only folder as no folder', async () => {
      mockDocumentRepo.create.mockResolvedValue({
        ...baseDocument,
        folder: null,
      });

      await service.confirmUpload({
        chapter_id: 'ch-1',
        title: 'Agenda',
        folder: '   ',
        storage_path: 'chapters/ch-1/documents/doc-2/agenda.pdf',
        uploaded_by: 'user-1',
      });

      expect(mockDocumentRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ folder: null }),
      );
      expect(mockFolderRepo.create).not.toHaveBeenCalled();
    });

    it.each([
      'chapters/ch-1/documents/../../../branding/chapters/ch-2/logo.png',
      'chapters/ch-1/documents/%2e%2e/%2e%2e/branding/chapters/ch-2/logo.png',
      'chapters/ch-1/documents/p%/%2e%2e/branding/chapters/ch-2/logo.png',
      'chapters/ch-1/documents/.\t./branding/chapters/ch-2/logo.png',
    ])(
      'rejects a prefix-passing traversal in storage_path (%p)',
      async (storagePath) => {
        // See the equivalent backwork test: the startsWith check accepts these,
        // and the stored value is later signed for download.
        await expect(
          service.confirmUpload({
            chapter_id: 'ch-1',
            title: 'Leak',
            storage_path: storagePath,
            uploaded_by: 'user-1',
          }),
        ).rejects.toThrow(BadRequestException);
        expect(mockDocumentRepo.create).not.toHaveBeenCalled();
      },
    );

    it('should reject a storage_path outside the chapter (cross-chapter)', async () => {
      await expect(
        service.confirmUpload({
          chapter_id: 'ch-1',
          title: 'Leak',
          storage_path: 'chapters/other-ch/documents/doc-1/leak.pdf',
          uploaded_by: 'user-1',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockDocumentRepo.create).not.toHaveBeenCalled();
    });

    it('should reject a storage_path from another module (wrong-module)', async () => {
      await expect(
        service.confirmUpload({
          chapter_id: 'ch-1',
          title: 'Leak',
          storage_path: 'chapters/ch-1/backwork/res-1/leak.pdf',
          uploaded_by: 'user-1',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockDocumentRepo.create).not.toHaveBeenCalled();
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

    it('should pass a title search through to the repository', async () => {
      mockDocumentRepo.findByChapter.mockResolvedValue([baseDocument]);

      await service.findByChapter('ch-1', { search: 'bylaws' });

      expect(mockDocumentRepo.findByChapter).toHaveBeenCalledWith('ch-1', {
        search: 'bylaws',
      });
    });

    it('should support folder and search together', async () => {
      mockDocumentRepo.findByChapter.mockResolvedValue([baseDocument]);

      await service.findByChapter('ch-1', {
        folder: 'Governance',
        search: 'bylaws',
      });

      expect(mockDocumentRepo.findByChapter).toHaveBeenCalledWith('ch-1', {
        folder: 'Governance',
        search: 'bylaws',
      });
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

  describe('listFolders', () => {
    it('should return the chapter folders', async () => {
      mockFolderRepo.findByChapter.mockResolvedValue([baseFolder]);

      const result = await service.listFolders('ch-1');

      expect(mockFolderRepo.findByChapter).toHaveBeenCalledWith('ch-1');
      expect(result).toEqual([baseFolder]);
    });
  });

  describe('createFolder', () => {
    it('should create a folder at the end of the list', async () => {
      mockFolderRepo.findByChapter.mockResolvedValue([
        { ...baseFolder, sort_order: 0 },
        { ...baseFolder, id: 'folder-2', name: 'Minutes', sort_order: 4 },
      ]);

      await service.createFolder('ch-1', 'Policies');

      expect(mockFolderRepo.create).toHaveBeenCalledWith({
        chapter_id: 'ch-1',
        name: 'Policies',
        sort_order: 5,
      });
    });

    it('should honor an explicit sort order', async () => {
      await service.createFolder('ch-1', 'Policies', 2);

      expect(mockFolderRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ sort_order: 2 }),
      );
    });

    it('should start at sort order 0 for the first folder', async () => {
      mockFolderRepo.findByChapter.mockResolvedValue([]);

      await service.createFolder('ch-1', 'Governance');

      expect(mockFolderRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ sort_order: 0 }),
      );
    });

    it('should trim the folder name', async () => {
      await service.createFolder('ch-1', '  Governance  ');

      expect(mockFolderRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Governance' }),
      );
    });

    it('should throw ConflictException on a duplicate name', async () => {
      mockFolderRepo.findByName.mockResolvedValue(baseFolder);

      await expect(service.createFolder('ch-1', 'Governance')).rejects.toThrow(
        ConflictException,
      );
      expect(mockFolderRepo.create).not.toHaveBeenCalled();
    });

    it.each(['', '   '])(
      'should reject an empty folder name (%p)',
      async (name) => {
        await expect(service.createFolder('ch-1', name)).rejects.toThrow(
          BadRequestException,
        );
        expect(mockFolderRepo.create).not.toHaveBeenCalled();
      },
    );
  });

  describe('updateFolder', () => {
    it('should rename the folder and re-file its documents', async () => {
      mockFolderRepo.findById.mockResolvedValue(baseFolder);
      mockFolderRepo.findByName.mockResolvedValue(null);
      mockFolderRepo.update.mockResolvedValue({
        ...baseFolder,
        name: 'Bylaws',
      });

      const result = await service.updateFolder('folder-1', 'ch-1', {
        name: 'Bylaws',
      });

      expect(mockFolderRepo.update).toHaveBeenCalledWith('folder-1', 'ch-1', {
        name: 'Bylaws',
      });
      expect(mockDocumentRepo.renameFolder).toHaveBeenCalledWith(
        'Governance',
        'Bylaws',
        'ch-1',
      );
      expect(result.name).toBe('Bylaws');
    });

    it('should reorder without touching documents', async () => {
      mockFolderRepo.findById.mockResolvedValue(baseFolder);
      mockFolderRepo.update.mockResolvedValue({
        ...baseFolder,
        sort_order: 3,
      });

      await service.updateFolder('folder-1', 'ch-1', { sort_order: 3 });

      expect(mockFolderRepo.update).toHaveBeenCalledWith('folder-1', 'ch-1', {
        sort_order: 3,
      });
      expect(mockDocumentRepo.renameFolder).not.toHaveBeenCalled();
    });

    it('should not re-file documents when the name is unchanged', async () => {
      mockFolderRepo.findById.mockResolvedValue(baseFolder);
      mockFolderRepo.update.mockResolvedValue(baseFolder);

      await service.updateFolder('folder-1', 'ch-1', { name: 'Governance' });

      expect(mockDocumentRepo.renameFolder).not.toHaveBeenCalled();
    });

    it('should throw ConflictException when renaming onto an existing folder', async () => {
      mockFolderRepo.findById.mockResolvedValue(baseFolder);
      mockFolderRepo.findByName.mockResolvedValue({
        ...baseFolder,
        id: 'folder-2',
        name: 'Minutes',
      });

      await expect(
        service.updateFolder('folder-1', 'ch-1', { name: 'Minutes' }),
      ).rejects.toThrow(ConflictException);
      expect(mockFolderRepo.update).not.toHaveBeenCalled();
      expect(mockDocumentRepo.renameFolder).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException for a folder in another chapter', async () => {
      mockFolderRepo.findById.mockResolvedValue(null);

      await expect(
        service.updateFolder('folder-1', 'ch-2', { name: 'Bylaws' }),
      ).rejects.toThrow(NotFoundException);
      expect(mockFolderRepo.update).not.toHaveBeenCalled();
    });

    it('should reject an empty rename', async () => {
      mockFolderRepo.findById.mockResolvedValue(baseFolder);

      await expect(
        service.updateFolder('folder-1', 'ch-1', { name: '   ' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockFolderRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('deleteFolder', () => {
    it('should move documents to root, then delete the folder', async () => {
      mockFolderRepo.findById.mockResolvedValue(baseFolder);

      await service.deleteFolder('folder-1', 'ch-1');

      expect(mockDocumentRepo.moveToRoot).toHaveBeenCalledWith(
        'Governance',
        'ch-1',
      );
      expect(mockFolderRepo.delete).toHaveBeenCalledWith('folder-1', 'ch-1');
      // Spec: no cascading delete of the files themselves.
      expect(mockStorageProvider.deleteFile).not.toHaveBeenCalled();
      expect(mockDocumentRepo.delete).not.toHaveBeenCalled();
    });

    it('should not delete the folder row if moving documents fails', async () => {
      mockFolderRepo.findById.mockResolvedValue(baseFolder);
      mockDocumentRepo.moveToRoot.mockRejectedValue(new Error('db down'));

      await expect(service.deleteFolder('folder-1', 'ch-1')).rejects.toThrow(
        'db down',
      );
      expect(mockFolderRepo.delete).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException for a folder in another chapter', async () => {
      mockFolderRepo.findById.mockResolvedValue(null);

      await expect(service.deleteFolder('folder-1', 'ch-2')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockDocumentRepo.moveToRoot).not.toHaveBeenCalled();
    });
  });
});
