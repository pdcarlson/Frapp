import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { MAX_ARCHIVE_EXPORT_PART_BYTES } from '@repo/validation';
import { DiscordImportService } from './discord-import.service';
import { DISCORD_IMPORT_REPOSITORY } from '../../domain/repositories/discord-import.repository.interface';
import { STORAGE_PROVIDER } from '../../domain/adapters/storage.interface';
import type { DiscordImport } from '../../domain/entities/discord-import.entity';
import { isUnsafeStoragePath } from '../../domain/utils/storage-path';

const CHAPTER = '11111111-1111-4111-8111-111111111111';
const USER = '33333333-3333-4333-8333-333333333333';
const IMPORT_ID = '44444444-4444-4444-8444-444444444444';

function job(overrides: Partial<DiscordImport> = {}): DiscordImport {
  return {
    id: IMPORT_ID,
    chapter_id: CHAPTER,
    created_by: USER,
    status: 'draft',
    guild_id: null,
    guild_name: null,
    consent_acknowledged_at: '2026-08-24T12:00:00Z',
    role_mapping: [],
    storage_prefix: `chapters/${CHAPTER}/chat-archive/imports/${IMPORT_ID}`,
    total_messages: 0,
    imported_messages: 0,
    messages_skipped: 0,
    attachments_imported: 0,
    attachments_skipped: 0,
    parts_total: 0,
    cursor_part_index: 0,
    cursor_message_index: 0,
    cursor_part_message_count: 0,
    warnings: [],
    error: null,
    lock_token: null,
    locked_by: null,
    lease_expires_at: null,
    attempt_count: 0,
    created_at: '2026-08-24T12:00:00Z',
    updated_at: '2026-08-24T12:00:00Z',
    completed_at: null,
    purged_at: null,
    ...overrides,
  };
}

let repo: Record<string, jest.Mock>;
let storage: Record<string, jest.Mock>;
let service: DiscordImportService;

async function build(current: DiscordImport = job()) {
  repo = {
    create: jest.fn(async () => current),
    findById: jest.fn(async () => current),
    findByChapter: jest.fn(async () => [current]),
    update: jest.fn(async (_id, _chapter, patch) => ({ ...current, ...patch })),
    replaceChannels: jest.fn(async (_id, _chapter, rows) => rows),
    findChannels: jest.fn(async () => []),
    updateChannel: jest.fn(),
    createFiles: jest.fn(async (rows) =>
      rows.map((row: Record<string, unknown>, i: number) => ({
        ...row,
        id: `file-${i}`,
        uploaded_at: null,
        created_at: '2026-08-24T12:00:00Z',
      })),
    ),
    findFiles: jest.fn(async () => []),
    markFilesUploaded: jest.fn(async () => 1),
    claimNextRunnable: jest.fn(),
    renewLease: jest.fn(),
    releaseLease: jest.fn(),
    findExistingExternalIds: jest.fn(),
    insertMessages: jest.fn(),
    insertAttachments: jest.fn(),
    deleteImportedMessages: jest.fn(),
  };
  storage = {
    getSignedUploadUrl: jest.fn(async () => 'https://signed.example/put'),
    downloadFile: jest.fn(),
    listFiles: jest.fn(),
    deleteFiles: jest.fn(),
    getSignedDownloadUrl: jest.fn(),
    uploadFile: jest.fn(),
    deleteFile: jest.fn(),
    listObjects: jest.fn(),
    listFolders: jest.fn(),
  };
  const moduleRef = await Test.createTestingModule({
    providers: [
      DiscordImportService,
      { provide: DISCORD_IMPORT_REPOSITORY, useValue: repo },
      { provide: STORAGE_PROVIDER, useValue: storage },
    ],
  }).compile();
  service = moduleRef.get(DiscordImportService);
  return service;
}

