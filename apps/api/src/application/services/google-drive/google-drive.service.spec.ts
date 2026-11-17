import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  GOOGLE_DRIVE_FOLDER_MIME,
  GoogleDriveApiError,
  type GoogleDriveItem,
  type IGoogleDriveApi,
} from '#domain/adapters/google-drive.interface';
import type { IChapterDriveRepository } from '#domain/repositories/chapter-drive.repository.interface';
import type { ChapterDriveConnection } from '#domain/entities/chapter-drive-connection.entity';
import { GoogleDriveService, parseDriveFolderId } from './google-drive.service';
import type { ChapterDocumentService } from '../chapter-document.service';

const FOLDER_ID = '1AbCdEfGhIjKlMnOp';
const EMAIL = 'frapp-docs@signet-frapp.iam.gserviceaccount.com';
const CODE = 'frapp-k3x9qm2p';

const live = (
  over: Partial<ChapterDriveConnection> = {},
): ChapterDriveConnection => ({
  id: 'conn-1',
  chapter_id: 'ch-1',
  folder_id: FOLDER_ID,
  folder_name: 'Chapter files',
  connected_by: 'user-1',
  status: 'active',
  sync_due_at: '2026-11-16T16:00:00.000Z',
  sync_lease_until: null,
  last_synced_at: '2026-11-16T15:45:00.000Z',
  last_error: null,
  synced_count: 12,
  skipped_count: 1,
  folders_left_out: 2,
  created_at: '2026-11-16T15:00:00.000Z',
  who_can_see: null,
  ...over,
});

