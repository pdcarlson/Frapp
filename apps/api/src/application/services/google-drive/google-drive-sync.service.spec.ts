import {
  GOOGLE_DRIVE_FOLDER_MIME,
  GoogleDriveApiError,
  type GoogleDriveItem,
  type IGoogleDriveApi,
} from '#domain/adapters/google-drive.interface';
import type { IStorageProvider } from '#domain/adapters/storage.interface';
import type { IChapterDocumentRepository } from '#domain/repositories/chapter-document.repository.interface';
import type { IChapterDocumentFolderRepository } from '#domain/repositories/chapter-document-folder.repository.interface';
import type { IChapterDriveRepository } from '#domain/repositories/chapter-drive.repository.interface';
import type {
  ChapterDocument,
  ChapterDocumentFolder,
} from '#domain/entities/chapter-document.entity';
import type { ChapterDriveConnection } from '#domain/entities/chapter-drive-connection.entity';
import {
  DRIVE_COPY_BUDGET,
  DRIVE_MAX_FILES,
  GoogleDriveSyncService,
  planFile,
} from './google-drive-sync.service';

const NOW = new Date('2026-11-16T15:00:00.000Z');
const ROOT = 'root-folder-id';

const item = (over: Partial<GoogleDriveItem>): GoogleDriveItem => ({
  id: 'f1',
  name: 'Bylaws.pdf',
  mimeType: 'application/pdf',
  modifiedTime: '2026-11-15T00:00:00.000Z',
  size: 1000,
  webViewLink: 'https://drive.google.com/file/d/f1/view',
  ...over,
});

const folder = (id: string, name: string): GoogleDriveItem =>
  item({ id, name, mimeType: GOOGLE_DRIVE_FOLDER_MIME, size: null });

const connection = (
  over: Partial<ChapterDriveConnection> = {},
): ChapterDriveConnection => ({
  id: 'conn-1',
  chapter_id: 'ch-1',
  folder_id: ROOT,
  folder_name: 'Chapter files',
  connected_by: 'user-1',
  status: 'active',
  sync_due_at: NOW.toISOString(),
  sync_lease_until: null,
  last_synced_at: null,
  last_error: null,
  synced_count: 0,
  skipped_count: 0,
  created_at: NOW.toISOString(),
  who_can_see: null,
  ...over,
});

const copy = (over: Partial<ChapterDocument>): ChapterDocument => ({
  id: 'doc-1',
  chapter_id: 'ch-1',
  title: 'Bylaws',
  description: null,
  folder: null,
  storage_path: 'chapters/ch-1/documents/old/Bylaws.pdf',
  uploaded_by: 'user-1',
  created_at: NOW.toISOString(),
  content_type: 'application/pdf',
  byte_size: 1000,
  document_type: null,
  effective_date: null,
  pinned_at: null,
  drive_file_id: 'f1',
  // As PostgREST hands a timestamptz back, not as Drive wrote it.
  drive_modified_at: '2026-11-15T00:00:00+00:00',
  drive_url: 'https://drive.google.com/file/d/f1/view',
  drive_held_folder_id: null,
  who_can_see: null,
  ...over,
});

const frappFolder = (
  over: Partial<ChapterDocumentFolder>,
): ChapterDocumentFolder => ({
  id: 'fold-x',
  chapter_id: 'ch-1',
  name: 'Folder',
  sort_order: 0,
  created_at: NOW.toISOString(),
  pinned_at: null,
  who_can_see: null,
  drive_folder_id: null,
  ...over,
});

