import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { MAX_UPLOAD_BYTES } from '@repo/validation';
import { ChapterDocumentService } from './chapter-document.service';
import { safeObjectFilename } from '#domain/constants/storage';
import { CHAPTER_DOCUMENT_REPOSITORY } from '#domain/repositories/chapter-document.repository.interface';
import type { IChapterDocumentRepository } from '#domain/repositories/chapter-document.repository.interface';
import { CHAPTER_DOCUMENT_FOLDER_REPOSITORY } from '#domain/repositories/chapter-document-folder.repository.interface';
import {
  CHAPTER_DOCUMENT_TYPE_REPOSITORY,
  type IChapterDocumentTypeRepository,
} from '#domain/repositories/chapter-document-type.repository.interface';
import { ChapterDocumentTypeService } from './chapter-document-type.service';
import type { IChapterDocumentFolderRepository } from '#domain/repositories/chapter-document-folder.repository.interface';
import {
  CHAPTER_DOCUMENT_STAR_REPOSITORY,
  type IChapterDocumentStarRepository,
} from '#domain/repositories/chapter-document-star.repository.interface';
import { STORAGE_PROVIDER } from '#domain/adapters/storage.interface';
import type { IStorageProvider } from '#domain/adapters/storage.interface';
import type {
  ChapterDocument,
  ChapterDocumentFolder,
} from '#domain/entities/chapter-document.entity';