describe('GoogleDriveService', () => {
  let drive: jest.Mocked<IGoogleDriveApi>;
  let repo: jest.Mocked<IChapterDriveRepository>;
  let documents: jest.Mocked<ChapterDocumentService>;
  let service: GoogleDriveService;

  beforeEach(() => {
    drive = {
      isConfigured: jest.fn().mockReturnValue(true),
      serviceAccountEmail: jest.fn().mockReturnValue(EMAIL),
      proofCode: jest.fn().mockReturnValue(CODE),
      getItem: jest.fn().mockResolvedValue({
        id: FOLDER_ID,
        name: `Chapter files ${CODE}`,
        mimeType: GOOGLE_DRIVE_FOLDER_MIME,
        modifiedTime: '',
        size: null,
        webViewLink: null,
        description: null,
        parents: [],
      }),
      listChildren: jest.fn().mockResolvedValue([]),
      download: jest.fn(),
      exportAs: jest.fn(),
    };
    repo = {
      findLive: jest.fn().mockResolvedValue(null),
      findAny: jest.fn().mockResolvedValue(null),
      folderTakenElsewhere: jest.fn().mockResolvedValue(false),
      liveFolderIdsElsewhere: jest.fn().mockResolvedValue(new Set()),
      create: jest.fn().mockResolvedValue(live()),
      markDue: jest.fn().mockResolvedValue(true),
      disconnect: jest.fn().mockResolvedValue(true),
      claim: jest.fn(),
      finishSync: jest.fn(),
      releaseLease: jest.fn(),
      delete: jest.fn(),
    };
    documents = {
      checkedList: jest.fn(async (_c: string, _u: string, list) => list),
    } as unknown as jest.Mocked<ChapterDocumentService>;
    service = new GoogleDriveService(drive, repo, documents);
  });

  it('reports the connection, with the folder link and whether a sync is due', async () => {
    repo.findLive.mockResolvedValue(live());

    const status = await service.status(
      'ch-1',
      new Date('2026-11-16T15:50:00.000Z'),
    );

    expect(status).toEqual({
      available: true,
      service_account_email: EMAIL,
      connection: {
        folder_id: FOLDER_ID,
        folder_name: 'Chapter files',
        folder_url: `https://drive.google.com/drive/folders/${FOLDER_ID}`,
        status: 'active',
        last_synced_at: '2026-11-16T15:45:00.000Z',
        synced_count: 12,
        skipped_count: 1,
        folders_left_out: 2,
        syncing: false,
        who_can_see: null,
      },
    });
  });

  it('connects a folder shared with Frapp', async () => {
    await service.connect(
      'ch-1',
      'user-1',
      `https://drive.google.com/drive/u/0/folders/${FOLDER_ID}?usp=sharing`,
    );

    expect(drive.getItem).toHaveBeenCalledWith(FOLDER_ID);
    expect(drive.proofCode).toHaveBeenCalledWith(`ch-1:${FOLDER_ID}`);
    expect(repo.create).toHaveBeenCalledWith({
      chapter_id: 'ch-1',
      folder_id: FOLDER_ID,
      folder_name: `Chapter files ${CODE}`,
      connected_by: 'user-1',
      who_can_see: null,
    });
  });

  // #5220: what the folder brings in starts behind the list the officer
  // picked, checked (and their own tier kept) as any folder's list is.
  it('connects with a who-can-see list, checked as a folder list is', async () => {
    documents.checkedList.mockResolvedValue(['tier:exec', 'tier:pres']);

    await service.connect('ch-1', 'user-1', FOLDER_ID, ['tier:exec']);

    expect(documents.checkedList).toHaveBeenCalledWith('ch-1', 'user-1', [
      'tier:exec',
    ]);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ who_can_see: ['tier:exec', 'tier:pres'] }),
    );
  });

  it('refuses a folder not shared with Frapp, naming the address to share it with', async () => {
    drive.getItem.mockRejectedValue(
      new GoogleDriveApiError('not_found', 404, 'notFound'),
    );

    const attempt = service.connect('ch-1', 'user-1', FOLDER_ID);
    await expect(attempt).rejects.toThrow(BadRequestException);
    await expect(attempt).rejects.toThrow(EMAIL);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('refuses a link to a file, and anything that isn’t a Drive link', async () => {
    drive.getItem.mockResolvedValue({
      id: FOLDER_ID,
      name: 'Bylaws.pdf',
      mimeType: 'application/pdf',
      modifiedTime: '',
      size: 10,
      webViewLink: null,
    });
    await expect(service.connect('ch-1', 'user-1', FOLDER_ID)).rejects.toThrow(
      'not a folder',
    );
    await expect(
      service.connect('ch-1', 'user-1', 'https://example.com/folders/abc'),
    ).rejects.toThrow('isn’t a Google Drive folder link');
  });

  // #5185: one service account sees every chapter's shared folders, so
  // seeing the folder doesn't make it the connecting chapter's.
  describe('proving the folder is the chapter’s', () => {
    const plain = (over: Partial<GoogleDriveItem> = {}): GoogleDriveItem => ({
      id: FOLDER_ID,
      name: 'Chapter files',
      mimeType: GOOGLE_DRIVE_FOLDER_MIME,
      modifiedTime: '',
      size: null,
      webViewLink: null,
      description: null,
      parents: [],
      ...over,
    });

    it('refuses a folder without the code, naming the code, and saves nothing', async () => {
      drive.getItem.mockResolvedValue(plain());
      drive.listChildren.mockResolvedValue([
        plain({ id: 'f1', name: 'Bylaws.pdf', mimeType: 'application/pdf' }),
      ]);

      const attempt = service.connect('ch-1', 'user-1', FOLDER_ID);
      await expect(attempt).rejects.toThrow(BadRequestException);
      await expect(attempt).rejects.toThrow(CODE);
      expect(repo.create).not.toHaveBeenCalled();
      expect(repo.folderTakenElsewhere).not.toHaveBeenCalled();
    });

    it.each([
      [
        'its name, in any case',
        { name: `Chapter files ${CODE.toUpperCase()}` },
      ],
      ['its Description', { description: `Frapp: ${CODE}` }],
    ])('takes the code in %s', async (_where, over) => {
      drive.getItem.mockResolvedValue(plain(over));
      await service.connect('ch-1', 'user-1', FOLDER_ID);
      expect(drive.listChildren).not.toHaveBeenCalled();
      expect(repo.create).toHaveBeenCalled();
    });

    it('takes the code as the name of something directly inside it', async () => {
      drive.getItem.mockResolvedValue(plain());
      drive.listChildren.mockResolvedValue([
        plain({
          id: 'f1',
          name: CODE,
          mimeType: 'application/vnd.google-apps.document',
        }),
      ]);
      await service.connect('ch-1', 'user-1', FOLDER_ID);
      expect(drive.listChildren).toHaveBeenCalledWith(FOLDER_ID);
      expect(repo.create).toHaveBeenCalled();
    });

    it('refuses a folder inside another chapter’s connected one, walking up as far as Frapp sees', async () => {
      drive.getItem.mockImplementation((id: string) => {
        if (id === FOLDER_ID) {
          return Promise.resolve(plain({ name: CODE, parents: ['parent-1'] }));
        }
        if (id === 'parent-1') {
          return Promise.resolve(plain({ id, parents: ['parent-2'] }));
        }
        return Promise.reject(
          new GoogleDriveApiError('not_found', 404, 'notFound'),
        );
      });
      repo.folderTakenElsewhere.mockResolvedValue(true);

      await expect(
        service.connect('ch-1', 'user-1', FOLDER_ID),
      ).rejects.toThrow(ConflictException);
      expect(repo.folderTakenElsewhere).toHaveBeenCalledWith('ch-1', [
        FOLDER_ID,
        'parent-1',
        'parent-2',
      ]);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('is unavailable when Google can’t be reached while checking', async () => {
      drive.getItem.mockResolvedValue(plain());
      drive.listChildren.mockRejectedValue(
        new GoogleDriveApiError('failed', 500, 'backendError'),
      );
      await expect(
        service.connect('ch-1', 'user-1', FOLDER_ID),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });

  it('refuses a second folder while one is connected, or still leaving', async () => {
    repo.findAny.mockResolvedValue(live());
    await expect(service.connect('ch-1', 'user-1', FOLDER_ID)).rejects.toThrow(
      'Disconnect it first',
    );
    repo.findAny.mockResolvedValue(live({ status: 'disconnecting' }));
    await expect(service.connect('ch-1', 'user-1', FOLDER_ID)).rejects.toThrow(
      'still leaving Documents',
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('refuses a folder another chapter has connected', async () => {
    repo.create.mockRejectedValue({ code: '23505' });
    await expect(service.connect('ch-1', 'user-1', FOLDER_ID)).rejects.toThrow(
      'already connected to another chapter',
    );
  });

  it('is unavailable while the server has no service account', async () => {
    drive.isConfigured.mockReturnValue(false);
    drive.serviceAccountEmail.mockReturnValue(null);
    await expect(service.connect('ch-1', 'user-1', FOLDER_ID)).rejects.toThrow(
      ServiceUnavailableException,
    );
    await expect(service.status('ch-1')).resolves.toMatchObject({
      available: false,
    });
  });

  it('Sync now and Disconnect need a connected folder', async () => {
    repo.markDue.mockResolvedValue(false);
    repo.disconnect.mockResolvedValue(false);
    await expect(service.syncNow('ch-1')).rejects.toThrow(NotFoundException);
    await expect(service.disconnect('ch-1')).rejects.toThrow(NotFoundException);
  });

  it('disconnects even while the server has no service account', async () => {
    drive.isConfigured.mockReturnValue(false);
    await service.disconnect('ch-1');
    expect(repo.disconnect).toHaveBeenCalledWith('ch-1', expect.any(Date));
  });
});

describe('parseDriveFolderId', () => {
  it.each([
    [`https://drive.google.com/drive/folders/${FOLDER_ID}`, FOLDER_ID],
    [
      `https://drive.google.com/drive/u/1/folders/${FOLDER_ID}?usp=drive_link`,
      FOLDER_ID,
    ],
    [`https://drive.google.com/open?id=${FOLDER_ID}`, FOLDER_ID],
    [`  ${FOLDER_ID}  `, FOLDER_ID],
  ])('reads %s', (input, expected) => {
    expect(parseDriveFolderId(input)).toBe(expected);
  });

  it.each([
    'https://evil.example/drive/folders/1AbCdEfGhIjKlMnOp',
    'short',
    'not a link at all',
    `https://drive.google.com/file/d/${FOLDER_ID}/view`,
  ])('refuses %s', (input) => {
    expect(parseDriveFolderId(input)).toBeNull();
  });
});
