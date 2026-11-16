import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  GOOGLE_DRIVE_FOLDER_MIME,
  GoogleDriveApiError,
  type IGoogleDriveApi,
} from '#domain/adapters/google-drive.interface';
import type { IChapterDriveRepository } from '#domain/repositories/chapter-drive.repository.interface';
import type { ChapterDriveConnection } from '#domain/entities/chapter-drive-connection.entity';
import { GoogleDriveService, parseDriveFolderId } from './google-drive.service';

const FOLDER_ID = '1AbCdEfGhIjKlMnOp';
const EMAIL = 'frapp-docs@signet-frapp.iam.gserviceaccount.com';

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
  created_at: '2026-11-16T15:00:00.000Z',
  ...over,
});

describe('GoogleDriveService', () => {
  let drive: jest.Mocked<IGoogleDriveApi>;
  let repo: jest.Mocked<IChapterDriveRepository>;
  let service: GoogleDriveService;

  beforeEach(() => {
    drive = {
      isConfigured: jest.fn().mockReturnValue(true),
      serviceAccountEmail: jest.fn().mockReturnValue(EMAIL),
      getItem: jest.fn().mockResolvedValue({
        id: FOLDER_ID,
        name: 'Chapter files',
        mimeType: GOOGLE_DRIVE_FOLDER_MIME,
        modifiedTime: '',
        size: null,
        webViewLink: null,
      }),
      listChildren: jest.fn(),
      download: jest.fn(),
      exportAs: jest.fn(),
    };
    repo = {
      findLive: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(live()),
      markDue: jest.fn().mockResolvedValue(true),
      disconnect: jest.fn().mockResolvedValue(true),
      claim: jest.fn(),
      finishSync: jest.fn(),
      releaseLease: jest.fn(),
      delete: jest.fn(),
    };
    service = new GoogleDriveService(drive, repo);
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
        syncing: false,
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
    expect(repo.create).toHaveBeenCalledWith({
      chapter_id: 'ch-1',
      folder_id: FOLDER_ID,
      folder_name: 'Chapter files',
      connected_by: 'user-1',
    });
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

  it('refuses a second folder while one is connected', async () => {
    repo.findLive.mockResolvedValue(live());
    await expect(service.connect('ch-1', 'user-1', FOLDER_ID)).rejects.toThrow(
      ConflictException,
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