describe('ChapterDocumentService', () => {
  let service: ChapterDocumentService;
  let mockDocumentRepo: jest.Mocked<IChapterDocumentRepository>;
  let mockFolderRepo: jest.Mocked<IChapterDocumentFolderRepository>;
  let mockTypeRepo: jest.Mocked<IChapterDocumentTypeRepository>;
  let mockStarRepo: jest.Mocked<IChapterDocumentStarRepository>;
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
    content_type: 'application/pdf',
    byte_size: 1024,
    document_type: 'Bylaws',
    effective_date: '2026-01-01',
    pinned_at: null,
  };

  const baseFolder: ChapterDocumentFolder = {
    id: 'folder-1',
    chapter_id: 'ch-1',
    name: 'Governance',
    sort_order: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    pinned_at: null,
  };

  beforeEach(async () => {
    mockDocumentRepo = {
      findById: jest.fn(),
      findByIds: jest.fn().mockResolvedValue([]),
      findByChapter: jest.fn(),
      findByStoragePath: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      delete: jest.fn(),
      setPinnedAt: jest.fn(),
      moveToRoot: jest.fn(),
      renameFolder: jest.fn(),
    };

    mockTypeRepo = {
      findByChapter: jest.fn().mockResolvedValue([]),
      findById: jest.fn(),
      findByName: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async (row) => ({
        id: 'type-new',
        created_at: '2026-11-13T00:00:00.000Z',
        ...row,
      })),
      setSortOrder: jest.fn(),
      rename: jest.fn(),
      deleteWithDocuments: jest.fn(),
    };

    mockFolderRepo = {
      findByChapter: jest.fn().mockResolvedValue([]),
      findById: jest.fn(),
      findByName: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(baseFolder),
      update: jest.fn(),
      delete: jest.fn(),
      setPinnedAt: jest.fn(),
    };

    mockStarRepo = {
      findByUser: jest.fn().mockResolvedValue([]),
      add: jest.fn(),
      remove: jest.fn(),
    };

    mockStorageProvider = {
      getSignedUploadUrl: jest.fn(),
      getSignedDownloadUrl: jest.fn(),
      getSignedInlineAndAttachmentUrls: jest.fn(),
      getSignedDownloadUrls: jest.fn().mockResolvedValue({}),
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
        { provide: CHAPTER_DOCUMENT_STAR_REPOSITORY, useValue: mockStarRepo },
        { provide: STORAGE_PROVIDER, useValue: mockStorageProvider },
        ChapterDocumentTypeService,
        { provide: CHAPTER_DOCUMENT_TYPE_REPOSITORY, useValue: mockTypeRepo },
      ],
    }).compile();

    service = module.get(ChapterDocumentService);
  });

  describe('requestUploadUrl', () => {
    it('squashes storage-unsafe filename characters in the key (#2697)', async () => {
      const result = await service.requestUploadUrl({
        chapterId: 'ch-1',
        filename: 'Résumé #3 50%.pdf',
        contentType: 'application/pdf',
      });

      expect(result.storagePath).toMatch(
        /^chapters\/ch-1\/documents\/[0-9a-f-]{36}\/R_sum_ _3 50_\.pdf$/,
      );
    });

    it('mints a key its own confirm accepts for a name ending in a space', async () => {
      // The extension check trims, so `bylaws.pdf ` mints; a key ending in a
      // space would then be refused at confirm, orphaning the uploaded bytes.
      const { storagePath } = await service.requestUploadUrl({
        chapterId: 'ch-1',
        filename: 'bylaws.pdf ',
        contentType: 'application/pdf',
      });
      expect(storagePath).toMatch(/\/bylaws\.pdf$/);
      mockDocumentRepo.create.mockResolvedValue({
        ...baseDocument,
        storage_path: storagePath,
      });

      await expect(
        service.confirmUpload({
          chapter_id: 'ch-1',
          title: 'Bylaws',
          storage_path: storagePath,
          uploaded_by: 'user-1',
        }),
      ).resolves.toMatchObject({ storage_path: storagePath });
    });

    it('strips directory components from the filename before building the key', async () => {
      const result = await service.requestUploadUrl({
        chapterId: 'ch-1',
        filename: '../../x.pdf',
        contentType: 'application/pdf',
      });

      expect(result.storagePath).toMatch(
        /^chapters\/ch-1\/documents\/[0-9a-f-]{36}\/x\.pdf$/,
      );
    });

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

    it('accepts a declared size at exactly the upload ceiling', async () => {
      mockStorageProvider.getSignedUploadUrl.mockResolvedValue(
        'https://storage.supabase.co/upload/signed',
      );

      const result = await service.requestUploadUrl({
        chapterId: 'ch-1',
        filename: 'bylaws.pdf',
        contentType: 'application/pdf',
        sizeBytes: MAX_UPLOAD_BYTES,
      });

      expect(result.signedUrl).toBeDefined();
    });

    it('throws BadRequestException for a declared size one byte over the upload ceiling', async () => {
      await expect(
        service.requestUploadUrl({
          chapterId: 'ch-1',
          filename: 'bylaws.pdf',
          contentType: 'application/pdf',
          sizeBytes: MAX_UPLOAD_BYTES + 1,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('batches (folder import, #2242)', () => {
    it('mints one ticket per file, in order', async () => {
      mockStorageProvider.getSignedUploadUrl.mockResolvedValue(
        'https://signed',
      );
      const tickets = await service.requestUploadUrls('ch-1', [
        { filename: 'a.pdf', contentType: 'application/pdf' },
        {
          filename: 'b.docx',
          contentType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        },
      ]);
      expect(tickets).toHaveLength(2);
      expect(tickets[0].storagePath).toMatch(/\/a\.pdf$/);
      expect(tickets[1].storagePath).toMatch(/\/b\.docx$/);
    });

    it('refuses the call when one file is not allowed, naming it', async () => {
      mockStorageProvider.getSignedUploadUrl.mockResolvedValue(
        'https://signed',
      );
      await expect(
        service.requestUploadUrls('ch-1', [
          { filename: 'a.pdf', contentType: 'application/pdf' },
          { filename: 'movie.mov', contentType: 'video/quicktime' },
        ]),
      ).rejects.toThrow(/File 2 \(movie\.mov\)/);
    });

    it('files each upload on its own and reports a refusal against it', async () => {
      mockDocumentRepo.create.mockResolvedValue(baseDocument);
      const results = await service.confirmUploads([
        {
          chapter_id: 'ch-1',
          title: 'Bylaws',
          storage_path: 'chapters/ch-1/documents/doc-1/bylaws.pdf',
          uploaded_by: 'user-1',
        },
        {
          chapter_id: 'ch-1',
          title: 'Elsewhere',
          storage_path: 'chapters/ch-2/documents/doc-2/x.pdf',
          uploaded_by: 'user-1',
        },
      ]);
      expect(results[0]).toEqual({
        storage_path: 'chapters/ch-1/documents/doc-1/bylaws.pdf',
        document: baseDocument,
      });
      expect(results[1].document).toBeUndefined();
      expect(results[1].error).toEqual(expect.any(String));
      expect(mockDocumentRepo.create).toHaveBeenCalledTimes(1);
    });

    it('fails the whole call on a server error (the client retries with the same paths)', async () => {
      mockDocumentRepo.create.mockRejectedValue(new Error('db down'));
      await expect(
        service.confirmUploads([
          {
            chapter_id: 'ch-1',
            title: 'Bylaws',
            storage_path: 'chapters/ch-1/documents/doc-1/bylaws.pdf',
            uploaded_by: 'user-1',
          },
        ]),
      ).rejects.toThrow('db down');
    });
  });

  describe('confirmUpload', () => {
    it("files a type in the chapter's own spelling (#3642)", async () => {
      mockDocumentRepo.create.mockResolvedValue(baseDocument);
      mockTypeRepo.findByName.mockResolvedValue({
        id: 'type-1',
        chapter_id: 'ch-1',
        name: 'Bylaws',
        sort_order: 1,
        created_at: '2026-11-13T00:00:00.000Z',
      });

      await service.confirmUpload({
        chapter_id: 'ch-1',
        title: 'Bylaws 2025',
        storage_path: 'chapters/ch-1/documents/doc-1/bylaws.pdf',
        uploaded_by: 'user-1',
        document_type: '  bylaws ',
      });

      expect(mockTypeRepo.findByName).toHaveBeenCalledWith('ch-1', 'bylaws');
      expect(mockTypeRepo.create).not.toHaveBeenCalled();
      expect(mockDocumentRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ document_type: 'Bylaws' }),
      );
    });

    it("adds a type the chapter doesn't have to its list", async () => {
      mockDocumentRepo.create.mockResolvedValue(baseDocument);
      mockTypeRepo.create.mockResolvedValue({
        id: 'type-9',
        chapter_id: 'ch-1',
        name: 'Rush schedule',
        sort_order: 7,
        created_at: '2026-11-13T00:00:00.000Z',
      });

      await service.confirmUpload({
        chapter_id: 'ch-1',
        title: 'Rush 2026',
        storage_path: 'chapters/ch-1/documents/doc-1/rush.pdf',
        uploaded_by: 'user-1',
        document_type: 'Rush schedule',
      });

      expect(mockTypeRepo.create).toHaveBeenCalledWith({
        chapter_id: 'ch-1',
        name: 'Rush schedule',
        sort_order: 0,
      });
      expect(mockDocumentRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ document_type: 'Rush schedule' }),
      );
    });

    it('files no type when none is given, without reading the list', async () => {
      mockDocumentRepo.create.mockResolvedValue(baseDocument);

      await service.confirmUpload({
        chapter_id: 'ch-1',
        title: 'Bylaws 2025',
        storage_path: 'chapters/ch-1/documents/doc-1/bylaws.pdf',
        uploaded_by: 'user-1',
        document_type: '   ',
      });

      expect(mockTypeRepo.findByName).not.toHaveBeenCalled();
      expect(mockDocumentRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ document_type: null }),
      );
    });

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

    it('returns the row a retried confirm already filed, unchanged, and files nothing', async () => {
      // A mobile retry after a lost response lands here (#3399).
      mockDocumentRepo.findByStoragePath.mockResolvedValue(baseDocument);

      await expect(
        service.confirmUpload({
          chapter_id: 'ch-1',
          title: 'Bylaws 2025',
          folder: 'A folder nothing is filed into',
          storage_path: baseDocument.storage_path,
          uploaded_by: baseDocument.uploaded_by,
        }),
      ).resolves.toEqual(baseDocument);
      expect(mockDocumentRepo.findByStoragePath).toHaveBeenCalledWith(
        baseDocument.storage_path,
        'ch-1',
      );
      expect(mockDocumentRepo.create).not.toHaveBeenCalled();
      expect(mockFolderRepo.create).not.toHaveBeenCalled();
    });

    it('refuses a path another member filed, registering no folder for it', async () => {
      mockDocumentRepo.findByStoragePath.mockResolvedValue(baseDocument);

      await expect(
        service.confirmUpload({
          chapter_id: 'ch-1',
          title: 'Bylaws 2025',
          folder: 'Not mine',
          storage_path: baseDocument.storage_path,
          uploaded_by: 'user-2',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mockDocumentRepo.create).not.toHaveBeenCalled();
      expect(mockFolderRepo.create).not.toHaveBeenCalled();
    });

    it('refuses another member who won a race past the read', async () => {
      // `create` hands back the row a concurrent confirm filed (its 23505).
      mockDocumentRepo.create.mockResolvedValue(baseDocument);

      await expect(
        service.confirmUpload({
          chapter_id: 'ch-1',
          title: 'Bylaws 2025',
          storage_path: baseDocument.storage_path,
          uploaded_by: 'user-2',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
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

    it('should persist content type, size, document type and effective date when provided', async () => {
      mockDocumentRepo.create.mockResolvedValue(baseDocument);

      await service.confirmUpload({
        chapter_id: 'ch-1',
        title: 'Bylaws 2025',
        storage_path: 'chapters/ch-1/documents/doc-1/bylaws.pdf',
        uploaded_by: 'user-1',
        content_type: 'application/pdf',
        byte_size: 1024,
        document_type: 'Bylaws',
        effective_date: '2026-01-01',
      });

      expect(mockDocumentRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          content_type: 'application/pdf',
          byte_size: 1024,
          document_type: 'Bylaws',
          effective_date: '2026-01-01',
        }),
      );
    });

    it('should default content type, size, document type and effective date to null when omitted', async () => {
      mockDocumentRepo.create.mockResolvedValue(baseDocument);

      await service.confirmUpload({
        chapter_id: 'ch-1',
        title: 'Agenda',
        storage_path: 'chapters/ch-1/documents/doc-2/agenda.pdf',
        uploaded_by: 'user-1',
      });

      expect(mockDocumentRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          content_type: null,
          byte_size: null,
          document_type: null,
          effective_date: null,
        }),
      );
    });

    it('should reject a content type not on the document upload allowlist', async () => {
      await expect(
        service.confirmUpload({
          chapter_id: 'ch-1',
          title: 'Bylaws 2025',
          storage_path: 'chapters/ch-1/documents/doc-1/bylaws.pdf',
          uploaded_by: 'user-1',
          content_type: 'application/x-msdownload',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(mockDocumentRepo.create).not.toHaveBeenCalled();
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

    it('should not fail the upload when a concurrent upload created the folder', async () => {
      // Both uploads read "absent" and both insert; one loses the unique
      // index. The folder exists either way, which is all ensureFolder
      // promised — the upload must not 500 over it.
      mockFolderRepo.findByName
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(baseFolder);
      mockFolderRepo.create.mockRejectedValue({ code: '23505' });
      mockDocumentRepo.create.mockResolvedValue(baseDocument);

      const result = await service.confirmUpload({
        chapter_id: 'ch-1',
        title: 'Bylaws 2025',
        folder: 'Governance',
        storage_path: 'chapters/ch-1/documents/doc-1/bylaws.pdf',
        uploaded_by: 'user-1',
      });

      expect(result).toEqual(baseDocument);
      expect(mockDocumentRepo.create).toHaveBeenCalled();
    });

    it('should still fail the upload if the folder genuinely cannot be read back', async () => {
      mockFolderRepo.findByName.mockResolvedValue(null);
      mockFolderRepo.create.mockRejectedValue({ code: '23505' });

      await expect(
        service.confirmUpload({
          chapter_id: 'ch-1',
          title: 'Bylaws 2025',
          folder: 'Governance',
          storage_path: 'chapters/ch-1/documents/doc-1/bylaws.pdf',
          uploaded_by: 'user-1',
        }),
      ).rejects.toEqual(expect.objectContaining({ code: '23505' }));
      expect(mockDocumentRepo.create).not.toHaveBeenCalled();
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

    it.each([
      // Each names the filed object `doc-1/bylaws.pdf` under another string,
      // so it would pass the filed-row read and the unique index (#3399).
      'chapters/ch-1/documents/doc-1/bylaws.pdf?alias',
      'chapters/ch-1/documents/doc-1/bylaws.pdf#alias',
      'chapters/ch-1/documents/doc-1/bylaw%73.pdf',
      // The URL parser strips a trailing space, so this signs the filed object.
      'chapters/ch-1/documents/doc-1/bylaws.pdf ',
      // Not the `{documentId}/{filename}` the mint builds.
      'chapters/ch-1/documents/bylaws.pdf',
      'chapters/ch-1/documents/doc-1/extra/bylaws.pdf',
      'chapters/ch-1/documents/doc-1/',
      'chapters/ch-1/documents/doc-1//bylaws.pdf',
    ])(
      'rejects a storage_path that is not a minted key (%p)',
      async (storagePath) => {
        await expect(
          service.confirmUpload({
            chapter_id: 'ch-1',
            title: 'Bylaws',
            storage_path: storagePath,
            uploaded_by: 'user-1',
          }),
        ).rejects.toThrow(BadRequestException);
        expect(mockDocumentRepo.findByStoragePath).not.toHaveBeenCalled();
        expect(mockDocumentRepo.create).not.toHaveBeenCalled();
      },
    );

    it('accepts every character a minted filename can keep', async () => {
      const storagePath = `chapters/ch-1/documents/4a5c1f0e-3d2b-4c8a-9f1e-2b7d6c5a4e3f/${safeObjectFilename("Bob's notes (final), A&B $1=@;:+!*.pdf")}`;
      mockDocumentRepo.create.mockResolvedValue({
        ...baseDocument,
        storage_path: storagePath,
      });

      await service.confirmUpload({
        chapter_id: 'ch-1',
        title: 'Notes',
        storage_path: storagePath,
        uploaded_by: 'user-1',
      });

      expect(mockDocumentRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ storage_path: storagePath }),
      );
    });

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

  // #4647: the web grid's previews, signed in one batch rather than one
  // `findById` per tile.
  describe('previewUrls', () => {
    it("signs only the chapter's documents, in one batch, as inline links", async () => {
      mockDocumentRepo.findByIds.mockResolvedValue([
        baseDocument,
        { ...baseDocument, id: 'doc-2', storage_path: 'ch-1/photo.jpg' },
      ]);
      mockStorageProvider.getSignedDownloadUrls.mockResolvedValue({
        [baseDocument.storage_path]: 'https://signed/1',
        'ch-1/photo.jpg': 'https://signed/2',
      });

      const result = await service.previewUrls(
        [baseDocument.id, 'doc-2', baseDocument.id, 'other-chapter-doc'],
        'ch-1',
      );

      expect(mockDocumentRepo.findByIds).toHaveBeenCalledWith(
        [baseDocument.id, 'doc-2', 'other-chapter-doc'],
        'ch-1',
      );
      expect(mockStorageProvider.getSignedDownloadUrls).toHaveBeenCalledTimes(
        1,
      );
      const [bucket, paths, ttl, forceDownload] =
        mockStorageProvider.getSignedDownloadUrls.mock.calls[0];
      expect(bucket).toBe('documents');
      expect(paths).toEqual([baseDocument.storage_path, 'ch-1/photo.jpg']);
      expect(ttl).toBe(3600);
      // Inline: the tile draws the file, never saves it.
      expect(forceDownload).toBeFalsy();
      expect(result).toEqual([
        { id: baseDocument.id, url: 'https://signed/1' },
        { id: 'doc-2', url: 'https://signed/2' },
      ]);
    });

    it('leaves out a path storage could not sign', async () => {
      mockDocumentRepo.findByIds.mockResolvedValue([baseDocument]);
      mockStorageProvider.getSignedDownloadUrls.mockResolvedValue({});
      await expect(
        service.previewUrls([baseDocument.id], 'ch-1'),
      ).resolves.toEqual([]);
    });

    it('asks storage for nothing when no id is in the chapter', async () => {
      mockDocumentRepo.findByIds.mockResolvedValue([]);
      await expect(service.previewUrls(['x'], 'ch-1')).resolves.toEqual([]);
      expect(mockStorageProvider.getSignedDownloadUrls).not.toHaveBeenCalled();
    });

    it('refuses more than 100 ids', async () => {
      const ids = Array.from({ length: 101 }, (_, i) => `doc-${i}`);
      await expect(service.previewUrls(ids, 'ch-1')).rejects.toThrow(
        'At most 100 documents per request',
      );
      expect(mockDocumentRepo.findByIds).not.toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('returns an inline link and a forced-download link from one signature', async () => {
      mockDocumentRepo.findById.mockResolvedValue(baseDocument);
      mockStorageProvider.getSignedInlineAndAttachmentUrls.mockResolvedValue({
        inline: 'https://storage.supabase.co/signed?token=t',
        attachment:
          'https://storage.supabase.co/signed?token=t&download=bylaws.pdf',
      });

      const result = await service.findById('doc-1', 'ch-1');

      expect(result.id).toBe('doc-1');
      // Inline, as before: the viewer and mobile's in-app browser read it.
      expect(result.downloadUrl).toBe(
        'https://storage.supabase.co/signed?token=t',
      );
      expect(result.forcedDownloadUrl).toBe(
        'https://storage.supabase.co/signed?token=t&download=bylaws.pdf',
      );
      // Saved under the stored key's last segment.
      expect(
        mockStorageProvider.getSignedInlineAndAttachmentUrls,
      ).toHaveBeenCalledWith(
        'documents',
        baseDocument.storage_path,
        'bylaws.pdf',
      );
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

    it('should report a lost unique-index race as a conflict, not a 500', async () => {
      // The pre-check is advisory; a concurrent create slips between it and
      // the insert, and the index is the real arbiter.
      mockFolderRepo.findByName.mockResolvedValue(null);
      mockFolderRepo.create.mockRejectedValue({ code: '23505' });

      await expect(service.createFolder('ch-1', 'Governance')).rejects.toThrow(
        ConflictException,
      );
    });

    it('should not swallow unrelated repository errors', async () => {
      mockFolderRepo.findByName.mockResolvedValue(null);
      mockFolderRepo.create.mockRejectedValue({
        code: '08006',
        message: 'connection failure',
      });

      await expect(service.createFolder('ch-1', 'Governance')).rejects.toEqual(
        expect.objectContaining({ code: '08006' }),
      );
    });
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

    it('should treat a no-op patch as a no-op, not an error', async () => {
      // Every UpdateDocumentFolderDto field is optional, so `{}` is a valid
      // body. An empty PostgREST update matches no row and fails `.single()`
      // with PGRST116, which would surface as a 500.
      mockFolderRepo.findById.mockResolvedValue(baseFolder);

      const result = await service.updateFolder('folder-1', 'ch-1', {});

      expect(result).toEqual(baseFolder);
      expect(mockFolderRepo.update).not.toHaveBeenCalled();
      expect(mockDocumentRepo.renameFolder).not.toHaveBeenCalled();
    });

    it('should re-file documents before renaming the folder row', async () => {
      const calls: string[] = [];
      mockFolderRepo.findById.mockResolvedValue(baseFolder);
      mockFolderRepo.findByName.mockResolvedValue(null);
      mockDocumentRepo.renameFolder.mockImplementation(async () => {
        calls.push('documents');
      });
      mockFolderRepo.update.mockImplementation(async () => {
        calls.push('folder');
        return { ...baseFolder, name: 'Bylaws' };
      });

      await service.updateFolder('folder-1', 'ch-1', { name: 'Bylaws' });

      expect(calls).toEqual(['documents', 'folder']);
    });

    it('should leave the rename retryable when re-filing documents fails', async () => {
      // The row keeps the old name, so a retry still sees a real rename and
      // re-runs both steps. Renaming the row first would make the retry a
      // no-op and strand the documents permanently.
      mockFolderRepo.findById.mockResolvedValue(baseFolder);
      mockFolderRepo.findByName.mockResolvedValue(null);
      mockDocumentRepo.renameFolder.mockRejectedValue(new Error('db down'));

      await expect(
        service.updateFolder('folder-1', 'ch-1', { name: 'Bylaws' }),
      ).rejects.toThrow('db down');
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

  describe('pins (#3934)', () => {
    it('pins an unpinned folder with the current time', async () => {
      mockFolderRepo.findById.mockResolvedValue(baseFolder);
      mockFolderRepo.setPinnedAt.mockImplementation(
        async (_id, _ch, pinnedAt) => ({ ...baseFolder, pinned_at: pinnedAt }),
      );
      const result = await service.setFolderPinned('folder-1', 'ch-1', true);
      expect(mockFolderRepo.findById).toHaveBeenCalledWith('folder-1', 'ch-1');
      expect(mockFolderRepo.setPinnedAt).toHaveBeenCalledWith(
        'folder-1',
        'ch-1',
        expect.any(String),
      );
      expect(result.pinned_at).not.toBeNull();
    });

    it('keeps the first pin time when a pinned folder is pinned again', async () => {
      const pinned = { ...baseFolder, pinned_at: '2026-11-01T00:00:00.000Z' };
      mockFolderRepo.findById.mockResolvedValue(pinned);
      await expect(
        service.setFolderPinned('folder-1', 'ch-1', true),
      ).resolves.toBe(pinned);
      expect(mockFolderRepo.setPinnedAt).not.toHaveBeenCalled();
    });

    it('unpins a pinned folder', async () => {
      mockFolderRepo.findById.mockResolvedValue({
        ...baseFolder,
        pinned_at: '2026-11-01T00:00:00.000Z',
      });
      mockFolderRepo.setPinnedAt.mockResolvedValue(baseFolder);
      await service.setFolderPinned('folder-1', 'ch-1', false);
      expect(mockFolderRepo.setPinnedAt).toHaveBeenCalledWith(
        'folder-1',
        'ch-1',
        null,
      );
    });

    it("refuses to pin a folder outside the caller's chapter", async () => {
      mockFolderRepo.findById.mockResolvedValue(null);
      await expect(
        service.setFolderPinned('folder-x', 'ch-1', true),
      ).rejects.toThrow(NotFoundException);
      expect(mockFolderRepo.setPinnedAt).not.toHaveBeenCalled();
    });

    it('answers 404 when the folder is deleted between the read and the pin', async () => {
      mockFolderRepo.findById.mockResolvedValue(baseFolder);
      mockFolderRepo.setPinnedAt.mockResolvedValue(null);
      await expect(
        service.setFolderPinned('folder-1', 'ch-1', true),
      ).rejects.toThrow(NotFoundException);
    });

    it('answers 404 when the document is deleted between the read and the pin', async () => {
      mockDocumentRepo.findById.mockResolvedValue(baseDocument);
      mockDocumentRepo.setPinnedAt.mockResolvedValue(null);
      await expect(
        service.setDocumentPinned('doc-1', 'ch-1', true),
      ).rejects.toThrow(NotFoundException);
    });

    it('pins and unpins a document', async () => {
      mockDocumentRepo.findById.mockResolvedValue(baseDocument);
      mockDocumentRepo.setPinnedAt.mockResolvedValue({
        ...baseDocument,
        pinned_at: '2026-11-11T00:00:00.000Z',
      });
      await service.setDocumentPinned('doc-1', 'ch-1', true);
      expect(mockDocumentRepo.setPinnedAt).toHaveBeenCalledWith(
        'doc-1',
        'ch-1',
        expect.any(String),
      );

      mockDocumentRepo.setPinnedAt.mockClear();
      mockDocumentRepo.findById.mockResolvedValue({
        ...baseDocument,
        pinned_at: '2026-11-11T00:00:00.000Z',
      });
      await service.setDocumentPinned('doc-1', 'ch-1', false);
      expect(mockDocumentRepo.setPinnedAt).toHaveBeenCalledWith(
        'doc-1',
        'ch-1',
        null,
      );
    });

    it('leaves an unpinned document alone when asked to unpin it', async () => {
      mockDocumentRepo.findById.mockResolvedValue(baseDocument);
      await expect(
        service.setDocumentPinned('doc-1', 'ch-1', false),
      ).resolves.toBe(baseDocument);
      expect(mockDocumentRepo.setPinnedAt).not.toHaveBeenCalled();
    });

    it("refuses to pin a document outside the caller's chapter", async () => {
      mockDocumentRepo.findById.mockResolvedValue(null);
      await expect(
        service.setDocumentPinned('doc-x', 'ch-1', true),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('stars (#3934)', () => {
    it("splits the caller's stars into folder and document ids", async () => {
      mockStarRepo.findByUser.mockResolvedValue([
        {
          id: 's1',
          user_id: 'user-1',
          chapter_id: 'ch-1',
          folder_id: 'folder-1',
          document_id: null,
          created_at: '2026-11-01T00:00:00.000Z',
        },
        {
          id: 's2',
          user_id: 'user-1',
          chapter_id: 'ch-1',
          folder_id: null,
          document_id: 'doc-1',
          created_at: '2026-11-02T00:00:00.000Z',
        },
      ]);
      await expect(service.listStars('user-1', 'ch-1')).resolves.toEqual({
        folder_ids: ['folder-1'],
        document_ids: ['doc-1'],
      });
      expect(mockStarRepo.findByUser).toHaveBeenCalledWith('user-1', 'ch-1');
    });

    it("stars a folder after reading it in the caller's chapter", async () => {
      mockFolderRepo.findById.mockResolvedValue(baseFolder);
      await service.setFolderStarred('user-1', 'ch-1', 'folder-1', true);
      expect(mockFolderRepo.findById).toHaveBeenCalledWith('folder-1', 'ch-1');
      expect(mockStarRepo.add).toHaveBeenCalledWith('user-1', 'ch-1', {
        folder_id: 'folder-1',
      });
    });

    it("refuses to star a folder outside the caller's chapter", async () => {
      mockFolderRepo.findById.mockResolvedValue(null);
      await expect(
        service.setFolderStarred('user-1', 'ch-1', 'folder-x', true),
      ).rejects.toThrow(NotFoundException);
      expect(mockStarRepo.add).not.toHaveBeenCalled();
    });

    it('answers 404 when the target is deleted between the read and the star', async () => {
      mockFolderRepo.findById.mockResolvedValue(baseFolder);
      mockStarRepo.add.mockRejectedValue(
        Object.assign(new Error('fk'), { code: '23503' }),
      );
      await expect(
        service.setFolderStarred('user-1', 'ch-1', 'folder-1', true),
      ).rejects.toThrow(NotFoundException);

      mockDocumentRepo.findById.mockResolvedValue(baseDocument);
      await expect(
        service.setDocumentStarred('user-1', 'ch-1', 'doc-1', true),
      ).rejects.toThrow(NotFoundException);
    });

    it('lets any other insert failure through', async () => {
      mockFolderRepo.findById.mockResolvedValue(baseFolder);
      const failure = Object.assign(new Error('down'), { code: '08006' });
      mockStarRepo.add.mockRejectedValue(failure);
      await expect(
        service.setFolderStarred('user-1', 'ch-1', 'folder-1', true),
      ).rejects.toBe(failure);
    });

    it('unstars a folder without reading it', async () => {
      await service.setFolderStarred('user-1', 'ch-1', 'folder-1', false);
      expect(mockFolderRepo.findById).not.toHaveBeenCalled();
      expect(mockStarRepo.remove).toHaveBeenCalledWith('user-1', 'ch-1', {
        folder_id: 'folder-1',
      });
    });

    it('stars and unstars a document', async () => {
      mockDocumentRepo.findById.mockResolvedValue(baseDocument);
      await service.setDocumentStarred('user-1', 'ch-1', 'doc-1', true);
      expect(mockStarRepo.add).toHaveBeenCalledWith('user-1', 'ch-1', {
        document_id: 'doc-1',
      });
      await service.setDocumentStarred('user-1', 'ch-1', 'doc-1', false);
      expect(mockStarRepo.remove).toHaveBeenCalledWith('user-1', 'ch-1', {
        document_id: 'doc-1',
      });
    });

    it("refuses to star a document outside the caller's chapter", async () => {
      mockDocumentRepo.findById.mockResolvedValue(null);
      await expect(
        service.setDocumentStarred('user-1', 'ch-1', 'doc-x', true),
      ).rejects.toThrow(NotFoundException);
      expect(mockStarRepo.add).not.toHaveBeenCalled();
    });
  });
});