describe('DiscordImportService — the consent gate', () => {
  it('refuses to create an import without the acknowledgement', async () => {
    // The friction point the compliance step exists to be. Enforced here AND by
    // a NOT NULL column, so a caller that skips the wizard still cannot skip it.
    await build();
    await expect(
      service.create(CHAPTER, USER, { consent_acknowledged: false }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('stamps the acknowledgement time when the admin confirms', async () => {
    await build();
    await service.create(CHAPTER, USER, { consent_acknowledged: true });

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        chapter_id: CHAPTER,
        created_by: USER,
        consent_acknowledged_at: expect.any(String),
      }),
    );
  });

  it('stamps the storage prefix so no reader has to rebuild it', async () => {
    await build();
    await service.create(CHAPTER, USER, { consent_acknowledged: true });

    expect(repo.update).toHaveBeenCalledWith(
      IMPORT_ID,
      CHAPTER,
      expect.objectContaining({
        storage_prefix: expect.stringContaining(`chat-archive/imports/${IMPORT_ID}`),
      }),
    );
  });
});

describe('DiscordImportService — upload URLs', () => {
  const file = (overrides = {}) => ({
    kind: 'export' as const,
    relative_path: 'part-000.json',
    content_type: 'application/json',
    byte_size: 1024,
    part_index: 0,
    ...overrides,
  });

  it('signs with upsert so an interrupted upload can resume', async () => {
    // Verified against the local stack: re-signing an existing key without
    // upsert answers 409 Duplicate, which would strand an admin partway
    // through a several-thousand-file archive.
    await build();
    await service.requestUploadUrls(IMPORT_ID, CHAPTER, [file()]);

    expect(storage.getSignedUploadUrl).toHaveBeenCalledWith(
      'chat-archive',
      expect.any(String),
      expect.any(String),
      { upsert: true },
    );
  });

  it('places every object under the import prefix', async () => {
    await build();
    const tickets = await service.requestUploadUrls(IMPORT_ID, CHAPTER, [
      file(),
      file({ kind: 'media', relative_path: 'general_Files/a.png', content_type: 'image/png' }),
    ]);

    for (const ticket of tickets) {
      expect(ticket.storage_path).toContain(
        `chapters/${CHAPTER}/chat-archive/imports/${IMPORT_ID}/`,
      );
    }
  });

  it('rejects an export partition too large to parse in memory', async () => {
    await build();
    await expect(
      service.requestUploadUrls(IMPORT_ID, CHAPTER, [
        file({ byte_size: MAX_ARCHIVE_EXPORT_PART_BYTES + 1 }),
      ]),
    ).rejects.toThrow(/--partition/);
  });

  it('rejects a media type the archive bucket would 415 anyway', async () => {
    await build();
    await expect(
      service.requestUploadUrls(IMPORT_ID, CHAPTER, [
        file({
          kind: 'media',
          relative_path: 'evil.exe',
          content_type: 'application/x-msdownload',
        }),
      ]),
    ).rejects.toThrow(/does not accept/);
  });

  it('rejects a file above the archive bucket cap', async () => {
    await build();
    await expect(
      service.requestUploadUrls(IMPORT_ID, CHAPTER, [
        file({ kind: 'media', relative_path: 'huge.mp4', byte_size: 200 * 1024 * 1024 }),
      ]),
    ).rejects.toThrow(/too large/);
  });

  it('caps how many URLs one request may mint', async () => {
    await build();
    await expect(
      service.requestUploadUrls(
        IMPORT_ID,
        CHAPTER,
        Array.from({ length: 101 }, (_, i) =>
          file({ relative_path: `part-${i}.json`, part_index: i }),
        ),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('produces a key the storage path guard accepts, even from a traversal attempt', async () => {
    // Asserted against the real guard rather than a hand-rolled proxy: it is
    // hardened against four proven bucket-escape spellings (literal `../..`,
    // `%2e%2e`, control characters, and a malformed-percent decode bypass), and
    // it is what every storage call actually passes through.
    await build();
    const tickets = await service.requestUploadUrls(IMPORT_ID, CHAPTER, [
      file({
        kind: 'media',
        relative_path: '../../escape/general [123]_Files/a.png',
        content_type: 'image/png',
      }),
      file({
        kind: 'media',
        relative_path: '..%2f..%2fetc/passwd.png',
        content_type: 'image/png',
      }),
      file({ kind: 'media', relative_path: '..', content_type: 'image/png' }),
    ]);

    for (const ticket of tickets) {
      expect(isUnsafeStoragePath(ticket.storage_path)).toBe(false);
      // The whole media prefix stays exactly one level deep, which is what lets
      // the purge sweep it with a non-recursive `listFiles`.
      expect(ticket.storage_path.split('/media/')[1]).not.toContain('/');
    }
  });

  it('keeps two source paths that flatten alike distinct', async () => {
    await build();
    const tickets = await service.requestUploadUrls(IMPORT_ID, CHAPTER, [
      file({ kind: 'media', relative_path: 'a/b.png', content_type: 'image/png' }),
      file({ kind: 'media', relative_path: 'a_b.png', content_type: 'image/png' }),
    ]);

    expect(tickets[0].storage_path).not.toBe(tickets[1].storage_path);
  });
});

describe('DiscordImportService — channel mapping', () => {
  it('refuses a merge with no target chosen', async () => {
    // "Ask, never guess": chat_channels has no unique (chapter_id, name), so a
    // same-name match is never an answer.
    await build();
    await expect(
      service.setChannelMapping(IMPORT_ID, CHAPTER, [
        {
          discord_channel_id: '1',
          discord_channel_name: 'general',
          mapping_action: 'use_existing',
        },
      ]),
    ).rejects.toThrow(/Pick a Signet channel/);
  });

  it('refuses a new channel with no name', async () => {
    await build();
    await expect(
      service.setChannelMapping(IMPORT_ID, CHAPTER, [
        {
          discord_channel_id: '1',
          discord_channel_name: 'general',
          mapping_action: 'create_new',
          new_channel_name: '   ',
        },
      ]),
    ).rejects.toThrow(/Name the new channel/);
  });

  it('marks a skipped channel skipped rather than pending', async () => {
    await build();
    const rows = await service.setChannelMapping(IMPORT_ID, CHAPTER, [
      {
        discord_channel_id: '1',
        discord_channel_name: 'general',
        mapping_action: 'skip',
      },
    ]);
    expect(rows[0].status).toBe('skipped');
  });
});

describe('DiscordImportService — starting', () => {
  it('refuses to start with no uploaded export', async () => {
    await build();
    await expect(service.start(IMPORT_ID, CHAPTER)).rejects.toThrow(
      /Upload the exported JSON/,
    );
  });

  it('refuses to start while files are still uploading', async () => {
    await build();
    repo.findFiles.mockResolvedValue([
      { kind: 'export', uploaded_at: '2026-08-24T12:00:00Z' },
      { kind: 'media', uploaded_at: null },
    ]);
    await expect(service.start(IMPORT_ID, CHAPTER)).rejects.toThrow(
      /have not finished uploading/,
    );
  });

  it('refuses to start with no channel mapping', async () => {
    await build();
    repo.findFiles.mockResolvedValue([
      { kind: 'export', uploaded_at: '2026-08-24T12:00:00Z' },
    ]);
    await expect(service.start(IMPORT_ID, CHAPTER)).rejects.toThrow(
      /Map the exported channels/,
    );
  });

  it('queues the import and records how many parts to expect', async () => {
    await build();
    repo.findFiles.mockResolvedValue([
      { kind: 'export', uploaded_at: '2026-08-24T12:00:00Z' },
      { kind: 'export', uploaded_at: '2026-08-24T12:00:00Z' },
    ]);
    repo.findChannels.mockResolvedValue([{ id: 'map-1' }]);

    await service.start(IMPORT_ID, CHAPTER);

    expect(repo.update).toHaveBeenCalledWith(IMPORT_ID, CHAPTER, {
      status: 'ready',
      parts_total: 2,
      error: null,
    });
  });
});

describe('DiscordImportService — lifecycle guards', () => {
  it('404s an import from another chapter', async () => {
    await build();
    repo.findById.mockResolvedValue(null);
    await expect(service.get(IMPORT_ID, CHAPTER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('refuses to change a running import', async () => {
    await build(job({ status: 'running' }));
    await expect(
      service.setRoleMapping(IMPORT_ID, CHAPTER, []),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to purge a running import rather than racing the worker', async () => {
    await build(job({ status: 'running' }));
    await expect(service.requestPurge(IMPORT_ID, CHAPTER)).rejects.toThrow(
      /Cancel the running import/,
    );
  });

  it('queues a completed import for purge', async () => {
    await build(job({ status: 'completed' }));
    await service.requestPurge(IMPORT_ID, CHAPTER);
    expect(repo.update).toHaveBeenCalledWith(IMPORT_ID, CHAPTER, {
      status: 'purging',
    });
  });

  it('treats purging an already-purged import as done, not an error', async () => {
    await build(job({ status: 'purged' }));
    const result = await service.requestPurge(IMPORT_ID, CHAPTER);
    expect(result.status).toBe('purged');
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('stores the role mapping without ever granting anything', async () => {
    await build();
    await service.setRoleMapping(IMPORT_ID, CHAPTER, [
      {
        discord_role_id: '1',
        discord_role_name: 'President',
        signet_role_key: 'member',
      },
    ]);

    // The only write is the worksheet itself. No member, role, or permission
    // repository is reachable from this service at all.
    expect(repo.update).toHaveBeenCalledWith(IMPORT_ID, CHAPTER, {
      role_mapping: [
        {
          discord_role_id: '1',
          discord_role_name: 'President',
          signet_role_key: 'member',
        },
      ],
    });
  });
});