describe('GoogleDriveSyncService', () => {
  let drive: jest.Mocked<IGoogleDriveApi>;
  let connections: jest.Mocked<IChapterDriveRepository>;
  let documents: jest.Mocked<IChapterDocumentRepository>;
  let storage: jest.Mocked<IStorageProvider>;
  let folders: jest.Mocked<IChapterDocumentFolderRepository>;
  /** The chapter's folders, as the fake folder repository holds them. */
  let folderRows: ChapterDocumentFolder[];
  const byName = (name: string) => folderRows.find((row) => row.name === name);
  let service: GoogleDriveSyncService;
  let tree: Record<string, GoogleDriveItem[]>;

  beforeEach(() => {
    tree = { [ROOT]: [] };
    drive = {
      isConfigured: jest.fn().mockReturnValue(true),
      serviceAccountEmail: jest
        .fn()
        .mockReturnValue('frapp@x.iam.gserviceaccount.com'),
      getItem: jest.fn().mockResolvedValue(folder(ROOT, 'Chapter files')),
      listChildren: jest.fn((id: string) => Promise.resolve(tree[id] ?? [])),
      download: jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      exportAs: jest.fn().mockResolvedValue(new Uint8Array([4, 5])),
    };
    connections = {
      findLive: jest.fn(),
      findAny: jest.fn(),
      create: jest.fn(),
      markDue: jest.fn(),
      disconnect: jest.fn(),
      claim: jest.fn(),
      finishSync: jest.fn().mockResolvedValue(undefined),
      releaseLease: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    documents = {
      findById: jest.fn(),
      findByIds: jest.fn(),
      findByChapter: jest.fn(),
      findByStoragePath: jest.fn(),
      create: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue(undefined),
      findDriveCopies: jest.fn().mockResolvedValue([]),
      updateDriveCopy: jest.fn().mockResolvedValue(undefined),
      setPinnedAt: jest.fn(),
      setWhoCanSee: jest.fn(),
    };
    storage = {
      uploadFile: jest.fn().mockResolvedValue(undefined),
      deleteFile: jest.fn().mockResolvedValue(undefined),
      deleteFiles: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<IStorageProvider>;
    folderRows = [];
    let made = 0;
    folders = {
      findByChapter: jest.fn((_chapter: string) =>
        Promise.resolve(folderRows.map((row) => ({ ...row }))),
      ),
      findById: jest.fn(),
      findByName: jest.fn(),
      create: jest.fn((data) => {
        if (byName(data.name)) {
          return Promise.reject(
            Object.assign(new Error('dup'), { code: '23505' }),
          );
        }
        made += 1;
        const row = frappFolder({
          id: `fold-${made}`,
          name: data.name,
          sort_order: data.sort_order,
          who_can_see: data.who_can_see ?? null,
          drive_folder_id: data.drive_folder_id ?? null,
        });
        folderRows.push(row);
        return Promise.resolve({ ...row });
      }),
      update: jest.fn(),
      rename: jest.fn((id: string, _chapter: string, name: string) => {
        const row = folderRows.find((r) => r.id === id);
        if (!row) return Promise.resolve(null);
        row.name = name;
        return Promise.resolve({ ...row });
      }),
      deleteMovingDocuments: jest.fn((id: string, _chapter: string) => {
        folderRows = folderRows.filter((row) => row.id !== id);
        return Promise.resolve(true);
      }),
      setPinnedAt: jest.fn(),
    };
    service = new GoogleDriveSyncService(
      drive,
      connections,
      documents,
      folders,
      storage,
    );
  });

  it('files a new PDF in a folder named for the connected one, open to the chapter', async () => {
    tree[ROOT] = [item({})];

    await expect(service.process(connection(), NOW)).resolves.toBe('synced');

    expect(drive.download).toHaveBeenCalledWith('f1', 25 * 1024 * 1024);
    const [bucket, path, , contentType] = storage.uploadFile.mock.calls[0];
    expect(bucket).toBe('documents');
    expect(path).toMatch(
      /^chapters\/ch-1\/documents\/[0-9a-f-]{36}\/Bylaws\.pdf$/,
    );
    expect(contentType).toBe('application/pdf');
    expect(documents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        chapter_id: 'ch-1',
        title: 'Bylaws',
        folder: 'Chapter files',
        uploaded_by: 'user-1',
        drive_file_id: 'f1',
        drive_modified_at: '2026-11-15T00:00:00.000Z',
        byte_size: 3,
      }),
    );
    expect(connections.finishSync).toHaveBeenCalledWith(
      'conn-1',
      expect.objectContaining({
        status: 'active',
        synced_count: 1,
        skipped_count: 0,
        last_error: null,
      }),
    );
  });

  it('exports a Google Doc as PDF and a Sheet as Excel, filing subfolders as folders', async () => {
    tree[ROOT] = [folder('sub', 'Rush')];
    tree.sub = [
      folder('deep', 'Flyers'),
      item({
        id: 'doc',
        name: 'Plan',
        mimeType: 'application/vnd.google-apps.document',
        size: null,
      }),
    ];
    tree.deep = [
      item({
        id: 'sheet',
        name: 'Budget',
        mimeType: 'application/vnd.google-apps.spreadsheet',
        size: null,
      }),
    ];

    await service.process(connection(), NOW);

    expect(drive.exportAs).toHaveBeenCalledWith(
      'doc',
      'application/pdf',
      expect.any(Number),
    );
    expect(drive.exportAs).toHaveBeenCalledWith(
      'sheet',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      expect.any(Number),
    );
    expect(documents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Plan',
        folder: 'Chapter files / Rush',
      }),
    );
    expect(documents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Budget',
        folder: 'Chapter files / Rush / Flyers',
      }),
    );
    expect(folderRows.map((row) => [row.name, row.drive_folder_id])).toEqual([
      ['Chapter files', ROOT],
      ['Chapter files / Rush', 'sub'],
      ['Chapter files / Rush / Flyers', 'deep'],
    ]);
  });

  it('leaves out folders past three levels, unsupported types and oversized files', async () => {
    tree[ROOT] = [
      folder('a', 'A'),
      item({ id: 'form', mimeType: 'application/vnd.google-apps.form' }),
      item({ id: 'zip', name: 'x.zip', mimeType: 'application/zip' }),
      item({ id: 'big', size: 26 * 1024 * 1024 }),
    ];
    tree.a = [folder('b', 'B')];
    tree.b = [folder('c', 'C')];
    tree.c = [item({ id: 'too-deep' })];

    await service.process(connection(), NOW);

    expect(drive.listChildren).not.toHaveBeenCalledWith('c');
    expect(documents.create).not.toHaveBeenCalled();
    expect(connections.finishSync).toHaveBeenCalledWith(
      'conn-1',
      expect.objectContaining({ synced_count: 0, skipped_count: 3 }),
    );
  });

  it('renames and refiles an unchanged copy without downloading it again', async () => {
    tree[ROOT] = [folder('sub', 'Minutes')];
    tree.sub = [item({ name: 'Bylaws 2026.pdf' })];
    documents.findDriveCopies.mockResolvedValue([copy({})]);

    await service.process(connection(), NOW);

    expect(drive.download).not.toHaveBeenCalled();
    expect(documents.updateDriveCopy).toHaveBeenCalledWith('doc-1', 'ch-1', {
      title: 'Bylaws 2026',
      folder: 'Chapter files / Minutes',
      drive_held_folder_id: null,
      drive_url: 'https://drive.google.com/file/d/f1/view',
    });
  });

  it('leaves an unchanged copy alone, whichever way the time is written', async () => {
    tree[ROOT] = [item({})];
    folderRows = [
      frappFolder({ id: 'top', name: 'Chapter files', drive_folder_id: ROOT }),
    ];
    documents.findDriveCopies.mockResolvedValue([
      copy({ folder: 'Chapter files' }),
    ]);

    await service.process(connection(), NOW);

    expect(drive.download).not.toHaveBeenCalled();
    expect(documents.updateDriveCopy).not.toHaveBeenCalled();
    expect(storage.uploadFile).not.toHaveBeenCalled();
  });

  it('keeps copies it could not reach when the tree is read only in part', async () => {
    tree[ROOT] = [folder('gone', 'Old minutes')];
    drive.listChildren.mockImplementation((id: string) =>
      id === 'gone'
        ? Promise.reject(new GoogleDriveApiError('not_found', 404, 'notFound'))
        : Promise.resolve(tree[id] ?? []),
    );
    folderRows = [
      frappFolder({ id: 'old', name: 'Old minutes', drive_folder_id: 'gone' }),
    ];
    documents.findDriveCopies.mockResolvedValue([
      copy({ folder: 'Old minutes' }),
    ]);

    await expect(service.process(connection(), NOW)).resolves.toBe('synced');

    expect(documents.delete).not.toHaveBeenCalled();
    expect(folders.deleteMovingDocuments).not.toHaveBeenCalled();
    expect(connections.finishSync).toHaveBeenCalledWith(
      'conn-1',
      expect.objectContaining({ status: 'active' }),
    );
  });

  it('replaces a changed copy in place, keeping its row, and drops the old file', async () => {
    tree[ROOT] = [item({ modifiedTime: '2026-11-16T00:00:00.000Z' })];
    documents.findDriveCopies.mockResolvedValue([copy({})]);

    await service.process(connection(), NOW);

    expect(documents.create).not.toHaveBeenCalled();
    expect(documents.updateDriveCopy).toHaveBeenCalledWith(
      'doc-1',
      'ch-1',
      expect.objectContaining({
        drive_modified_at: '2026-11-16T00:00:00.000Z',
        byte_size: 3,
      }),
    );
    expect(storage.deleteFile).toHaveBeenCalledWith(
      'documents',
      'chapters/ch-1/documents/old/Bylaws.pdf',
    );
  });

  it('removes copies of files that left the folder', async () => {
    documents.findDriveCopies.mockResolvedValue([copy({})]);

    await service.process(connection(), NOW);

    expect(documents.delete).toHaveBeenCalledWith('doc-1', 'ch-1');
    expect(storage.deleteFiles).toHaveBeenCalledWith('documents', [
      'chapters/ch-1/documents/old/Bylaws.pdf',
    ]);
  });

  it('copies a limited number per pass and is due again at once', async () => {
    tree[ROOT] = Array.from({ length: DRIVE_COPY_BUDGET + 3 }, (_, i) =>
      item({ id: `f${i}`, name: `File ${i}.pdf` }),
    );

    await expect(service.process(connection(), NOW)).resolves.toBe('more');

    expect(documents.create).toHaveBeenCalledTimes(DRIVE_COPY_BUDGET);
    expect(connections.finishSync).toHaveBeenCalledWith(
      'conn-1',
      expect.objectContaining({ sync_due_at: NOW.toISOString() }),
    );
  });

  it('tries at most a budget of refused files a pass, without asking for another pass', async () => {
    tree[ROOT] = Array.from({ length: DRIVE_COPY_BUDGET + 2 }, (_, i) =>
      item({ id: `bad${i}`, name: `A ${i}.pdf` }),
    );
    drive.download.mockRejectedValue(
      new GoogleDriveApiError('forbidden', 403, 'cannotDownloadFile'),
    );

    await expect(service.process(connection(), NOW)).resolves.toBe('synced');

    expect(drive.download).toHaveBeenCalledTimes(DRIVE_COPY_BUDGET);
    expect(connections.finishSync).toHaveBeenCalledWith(
      'conn-1',
      expect.objectContaining({ skipped_count: DRIVE_COPY_BUDGET + 2 }),
    );
  });

  it('caps a folder at the file limit', async () => {
    tree[ROOT] = Array.from({ length: DRIVE_MAX_FILES + 2 }, (_, i) =>
      item({ id: `f${i}`, name: `File ${i}.pdf` }),
    );

    await service.process(connection(), NOW);

    expect(connections.finishSync).toHaveBeenCalledWith(
      'conn-1',
      expect.objectContaining({ skipped_count: 2 }),
    );
  });

  it('skips a file Google refuses or that grew past the limit, and drops its stale copy', async () => {
    tree[ROOT] = [item({ modifiedTime: '2026-11-16T00:00:00.000Z' })];
    documents.findDriveCopies.mockResolvedValue([copy({})]);
    drive.download.mockRejectedValue(
      new GoogleDriveApiError('too_large', null, 'over_limit'),
    );

    await service.process(connection(), NOW);

    expect(documents.delete).toHaveBeenCalledWith('doc-1', 'ch-1');
    expect(connections.finishSync).toHaveBeenCalledWith(
      'conn-1',
      expect.objectContaining({ synced_count: 0, skipped_count: 1 }),
    );
  });

  it('marks the folder no_access when it is no longer shared, keeping copies', async () => {
    drive.getItem.mockRejectedValue(
      new GoogleDriveApiError('not_found', 404, 'notFound'),
    );
    documents.findDriveCopies.mockResolvedValue([copy({})]);

    await expect(service.process(connection(), NOW)).resolves.toBe('no_access');

    expect(connections.finishSync).toHaveBeenCalledWith('conn-1', {
      status: 'no_access',
      last_error: 'no_access',
    });
    expect(documents.delete).not.toHaveBeenCalled();
  });

  it('backs off five minutes on a rate limit', async () => {
    drive.listChildren.mockRejectedValue(
      new GoogleDriveApiError('rate_limited', 429, 'rateLimitExceeded'),
    );

    await expect(service.process(connection(), NOW)).resolves.toBe(
      'rate_limited',
    );
    expect(connections.finishSync).toHaveBeenCalledWith('conn-1', {
      last_error: 'rate_limited',
      sync_due_at: '2026-11-16T15:05:00.000Z',
    });
  });

  it('tries again in five minutes and rethrows when something else breaks', async () => {
    documents.findDriveCopies.mockRejectedValue(new Error('db down'));

    await expect(service.process(connection(), NOW)).rejects.toThrow('db down');
    expect(connections.finishSync).toHaveBeenCalledWith('conn-1', {
      last_error: 'failed',
      sync_due_at: '2026-11-16T15:05:00.000Z',
    });
  });

  it('releases a disconnecting row whose cleanup broke, for the next tick', async () => {
    documents.findDriveCopies.mockRejectedValue(new Error('db down'));

    await expect(
      service.process(connection({ status: 'disconnecting' }), NOW),
    ).rejects.toThrow('db down');
    expect(connections.releaseLease).toHaveBeenCalledWith('conn-1');
    expect(connections.delete).not.toHaveBeenCalled();
  });

  it('removes every copy and synced folder, then the connection, once disconnected', async () => {
    folderRows = [
      frappFolder({ id: 'top', name: 'Chapter files', drive_folder_id: ROOT }),
      frappFolder({ id: 'mine', name: 'Rush' }),
    ];
    documents.findDriveCopies.mockResolvedValue([
      copy({}),
      copy({ id: 'doc-2', storage_path: 'p2', drive_file_id: 'f2' }),
    ]);

    await expect(
      service.process(connection({ status: 'disconnecting' }), NOW),
    ).resolves.toBe('disconnected');

    expect(drive.getItem).not.toHaveBeenCalled();
    expect(documents.delete).toHaveBeenCalledTimes(2);
    expect(storage.deleteFiles).toHaveBeenCalledWith('documents', [
      'chapters/ch-1/documents/old/Bylaws.pdf',
      'p2',
    ]);
    expect(folders.deleteMovingDocuments).toHaveBeenCalledTimes(1);
    expect(folders.deleteMovingDocuments).toHaveBeenCalledWith('top', 'ch-1');
    expect(connections.delete).toHaveBeenCalledWith('conn-1');
  });

  // #5220: who can see a copy survives what happens to it in Drive.
  describe('who can see', () => {
    const EXEC = ['tier:exec'];

    it('starts the top folder with the connection list and each new subfolder with its parent list', async () => {
      tree[ROOT] = [folder('sub', 'Exec')];
      tree.sub = [folder('deep', 'Budget')];

      await service.process(connection({ who_can_see: EXEC }), NOW);

      expect(folderRows.map((row) => [row.name, row.who_can_see])).toEqual([
        ['Chapter files', EXEC],
        ['Chapter files / Exec', EXEC],
        ['Chapter files / Exec / Budget', EXEC],
      ]);
    });

    it('starts a new subfolder with its parent folder list, not the connection list', async () => {
      tree[ROOT] = [folder('sub', 'Exec')];
      tree.sub = [folder('deep', 'Minutes')];
      folderRows = [
        frappFolder({
          id: 'top',
          name: 'Chapter files',
          drive_folder_id: ROOT,
        }),
        frappFolder({
          id: 'exec',
          name: 'Chapter files / Exec',
          drive_folder_id: 'sub',
          who_can_see: EXEC,
        }),
      ];

      await service.process(connection(), NOW);

      expect(byName('Chapter files / Exec / Minutes')?.who_can_see).toEqual(
        EXEC,
      );
    });

    it('renames the same folder when Drive renames it, keeping its list', async () => {
      tree[ROOT] = [folder('sub', 'Exec Board')];
      tree.sub = [item({})];
      folderRows = [
        frappFolder({
          id: 'top',
          name: 'Chapter files',
          drive_folder_id: ROOT,
        }),
        frappFolder({
          id: 'exec',
          name: 'Chapter files / Exec',
          drive_folder_id: 'sub',
          who_can_see: EXEC,
        }),
      ];
      // The rename re-files the copy in the database; the pass reads it after.
      documents.findDriveCopies.mockImplementation(() =>
        Promise.resolve([
          copy({
            folder: byName('Chapter files / Exec Board')
              ? 'Chapter files / Exec Board'
              : 'Chapter files / Exec',
          }),
        ]),
      );

      await service.process(connection(), NOW);

      expect(folders.rename).toHaveBeenCalledWith(
        'exec',
        'ch-1',
        'Chapter files / Exec Board',
      );
      expect(folders.create).not.toHaveBeenCalled();
      expect(byName('Chapter files / Exec Board')?.who_can_see).toEqual(EXEC);
      expect(documents.updateDriveCopy).not.toHaveBeenCalled();
    });

    it('keeps a synced folder under its old name when a rename races for a taken name', async () => {
      tree[ROOT] = [folder('sub', 'Exec Board'), item({})];
      folderRows = [
        frappFolder({
          id: 'top',
          name: 'Chapter files',
          drive_folder_id: ROOT,
        }),
        frappFolder({
          id: 'exec',
          name: 'Chapter files / Exec',
          drive_folder_id: 'sub',
          who_can_see: EXEC,
        }),
      ];
      folders.rename.mockRejectedValueOnce({ code: '23505' });

      await expect(service.process(connection(), NOW)).resolves.toBe('synced');

      expect(byName('Chapter files / Exec')?.who_can_see).toEqual(EXEC);
      expect(documents.create).toHaveBeenCalledWith(
        expect.objectContaining({ folder: 'Chapter files' }),
      );
    });

    it('numbers a synced folder whose name another folder already has', async () => {
      folderRows = [frappFolder({ id: 'mine', name: 'Chapter files' })];
      tree[ROOT] = [item({})];

      await service.process(connection(), NOW);

      expect(documents.create).toHaveBeenCalledWith(
        expect.objectContaining({ folder: 'Chapter files (2)' }),
      );
      expect(byName('Chapter files')?.drive_folder_id).toBeNull();
    });

    it('holds a copy Drive moved into a folder more people may see, and says where Drive put it', async () => {
      tree[ROOT] = [folder('sub', 'Exec'), item({})];
      folderRows = [
        frappFolder({
          id: 'top',
          name: 'Chapter files',
          drive_folder_id: ROOT,
        }),
        frappFolder({
          id: 'exec',
          name: 'Chapter files / Exec',
          drive_folder_id: 'sub',
          who_can_see: EXEC,
        }),
      ];
      documents.findDriveCopies.mockResolvedValue([
        copy({ folder: 'Chapter files / Exec' }),
      ]);

      await service.process(connection(), NOW);

      expect(documents.updateDriveCopy).toHaveBeenCalledWith('doc-1', 'ch-1', {
        title: 'Bylaws',
        folder: 'Chapter files / Exec',
        drive_held_folder_id: 'top',
        drive_url: 'https://drive.google.com/file/d/f1/view',
      });
    });

    it('moves a copy Drive moved into a folder no more people see, and lets go of a hold once Drive agrees', async () => {
      tree[ROOT] = [folder('sub', 'Exec')];
      tree.sub = [item({}), item({ id: 'f2', name: 'Dues.pdf' })];
      folderRows = [
        frappFolder({
          id: 'top',
          name: 'Chapter files',
          drive_folder_id: ROOT,
        }),
        frappFolder({
          id: 'exec',
          name: 'Chapter files / Exec',
          drive_folder_id: 'sub',
          who_can_see: EXEC,
        }),
      ];
      documents.findDriveCopies.mockResolvedValue([
        copy({ folder: 'Chapter files' }),
        copy({
          id: 'doc-2',
          drive_file_id: 'f2',
          title: 'Dues',
          folder: 'Chapter files / Exec',
          drive_held_folder_id: 'top',
        }),
      ]);

      await service.process(connection(), NOW);

      expect(documents.updateDriveCopy).toHaveBeenCalledWith(
        'doc-1',
        'ch-1',
        expect.objectContaining({
          folder: 'Chapter files / Exec',
          drive_held_folder_id: null,
        }),
      );
      expect(documents.updateDriveCopy).toHaveBeenCalledWith(
        'doc-2',
        'ch-1',
        expect.objectContaining({
          folder: 'Chapter files / Exec',
          drive_held_folder_id: null,
        }),
      );
    });

    it('holds a changed copy too, when its new place is wider', async () => {
      tree[ROOT] = [
        folder('sub', 'Exec'),
        item({ modifiedTime: '2026-11-16T00:00:00.000Z' }),
      ];
      folderRows = [
        frappFolder({
          id: 'top',
          name: 'Chapter files',
          drive_folder_id: ROOT,
        }),
        frappFolder({
          id: 'exec',
          name: 'Chapter files / Exec',
          drive_folder_id: 'sub',
          who_can_see: EXEC,
        }),
      ];
      documents.findDriveCopies.mockResolvedValue([
        copy({ folder: 'Chapter files / Exec' }),
      ]);

      await service.process(connection(), NOW);

      expect(documents.updateDriveCopy).toHaveBeenCalledWith(
        'doc-1',
        'ch-1',
        expect.objectContaining({
          folder: 'Chapter files / Exec',
          drive_held_folder_id: 'top',
        }),
      );
    });

    it('deletes a synced folder Drive no longer has, once a full read shows it gone', async () => {
      tree[ROOT] = [];
      folderRows = [
        frappFolder({
          id: 'top',
          name: 'Chapter files',
          drive_folder_id: ROOT,
        }),
        frappFolder({
          id: 'old',
          name: 'Chapter files / Old',
          drive_folder_id: 'old-id',
        }),
        frappFolder({ id: 'mine', name: 'Rush' }),
      ];

      await service.process(connection(), NOW);

      expect(folders.deleteMovingDocuments).toHaveBeenCalledTimes(1);
      expect(folders.deleteMovingDocuments).toHaveBeenCalledWith('old', 'ch-1');
    });

    it('keeps a synced folder it did not see when the read was only in part', async () => {
      tree[ROOT] = [folder('bad', 'Unreadable')];
      drive.listChildren.mockImplementation((id: string) =>
        id === 'bad'
          ? Promise.reject(
              new GoogleDriveApiError('not_found', 404, 'notFound'),
            )
          : Promise.resolve(tree[id] ?? []),
      );
      folderRows = [
        frappFolder({
          id: 'top',
          name: 'Chapter files',
          drive_folder_id: ROOT,
        }),
        frappFolder({
          id: 'old',
          name: 'Chapter files / Old',
          drive_folder_id: 'old-id',
          who_can_see: EXEC,
        }),
      ];

      await service.process(connection(), NOW);

      expect(folders.deleteMovingDocuments).not.toHaveBeenCalled();
    });
  });

  it('refuses a connection whose id now names a file', async () => {
    drive.getItem.mockResolvedValue(item({ id: ROOT }));

    await expect(service.process(connection(), NOW)).resolves.toBe('no_access');
  });
});

describe('planFile', () => {
  it('keeps a stored file’s name as its filename and drops the extension from its title', () => {
    expect(
      planFile(
        item({
          name: '  Rush   Plan.docx ',
          mimeType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
        ROOT,
      ),
    ).toMatchObject({ title: 'Rush Plan', filename: 'Rush Plan.docx' });
  });

  it('exports Slides as PDF', () => {
    expect(
      planFile(
        item({
          name: 'Deck',
          mimeType: 'application/vnd.google-apps.presentation',
          size: null,
        }),
        'rush',
      ),
    ).toMatchObject({
      filename: 'Deck.pdf',
      contentType: 'application/pdf',
      exportMime: 'application/pdf',
      folderDriveId: 'rush',
    });
  });

  it('leaves out shortcuts and nameless files', () => {
    expect(
      planFile(
        item({ mimeType: 'application/vnd.google-apps.shortcut' }),
        ROOT,
      ),
    ).toBeNull();
    expect(planFile(item({ name: '   ' }), ROOT)).toBeNull();
  });
});
