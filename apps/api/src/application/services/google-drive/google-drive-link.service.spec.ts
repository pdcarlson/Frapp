import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  GoogleDriveApiError,
  type GoogleDriveItem,
  type IGoogleDriveApi,
} from '#domain/adapters/google-drive.interface';
import type { IStorageProvider } from '#domain/adapters/storage.interface';
import type { IChapterDocumentRepository } from '#domain/repositories/chapter-document.repository.interface';
import type { IChapterDriveLinkRepository } from '#domain/repositories/chapter-drive-link.repository.interface';
import type { ChapterDocument } from '#domain/entities/chapter-document.entity';
import type { ChapterDriveLink } from '#domain/entities/chapter-drive-link.entity';
import type { ChapterDocumentService } from '../chapter-document.service';
import {
  GoogleDriveLinkService,
  parseDriveFileLink,
} from './google-drive-link.service';

const NOW = new Date('2026-11-17T20:00:00.000Z');
const EMAIL = 'frapp-docs@cs-project-6vw9f5xp.iam.gserviceaccount.com';
const FILE_ID = '1AbCdEfGhIjKlMnOpQrStUv';
const DOC_LINK = `https://docs.google.com/document/d/${FILE_ID}/edit?usp=sharing`;
const CODE = 'frapp-ab12cd34';

const googleDoc = (over: Partial<GoogleDriveItem> = {}): GoogleDriveItem => ({
  id: FILE_ID,
  name: 'Bylaws',
  mimeType: 'application/vnd.google-apps.document',
  modifiedTime: '2026-11-17T19:00:00.000Z',
  size: null,
  webViewLink: `https://docs.google.com/document/d/${FILE_ID}/edit`,
  description: null,
  parents: [],
  permissionIds: ['anyoneWithLink', '0123'],
  trashed: false,
  ...over,
});

const doc = (over: Partial<ChapterDocument> = {}): ChapterDocument => ({
  id: 'doc-1',
  chapter_id: 'ch-1',
  title: 'Bylaws',
  description: null,
  folder: null,
  storage_path: 'chapters/ch-1/documents/old/Bylaws.pdf',
  uploaded_by: 'user-1',
  created_at: NOW.toISOString(),
  content_type: 'application/pdf',
  byte_size: 3,
  document_type: null,
  effective_date: null,
  pinned_at: null,
  drive_file_id: FILE_ID,
  drive_modified_at: '2026-11-17T19:00:00+00:00',
  drive_url: null,
  drive_held_folder_id: null,
  drive_link_status: 'active',
  drive_synced_at: NOW.toISOString(),
  who_can_see: null,
  ...over,
});

const link = (over: Partial<ChapterDriveLink> = {}): ChapterDriveLink => ({
  id: 'link-1',
  chapter_id: 'ch-1',
  document_id: 'doc-1',
  file_id: FILE_ID,
  resource_key: null,
  linked_by: 'user-1',
  proven: false,
  sync_due_at: NOW.toISOString(),
  sync_lease_until: null,
  last_error: null,
  created_at: NOW.toISOString(),
  ...over,
});

describe('parseDriveFileLink', () => {
  it.each([
    [DOC_LINK, FILE_ID],
    [`https://docs.google.com/spreadsheets/d/${FILE_ID}/edit#gid=0`, FILE_ID],
    [`https://docs.google.com/presentation/u/1/d/${FILE_ID}/edit`, FILE_ID],
    [`https://drive.google.com/file/d/${FILE_ID}/view?usp=drive_link`, FILE_ID],
    [`https://drive.google.com/open?id=${FILE_ID}`, FILE_ID],
    [`https://drive.google.com/uc?id=${FILE_ID}&export=download`, FILE_ID],
    [`  ${FILE_ID}  `, FILE_ID],
  ])('reads the file id in %s', (input, id) => {
    expect(parseDriveFileLink(input)).toEqual({
      kind: 'file',
      fileId: id,
      resourceKey: null,
    });
  });

  it('keeps a resource key the link carries', () => {
    expect(
      parseDriveFileLink(
        `https://drive.google.com/file/d/${FILE_ID}/view?resourcekey=0-AbC_d`,
      ),
    ).toEqual({ kind: 'file', fileId: FILE_ID, resourceKey: '0-AbC_d' });
  });

  it('tells a folder link apart', () => {
    expect(
      parseDriveFileLink(`https://drive.google.com/drive/folders/${FILE_ID}`),
    ).toEqual({ kind: 'folder' });
  });

  it.each([
    'https://example.com/document/d/1AbCdEfGhIjKlMnOp/edit',
    'https://docs.google.com/document/d/e/2PACX-1vPublished/pub',
    'javascript:alert(1)',
    'not a link',
    `https://drive.google.com/drive/my-drive?id=${FILE_ID}`,
  ])('refuses %s', (input) => {
    expect(parseDriveFileLink(input)).toBeNull();
  });
});

