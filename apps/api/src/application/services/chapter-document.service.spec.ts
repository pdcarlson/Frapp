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
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import { RbacService } from './rbac.service';
import { ChannelAccessListService } from './channel-access-list.service';
import type { ChannelAccessHolder } from '#domain/utils/channel-access';

describe('ChapterDocumentService', () => {
  let service: ChapterDocumentService;
  let mockDocumentRepo: jest.Mocked<IChapterDocumentRepository>;
  let mockFolderRepo: jest.Mocked<IChapterDocumentFolderRepository>;
  let mockTypeRepo: jest.Mocked<IChapterDocumentTypeRepository>;
  let mockStarRepo: jest.Mocked<IChapterDocumentStarRepository>;
  let mockStorageProvider: jest.Mocked<IStorageProvider>;
  let mockRbac: {
    getChannelAccessHolder: jest.Mock;
    getRankContext: jest.Mock;
    memberHasAnyPermission: jest.Mock;
  };
  let mockAccessLists: { normalize: jest.Mock; listOptions: jest.Mock };

  /** What the caller holds for lists: nothing, unless a test says so. */
  const holder = (
    entries: string[] = [],
    wildcard = false,
  ): ChannelAccessHolder => ({
    entries: new Set(entries),
    wildcard,
    alumniEntries: new Set(),
  });

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
    drive_file_id: null,
    drive_modified_at: null,
    drive_url: null,
    drive_held_folder_id: null,
    drive_link_status: null,
    drive_synced_at: null,
    who_can_see: null,
  };

  const baseFolder: ChapterDocumentFolder = {
    id: 'folder-1',
    chapter_id: 'ch-1',
    name: 'Governance',
    sort_order: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    pinned_at: null,
    who_can_see: null,
    drive_folder_id: null,
  };

  beforeEach(async () => {
    mockDocumentRepo = {
      findById: jest.fn(),
      findByIds: jest.fn().mockResolvedValue([]),
      findByChapter: jest.fn(),
      findByStoragePath: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      delete: jest.fn(),
      findDriveCopies: jest.fn().mockResolvedValue([]),
      findLinkedDriveFileIds: jest.fn().mockResolvedValue(new Set()),
      findByDriveFileId: jest.fn().mockResolvedValue(null),
      updateDriveCopy: jest.fn(),
      setPinnedAt: jest.fn(),
      setWhoCanSee: jest.fn(),
      updateFiling: jest.fn(),
      moveMany: jest.fn(),
    };

    mockRbac = {
      getChannelAccessHolder: jest.fn().mockResolvedValue(holder()),
      getRankContext: jest.fn(),
      memberHasAnyPermission: jest.fn().mockResolvedValue(false),
    };
    mockAccessLists = {
      normalize: jest.fn(async (_chapterId, dto) => dto),
      listOptions: jest.fn().mockResolvedValue([]),
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
      rename: jest.fn(),
      deleteMovingDocuments: jest.fn().mockResolvedValue(true),
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
        {
          provide: MEMBER_REPOSITORY,
          useValue: { findByUserAndChapter: jest.fn().mockResolvedValue(null) },
        },
        { provide: RbacService, useValue: mockRbac },
        { provide: ChannelAccessListService, useValue: mockAccessLists },
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
      ).rejects.toThrow(
        new BadRequestException('File extension is not allowed'),
      );
    });

    it('should throw BadRequestException if content type is not allowed', async () => {
      await expect(
        service.requestUploadUrl({
          chapterId: 'ch-1',
          filename: 'video.mp4',
          contentType: 'video/mp4',
        }),
      ).rejects.toThrow(
        new BadRequestException('File extension is not allowed'),
      );
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

      const result = await service.findByChapter('ch-1', 'user-1', {
        folder: 'Governance',
      });

      expect(mockDocumentRepo.findByChapter).toHaveBeenCalledWith('ch-1', {
        folder: 'Governance',
      });
      expect(result).toHaveLength(1);
    });

    it('should return all documents without filter', async () => {
      mockDocumentRepo.findByChapter.mockResolvedValue([baseDocument]);

      const result = await service.findByChapter('ch-1', 'user-1');

      expect(mockDocumentRepo.findByChapter).toHaveBeenCalledWith(
        'ch-1',
        undefined,
      );
      expect(result).toHaveLength(1);
    });

    it('should pass a title search through to the repository', async () => {
      mockDocumentRepo.findByChapter.mockResolvedValue([baseDocument]);

      await service.findByChapter('ch-1', 'user-1', { search: 'bylaws' });

      expect(mockDocumentRepo.findByChapter).toHaveBeenCalledWith('ch-1', {
        search: 'bylaws',
      });
    });

    it('should support folder and search together', async () => {
      mockDocumentRepo.findByChapter.mockResolvedValue([baseDocument]);

      await service.findByChapter('ch-1', 'user-1', {
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
        'user-1',
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
        service.previewUrls([baseDocument.id], 'ch-1', 'user-1'),
      ).resolves.toEqual([]);
    });

    it('asks storage for nothing when no id is in the chapter', async () => {
      mockDocumentRepo.findByIds.mockResolvedValue([]);
      await expect(
        service.previewUrls(['x'], 'ch-1', 'user-1'),
      ).resolves.toEqual([]);
      expect(mockStorageProvider.getSignedDownloadUrls).not.toHaveBeenCalled();
    });

    it('refuses more than 100 ids', async () => {
      const ids = Array.from({ length: 101 }, (_, i) => `doc-${i}`);
      await expect(service.previewUrls(ids, 'ch-1', 'user-1')).rejects.toThrow(
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

      const result = await service.findById('doc-1', 'ch-1', 'user-1');

      expect(result.id).toBe('doc-1');
      // Inline, as before: the web viewer reads it.
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

      await expect(service.findById('doc-x', 'ch-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('delete', () => {
    it('should delete document and storage file', async () => {
      mockDocumentRepo.findById.mockResolvedValue(baseDocument);
      mockStorageProvider.deleteFile.mockResolvedValue();
      mockDocumentRepo.delete.mockResolvedValue();

      await service.delete('doc-1', 'ch-1', 'user-1');

      expect(mockStorageProvider.deleteFile).toHaveBeenCalledWith(
        'documents',
        baseDocument.storage_path,
      );
      expect(mockDocumentRepo.delete).toHaveBeenCalledWith('doc-1', 'ch-1');
    });

    it('should throw NotFoundException when document not found', async () => {
      mockDocumentRepo.findById.mockResolvedValue(null);

      await expect(service.delete('doc-x', 'ch-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('refuses a copy of a Google Drive file, which Drive owns (#5157)', async () => {
      mockDocumentRepo.findById.mockResolvedValue({
        ...baseDocument,
        drive_file_id: 'drive-1',
      });

      await expect(service.delete('doc-1', 'ch-1', 'user-1')).rejects.toThrow(
        'Remove it in Google Drive',
      );
      expect(mockStorageProvider.deleteFile).not.toHaveBeenCalled();
      expect(mockDocumentRepo.delete).not.toHaveBeenCalled();
    });
  });

  describe('delete, a Drive file added by link (#5434)', () => {
    it('lets it go: deleting it unlinks it, and Drive is untouched', async () => {
      mockDocumentRepo.findById.mockResolvedValue({
        ...baseDocument,
        drive_file_id: 'drive-1',
        drive_link_status: 'active',
      });
      mockStorageProvider.deleteFile.mockResolvedValue();
      mockDocumentRepo.delete.mockResolvedValue();

      await service.delete('doc-1', 'ch-1', 'user-1');

      expect(mockDocumentRepo.delete).toHaveBeenCalledWith('doc-1', 'ch-1');
    });
  });

  describe('listFolders', () => {
    it('should return the chapter folders', async () => {
      mockFolderRepo.findByChapter.mockResolvedValue([baseFolder]);

      const result = await service.listFolders('ch-1', 'user-1');

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

      await service.createFolder('ch-1', 'Policies', undefined, 'user-1');

      expect(mockFolderRepo.create).toHaveBeenCalledWith({
        chapter_id: 'ch-1',
        name: 'Policies',
        sort_order: 5,
        who_can_see: null,
      });
    });

    it('should honor an explicit sort order', async () => {
      await service.createFolder('ch-1', 'Policies', 2, 'user-1');

      expect(mockFolderRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ sort_order: 2 }),
      );
    });

    it('should start at sort order 0 for the first folder', async () => {
      mockFolderRepo.findByChapter.mockResolvedValue([]);

      await service.createFolder('ch-1', 'Governance', undefined, 'user-1');

      expect(mockFolderRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ sort_order: 0 }),
      );
    });

    it('should trim the folder name', async () => {
      await service.createFolder('ch-1', '  Governance  ', undefined, 'user-1');

      expect(mockFolderRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Governance' }),
      );
    });

    it('should throw ConflictException on a duplicate name', async () => {
      mockFolderRepo.findByName.mockResolvedValue(baseFolder);

      await expect(
        service.createFolder('ch-1', 'Governance', undefined, 'user-1'),
      ).rejects.toThrow(ConflictException);
      expect(mockFolderRepo.create).not.toHaveBeenCalled();
    });

    it.each(['', '   '])(
      'should reject an empty folder name (%p)',
      async (name) => {
        await expect(
          service.createFolder('ch-1', name, undefined, 'user-1'),
        ).rejects.toThrow(BadRequestException);
        expect(mockFolderRepo.create).not.toHaveBeenCalled();
      },
    );

    it('should report a lost unique-index race as a conflict, not a 500', async () => {
      // The pre-check is advisory; a concurrent create slips between it and
      // the insert, and the index is the real arbiter.
      mockFolderRepo.findByName.mockResolvedValue(null);
      mockFolderRepo.create.mockRejectedValue({ code: '23505' });

      await expect(
        service.createFolder('ch-1', 'Governance', undefined, 'user-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('should not swallow unrelated repository errors', async () => {
      mockFolderRepo.findByName.mockResolvedValue(null);
      mockFolderRepo.create.mockRejectedValue({
        code: '08006',
        message: 'connection failure',
      });

      await expect(
        service.createFolder('ch-1', 'Governance', undefined, 'user-1'),
      ).rejects.toEqual(expect.objectContaining({ code: '08006' }));
    });
  });

  describe('updateFolder', () => {
    it('renames the folder and re-files its documents in one call', async () => {
      mockFolderRepo.findById.mockResolvedValue(baseFolder);
      mockFolderRepo.findByName.mockResolvedValue(null);
      mockFolderRepo.rename.mockResolvedValue({
        ...baseFolder,
        name: 'Bylaws',
      });

      const result = await service.updateFolder('folder-1', 'ch-1', 'user-1', {
        name: 'Bylaws',
      });

      expect(mockFolderRepo.rename).toHaveBeenCalledWith(
        'folder-1',
        'ch-1',
        'Bylaws',
      );
      expect(mockFolderRepo.update).not.toHaveBeenCalled();
      expect(result.name).toBe('Bylaws');
    });

    it('renames first, then applies the rest of the patch', async () => {
      mockFolderRepo.findById.mockResolvedValue(baseFolder);
      const calls: string[] = [];
      mockFolderRepo.rename.mockImplementation(async () => {
        calls.push('rename');
        return { ...baseFolder, name: 'Bylaws' };
      });
      mockFolderRepo.update.mockImplementation(async () => {
        calls.push('update');
        return { ...baseFolder, name: 'Bylaws', sort_order: 3 };
      });

      await service.updateFolder('folder-1', 'ch-1', 'user-1', {
        name: 'Bylaws',
        sort_order: 3,
      });

      expect(calls).toEqual(['rename', 'update']);
      expect(mockFolderRepo.update).toHaveBeenCalledWith('folder-1', 'ch-1', {
        sort_order: 3,
      });
    });

    it('should reorder without renaming', async () => {
      mockFolderRepo.findById.mockResolvedValue(baseFolder);
      mockFolderRepo.update.mockResolvedValue({ ...baseFolder, sort_order: 3 });

      await service.updateFolder('folder-1', 'ch-1', 'user-1', {
        sort_order: 3,
      });

      expect(mockFolderRepo.update).toHaveBeenCalledWith('folder-1', 'ch-1', {
        sort_order: 3,
      });
      expect(mockFolderRepo.rename).not.toHaveBeenCalled();
    });

    it('should not rename when the name is unchanged', async () => {
      mockFolderRepo.findById.mockResolvedValue(baseFolder);

      await expect(
        service.updateFolder('folder-1', 'ch-1', 'user-1', {
          name: 'Governance',
        }),
      ).resolves.toEqual(baseFolder);

      expect(mockFolderRepo.rename).not.toHaveBeenCalled();
      expect(mockFolderRepo.update).not.toHaveBeenCalled();
    });

    it('should throw ConflictException when renaming onto an existing folder', async () => {
      mockFolderRepo.findById.mockResolvedValue(baseFolder);
      mockFolderRepo.findByName.mockResolvedValue({
        ...baseFolder,
        id: 'folder-2',
        name: 'Minutes',
      });

      await expect(
        service.updateFolder('folder-1', 'ch-1', 'user-1', { name: 'Minutes' }),
      ).rejects.toThrow(ConflictException);
      expect(mockFolderRepo.rename).not.toHaveBeenCalled();
    });

    it('reports a rename that lost a race to the unique index as a conflict', async () => {
      // The pre-check is advisory; the transaction's unique index is the real
      // arbiter, and it rolls the documents back with the row.
      mockFolderRepo.findById.mockResolvedValue(baseFolder);
      mockFolderRepo.findByName.mockResolvedValue(null);
      mockFolderRepo.rename.mockRejectedValue({ code: '23505' });

      await expect(
        service.updateFolder('folder-1', 'ch-1', 'user-1', { name: 'Minutes' }),
      ).rejects.toThrow(ConflictException);
    });

    it('answers 404 when the folder goes between the read and the rename', async () => {
      mockFolderRepo.findById.mockResolvedValue(baseFolder);
      mockFolderRepo.rename.mockResolvedValue(null);

      await expect(
        service.updateFolder('folder-1', 'ch-1', 'user-1', { name: 'Bylaws' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException for a folder in another chapter', async () => {
      mockFolderRepo.findById.mockResolvedValue(null);

      await expect(
        service.updateFolder('folder-1', 'ch-2', 'user-1', { name: 'Bylaws' }),
      ).rejects.toThrow(NotFoundException);
      expect(mockFolderRepo.rename).not.toHaveBeenCalled();
    });

    it('should reject an empty rename', async () => {
      mockFolderRepo.findById.mockResolvedValue(baseFolder);

      await expect(
        service.updateFolder('folder-1', 'ch-1', 'user-1', { name: '   ' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockFolderRepo.rename).not.toHaveBeenCalled();
    });

    it('should treat a no-op patch as a no-op, not an error', async () => {
      // Every UpdateDocumentFolderDto field is optional, so `{}` is a valid
      // body. An empty PostgREST update matches no row and fails `.single()`
      // with PGRST116, which would surface as a 500.
      mockFolderRepo.findById.mockResolvedValue(baseFolder);

      const result = await service.updateFolder(
        'folder-1',
        'ch-1',
        'user-1',
        {},
      );

      expect(result).toEqual(baseFolder);
      expect(mockFolderRepo.update).not.toHaveBeenCalled();
      expect(mockFolderRepo.rename).not.toHaveBeenCalled();
    });
  });

  describe('deleteFolder', () => {
    it('moves the documents to the top level and deletes the folder in one call', async () => {
      mockFolderRepo.findById.mockResolvedValue(baseFolder);

      await service.deleteFolder('folder-1', 'ch-1', 'user-1');

      expect(mockFolderRepo.deleteMovingDocuments).toHaveBeenCalledWith(
        'folder-1',
        'ch-1',
      );
      // Spec: no cascading delete of the files themselves.
      expect(mockStorageProvider.deleteFile).not.toHaveBeenCalled();
      expect(mockDocumentRepo.delete).not.toHaveBeenCalled();
    });

    it('answers 404 when the folder goes between the read and the delete', async () => {
      mockFolderRepo.findById.mockResolvedValue(baseFolder);
      mockFolderRepo.deleteMovingDocuments.mockResolvedValue(false);

      await expect(
        service.deleteFolder('folder-1', 'ch-1', 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException for a folder in another chapter', async () => {
      mockFolderRepo.findById.mockResolvedValue(null);

      await expect(
        service.deleteFolder('folder-1', 'ch-2', 'user-1'),
      ).rejects.toThrow(NotFoundException);
      expect(mockFolderRepo.deleteMovingDocuments).not.toHaveBeenCalled();
    });
  });

  describe('pins (#3934)', () => {
    it('pins an unpinned folder with the current time', async () => {
      mockFolderRepo.findById.mockResolvedValue(baseFolder);
      mockFolderRepo.setPinnedAt.mockImplementation(
        async (_id, _ch, pinnedAt) => ({ ...baseFolder, pinned_at: pinnedAt }),
      );
      const result = await service.setFolderPinned(
        'folder-1',
        'ch-1',
        'user-1',
        true,
      );
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
        service.setFolderPinned('folder-1', 'ch-1', 'user-1', true),
      ).resolves.toBe(pinned);
      expect(mockFolderRepo.setPinnedAt).not.toHaveBeenCalled();
    });

    it('unpins a pinned folder', async () => {
      mockFolderRepo.findById.mockResolvedValue({
        ...baseFolder,
        pinned_at: '2026-11-01T00:00:00.000Z',
      });
      mockFolderRepo.setPinnedAt.mockResolvedValue(baseFolder);
      await service.setFolderPinned('folder-1', 'ch-1', 'user-1', false);
      expect(mockFolderRepo.setPinnedAt).toHaveBeenCalledWith(
        'folder-1',
        'ch-1',
        null,
      );
    });

    it("refuses to pin a folder outside the caller's chapter", async () => {
      mockFolderRepo.findById.mockResolvedValue(null);
      await expect(
        service.setFolderPinned('folder-x', 'ch-1', 'user-1', true),
      ).rejects.toThrow(NotFoundException);
      expect(mockFolderRepo.setPinnedAt).not.toHaveBeenCalled();
    });

    it('answers 404 when the folder is deleted between the read and the pin', async () => {
      mockFolderRepo.findById.mockResolvedValue(baseFolder);
      mockFolderRepo.setPinnedAt.mockResolvedValue(null);
      await expect(
        service.setFolderPinned('folder-1', 'ch-1', 'user-1', true),
      ).rejects.toThrow(NotFoundException);
    });

    it('answers 404 when the document is deleted between the read and the pin', async () => {
      mockDocumentRepo.findById.mockResolvedValue(baseDocument);
      mockDocumentRepo.setPinnedAt.mockResolvedValue(null);
      await expect(
        service.setDocumentPinned('doc-1', 'ch-1', 'user-1', true),
      ).rejects.toThrow(NotFoundException);
    });

    it('pins and unpins a document', async () => {
      mockDocumentRepo.findById.mockResolvedValue(baseDocument);
      mockDocumentRepo.setPinnedAt.mockResolvedValue({
        ...baseDocument,
        pinned_at: '2026-11-11T00:00:00.000Z',
      });
      await service.setDocumentPinned('doc-1', 'ch-1', 'user-1', true);
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
      await service.setDocumentPinned('doc-1', 'ch-1', 'user-1', false);
      expect(mockDocumentRepo.setPinnedAt).toHaveBeenCalledWith(
        'doc-1',
        'ch-1',
        null,
      );
    });

    it('leaves an unpinned document alone when asked to unpin it', async () => {
      mockDocumentRepo.findById.mockResolvedValue(baseDocument);
      await expect(
        service.setDocumentPinned('doc-1', 'ch-1', 'user-1', false),
      ).resolves.toBe(baseDocument);
      expect(mockDocumentRepo.setPinnedAt).not.toHaveBeenCalled();
    });

    it("refuses to pin a document outside the caller's chapter", async () => {
      mockDocumentRepo.findById.mockResolvedValue(null);
      await expect(
        service.setDocumentPinned('doc-x', 'ch-1', 'user-1', true),
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
      mockFolderRepo.findByChapter.mockResolvedValue([baseFolder]);
      mockDocumentRepo.findByIds.mockResolvedValue([baseDocument]);
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

  // #3642 piece 1 (Paul 2026-11-16): who can see a folder or file.
  describe('who can see', () => {
    const execFolder: ChapterDocumentFolder = {
      ...baseFolder,
      id: 'folder-exec',
      name: 'Exec',
      who_can_see: ['tier:exec'],
    };
    const inExec: ChapterDocument = {
      ...baseDocument,
      id: 'doc-exec',
      folder: 'Exec',
      uploaded_by: 'user-9',
    };
    const treasurerOnly: ChapterDocument = {
      ...baseDocument,
      id: 'doc-budget',
      folder: 'Governance',
      uploaded_by: 'user-9',
      who_can_see: ['role:treasurer'],
    };

    beforeEach(() => {
      mockFolderRepo.findByChapter.mockResolvedValue([baseFolder, execFolder]);
      mockDocumentRepo.findByChapter.mockResolvedValue([
        baseDocument,
        inExec,
        treasurerOnly,
      ]);
    });

    const ids = (docs: ChapterDocument[]) => docs.map((doc) => doc.id);

    it("hides a file in a folder whose list the member isn't on, and one whose own list they aren't on", async () => {
      mockRbac.getChannelAccessHolder.mockResolvedValue(
        holder(['tier:member']),
      );
      await expect(
        service.findByChapter('ch-1', 'user-1').then(ids),
      ).resolves.toEqual(['doc-1']);
    });

    it('shows a file to a member on both its folder list and its own', async () => {
      mockRbac.getChannelAccessHolder.mockResolvedValue(
        holder(['tier:exec', 'role:treasurer']),
      );
      await expect(
        service.findByChapter('ch-1', 'user-1').then(ids),
      ).resolves.toEqual(['doc-1', 'doc-exec', 'doc-budget']);
    });

    it('shows its uploader a file whatever its lists say', async () => {
      await expect(
        service.findByChapter('ch-1', 'user-9').then(ids),
      ).resolves.toEqual(['doc-1', 'doc-exec', 'doc-budget']);
    });

    it('lets * through every list', async () => {
      mockRbac.getChannelAccessHolder.mockResolvedValue(holder([], true));
      await expect(
        service.findByChapter('ch-1', 'user-1').then(ids),
      ).resolves.toHaveLength(3);
    });

    it('answers 404 for a single file the member cannot see', async () => {
      mockDocumentRepo.findById.mockResolvedValue(inExec);
      await expect(
        service.findById('doc-exec', 'ch-1', 'user-1'),
      ).rejects.toThrow(NotFoundException);
      expect(
        mockStorageProvider.getSignedInlineAndAttachmentUrls,
      ).not.toHaveBeenCalled();
    });

    it('signs no preview for a file the member cannot see', async () => {
      mockDocumentRepo.findByIds.mockResolvedValue([inExec]);
      await expect(
        service.previewUrls(['doc-exec'], 'ch-1', 'user-1'),
      ).resolves.toEqual([]);
      expect(mockStorageProvider.getSignedDownloadUrls).not.toHaveBeenCalled();
    });

    it("leaves out a folder whose list the member isn't on", async () => {
      await expect(service.listFolders('ch-1', 'user-1')).resolves.toEqual([
        baseFolder,
      ]);
    });

    it("refuses an upload into a folder the uploader can't see", async () => {
      mockFolderRepo.findByName.mockResolvedValue(execFolder);
      await expect(
        service.confirmUpload({
          chapter_id: 'ch-1',
          title: 'Minutes',
          storage_path: 'chapters/ch-1/documents/doc-new/a.pdf',
          uploaded_by: 'user-1',
          folder: 'Exec',
        }),
      ).rejects.toThrow("You can't file into that folder");
      expect(mockDocumentRepo.create).not.toHaveBeenCalled();
    });

    it("answers 404 for deleting a folder the member can't see, managers included", async () => {
      mockFolderRepo.findById.mockResolvedValue(execFolder);
      await expect(
        service.deleteFolder('folder-exec', 'ch-1', 'user-1'),
      ).rejects.toThrow(NotFoundException);
      expect(mockFolderRepo.deleteMovingDocuments).not.toHaveBeenCalled();
    });

    it("answers 404 for deleting, pinning or starring a file the member can't see", async () => {
      mockDocumentRepo.findById.mockResolvedValue(inExec);
      await expect(
        service.delete('doc-exec', 'ch-1', 'user-1'),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.setDocumentPinned('doc-exec', 'ch-1', 'user-1', true),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.setDocumentStarred('user-1', 'ch-1', 'doc-exec', true),
      ).rejects.toThrow(NotFoundException);
      expect(mockDocumentRepo.delete).not.toHaveBeenCalled();
      expect(mockDocumentRepo.setPinnedAt).not.toHaveBeenCalled();
      expect(mockStarRepo.add).not.toHaveBeenCalled();
    });

    it("answers 404 for pinning or starring a folder the member can't see", async () => {
      mockFolderRepo.findById.mockResolvedValue(execFolder);
      await expect(
        service.setFolderPinned('folder-exec', 'ch-1', 'user-1', true),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.setFolderStarred('user-1', 'ch-1', 'folder-exec', true),
      ).rejects.toThrow(NotFoundException);
      expect(mockFolderRepo.setPinnedAt).not.toHaveBeenCalled();
      expect(mockStarRepo.add).not.toHaveBeenCalled();
    });

    it('leaves out stars on what the member can no longer see', async () => {
      const star = (folder_id: string | null, document_id: string | null) => ({
        id: `s-${folder_id ?? document_id}`,
        user_id: 'user-1',
        chapter_id: 'ch-1',
        folder_id,
        document_id,
        created_at: '2026-11-16T00:00:00.000Z',
      });
      mockStarRepo.findByUser.mockResolvedValue([
        star('folder-1', null),
        star('folder-exec', null),
        star(null, 'doc-1'),
        star(null, 'doc-exec'),
      ]);
      mockDocumentRepo.findByIds.mockResolvedValue([baseDocument, inExec]);
      await expect(service.listStars('user-1', 'ch-1')).resolves.toEqual({
        folder_ids: ['folder-1'],
        document_ids: ['doc-1'],
      });
    });

    it('files an upload with its checked list, from the single route and a batch', async () => {
      mockRbac.getRankContext.mockResolvedValue({
        reach: {
          rank: 1,
          wildcard: false,
          permissions: new Set(),
          memberId: 'm',
        },
        tiers: [
          { id: 'president', position: 0 },
          { id: 'exec', position: 1 },
        ],
        roles: [],
        positions: new Map(),
      });
      mockDocumentRepo.create.mockResolvedValue(baseDocument);
      const input = {
        chapter_id: 'ch-1',
        title: 'Budget',
        storage_path: 'chapters/ch-1/documents/doc-new/b.pdf',
        uploaded_by: 'user-1',
        who_can_see: ['role:treasurer'],
      };
      await service.confirmUpload(input);
      await service.confirmUploads([
        { ...input, storage_path: 'chapters/ch-1/documents/doc-2/c.pdf' },
      ]);
      expect(mockDocumentRepo.create).toHaveBeenCalledTimes(2);
      for (const [row] of mockDocumentRepo.create.mock.calls) {
        expect(row).toEqual(
          expect.objectContaining({
            who_can_see: ['role:treasurer', 'tier:exec', 'tier:president'],
          }),
        );
      }
    });

    it('reads no viewer when nothing in the library has a list', async () => {
      mockFolderRepo.findByChapter.mockResolvedValue([baseFolder]);
      mockDocumentRepo.findByChapter.mockResolvedValue([baseDocument]);
      await service.findByChapter('ch-1', 'user-1');
      await service.listFolders('ch-1', 'user-1');
      expect(mockRbac.getChannelAccessHolder).not.toHaveBeenCalled();
    });

    it('limits a folder synced from Google Drive like any other (#5220)', async () => {
      mockRbac.getRankContext.mockResolvedValue({
        reach: {
          rank: 0,
          wildcard: true,
          permissions: new Set(),
          memberId: 'm',
        },
        tiers: [],
        roles: [],
        positions: new Map(),
      });
      mockFolderRepo.findById.mockResolvedValue({
        ...baseFolder,
        drive_folder_id: 'drive-folder',
      });
      mockFolderRepo.update.mockResolvedValue({
        ...baseFolder,
        drive_folder_id: 'drive-folder',
        who_can_see: ['role:treasurer'],
      });
      await service.updateFolder('folder-1', 'ch-1', 'user-1', {
        who_can_see: ['role:treasurer'],
      });
      expect(mockFolderRepo.update).toHaveBeenCalledWith('folder-1', 'ch-1', {
        who_can_see: ['role:treasurer'],
      });
    });

    it('leaves renaming and deleting a synced folder to Google Drive (#5220)', async () => {
      const synced = { ...baseFolder, drive_folder_id: 'drive-folder' };
      mockFolderRepo.findById.mockResolvedValue(synced);
      mockFolderRepo.findByName.mockResolvedValue(null);
      await expect(
        service.updateFolder('folder-1', 'ch-1', 'user-1', { name: 'Exec' }),
      ).rejects.toThrow('Rename or delete it in Drive');
      await expect(
        service.deleteFolder('folder-1', 'ch-1', 'user-1'),
      ).rejects.toThrow('Rename or delete it in Drive');
      expect(mockFolderRepo.rename).not.toHaveBeenCalled();
      expect(mockFolderRepo.deleteMovingDocuments).not.toHaveBeenCalled();
    });

    describe('openUpDriveCopy (#5220)', () => {
      const held = {
        ...baseDocument,
        folder: 'Exec',
        drive_file_id: 'drive-1',
        drive_held_folder_id: 'folder-1',
      };

      it('moves a held copy into the folder Drive put it in', async () => {
        mockRbac.getChannelAccessHolder.mockResolvedValue(
          holder(['tier:exec']),
        );
        mockDocumentRepo.findById
          .mockResolvedValueOnce(held)
          .mockResolvedValueOnce({
            ...held,
            folder: 'Governance',
            drive_held_folder_id: null,
          });
        mockFolderRepo.findById.mockResolvedValue(baseFolder);

        const moved = await service.openUpDriveCopy('doc-1', 'ch-1', 'user-1');

        expect(mockDocumentRepo.updateDriveCopy).toHaveBeenCalledWith(
          'doc-1',
          'ch-1',
          { folder: 'Governance', drive_held_folder_id: null },
        );
        expect(moved.folder).toBe('Governance');
      });

      it('refuses a copy sync is not holding', async () => {
        mockRbac.getChannelAccessHolder.mockResolvedValue(
          holder(['tier:exec']),
        );
        mockDocumentRepo.findById.mockResolvedValue({
          ...held,
          drive_held_folder_id: null,
        });
        await expect(
          service.openUpDriveCopy('doc-1', 'ch-1', 'user-1'),
        ).rejects.toThrow(ConflictException);
        expect(mockDocumentRepo.updateDriveCopy).not.toHaveBeenCalled();
      });

      it("hides which folder Drive put a held copy in from a reader who can't see that folder", async () => {
        mockRbac.getChannelAccessHolder.mockResolvedValue(
          holder(['tier:exec']),
        );
        mockFolderRepo.findByChapter.mockResolvedValue([
          {
            ...baseFolder,
            id: 'exec',
            name: 'Exec',
            who_can_see: ['tier:exec'],
          },
          {
            ...baseFolder,
            id: 'folder-1',
            name: 'Treasury',
            who_can_see: ['role:treasurer'],
          },
          { ...baseFolder, id: 'open', name: 'Governance', who_can_see: null },
        ]);

        const [hidden] = await service.visibleTo('ch-1', 'user-1', [held]);
        expect(hidden.drive_held_folder_id).toBeNull();

        const [shown] = await service.visibleTo('ch-1', 'user-1', [
          { ...held, drive_held_folder_id: 'open' },
        ]);
        expect(shown.drive_held_folder_id).toBe('open');
      });

      it("answers 404 when the manager can't see the folder Drive put it in", async () => {
        mockRbac.getChannelAccessHolder.mockResolvedValue(
          holder(['tier:exec']),
        );
        mockDocumentRepo.findById.mockResolvedValue(held);
        mockFolderRepo.findById.mockResolvedValue({
          ...baseFolder,
          who_can_see: ['role:treasurer'],
        });
        await expect(
          service.openUpDriveCopy('doc-1', 'ch-1', 'user-1'),
        ).rejects.toThrow(NotFoundException);
        expect(mockDocumentRepo.updateDriveCopy).not.toHaveBeenCalled();
      });
    });

    it("lets whoever connected Google Drive change no copy's list as its uploader", async () => {
      mockRbac.getChannelAccessHolder.mockResolvedValue(holder(['tier:exec']));
      mockDocumentRepo.findById.mockResolvedValue({
        ...inExec,
        uploaded_by: 'user-1',
        drive_file_id: 'drive-1',
      });
      await expect(
        service.setDocumentAccess('doc-exec', 'ch-1', 'user-1', null),
      ).rejects.toThrow('Only whoever uploaded a file');
    });

    it("answers 404 for a folder the member can't see, so a manager can't change it", async () => {
      mockFolderRepo.findById.mockResolvedValue(execFolder);
      await expect(
        service.updateFolder('folder-exec', 'ch-1', 'user-1', {
          who_can_see: null,
        }),
      ).rejects.toThrow(NotFoundException);
      expect(mockFolderRepo.update).not.toHaveBeenCalled();
    });

    describe('setting a list', () => {
      const tiers = [
        { id: 'president', position: 0 },
        { id: 'exec', position: 1 },
        { id: 'member', position: 2 },
      ];
      const rankedAt = (rank: number, wildcard = false) =>
        mockRbac.getRankContext.mockResolvedValue({
          reach: { rank, wildcard, permissions: new Set(), memberId: 'm-1' },
          tiers,
          roles: [],
          positions: new Map(),
        });

      beforeEach(() => {
        mockDocumentRepo.findById.mockResolvedValue(baseDocument);
        mockDocumentRepo.setWhoCanSee.mockImplementation(
          async (_id, _chapter, list) => ({
            ...baseDocument,
            who_can_see: list,
          }),
        );
      });

      it("keeps the setter's tier and every tier above it on the list", async () => {
        rankedAt(1);
        const result = await service.setDocumentAccess(
          'doc-1',
          'ch-1',
          'user-1',
          ['role:treasurer'],
        );
        expect(result.who_can_see).toEqual([
          'role:treasurer',
          'tier:exec',
          'tier:president',
        ]);
      });

      it('adds no tier for *', async () => {
        rankedAt(Infinity, true);
        const result = await service.setDocumentAccess(
          'doc-1',
          'ch-1',
          'user-1',
          ['role:treasurer'],
        );
        expect(result.who_can_see).toEqual(['role:treasurer']);
      });

      it('refuses a list from a member outside every tier', async () => {
        rankedAt(Infinity);
        await expect(
          service.setDocumentAccess('doc-1', 'ch-1', 'user-1', [
            'role:treasurer',
          ]),
        ).rejects.toThrow("You can't limit who sees a file");
        expect(mockDocumentRepo.setWhoCanSee).not.toHaveBeenCalled();
      });

      it("puts a file back to its folder's answer with null", async () => {
        await service.setDocumentAccess('doc-1', 'ch-1', 'user-1', null);
        expect(mockDocumentRepo.setWhoCanSee).toHaveBeenCalledWith(
          'doc-1',
          'ch-1',
          null,
        );
        expect(mockRbac.getRankContext).not.toHaveBeenCalled();
      });

      it('refuses someone who neither uploaded the file nor manages documents', async () => {
        mockDocumentRepo.findById.mockResolvedValue({
          ...baseDocument,
          uploaded_by: 'user-9',
        });
        await expect(
          service.setDocumentAccess('doc-1', 'ch-1', 'user-1', null),
        ).rejects.toThrow('Only whoever uploaded a file');
        expect(mockRbac.memberHasAnyPermission).toHaveBeenCalledWith(
          'ch-1',
          'user-1',
          ['chapter_docs:manage'],
        );
        expect(mockDocumentRepo.setWhoCanSee).not.toHaveBeenCalled();
      });

      it('lets a member who manages documents set it on a file they see', async () => {
        mockDocumentRepo.findById.mockResolvedValue({
          ...baseDocument,
          uploaded_by: 'user-9',
        });
        mockRbac.memberHasAnyPermission.mockResolvedValue(true);
        await service.setDocumentAccess('doc-1', 'ch-1', 'user-1', null);
        expect(mockDocumentRepo.setWhoCanSee).toHaveBeenCalled();
      });

      it('validates the list as a channel list is', async () => {
        rankedAt(1);
        mockAccessLists.normalize.mockRejectedValue(
          new BadRequestException('Unknown role'),
        );
        await expect(
          service.setDocumentAccess('doc-1', 'ch-1', 'user-1', ['role:x']),
        ).rejects.toThrow('Unknown role');
      });

      it('stores a new folder with the checked list', async () => {
        rankedAt(1);
        await service.createFolder('ch-1', 'Exec', undefined, 'user-1', [
          'role:treasurer',
        ]);
        expect(mockFolderRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            who_can_see: ['role:treasurer', 'tier:exec', 'tier:president'],
          }),
        );
      });

      it('offers the options and the tiers a list keeps', async () => {
        rankedAt(2);
        mockAccessLists.listOptions.mockResolvedValue([
          {
            entry: 'role:treasurer',
            kind: 'role',
            id: 'treasurer',
            name: 'Treasurer',
          },
        ]);
        await expect(service.accessOptions('ch-1', 'user-1')).resolves.toEqual({
          options: [
            {
              entry: 'role:treasurer',
              kind: 'role',
              id: 'treasurer',
              name: 'Treasurer',
            },
          ],
          always: ['tier:president', 'tier:exec', 'tier:member'],
        });
      });
    });
  });

  // #5563: rename a file and move it to another folder after upload.
  describe('renaming and moving', () => {
    const driveCopy: ChapterDocument = {
      ...baseDocument,
      id: 'doc-drive',
      drive_file_id: 'drive-1',
    };
    const linked: ChapterDocument = {
      ...baseDocument,
      id: 'doc-linked',
      drive_file_id: 'drive-2',
      drive_link_status: 'active',
    };

    beforeEach(() => {
      mockDocumentRepo.findById.mockResolvedValue(baseDocument);
      mockDocumentRepo.updateFiling.mockImplementation(
        async (_id, _chapter, patch) => ({ ...baseDocument, ...patch }),
      );
    });

    it('renames its own upload, trimmed', async () => {
      const result = await service.updateDocument('doc-1', 'ch-1', 'user-1', {
        title: '  Bylaws 2026  ',
      });
      expect(mockDocumentRepo.updateFiling).toHaveBeenCalledWith(
        'doc-1',
        'ch-1',
        { title: 'Bylaws 2026' },
      );
      expect(result.title).toBe('Bylaws 2026');
      expect(mockRbac.memberHasAnyPermission).not.toHaveBeenCalled();
    });

    it("moves a file into another folder, making a folder that doesn't exist yet", async () => {
      await service.updateDocument('doc-1', 'ch-1', 'user-1', {
        folder: ' Rush ',
      });
      expect(mockFolderRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ chapter_id: 'ch-1', name: 'Rush' }),
      );
      expect(mockDocumentRepo.updateFiling).toHaveBeenCalledWith(
        'doc-1',
        'ch-1',
        { folder: 'Rush' },
      );
    });

    it('moves a file out of every folder with null', async () => {
      await service.updateDocument('doc-1', 'ch-1', 'user-1', {
        folder: null,
      });
      expect(mockDocumentRepo.updateFiling).toHaveBeenCalledWith(
        'doc-1',
        'ch-1',
        { folder: null },
      );
      expect(mockFolderRepo.create).not.toHaveBeenCalled();
    });

    it('writes nothing when nothing changes', async () => {
      const result = await service.updateDocument('doc-1', 'ch-1', 'user-1', {
        title: 'Bylaws 2025',
        folder: 'Governance',
      });
      expect(result).toBe(baseDocument);
      expect(mockDocumentRepo.updateFiling).not.toHaveBeenCalled();
    });

    it('refuses an empty change and an empty name', async () => {
      await expect(
        service.updateDocument('doc-1', 'ch-1', 'user-1', {}),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.updateDocument('doc-1', 'ch-1', 'user-1', { title: '   ' }),
      ).rejects.toThrow('A file needs a name');
    });

    it("lets someone who manages documents refile another member's upload", async () => {
      mockRbac.memberHasAnyPermission.mockResolvedValue(true);
      await service.updateDocument('doc-1', 'ch-1', 'user-2', {
        folder: 'Rush',
      });
      expect(mockRbac.memberHasAnyPermission).toHaveBeenCalledWith(
        'ch-1',
        'user-2',
        ['chapter_docs:manage'],
      );
      expect(mockDocumentRepo.updateFiling).toHaveBeenCalled();
    });

    it("refuses another member's upload to someone who doesn't manage documents", async () => {
      await expect(
        service.updateDocument('doc-1', 'ch-1', 'user-2', { title: 'Mine' }),
      ).rejects.toThrow('Only whoever uploaded a file');
      expect(mockDocumentRepo.updateFiling).not.toHaveBeenCalled();
    });

    it('refuses a copy from the Google Drive folder, even to its connector', async () => {
      mockDocumentRepo.findById.mockResolvedValue(driveCopy);
      mockRbac.memberHasAnyPermission.mockResolvedValue(true);
      await expect(
        service.updateDocument('doc-drive', 'ch-1', 'user-1', {
          folder: 'Rush',
        }),
      ).rejects.toThrow(ConflictException);
      expect(mockDocumentRepo.updateFiling).not.toHaveBeenCalled();
    });

    it("keeps Drive's name on a linked file but lets it move", async () => {
      mockDocumentRepo.findById.mockResolvedValue(linked);
      await expect(
        service.updateDocument('doc-linked', 'ch-1', 'user-1', {
          title: 'Renamed',
        }),
      ).rejects.toThrow('Rename it in Drive');
      await service.updateDocument('doc-linked', 'ch-1', 'user-1', {
        folder: 'Rush',
      });
      expect(mockDocumentRepo.updateFiling).toHaveBeenCalledWith(
        'doc-linked',
        'ch-1',
        { folder: 'Rush' },
      );
    });

    it("answers 404 for a file the member can't see", async () => {
      mockFolderRepo.findByChapter.mockResolvedValue([
        { ...baseFolder, who_can_see: ['tier:exec'] },
      ]);
      mockRbac.getChannelAccessHolder.mockResolvedValue(holder());
      mockDocumentRepo.findById.mockResolvedValue({
        ...baseDocument,
        uploaded_by: 'user-2',
      });
      await expect(
        service.updateDocument('doc-1', 'ch-1', 'user-1', { title: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });

    it("refuses a move into a folder the member can't see", async () => {
      mockFolderRepo.findByName.mockResolvedValue({
        ...baseFolder,
        id: 'folder-exec',
        name: 'Exec',
        who_can_see: ['tier:exec'],
      });
      await expect(
        service.updateDocument('doc-1', 'ch-1', 'user-1', { folder: 'Exec' }),
      ).rejects.toThrow("You can't file into that folder");
      expect(mockDocumentRepo.updateFiling).not.toHaveBeenCalled();
    });

    describe('many at once', () => {
      const second: ChapterDocument = { ...baseDocument, id: 'doc-2' };

      beforeEach(() => {
        mockDocumentRepo.moveMany.mockImplementation(
          async (ids, _chapter, folder) =>
            ids.map((id) => ({ ...baseDocument, id, folder })),
        );
      });

      it('moves every file, once each', async () => {
        mockDocumentRepo.findByIds.mockResolvedValue([baseDocument, second]);
        const moved = await service.moveDocuments(
          ['doc-1', 'doc-2', 'doc-1'],
          'ch-1',
          'user-1',
          'Rush',
        );
        expect(mockDocumentRepo.moveMany).toHaveBeenCalledWith(
          ['doc-1', 'doc-2'],
          'ch-1',
          'Rush',
        );
        expect(moved.map((doc) => doc.folder)).toEqual(['Rush', 'Rush']);
      });

      it('moves none when one is missing or hidden', async () => {
        mockDocumentRepo.findByIds.mockResolvedValue([baseDocument]);
        await expect(
          service.moveDocuments(['doc-1', 'doc-2'], 'ch-1', 'user-1', 'Rush'),
        ).rejects.toThrow(NotFoundException);
        expect(mockDocumentRepo.moveMany).not.toHaveBeenCalled();
      });

      it('moves none when one comes from the Google Drive folder', async () => {
        mockDocumentRepo.findByIds.mockResolvedValue([baseDocument, driveCopy]);
        await expect(
          service.moveDocuments(
            ['doc-1', 'doc-drive'],
            'ch-1',
            'user-1',
            'Rush',
          ),
        ).rejects.toThrow(ConflictException);
        expect(mockDocumentRepo.moveMany).not.toHaveBeenCalled();
      });

      it("needs Manage documents once any file is someone else's", async () => {
        mockDocumentRepo.findByIds.mockResolvedValue([
          baseDocument,
          { ...second, uploaded_by: 'user-2' },
        ]);
        await expect(
          service.moveDocuments(['doc-1', 'doc-2'], 'ch-1', 'user-1', null),
        ).rejects.toThrow('Only whoever uploaded a file');
        mockRbac.memberHasAnyPermission.mockResolvedValue(true);
        await service.moveDocuments(['doc-1', 'doc-2'], 'ch-1', 'user-1', null);
        expect(mockDocumentRepo.moveMany).toHaveBeenCalledWith(
          ['doc-1', 'doc-2'],
          'ch-1',
          null,
        );
      });
    });
  });
});