describe('GoogleDriveLinkService', () => {
  let drive: jest.Mocked<IGoogleDriveApi>;
  let links: jest.Mocked<IChapterDriveLinkRepository>;
  let documentRepo: jest.Mocked<
    Pick<
      IChapterDocumentRepository,
      'create' | 'delete' | 'findById' | 'findByDriveFileId' | 'updateDriveCopy'
    >
  >;
  let storage: jest.Mocked<Pick<IStorageProvider, 'uploadFile' | 'deleteFile'>>;
  let documents: jest.Mocked<
    Pick<ChapterDocumentService, 'checkedFiling' | 'ensureFolder' | 'findById'>
  >;
  let service: GoogleDriveLinkService;

  beforeEach(() => {
    drive = {
      isConfigured: jest.fn().mockReturnValue(true),
      serviceAccountEmail: jest.fn().mockReturnValue(EMAIL),
      proofCode: jest.fn().mockReturnValue(CODE),
      getItem: jest.fn().mockResolvedValue(googleDoc()),
      listChildren: jest.fn(),
      download: jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      exportAs: jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4])),
      userTokenInfo: jest.fn(),
      getItemAs: jest.fn(),
      shareWithServiceAccount: jest.fn(),
      unshare: jest.fn(),
    };
    links = {
      create: jest.fn().mockResolvedValue(link()),
      findByDocument: jest.fn(),
      markDue: jest.fn().mockResolvedValue(true),
      claim: jest.fn(),
      finish: jest.fn().mockResolvedValue(undefined),
    };
    documentRepo = {
      create: jest.fn((data) => Promise.resolve(doc(data))),
      delete: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn().mockResolvedValue(doc()),
      findByDriveFileId: jest.fn().mockResolvedValue(null),
      updateDriveCopy: jest.fn().mockResolvedValue(true),
    };
    storage = {
      uploadFile: jest.fn().mockResolvedValue(undefined),
      deleteFile: jest.fn().mockResolvedValue(undefined),
    };
    documents = {
      checkedFiling: jest.fn().mockResolvedValue(null),
      ensureFolder: jest.fn().mockResolvedValue({}),
      findById: jest.fn().mockResolvedValue({}),
    };
    service = new GoogleDriveLinkService(
      drive,
      links,
      documentRepo as unknown as IChapterDocumentRepository,
      storage as unknown as IStorageProvider,
      documents as unknown as ChapterDocumentService,
    );
  });

  describe('add', () => {
    it('copies a Doc anyone with the link can open as a PDF, filed and linked', async () => {
      const added = await service.add(
        'ch-1',
        'user-1',
        { link: DOC_LINK, folder: ' Governance ', who_can_see: ['tier:exec'] },
        NOW,
      );

      expect(documents.checkedFiling).toHaveBeenCalledWith(
        'ch-1',
        'user-1',
        'Governance',
        ['tier:exec'],
      );
      expect(drive.exportAs).toHaveBeenCalledWith(
        FILE_ID,
        'application/pdf',
        expect.any(Number),
        null,
      );
      expect(storage.uploadFile).toHaveBeenCalledWith(
        'documents',
        expect.stringMatching(
          /^chapters\/ch-1\/documents\/[^/]+\/Bylaws\.pdf$/,
        ),
        expect.any(Uint8Array),
        'application/pdf',
      );
      expect(documents.ensureFolder).toHaveBeenCalledWith('Governance', 'ch-1');
      expect(documentRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Bylaws',
          folder: 'Governance',
          uploaded_by: 'user-1',
          drive_file_id: FILE_ID,
          drive_link_status: 'active',
          drive_synced_at: NOW.toISOString(),
          byte_size: 4,
        }),
      );
      expect(links.create).toHaveBeenCalledWith(
        expect.objectContaining({ file_id: FILE_ID, proven: false }),
      );
      expect(drive.proofCode).not.toHaveBeenCalled();
      expect(added.drive_link_status).toBe('active');
    });

    it('asks a file not open to anyone with the link for the chapter’s code', async () => {
      drive.getItem.mockResolvedValue(googleDoc({ permissionIds: ['0123'] }));

      await expect(
        service.add('ch-1', 'user-1', { link: DOC_LINK }),
      ).rejects.toThrow(CODE);
      expect(drive.proofCode).toHaveBeenCalledWith(`ch-1:${FILE_ID}`);
      expect(storage.uploadFile).not.toHaveBeenCalled();
    });

    it('takes a restricted file once its name holds the code, and marks it proven', async () => {
      drive.getItem.mockResolvedValue(
        googleDoc({ permissionIds: [], name: 'Bylaws FRAPP-AB12-CD34' }),
      );

      await service.add('ch-1', 'user-1', { link: DOC_LINK });

      expect(links.create).toHaveBeenCalledWith(
        expect.objectContaining({ proven: true }),
      );
    });

    // #5434 review: Frapp's account reads a file shared with it directly
    // without the resource key a link needs since Google's 2021 update, so a
    // bare id must not stand in for a working link.
    it('asks for the code when the file needs a resource key the pasted link lacks', async () => {
      drive.getItem.mockResolvedValue(googleDoc({ resourceKey: '0-key' }));

      await expect(
        service.add('ch-1', 'user-1', { link: FILE_ID }),
      ).rejects.toThrow(CODE);

      await service.add('ch-1', 'user-1', {
        link: `https://drive.google.com/file/d/${FILE_ID}/view?resourcekey=0-key`,
      });
      expect(links.create).toHaveBeenCalledWith(
        expect.objectContaining({ proven: false, resource_key: '0-key' }),
      );
    });

    it('names no title when refusing a file already in Documents, and only after the proof', async () => {
      documentRepo.findByDriveFileId.mockResolvedValue(
        doc({ title: 'Exec minutes', drive_link_status: null }),
      );
      drive.getItem.mockResolvedValue(googleDoc({ permissionIds: [] }));
      await expect(
        service.add('ch-1', 'user-1', { link: DOC_LINK }),
      ).rejects.toThrow(CODE);
      expect(documentRepo.findByDriveFileId).not.toHaveBeenCalled();

      drive.getItem.mockResolvedValue(googleDoc());
      const refusal = service.add('ch-1', 'user-1', { link: DOC_LINK });
      await expect(refusal).rejects.toThrow(ConflictException);
      await expect(refusal).rejects.not.toThrow('Exec minutes');
    });

    it('says what to do with a file Frapp can’t open', async () => {
      drive.getItem.mockRejectedValue(
        new GoogleDriveApiError('not_found', 404, 'notFound'),
      );

      await expect(
        service.add('ch-1', 'user-1', { link: DOC_LINK }),
      ).rejects.toThrow(EMAIL);
    });

    it('refuses a folder link, a form, and a file already in Documents', async () => {
      await expect(
        service.add('ch-1', 'user-1', {
          link: `https://drive.google.com/drive/folders/${FILE_ID}`,
        }),
      ).rejects.toThrow(BadRequestException);

      drive.getItem.mockResolvedValue(
        googleDoc({ mimeType: 'application/vnd.google-apps.form' }),
      );
      await expect(
        service.add('ch-1', 'user-1', { link: DOC_LINK }),
      ).rejects.toThrow('can’t hold that file');

      drive.getItem.mockResolvedValue(googleDoc());
      documentRepo.findByDriveFileId.mockResolvedValue(
        doc({ drive_link_status: null, title: 'Bylaws (folder)' }),
      );
      await expect(
        service.add('ch-1', 'user-1', { link: DOC_LINK }),
      ).rejects.toThrow(ConflictException);
      expect(storage.uploadFile).not.toHaveBeenCalled();
    });

    it('is unavailable while Drive is off here', async () => {
      drive.isConfigured.mockReturnValue(false);
      await expect(
        service.add('ch-1', 'user-1', { link: DOC_LINK }),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('leaves no document or stored file behind when the link can’t be saved', async () => {
      links.create.mockRejectedValue(new Error('db down'));

      await expect(
        service.add('ch-1', 'user-1', { link: DOC_LINK }),
      ).rejects.toThrow('db down');
      expect(documentRepo.delete).toHaveBeenCalledWith('doc-1', 'ch-1');
      expect(storage.deleteFile).toHaveBeenCalledWith(
        'documents',
        expect.stringContaining('chapters/ch-1/documents/'),
      );
    });
  });

  describe('process', () => {
    it('only stamps the synced time when Drive’s copy hasn’t changed', async () => {
      await expect(service.process(link(), NOW)).resolves.toBe('unchanged');
      expect(drive.exportAs).not.toHaveBeenCalled();
      expect(documentRepo.updateDriveCopy).toHaveBeenCalledWith(
        'doc-1',
        'ch-1',
        expect.objectContaining({
          drive_link_status: 'active',
          drive_synced_at: NOW.toISOString(),
        }),
      );
      expect(links.finish).toHaveBeenCalledWith('link-1', { last_error: null });
    });

    it('copies an edited file again in place and drops the old stored file', async () => {
      drive.getItem.mockResolvedValue(
        googleDoc({
          modifiedTime: '2026-11-17T19:30:00.000Z',
          name: 'Bylaws v2',
        }),
      );

      await expect(service.process(link(), NOW)).resolves.toBe('updated');
      expect(documentRepo.updateDriveCopy).toHaveBeenCalledWith(
        'doc-1',
        'ch-1',
        expect.objectContaining({
          title: 'Bylaws v2',
          storage_path: expect.stringMatching(/Bylaws v2\.pdf$/),
          drive_modified_at: '2026-11-17T19:30:00.000Z',
        }),
      );
      expect(storage.deleteFile).toHaveBeenCalledWith(
        'documents',
        'chapters/ch-1/documents/old/Bylaws.pdf',
      );
    });

    it('marks a file Frapp can no longer see, keeping the copy', async () => {
      drive.getItem.mockRejectedValue(
        new GoogleDriveApiError('not_found', 404, 'notFound'),
      );

      await expect(service.process(link(), NOW)).resolves.toBe('no_access');
      expect(documentRepo.updateDriveCopy).toHaveBeenCalledWith(
        'doc-1',
        'ch-1',
        { drive_link_status: 'no_access' },
      );
      expect(storage.deleteFile).not.toHaveBeenCalled();
    });

    // A file added because anyone with the link could open it stops at that,
    // so a later private version shared with Frapp by its owner for their
    // own chapter never flows into this one.
    it('stops following an unproven file once it is no longer open to the link', async () => {
      drive.getItem.mockResolvedValue(
        googleDoc({
          permissionIds: ['0123'],
          modifiedTime: '2026-11-17T19:30:00.000Z',
        }),
      );

      await expect(service.process(link(), NOW)).resolves.toBe('no_access');
      expect(drive.exportAs).not.toHaveBeenCalled();
      expect(links.finish).toHaveBeenCalledWith('link-1', {
        last_error: 'not_shared_by_link',
      });

      drive.getItem.mockClear();
      await expect(service.process(link({ proven: true }), NOW)).resolves.toBe(
        'updated',
      );
    });

    it('treats a file in the Drive trash as gone from Frapp’s view', async () => {
      drive.getItem.mockResolvedValue(googleDoc({ trashed: true }));
      await expect(service.process(link(), NOW)).resolves.toBe('no_access');
    });

    it('keeps the last copy when the file grew past what Documents holds', async () => {
      drive.getItem.mockResolvedValue(
        googleDoc({ modifiedTime: '2026-11-17T19:30:00.000Z' }),
      );
      drive.exportAs.mockRejectedValue(
        new GoogleDriveApiError('too_large', null, 'over_limit'),
      );

      await expect(service.process(link(), NOW)).resolves.toBe('kept');
      expect(documentRepo.updateDriveCopy).not.toHaveBeenCalled();
      expect(links.finish).toHaveBeenCalledWith('link-1', {
        last_error: 'too_large',
      });
    });

    it('backs off five minutes when Google says to slow down', async () => {
      drive.getItem.mockRejectedValue(
        new GoogleDriveApiError('rate_limited', 429, 'rateLimitExceeded'),
      );

      await expect(service.process(link(), NOW)).resolves.toBe('rate_limited');
      expect(links.finish).toHaveBeenCalledWith('link-1', {
        last_error: 'rate_limited',
        sync_due_at: '2026-11-17T20:05:00.000Z',
      });
    });

    it('drops the new copy when the document was deleted while it was made', async () => {
      drive.getItem.mockResolvedValue(
        googleDoc({ modifiedTime: '2026-11-17T19:30:00.000Z' }),
      );
      documentRepo.updateDriveCopy.mockResolvedValue(false);

      await expect(service.process(link(), NOW)).resolves.toBe('gone');
      const fresh = storage.uploadFile.mock.calls[0][1];
      expect(storage.deleteFile).toHaveBeenCalledWith('documents', fresh);
      expect(storage.deleteFile).not.toHaveBeenCalledWith(
        'documents',
        'chapters/ch-1/documents/old/Bylaws.pdf',
      );
    });

    it('stops following an unproven file whose link no longer carries its key', async () => {
      drive.getItem.mockResolvedValue(googleDoc({ resourceKey: '0-key' }));
      await expect(service.process(link(), NOW)).resolves.toBe('no_access');
      await expect(
        service.process(link({ resource_key: '0-key' }), NOW),
      ).resolves.toBe('unchanged');
    });

    it('does nothing for a document deleted mid-check', async () => {
      documentRepo.findById.mockResolvedValue(null);
      await expect(service.process(link(), NOW)).resolves.toBe('gone');
      expect(drive.getItem).not.toHaveBeenCalled();
    });
  });

  it('checks a document now only when the member sees it and it is linked', async () => {
    await service.syncNow('doc-1', 'ch-1', 'user-1');
    expect(documents.findById).toHaveBeenCalledWith('doc-1', 'ch-1', 'user-1');
    expect(links.markDue).toHaveBeenCalledWith(
      'doc-1',
      'ch-1',
      expect.any(Date),
    );

    links.markDue.mockResolvedValue(false);
    await expect(service.syncNow('doc-1', 'ch-1', 'user-1')).rejects.toThrow(
      'isn’t linked',
    );
  });
});
