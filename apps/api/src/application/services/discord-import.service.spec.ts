import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  MAX_ARCHIVE_CHAPTER_BYTES,
  MAX_ARCHIVE_EXPORT_PART_BYTES,
  MAX_ARCHIVE_IMPORT_BYTES,
} from '@repo/validation';
import { DiscordImportService } from './discord-import.service';
import {
  ArchiveQuotaExceededError,
  DISCORD_IMPORT_REPOSITORY,
} from '#domain/repositories/discord-import.repository.interface';
import { CHAT_CHANNEL_REPOSITORY } from '#domain/repositories/chat.repository.interface';
import { STORAGE_PROVIDER } from '#domain/adapters/storage.interface';
import {
  DISCORD_BOT_GATEWAY,
  DiscordNotConfiguredError,
} from '#domain/adapters/discord.interface';
import { DiscordOAuthService } from './discord-oauth.service';
import { RbacService } from './rbac.service';
import type { DiscordImport } from '#domain/entities/discord-import.entity';
import { isUnsafeStoragePath } from '#domain/utils/storage-path';

const CHAPTER = '11111111-1111-4111-8111-111111111111';
const USER = '33333333-3333-4333-8333-333333333333';
const IMPORT_ID = '44444444-4444-4444-8444-444444444444';
const GUILD = '800000000000000001';

function job(overrides: Partial<DiscordImport> = {}): DiscordImport {
  return {
    id: IMPORT_ID,
    chapter_id: CHAPTER,
    created_by: USER,
    status: 'draft',
    source: 'upload',
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
    cleared_at: null,
    messages_after: null,
    ...overrides,
  };
}

let repo: Record<string, jest.Mock>;
let storage: Record<string, jest.Mock>;
let channelRepo: Record<string, jest.Mock>;
let bot: Record<string, jest.Mock>;
let oauthService: Record<string, jest.Mock>;
let rbac: Record<string, jest.Mock>;
let service: DiscordImportService;

/** A channel that exists in this chapter, and nothing else. */
const OWN_CHANNEL = '66666666-6666-4666-8666-666666666666';
const FOREIGN_CHANNEL = '77777777-7777-4777-8777-777777777777';

async function build(current: DiscordImport = job()) {
  repo = {
    create: jest.fn(async () => current),
    findById: jest.fn(async () => current),
    findByChapter: jest.fn(async () => [current]),
    update: jest.fn(async (_id, _chapter, patch) => ({ ...current, ...patch })),
    replaceChannels: jest.fn(async (_id, _chapter, rows) => rows),
    findChannels: jest.fn(async () => []),
    countChannels: jest.fn(async () => ({ total: 0, done: 0 })),
    findChannelProgress: jest.fn(async () => ({
      counts: { pending: 0, running: 0, completed: 0, failed: 0, skipped: 0 },
      running: [],
      recent: [],
      failed: [],
    })),
    markCleared: jest.fn(async () => ({ ...current, cleared_at: 'now' })),
    updateChannel: jest.fn(),
    // Registration enforces the archive ceilings itself now, so the default
    // admits everything and the quota tests make it throw. That mirrors the
    // real contract: the service never decides, it translates.
    registerFiles: jest.fn(async (_chapterId, _importId, rows) =>
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
  bot = {
    isConfigured: jest.fn(() => true),
    discoverChannels: jest.fn(),
    verifyChannelInGuild: jest.fn(),
    fetchMessagePage: jest.fn(),
  };
  oauthService = {
    requireGuildId: jest.fn(async () => GUILD),
    isAvailable: jest.fn(() => true),
  };
  channelRepo = {
    // Chapter-scoped by construction, like the real repository.
    findById: jest.fn(async (id: string, chapterId: string) =>
      id === OWN_CHANNEL && chapterId === CHAPTER
        ? { id, chapter_id: chapterId, name: 'general' }
        : null,
    ),
    create: jest.fn(),
    findRoleGates: jest.fn(async () => []),
  };
  rbac = {
    findByChapter: jest.fn(async () => []),
    create: jest.fn(),
    update: jest.fn(),
  };
  const moduleRef = await Test.createTestingModule({
    providers: [
      DiscordImportService,
      { provide: DISCORD_IMPORT_REPOSITORY, useValue: repo },
      { provide: STORAGE_PROVIDER, useValue: storage },
      { provide: CHAT_CHANNEL_REPOSITORY, useValue: channelRepo },
      // Phase-3 collaborators. Every test in this file exercises the UPLOAD
      // path, which never reaches either — they are here so the container can
      // be built, and any test that does touch them stubs them itself.
      { provide: DISCORD_BOT_GATEWAY, useValue: bot },
      { provide: DiscordOAuthService, useValue: oauthService },
      { provide: RbacService, useValue: rbac },
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
        storage_prefix: expect.stringContaining(
          `chat-archive/imports/${IMPORT_ID}`,
        ),
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
      file({
        kind: 'media',
        relative_path: 'general_Files/a.png',
        content_type: 'image/png',
      }),
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

  it('rejects a media type the archive bucket would reject anyway', async () => {
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
        file({
          kind: 'media',
          relative_path: 'huge.mp4',
          byte_size: 200 * 1024 * 1024,
        }),
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

  it('surfaces an import-ceiling refusal as a 400 naming what to do', async () => {
    await build();
    repo.registerFiles.mockRejectedValue(
      new ArchiveQuotaExceededError(
        'import',
        MAX_ARCHIVE_IMPORT_BYTES + 1,
        MAX_ARCHIVE_IMPORT_BYTES,
      ),
    );

    await expect(
      service.requestUploadUrls(IMPORT_ID, CHAPTER, [file()]),
    ).rejects.toThrow(/limit for one import/);
  });

  it('surfaces a chapter-ceiling refusal as a 400, and says deletion is not instant', async () => {
    // The advice has to be honest: `requestPurge` only flips the status to
    // `purging`, and the sweep finishes in the background — an admin told to
    // "delete an old import" who retries immediately would otherwise be
    // refused again with the same sentence.
    await build();
    repo.registerFiles.mockRejectedValue(
      new ArchiveQuotaExceededError(
        'chapter',
        MAX_ARCHIVE_CHAPTER_BYTES + 1,
        MAX_ARCHIVE_CHAPTER_BYTES,
      ),
    );

    await expect(
      service.requestUploadUrls(IMPORT_ID, CHAPTER, [file()]),
    ).rejects.toThrow(/Delete an old import.*background/s);
  });

  it('mints no signed URL when registration refuses the batch', async () => {
    // The property that makes this a quota rather than a report. Registration
    // and enforcement share a transaction, so a refusal means no manifest row
    // exists — and this asserts the service does not hand back a URL the
    // caller could still PUT to regardless.
    await build();
    repo.registerFiles.mockRejectedValue(
      new ArchiveQuotaExceededError('chapter', 2, 1),
    );

    await expect(
      service.requestUploadUrls(IMPORT_ID, CHAPTER, [file()]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.getSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('renders ceiling sizes with the shared formatter, not a hard-coded GB unit', async () => {
    // The rollback playbook names constant-tuning as the fast forward-fix for a
    // misfiring quota, so a lowered ceiling has to render as itself. A GB-only
    // helper turned a 50 MB ceiling into "0 GB".
    await build();
    repo.registerFiles.mockRejectedValue(
      new ArchiveQuotaExceededError(
        'import',
        60 * 1024 * 1024,
        50 * 1024 * 1024,
      ),
    );

    await expect(
      service.requestUploadUrls(IMPORT_ID, CHAPTER, [file()]),
    ).rejects.toThrow(/60 MB of files, past the 50 MB limit/);
  });

  it('does not tell a bot-path admin to re-export without --media', async () => {
    // They never ran DiscordChatExporter: there is no export folder and no
    // --media flag in their flow, so that advice names three things that do
    // not exist and leaves them with no next step.
    await build(job({ source: 'bot' }));
    repo.registerFiles.mockRejectedValue(
      new ArchiveQuotaExceededError(
        'import',
        MAX_ARCHIVE_IMPORT_BYTES + 1,
        MAX_ARCHIVE_IMPORT_BYTES,
      ),
    );

    const caught = await service
      .requestUploadUrls(IMPORT_ID, CHAPTER, [file()])
      .catch((error: Error) => error);

    expect(caught.message).toMatch(/limit for one import/);
    expect(caught.message).not.toMatch(/--media/);
    expect(caught.message).toMatch(/Import fewer channels/);
  });

  it('hands registration the caller scope, the batch, and both ceilings', async () => {
    // The service never decides the verdict — it passes the ceilings down and
    // translates what comes back. If this drifts, the quota silently stops
    // being enforced with no test failing on the arithmetic.
    await build();
    await service.requestUploadUrls(IMPORT_ID, CHAPTER, [
      file({ relative_path: 'part-000.json', byte_size: 111 }),
    ]);

    expect(repo.registerFiles).toHaveBeenCalledWith(
      CHAPTER,
      IMPORT_ID,
      [
        expect.objectContaining({
          relative_path: 'part-000.json',
          byte_size: 111,
        }),
      ],
      {
        importBytes: MAX_ARCHIVE_IMPORT_BYTES,
        chapterBytes: MAX_ARCHIVE_CHAPTER_BYTES,
      },
    );
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
      file({
        kind: 'media',
        relative_path: 'a/b.png',
        content_type: 'image/png',
      }),
      file({
        kind: 'media',
        relative_path: 'a_b.png',
        content_type: 'image/png',
      }),
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
    ).rejects.toThrow(/Pick a Frapp channel/);
  });

  it('refuses a target channel from another chapter', async () => {
    // The highest-consequence input on this surface. `chat_messages` has no
    // `chapter_id`, so its FK accepts any channel in the product — and the
    // purge scopes its delete by the import's chapter, so history written into
    // another chapter could never be removed.
    await build();
    await expect(
      service.setChannelMapping(IMPORT_ID, CHAPTER, [
        {
          discord_channel_id: '1',
          discord_channel_name: 'general',
          mapping_action: 'use_existing',
          target_channel_id: FOREIGN_CHANNEL,
        },
      ]),
    ).rejects.toThrow(/not one of this chapter/);
  });

  it('accepts a target channel that belongs to this chapter', async () => {
    await build();
    const rows = await service.setChannelMapping(IMPORT_ID, CHAPTER, [
      {
        discord_channel_id: '1',
        discord_channel_name: 'general',
        mapping_action: 'use_existing',
        target_channel_id: OWN_CHANNEL,
      },
    ]);

    expect(rows[0].target_channel_id).toBe(OWN_CHANNEL);
    expect(channelRepo.findById).toHaveBeenCalledWith(OWN_CHANNEL, CHAPTER);
  });

  it('refuses a direct message or group DM as a target (#2856)', async () => {
    await build();
    for (const type of ['DM', 'GROUP_DM']) {
      channelRepo.findById.mockResolvedValueOnce({
        id: OWN_CHANNEL,
        chapter_id: CHAPTER,
        name: 'officers',
        type,
      });
      await expect(
        service.setChannelMapping(IMPORT_ID, CHAPTER, [
          {
            discord_channel_id: '1',
            discord_channel_name: 'officers',
            mapping_action: 'use_existing',
            target_channel_id: OWN_CHANNEL,
          },
        ]),
      ).rejects.toThrow(/can't be imported into a direct message/);
    }
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
          new_channel_visibility: 'chapter',
        },
      ]),
    ).rejects.toThrow(/Name the new channel/);
  });

  it('drops a target sent with a new channel, as the bot path does (#2856)', async () => {
    // A create_new row's target is the channel the import creates for it,
    // which like-named rows then share; a client-sent id there would be an
    // unvalidated channel those rows could be sent into.
    await build();
    const rows = await service.setChannelMapping(IMPORT_ID, CHAPTER, [
      {
        discord_channel_id: '1',
        discord_channel_name: 'general',
        mapping_action: 'create_new',
        new_channel_name: 'general',
        new_channel_visibility: 'chapter',
        target_channel_id: FOREIGN_CHANNEL,
      },
    ]);

    expect(rows[0].target_channel_id).toBeNull();
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
    await expect(service.start(IMPORT_ID, CHAPTER, true)).rejects.toThrow(
      /Upload the exported JSON/,
    );
  });

  it('refuses to start while files are still uploading', async () => {
    await build();
    repo.findFiles.mockResolvedValue([
      { kind: 'export', uploaded_at: '2026-08-24T12:00:00Z' },
      { kind: 'media', uploaded_at: null },
    ]);
    await expect(service.start(IMPORT_ID, CHAPTER, true)).rejects.toThrow(
      /have not finished uploading/,
    );
  });

  it('refuses to start with no channel mapping', async () => {
    await build();
    repo.findFiles.mockResolvedValue([
      { kind: 'export', uploaded_at: '2026-08-24T12:00:00Z' },
    ]);
    await expect(service.start(IMPORT_ID, CHAPTER, true)).rejects.toThrow(
      /Map the exported channels/,
    );
  });

  it('refuses to start a merge whose channel was deleted after it was mapped (#2922)', async () => {
    // `target_channel_id` is `on delete set null`, and the database no longer
    // refuses a merge without one, so the start is where it is caught.
    await build();
    repo.findFiles.mockResolvedValue([
      { kind: 'export', uploaded_at: '2026-08-24T12:00:00Z' },
    ]);
    repo.findChannels.mockResolvedValue([
      {
        id: 'map-1',
        discord_channel_name: 'rush',
        mapping_action: 'create_new',
        target_channel_id: null,
      },
      // An upload's row reads completed after any of its parts, with more
      // to come, so it counts whatever its status.
      {
        id: 'map-2',
        discord_channel_name: 'general',
        mapping_action: 'use_existing',
        target_channel_id: null,
        status: 'completed',
      },
    ]);

    await expect(service.start(IMPORT_ID, CHAPTER, true)).rejects.toThrow(
      'The Frapp channel chosen for #general was deleted. Pick another channel for it, or choose to create a new one.',
    );
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('restarts a bot import past a finished or skipped merge whose channel was deleted, which the worker never walks again (#2922)', async () => {
    await build(job({ source: 'bot', status: 'failed', guild_id: GUILD }));
    repo.findChannels.mockResolvedValue([
      {
        id: 'map-1',
        discord_channel_id: 'd-general',
        discord_channel_name: 'general',
        mapping_action: 'use_existing',
        target_channel_id: null,
        status: 'completed',
        parent_discord_channel_id: null,
      },
      // Skipped when Discord stopped showing it, whatever its mapping.
      {
        id: 'map-3',
        discord_channel_id: 'd-announcements',
        discord_channel_name: 'announcements',
        mapping_action: 'use_existing',
        target_channel_id: null,
        status: 'skipped',
        parent_discord_channel_id: null,
      },
      {
        id: 'map-2',
        discord_channel_id: 'd-rush',
        discord_channel_name: 'rush',
        mapping_action: 'create_new',
        target_channel_id: null,
        status: 'failed',
        parent_discord_channel_id: null,
      },
    ]);

    await service.start(IMPORT_ID, CHAPTER, true);

    expect(repo.update).toHaveBeenCalledWith(
      IMPORT_ID,
      CHAPTER,
      expect.objectContaining({ status: 'ready' }),
    );
  });

  it("names a thread's lost merge by its parent, the channel the admin mapped (#2922)", async () => {
    await build(job({ source: 'bot', status: 'failed', guild_id: GUILD }));
    repo.findChannels.mockResolvedValue([
      {
        id: 'map-1',
        discord_channel_id: 'd-general',
        discord_channel_name: 'general',
        mapping_action: 'use_existing',
        target_channel_id: null,
        status: 'completed',
        parent_discord_channel_id: null,
      },
      {
        id: 'map-2',
        discord_channel_id: 'd-planning',
        discord_channel_name: 'general › planning',
        mapping_action: 'use_existing',
        target_channel_id: null,
        status: 'pending',
        parent_discord_channel_id: 'd-general',
      },
    ]);

    await expect(service.start(IMPORT_ID, CHAPTER, true)).rejects.toThrow(
      "The Frapp channel chosen for #general was deleted, so this import can't carry on. To bring #general in, delete this import and import again.",
    );
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('queues the import and records how many parts to expect', async () => {
    await build();
    repo.findFiles.mockResolvedValue([
      { kind: 'export', uploaded_at: '2026-08-24T12:00:00Z' },
      { kind: 'export', uploaded_at: '2026-08-24T12:00:00Z' },
    ]);
    repo.findChannels.mockResolvedValue([{ id: 'map-1' }]);

    await service.start(IMPORT_ID, CHAPTER, true);

    expect(repo.update).toHaveBeenCalledWith(IMPORT_ID, CHAPTER, {
      status: 'ready',
      parts_total: 2,
      error: null,
      role_mapping: [],
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
});

// ── the bot path ────────────────────────────────────────────────────────────
//
// Everything above exercises the DiscordChatExporter upload flow, which this
// phase does not change. What follows is the second way in, and the properties
// worth pinning are the ones that keep one shared bot inside one chapter.

function botChannel(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mapping-1',
    import_id: IMPORT_ID,
    discord_channel_id: '900000000000000001',
    discord_channel_name: 'general',
    discord_category: null,
    mapping_action: 'skip' as const,
    target_channel_id: null,
    new_channel_name: null,
    new_channel_is_read_only: true,
    message_count: 0,
    imported_count: 0,
    status: 'skipped' as const,
    error: null,
    cursor_before_snowflake: null,
    parent_discord_channel_id: null,
    position: 0,
    readable: true,
    private_in_discord: false,
    new_channel_type: 'PUBLIC' as const,
    new_channel_required_permissions: null,
    discord_reader_role_ids: null,
    new_channel_same_as_discord: false,
    ...overrides,
  };
}

describe('DiscordImportService — progress and clearing (#2816, #2817)', () => {
  it.each(['ready', 'running', 'failed', 'cancelled'] as const)(
    'counts progress for a %s bot import, which the list shows part-way',
    async (status) => {
      await build(job({ source: 'bot', status }));
      repo.countChannels.mockResolvedValue({ total: 900, done: 201 });
      expect(await service.get(IMPORT_ID, CHAPTER)).toMatchObject({
        channels_total: 900,
        channels_done: 201,
      });
    },
  );

  it('still lists the imports when a progress count fails', async () => {
    // The list is where the admin stops or deletes an import, so a count
    // that fails must not take it down with it.
    await build(job({ source: 'bot', status: 'running' }));
    repo.countChannels.mockRejectedValue(new Error('count timed out'));
    const [listed] = await service.list(CHAPTER);
    expect(listed).toMatchObject({
      id: IMPORT_ID,
      channels_total: null,
      channels_done: null,
    });
    expect(await service.get(IMPORT_ID, CHAPTER)).toMatchObject({
      channels_total: null,
    });
  });

  it("reports a bot import's progress in channel rows, since its message total grows as it reads", async () => {
    await build(
      job({
        source: 'bot',
        status: 'running',
        total_messages: 5307,
        imported_messages: 5307,
      }),
    );
    repo.countChannels.mockResolvedValue({ total: 900, done: 201 });

    const detail = await service.get(IMPORT_ID, CHAPTER);
    expect(detail).toMatchObject({ channels_total: 900, channels_done: 201 });
    const [listed] = await service.list(CHAPTER);
    expect(listed).toMatchObject({ channels_total: 900, channels_done: 201 });
    expect(repo.countChannels).toHaveBeenCalledWith(IMPORT_ID, CHAPTER);
  });

  it("leaves an upload's progress to its message counts", async () => {
    await build(job({ source: 'upload' }));
    expect(await service.get(IMPORT_ID, CHAPTER)).toMatchObject({
      channels_total: null,
      channels_done: null,
    });
    expect(repo.countChannels).not.toHaveBeenCalled();
  });

  it.each(['draft', 'completed', 'purged'] as const)(
    'skips the counts for a %s bot import, which has no progress to show',
    async (status) => {
      await build(job({ source: 'bot', status }));
      expect(await service.get(IMPORT_ID, CHAPTER)).toMatchObject({
        channels_total: null,
        channels_done: null,
      });
      await service.list(CHAPTER);
      expect(repo.countChannels).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['stops', 'cancelled'],
    ['deletes', 'purging'],
  ] as const)(
    '%s a bot import without waiting on its progress counts',
    async (_verb, next) => {
      await build(job({ source: 'bot', status: 'cancelled' }));
      const act =
        next === 'cancelled'
          ? service.cancel(IMPORT_ID, CHAPTER)
          : service.requestPurge(IMPORT_ID, CHAPTER);
      await act;
      expect(repo.update).toHaveBeenCalledWith(IMPORT_ID, CHAPTER, {
        status: next,
      });
      expect(repo.countChannels).not.toHaveBeenCalled();
    },
  );

  it('starts a queued bot import without waiting on its progress counts', async () => {
    // Queued (`ready`) is counted for the list, so a start read through the
    // counted path would wait on them first.
    await build(job({ source: 'bot', status: 'ready', guild_id: GUILD }));
    repo.findChannels.mockResolvedValue([
      { id: 'map-1', mapping_action: 'create_new' },
    ]);
    await service.start(IMPORT_ID, CHAPTER, true);
    expect(repo.countChannels).not.toHaveBeenCalled();
  });

  it('answers a clear without waiting on progress counts', async () => {
    // A stopped bot import is counted for the list, so reading it through
    // the counted path would make the refusal wait on (and fail with) them.
    await build(job({ source: 'bot', status: 'cancelled' }));
    repo.markCleared.mockResolvedValue(null);
    await expect(service.clear(IMPORT_ID, CHAPTER)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(repo.countChannels).not.toHaveBeenCalled();
  });

  it('clears only a deleted import', async () => {
    await build(job({ status: 'purged' }));
    await service.clear(IMPORT_ID, CHAPTER);
    expect(repo.markCleared).toHaveBeenCalledWith(
      IMPORT_ID,
      CHAPTER,
      ['purged'],
      expect.any(String),
    );
  });

  it('refuses to clear an import that still holds what it brought in', async () => {
    await build(job({ status: 'completed' }));
    // The conditional write matches nothing for an import that is not purged.
    repo.markCleared.mockResolvedValue(null);
    await expect(service.clear(IMPORT_ID, CHAPTER)).rejects.toThrow(
      'Only a deleted import can be cleared. Delete it first.',
    );
  });

  it('404s clearing an import from another chapter', async () => {
    await build();
    repo.findById.mockResolvedValue(null);
    await expect(service.clear(IMPORT_ID, CHAPTER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repo.markCleared).not.toHaveBeenCalled();
  });
});

describe('DiscordImportService — the date cutoff (#2858)', () => {
  const CUTOFF = '2024-06-01T00:00:00.000Z';
  const botDraft = (overrides: Partial<DiscordImport> = {}) =>
    job({ source: 'bot', status: 'draft', guild_id: GUILD, ...overrides });
  const mapped = () =>
    repo.findChannels.mockResolvedValue([
      { id: 'map-1', mapping_action: 'create_new' },
    ]);

  it('sets it on the first start of a bot import', async () => {
    await build(botDraft());
    mapped();
    await service.start(IMPORT_ID, CHAPTER, true, {
      messagesAfter: '2024-06-01T00:00:00Z',
    });
    expect(repo.update).toHaveBeenCalledWith(
      IMPORT_ID,
      CHAPTER,
      expect.objectContaining({ status: 'ready', messages_after: CUTOFF }),
    );
  });

  it('writes nothing about it when a start leaves it out', async () => {
    // So a start without one works against a database without the column.
    await build(botDraft({ status: 'failed', messages_after: CUTOFF }));
    mapped();
    await service.start(IMPORT_ID, CHAPTER, true);
    expect(repo.update.mock.calls[0][2]).not.toHaveProperty('messages_after');
  });

  it('lets a restart repeat it, and refuses to change it once started', async () => {
    await build(botDraft({ status: 'failed', messages_after: CUTOFF }));
    mapped();
    await service.start(IMPORT_ID, CHAPTER, true, { messagesAfter: CUTOFF });
    expect(repo.update.mock.calls[0][2]).not.toHaveProperty('messages_after');

    await expect(
      service.start(IMPORT_ID, CHAPTER, true, {
        messagesAfter: '2023-01-01T00:00:00Z',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.start(IMPORT_ID, CHAPTER, true, { messagesAfter: null }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a date in the future, before creating any role', async () => {
    await build(botDraft());
    mapped();
    await expect(
      service.start(IMPORT_ID, CHAPTER, true, {
        messagesAfter: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    ).rejects.toThrow(/date in the past/);
    expect(repo.findChannels).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('answers a date shape it cannot read with a 400, not a 500', async () => {
    await build(botDraft());
    mapped();
    await expect(
      service.start(IMPORT_ID, CHAPTER, true, { messagesAfter: '2025-W01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('writes nothing for an explicit null on a row read before the migration', async () => {
    // No column yet: the row carries no messages_after at all.
    const unmigrated = botDraft() as Partial<DiscordImport>;
    delete unmigrated.messages_after;
    await build(unmigrated as DiscordImport);
    mapped();
    await service.start(IMPORT_ID, CHAPTER, true, { messagesAfter: null });
    expect(repo.update.mock.calls[0][2]).not.toHaveProperty('messages_after');
  });

  it('refuses one on an upload, whose range is set when exporting', async () => {
    await build(job({ status: 'draft' }));
    await expect(
      service.start(IMPORT_ID, CHAPTER, true, { messagesAfter: CUTOFF }),
    ).rejects.toThrow(/--after/);
  });
});

describe('DiscordImportService — creating a bot import', () => {
  it('binds the guild through the chapter, never from anything the caller sent', async () => {
    const svc = await build(job({ source: 'bot' }));
    await svc.create(CHAPTER, USER, {
      consent_acknowledged: true,
      source: 'bot',
    });

    expect(oauthService.requireGuildId).toHaveBeenCalledWith(CHAPTER);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'bot', guild_id: GUILD }),
    );
  });

  it('refuses when the chapter has not connected a Discord server', async () => {
    const svc = await build(job({ source: 'bot' }));
    oauthService.requireGuildId.mockRejectedValue(
      new Error('This chapter has not connected a Discord server yet.'),
    );

    await expect(
      svc.create(CHAPTER, USER, { consent_acknowledged: true, source: 'bot' }),
    ).rejects.toThrow(/has not connected/);
  });

  it('still demands the consent acknowledgement, exactly like the upload path', async () => {
    const svc = await build(job({ source: 'bot' }));
    await expect(
      svc.create(CHAPTER, USER, { consent_acknowledged: false, source: 'bot' }),
    ).rejects.toThrow(/posted the archive notice/);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('defaults to the upload path when no source is given', async () => {
    const svc = await build();
    await svc.create(CHAPTER, USER, { consent_acknowledged: true });
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'upload', guild_id: null }),
    );
    expect(oauthService.requireGuildId).not.toHaveBeenCalled();
  });
});

describe('DiscordImportService — discovering a guild', () => {
  it('records every discovered channel as skip, so nothing imports unasked', async () => {
    const svc = await build(job({ source: 'bot' }));
    bot.discoverChannels.mockResolvedValue({
      channels: [
        {
          id: '900000000000000001',
          name: 'general',
          guildId: GUILD,
          categoryName: 'Text',
          parentChannelId: null,
          isThread: false,
        },
      ],
      warnings: [],
      roles: [{ id: '3', name: 'Exec' }],
    });

    const result = await svc.discoverBotChannels(IMPORT_ID, CHAPTER);

    expect(bot.discoverChannels).toHaveBeenCalledWith(GUILD);
    expect(repo.replaceChannels).toHaveBeenCalledWith(IMPORT_ID, CHAPTER, [
      expect.objectContaining({ mapping_action: 'skip', status: 'skipped' }),
    ]);
    expect(result.roles).toEqual([
      { discord_role_id: '3', discord_role_name: 'Exec' },
    ]);
  });

  it('orders a thread directly after its parent, which the walk depends on', async () => {
    const svc = await build(job({ source: 'bot' }));
    bot.discoverChannels.mockResolvedValue({
      channels: [
        {
          id: 'c1',
          name: 'general',
          guildId: GUILD,
          categoryName: null,
          parentChannelId: null,
          isThread: false,
        },
        {
          id: 'c2',
          name: 'random',
          guildId: GUILD,
          categoryName: null,
          parentChannelId: null,
          isThread: false,
        },
        {
          id: 't1',
          name: 'general › planning',
          guildId: GUILD,
          categoryName: 'general',
          parentChannelId: 'c1',
          isThread: true,
        },
      ],
      warnings: [],
      roles: [],
    });

    await svc.discoverBotChannels(IMPORT_ID, CHAPTER);

    const rows = repo.replaceChannels.mock.calls[0][2] as {
      discord_channel_id: string;
      position: number;
    }[];
    // A parent must be walked before the threads that inherit its destination.
    expect(rows.map((row) => row.discord_channel_id)).toEqual([
      'c1',
      't1',
      'c2',
    ]);
    expect(rows.map((row) => row.position)).toEqual([0, 1, 2]);
  });

  it('surfaces what could not be enumerated instead of dropping it silently', async () => {
    const svc = await build(job({ source: 'bot' }));
    bot.discoverChannels.mockResolvedValue({
      channels: [],
      warnings: ['Private archived threads in #general could not be read'],
      roles: [],
    });

    const result = await svc.discoverBotChannels(IMPORT_ID, CHAPTER);

    expect(result.warnings).toHaveLength(1);
    expect(repo.update).toHaveBeenCalledWith(
      IMPORT_ID,
      CHAPTER,
      expect.objectContaining({ guild_id: GUILD }),
    );
  });

  it('503s when the bot is not configured, carrying the gateway error as cause', async () => {
    const svc = await build(job({ source: 'bot' }));
    const notConfigured = new DiscordNotConfiguredError(
      'DISCORD_BOT_TOKEN is not set',
    );
    bot.discoverChannels.mockRejectedValue(notConfigured);

    const thrown = await svc
      .discoverBotChannels(IMPORT_ID, CHAPTER)
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(ServiceUnavailableException);
    expect((thrown as Error).message).not.toContain('DISCORD_BOT_TOKEN');
    // Sentry reads the gateway's own error off `cause` (#2131).
    expect((thrown as Error).cause).toBe(notConfigured);
  });

  it('refuses to scan on behalf of an upload import', async () => {
    const svc = await build(job({ source: 'upload' }));
    await expect(svc.discoverBotChannels(IMPORT_ID, CHAPTER)).rejects.toThrow(
      /nothing to discover/,
    );
    expect(bot.discoverChannels).not.toHaveBeenCalled();
  });

  it('refuses when the chapter reconnected to a different server', async () => {
    const svc = await build(job({ source: 'bot', guild_id: 'old-guild' }));
    await expect(svc.discoverBotChannels(IMPORT_ID, CHAPTER)).rejects.toThrow(
      /different Discord server/,
    );
    expect(bot.discoverChannels).not.toHaveBeenCalled();
  });
});

describe('DiscordImportService — what the scan saw, and who may read what (#2787)', () => {
  it("records the bot's access and the channel's privacy from the scan", async () => {
    const svc = await build(job({ source: 'bot' }));
    bot.discoverChannels.mockResolvedValue({
      channels: [
        {
          id: 'c1',
          name: 'cabinet',
          guildId: GUILD,
          categoryName: 'Exec',
          parentChannelId: null,
          isThread: false,
          holdsOnlyThreads: false,
          readable: false,
          privateInDiscord: true,
        },
      ],
      warnings: [],
      roles: [],
    });

    await svc.discoverBotChannels(IMPORT_ID, CHAPTER);

    expect(repo.replaceChannels).toHaveBeenCalledWith(IMPORT_ID, CHAPTER, [
      expect.objectContaining({
        readable: false,
        private_in_discord: true,
        new_channel_type: 'PUBLIC',
        new_channel_required_permissions: null,
      }),
    ]);
  });

  it('REFUSES to import a channel the bot cannot read', async () => {
    const svc = await build(job({ source: 'bot' }));
    repo.findChannels.mockResolvedValue([
      botChannel({ discord_channel_name: 'cabinet', readable: false }),
    ]);
    await expect(
      svc.applyDiscoveredChannelMapping(IMPORT_ID, CHAPTER, [
        {
          discord_channel_id: '900000000000000001',
          discord_channel_name: 'cabinet',
          mapping_action: 'create_new',
          new_channel_name: 'cabinet',
          new_channel_visibility: 'chapter',
        },
      ]),
    ).rejects.toThrow(/cannot read #cabinet/);
    expect(repo.replaceChannels).not.toHaveBeenCalled();
  });

  it('refuses a merge with no target chosen, as the upload route does', async () => {
    // The database no longer backs this up: a merge row may lose its target
    // when an officer deletes the channel (#2922), so the route is the rule.
    const svc = await build(job({ source: 'bot' }));
    repo.findChannels.mockResolvedValue([botChannel()]);
    await expect(
      svc.applyDiscoveredChannelMapping(IMPORT_ID, CHAPTER, [
        {
          discord_channel_id: '900000000000000001',
          discord_channel_name: 'general',
          mapping_action: 'use_existing',
        },
      ]),
    ).rejects.toThrow(/Pick a Frapp channel for #general/);
    expect(repo.replaceChannels).not.toHaveBeenCalled();
  });

  it('REFUSES to merge a channel the bot cannot read, not only to create one', async () => {
    const svc = await build(job({ source: 'bot' }));
    repo.findChannels.mockResolvedValue([
      botChannel({ discord_channel_name: 'cabinet', readable: false }),
    ]);
    await expect(
      svc.applyDiscoveredChannelMapping(IMPORT_ID, CHAPTER, [
        {
          discord_channel_id: '900000000000000001',
          discord_channel_name: 'cabinet',
          mapping_action: 'use_existing',
          target_channel_id: OWN_CHANNEL,
        },
      ]),
    ).rejects.toThrow(/cannot read #cabinet/);
    expect(repo.replaceChannels).not.toHaveBeenCalled();
  });

  it('still lets an unreadable channel be skipped', async () => {
    const svc = await build(job({ source: 'bot' }));
    repo.findChannels.mockResolvedValue([botChannel({ readable: false })]);
    await svc.applyDiscoveredChannelMapping(IMPORT_ID, CHAPTER, [
      {
        discord_channel_id: '900000000000000001',
        discord_channel_name: 'general',
        mapping_action: 'skip',
      },
    ]);
    expect(repo.replaceChannels).toHaveBeenCalled();
  });

  it('REFUSES to create a channel that was private in Discord without an explicit visibility', async () => {
    // The default would be PUBLIC: #cabinet readable by every member.
    const svc = await build(job({ source: 'bot' }));
    repo.findChannels.mockResolvedValue([
      botChannel({ discord_channel_name: 'cabinet', private_in_discord: true }),
    ]);
    await expect(
      svc.applyDiscoveredChannelMapping(IMPORT_ID, CHAPTER, [
        {
          discord_channel_id: '900000000000000001',
          discord_channel_name: 'cabinet',
          mapping_action: 'create_new',
          new_channel_name: 'cabinet',
        },
      ]),
    ).rejects.toThrow(/private in Discord/);
  });

  it('reads a null visibility as not chosen, not as a choice of the whole chapter', async () => {
    // `@IsOptional` lets null through validation; it must not slip past here.
    const svc = await build(job({ source: 'bot' }));
    repo.findChannels.mockResolvedValue([
      botChannel({ discord_channel_name: 'cabinet', private_in_discord: true }),
    ]);
    await expect(
      svc.applyDiscoveredChannelMapping(IMPORT_ID, CHAPTER, [
        {
          discord_channel_id: '900000000000000001',
          discord_channel_name: 'cabinet',
          mapping_action: 'create_new',
          new_channel_name: 'cabinet',
          new_channel_visibility: null,
        },
      ]),
    ).rejects.toThrow(/private in Discord/);
    expect(repo.replaceChannels).not.toHaveBeenCalled();
  });

  it('treats a channel whose privacy the scan could not read as private', async () => {
    // The roles read that answers "private?" can fail on its own; unknown must
    // not fall to the public default.
    const svc = await build(job({ source: 'bot' }));
    repo.findChannels.mockResolvedValue([
      botChannel({ discord_channel_name: 'exec', private_in_discord: null }),
    ]);
    const decision = {
      discord_channel_id: '900000000000000001',
      discord_channel_name: 'exec',
      mapping_action: 'create_new' as const,
      new_channel_name: 'exec',
    };
    await expect(
      svc.applyDiscoveredChannelMapping(IMPORT_ID, CHAPTER, [decision]),
    ).rejects.toThrow(/could not tell whether #exec is private/);

    await svc.applyDiscoveredChannelMapping(IMPORT_ID, CHAPTER, [
      { ...decision, new_channel_visibility: 'chapter' },
    ]);
    expect(repo.replaceChannels).toHaveBeenCalled();
  });

  it('treats a channel holding a private thread as private, because the thread lands in it', async () => {
    const svc = await build(job({ source: 'bot' }));
    repo.findChannels.mockResolvedValue([
      botChannel({ discord_channel_id: 'c1', discord_channel_name: 'general' }),
      botChannel({
        id: 'm-thread',
        discord_channel_id: 't1',
        parent_discord_channel_id: 'c1',
        private_in_discord: true,
      }),
    ]);
    await expect(
      svc.applyDiscoveredChannelMapping(IMPORT_ID, CHAPTER, [
        {
          discord_channel_id: 'c1',
          discord_channel_name: 'general',
          mapping_action: 'create_new',
          new_channel_name: 'general',
        },
      ]),
    ).rejects.toThrow(/#general holds private threads/);
  });

  it('lets a channel the scan saw was public take the whole-chapter default, ordinary threads and all', async () => {
    const svc = await build(job({ source: 'bot' }));
    repo.findChannels.mockResolvedValue([
      botChannel(),
      // A public thread: only a PRIVATE one makes its channel need a choice.
      botChannel({
        id: 'm-thread',
        discord_channel_id: 't1',
        parent_discord_channel_id: '900000000000000001',
        private_in_discord: false,
      }),
    ]);
    await svc.applyDiscoveredChannelMapping(IMPORT_ID, CHAPTER, [
      {
        discord_channel_id: '900000000000000001',
        discord_channel_name: 'general',
        mapping_action: 'create_new',
        new_channel_name: 'general',
      },
    ]);
    const rows = repo.replaceChannels.mock.calls[0][2] as Record<
      string,
      unknown
    >[];
    expect(rows[0]).toMatchObject({ new_channel_type: 'PUBLIC' });
  });

  it('creates it public when the admin says so explicitly', async () => {
    const svc = await build(job({ source: 'bot' }));
    repo.findChannels.mockResolvedValue([
      botChannel({ private_in_discord: true }),
    ]);
    await svc.applyDiscoveredChannelMapping(IMPORT_ID, CHAPTER, [
      {
        discord_channel_id: '900000000000000001',
        discord_channel_name: 'general',
        mapping_action: 'create_new',
        new_channel_name: 'general',
        new_channel_visibility: 'chapter',
      },
    ]);
    const rows = repo.replaceChannels.mock.calls[0][2] as Record<
      string,
      unknown
    >[];
    expect(rows[0]).toMatchObject({
      new_channel_type: 'PUBLIC',
      new_channel_required_permissions: null,
      private_in_discord: true,
    });
  });

  it('records a restricted channel as ROLE_GATED, and its threads inherit it', async () => {
    const svc = await build(job({ source: 'bot' }));
    repo.findChannels.mockResolvedValue([
      botChannel({ discord_channel_id: 'c1', private_in_discord: true }),
      botChannel({
        id: 'm-thread',
        discord_channel_id: 't1',
        parent_discord_channel_id: 'c1',
        private_in_discord: true,
      }),
    ]);
    await svc.applyDiscoveredChannelMapping(IMPORT_ID, CHAPTER, [
      {
        discord_channel_id: 'c1',
        discord_channel_name: 'cabinet',
        mapping_action: 'create_new',
        new_channel_name: 'cabinet',
        new_channel_visibility: 'restricted',
        new_channel_required_permissions: [
          ' chapter-config:manage ',
          'chapter-config:manage',
          'billing:view',
        ],
      },
    ]);
    const rows = repo.replaceChannels.mock.calls[0][2] as Record<
      string,
      unknown
    >[];
    const shape = {
      new_channel_type: 'ROLE_GATED',
      new_channel_required_permissions: [
        'chapter-config:manage',
        'billing:view',
      ],
    };
    expect(rows[0]).toMatchObject(shape);
    expect(rows[1]).toMatchObject(shape);
  });

  it('REFUSES a restricted channel that names no permission', async () => {
    // Chat's own rule (FRA-321): a ROLE_GATED channel gating on nothing is
    // readable by no one but a President.
    const svc = await build(job({ source: 'bot' }));
    repo.findChannels.mockResolvedValue([botChannel()]);
    await expect(
      svc.applyDiscoveredChannelMapping(IMPORT_ID, CHAPTER, [
        {
          discord_channel_id: '900000000000000001',
          discord_channel_name: 'general',
          mapping_action: 'create_new',
          new_channel_name: 'general',
          new_channel_visibility: 'restricted',
          new_channel_required_permissions: ['  '],
        },
      ]),
    ).rejects.toThrow(/at least one permission/);
  });

  it('REFUSES a new channel from an export with no visibility, since an export says nothing about privacy', async () => {
    const svc = await build(job({ source: 'upload' }));
    await expect(
      svc.setChannelMapping(IMPORT_ID, CHAPTER, [
        {
          discord_channel_id: 'u1',
          discord_channel_name: 'cabinet',
          mapping_action: 'create_new',
          new_channel_name: 'cabinet',
          new_channel_visibility: null,
        },
      ]),
    ).rejects.toThrow(/An export does not say whether #cabinet was private/);
    // The web client omits the key rather than sending null.
    await expect(
      svc.setChannelMapping(IMPORT_ID, CHAPTER, [
        {
          discord_channel_id: 'u1',
          discord_channel_name: 'cabinet',
          mapping_action: 'create_new',
          new_channel_name: 'cabinet',
        },
      ]),
    ).rejects.toThrow(/An export does not say whether #cabinet was private/);
    expect(repo.replaceChannels).not.toHaveBeenCalled();
  });

  it('creates a channel from an export public or restricted as its admin chose', async () => {
    const svc = await build(job({ source: 'upload' }));
    await svc.setChannelMapping(IMPORT_ID, CHAPTER, [
      {
        discord_channel_id: 'u1',
        discord_channel_name: 'general',
        mapping_action: 'create_new',
        new_channel_name: 'general',
        new_channel_visibility: 'chapter',
      },
      {
        discord_channel_id: 'u2',
        discord_channel_name: 'cabinet',
        mapping_action: 'create_new',
        new_channel_name: 'cabinet',
        new_channel_visibility: 'restricted',
        new_channel_required_permissions: ['chapter-config:manage'],
      },
    ]);
    const rows = repo.replaceChannels.mock.calls[0][2] as Record<
      string,
      unknown
    >[];
    expect(rows[0]).toMatchObject({
      new_channel_type: 'PUBLIC',
      readable: null,
      private_in_discord: null,
    });
    expect(rows[1]).toMatchObject({ new_channel_type: 'ROLE_GATED' });
  });
});

describe('DiscordImportService — mapping a discovered guild', () => {
  it('REJECTS a decision for a channel the scan never returned', async () => {
    // The bot can see the whole server; the import may only touch what the
    // scan recorded. A caller naming an arbitrary channel is the shape of a
    // cross-tenant read, so it is refused rather than inserted.
    const svc = await build(job({ source: 'bot' }));
    repo.findChannels.mockResolvedValue([botChannel()]);

    await expect(
      svc.applyDiscoveredChannelMapping(IMPORT_ID, CHAPTER, [
        {
          discord_channel_id: '999999999999999999',
          discord_channel_name: 'somebody-elses-channel',
          mapping_action: 'create_new',
          new_channel_name: 'Sneaky',
        },
      ]),
    ).rejects.toThrow(/not one of the channels found/);
    expect(repo.replaceChannels).not.toHaveBeenCalled();
  });

  it('REJECTS a target channel belonging to another chapter', async () => {
    // The #1242 bug, on the new path. `chat_messages` has no `chapter_id`, so
    // its FK accepts any channel in the product and the purge could never
    // remove what landed elsewhere.
    const svc = await build(job({ source: 'bot' }));
    repo.findChannels.mockResolvedValue([botChannel()]);

    await expect(
      svc.applyDiscoveredChannelMapping(IMPORT_ID, CHAPTER, [
        {
          discord_channel_id: '900000000000000001',
          discord_channel_name: 'general',
          mapping_action: 'use_existing',
          target_channel_id: FOREIGN_CHANNEL,
        },
      ]),
    ).rejects.toThrow(/not one of this chapter's channels/);
    expect(repo.replaceChannels).not.toHaveBeenCalled();
  });

  it('gives a thread its parent’s decision, and never its own', async () => {
    const svc = await build(job({ source: 'bot' }));
    repo.findChannels.mockResolvedValue([
      botChannel({ id: 'm-parent', discord_channel_id: 'c1', position: 0 }),
      botChannel({
        id: 'm-thread',
        discord_channel_id: 't1',
        discord_channel_name: 'general › planning',
        parent_discord_channel_id: 'c1',
        position: 1,
      }),
    ]);

    await svc.applyDiscoveredChannelMapping(IMPORT_ID, CHAPTER, [
      {
        discord_channel_id: 'c1',
        discord_channel_name: 'general',
        mapping_action: 'use_existing',
        target_channel_id: OWN_CHANNEL,
      },
    ]);

    const rows = repo.replaceChannels.mock.calls[0][2] as {
      discord_channel_id: string;
      mapping_action: string;
      target_channel_id: string | null;
    }[];
    expect(rows).toEqual([
      expect.objectContaining({
        discord_channel_id: 'c1',
        mapping_action: 'use_existing',
        target_channel_id: OWN_CHANNEL,
      }),
      expect.objectContaining({
        discord_channel_id: 't1',
        mapping_action: 'use_existing',
        target_channel_id: OWN_CHANNEL,
      }),
    ]);
  });

  it('DROPS a target_channel_id sent under an action that does not name one', async () => {
    // `assertDecisionResolvable` validates `target_channel_id` only for
    // `use_existing`. Persisting it under `create_new` or `skip` would write an
    // unchecked `chat_channels` id onto the row and onto every thread that
    // inherits it — and `chat_messages` has no `chapter_id`, so its FK accepts
    // a channel from any chapter in the product.
    const svc = await build(job({ source: 'bot' }));
    repo.findChannels.mockResolvedValue([
      botChannel({ discord_channel_id: 'c1' }),
    ]);

    await svc.applyDiscoveredChannelMapping(IMPORT_ID, CHAPTER, [
      {
        discord_channel_id: 'c1',
        discord_channel_name: 'general',
        mapping_action: 'create_new',
        new_channel_name: 'General',
        target_channel_id: FOREIGN_CHANNEL,
      },
    ]);

    const rows = repo.replaceChannels.mock.calls[0][2] as {
      target_channel_id: string | null;
    }[];
    expect(rows[0]?.target_channel_id).toBeNull();
  });

  it('leaves an unanswered channel — and its threads — skipped', async () => {
    const svc = await build(job({ source: 'bot' }));
    repo.findChannels.mockResolvedValue([
      botChannel({ id: 'm-parent', discord_channel_id: 'c1' }),
      botChannel({
        id: 'm-thread',
        discord_channel_id: 't1',
        parent_discord_channel_id: 'c1',
      }),
    ]);

    await svc.applyDiscoveredChannelMapping(IMPORT_ID, CHAPTER, []);

    const rows = repo.replaceChannels.mock.calls[0][2] as {
      mapping_action: string;
      status: string;
    }[];
    expect(rows.every((row) => row.mapping_action === 'skip')).toBe(true);
    expect(rows.every((row) => row.status === 'skipped')).toBe(true);
  });
});

describe('DiscordImportService — the upload mapping route refuses a bot import', () => {
  it('REFUSES, so it cannot be used to name channels the scan never returned', async () => {
    // `applyDiscoveredChannelMapping` enforces that discovery's set is the only
    // set the worker reads. This route builds the set from whatever the caller
    // sends, so without the guard it is the way around that invariant — and the
    // worker's guild-mismatch error, read back off the job row, would become an
    // oracle for which Discord servers other chapters have connected.
    const svc = await build(job({ source: 'bot' }));

    await expect(
      svc.setChannelMapping(IMPORT_ID, CHAPTER, [
        {
          discord_channel_id: '999999999999999999',
          discord_channel_name: 'someone-elses-channel',
          mapping_action: 'create_new',
          new_channel_name: 'Sneaky',
        },
      ]),
    ).rejects.toThrow(/scanned-channel route/);
    expect(repo.replaceChannels).not.toHaveBeenCalled();
  });

  it('still serves an upload import unchanged', async () => {
    const svc = await build(job({ source: 'upload' }));
    await svc.setChannelMapping(IMPORT_ID, CHAPTER, [
      {
        discord_channel_id: 'c1',
        discord_channel_name: 'general',
        mapping_action: 'skip',
      },
    ]);
    expect(repo.replaceChannels).toHaveBeenCalled();
  });
});

describe('DiscordImportService — starting a bot import', () => {
  it('does not demand uploaded files, and re-checks the connection', async () => {
    const svc = await build(job({ source: 'bot', guild_id: GUILD }));
    repo.findChannels.mockResolvedValue([
      botChannel({
        mapping_action: 'use_existing',
        target_channel_id: OWN_CHANNEL,
      }),
    ]);

    await svc.start(IMPORT_ID, CHAPTER, true);

    expect(repo.findFiles).not.toHaveBeenCalled();
    expect(oauthService.requireGuildId).toHaveBeenCalledWith(CHAPTER);
    expect(repo.update).toHaveBeenCalledWith(
      IMPORT_ID,
      CHAPTER,
      expect.objectContaining({ status: 'ready', parts_total: 0 }),
    );
  });

  it('refuses to start an import where every channel is skipped', async () => {
    // Reachable on the bot path in a way it never was on the upload path:
    // discovery marks everything skip, so clicking straight through would
    // report a successful import of nothing.
    const svc = await build(job({ source: 'bot', guild_id: GUILD }));
    repo.findChannels.mockResolvedValue([botChannel()]);

    await expect(svc.start(IMPORT_ID, CHAPTER, true)).rejects.toThrow(
      /at least one Discord channel/,
    );
  });

  it('refuses to start against a server the chapter has since replaced', async () => {
    const svc = await build(job({ source: 'bot', guild_id: 'old-guild' }));
    repo.findChannels.mockResolvedValue([botChannel()]);

    await expect(svc.start(IMPORT_ID, CHAPTER, true)).rejects.toThrow(
      /different Discord server/,
    );
  });
});

// ── Discord roles gate the imported private channels (#2818) ────────────────

describe('DiscordImportService — Discord roles gate private channels (#2818)', () => {
  const EXEC_ROLE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const MEMBER_ROLE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const OTHER_CHAPTER_ROLE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const D_EXEC = '910000000000000001';
  const D_RUSH = '910000000000000002';
  const D_PLEDGE = '910000000000000003';
  const D_BROTHER = '910000000000000004';

  function role(overrides: Record<string, unknown>) {
    return {
      chapter_id: CHAPTER,
      system_key: null,
      permissions: [],
      is_system: false,
      display_order: 3,
      color: null,
      created_at: '2026-09-28T00:00:00Z',
      ...overrides,
    };
  }

  const chapterRoles = () => [
    role({ id: EXEC_ROLE, name: 'Exec', permissions: ['members:view'] }),
    role({
      id: MEMBER_ROLE,
      name: 'Member',
      system_key: 'MEMBER',
      is_system: true,
      display_order: 5,
      permissions: ['members:view'],
    }),
  ];

  /** The mapping as the role step saves it: Exec, a new Rush Chair, Pledge ignored. */
  const savedMapping = () => [
    {
      discord_role_id: D_EXEC,
      discord_role_name: 'Exec',
      action: 'existing' as const,
      frapp_role_id: EXEC_ROLE,
      new_role_name: null,
      read_permission: 'channels:read:exec',
    },
    {
      discord_role_id: D_RUSH,
      discord_role_name: 'Rush Chair',
      action: 'new' as const,
      frapp_role_id: null,
      new_role_name: 'Rush Chair',
      read_permission: 'channels:read:rush-chair',
    },
    {
      discord_role_id: D_PLEDGE,
      discord_role_name: 'Pledge',
      action: 'ignore' as const,
      frapp_role_id: null,
      new_role_name: null,
      read_permission: null,
    },
  ];

  describe('saving the role step', () => {
    it('refuses to map anything without permission to manage roles, and writes nothing', async () => {
      // Starting the import creates roles and grants permissions, which
      // Settings -> Roles needs roles:manage for; channels:manage alone must
      // not reach it through the importer.
      const svc = await build(job({ source: 'bot' }));
      await expect(
        svc.setRoleMapping(
          IMPORT_ID,
          CHAPTER,
          [
            {
              discord_role_id: D_RUSH,
              discord_role_name: 'Rush Chair',
              action: 'new',
              new_role_name: 'Rush Chair',
            },
          ],
          false,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('lets an all-Ignore mapping through without it, and grants nothing', async () => {
      const svc = await build(job({ source: 'bot' }));
      await svc.setRoleMapping(
        IMPORT_ID,
        CHAPTER,
        [
          {
            discord_role_id: D_PLEDGE,
            discord_role_name: 'Pledge',
            action: 'ignore',
            // Ignored is ignored, whatever else the caller sends.
            frapp_role_id: EXEC_ROLE,
          },
        ],
        false,
      );
      expect(repo.update).toHaveBeenCalledWith(IMPORT_ID, CHAPTER, {
        role_mapping: [
          {
            discord_role_id: D_PLEDGE,
            discord_role_name: 'Pledge',
            action: 'ignore',
            frapp_role_id: null,
            new_role_name: null,
            read_permission: null,
          },
        ],
      });
      expect(rbac.create).not.toHaveBeenCalled();
      expect(rbac.update).not.toHaveBeenCalled();
    });

    it("refuses a role that is not one of this chapter's", async () => {
      const svc = await build(job({ source: 'bot' }));
      rbac.findByChapter.mockResolvedValue(chapterRoles());
      await expect(
        svc.setRoleMapping(
          IMPORT_ID,
          CHAPTER,
          [
            {
              discord_role_id: D_EXEC,
              discord_role_name: 'Exec',
              action: 'existing',
              frapp_role_id: OTHER_CHAPTER_ROLE,
            },
          ],
          true,
        ),
      ).rejects.toThrow(/not one of this chapter's roles/);
      expect(rbac.findByChapter).toHaveBeenCalledWith(CHAPTER);
    });

    it('refuses a new role whose name is taken, ignoring case, and says to map to it', async () => {
      const svc = await build(job({ source: 'bot' }));
      rbac.findByChapter.mockResolvedValue(chapterRoles());
      await expect(
        svc.setRoleMapping(
          IMPORT_ID,
          CHAPTER,
          [
            {
              discord_role_id: D_EXEC,
              discord_role_name: 'exec',
              action: 'new',
              new_role_name: ' EXEC ',
            },
          ],
          true,
        ),
      ).rejects.toThrow(/A role named "Exec" already exists/);
    });

    it('gives each Frapp role one read permission of its own, and never takes one from the caller', async () => {
      const svc = await build(job({ source: 'bot' }));
      rbac.findByChapter.mockResolvedValue([
        // Exec already holds the permission an earlier import gave it alone,
        // so it keeps it rather than collecting a second one.
        role({
          id: EXEC_ROLE,
          name: 'Exec',
          permissions: ['members:view', 'channels:read:exec-board'],
        }),
        // Two roles hold `channels:read:member`, so it gates more than one
        // role and is not Member's to reuse; the next free string is.
        role({
          id: MEMBER_ROLE,
          name: 'Member',
          permissions: ['channels:read:member'],
        }),
        role({
          id: OTHER_CHAPTER_ROLE,
          name: 'Alumni',
          permissions: ['channels:read:member', 'channels:read:rush-chair'],
        }),
      ]);
      await svc.setRoleMapping(
        IMPORT_ID,
        CHAPTER,
        [
          {
            discord_role_id: D_EXEC,
            discord_role_name: 'Exec',
            action: 'existing',
            frapp_role_id: EXEC_ROLE,
          },
          {
            discord_role_id: D_BROTHER,
            discord_role_name: 'Brother',
            action: 'existing',
            frapp_role_id: MEMBER_ROLE,
          },
          {
            discord_role_id: D_PLEDGE,
            discord_role_name: 'Active',
            action: 'existing',
            frapp_role_id: MEMBER_ROLE,
          },
          {
            discord_role_id: D_RUSH,
            discord_role_name: 'Rush Chair',
            action: 'new',
            new_role_name: 'Rush Chair',
          },
        ],
        true,
      );
      const [, , patch] = repo.update.mock.calls[0];
      expect(
        patch.role_mapping.map(
          (entry: { read_permission: string | null }) => entry.read_permission,
        ),
      ).toEqual([
        'channels:read:exec-board',
        'channels:read:member-2',
        'channels:read:member-2',
        'channels:read:rush-chair-2',
      ]);
      // Saving creates and grants nothing; starting does.
      expect(rbac.create).not.toHaveBeenCalled();
      expect(rbac.update).not.toHaveBeenCalled();
    });
  });

  describe('saving the role step: strings already spoken for', () => {
    const newRush = [
      {
        discord_role_id: D_RUSH,
        discord_role_name: 'Rush Chair',
        action: 'new' as const,
        new_role_name: 'Rush Chair',
      },
    ];
    const savedPermission = () =>
      repo.update.mock.calls[0][2].role_mapping[0].read_permission;

    it('never reissues a string that still gates a channel, though no role holds it', async () => {
      // An earlier import's #rush is gated on channels:read:rush-chair, and
      // the role that held it has since been deleted.
      const svc = await build(job({ source: 'bot' }));
      rbac.findByChapter.mockResolvedValue(chapterRoles());
      channelRepo.findRoleGates.mockResolvedValue([
        { id: 'old-rush', required_permissions: ['channels:read:rush-chair'] },
      ]);
      await svc.setRoleMapping(IMPORT_ID, CHAPTER, newRush, true);
      expect(savedPermission()).toBe('channels:read:rush-chair-2');
    });

    it("never reissues a string another import's saved mapping already gave out", async () => {
      const svc = await build(job({ source: 'bot' }));
      rbac.findByChapter.mockResolvedValue(chapterRoles());
      repo.findByChapter.mockResolvedValue([
        job({ source: 'bot' }),
        job({
          id: 'other-import',
          source: 'bot',
          role_mapping: [
            {
              ...savedMapping()[1],
              discord_role_id: 'someone-else',
            },
          ],
        }),
      ]);
      await svc.setRoleMapping(IMPORT_ID, CHAPTER, newRush, true);
      expect(savedPermission()).toBe('channels:read:rush-chair-2');
    });

    it('keeps pointing at the role an earlier, failed start of this import created', async () => {
      const svc = await build(
        job({
          source: 'bot',
          status: 'failed',
          role_mapping: [{ ...savedMapping()[1], frapp_role_id: 'rush-role' }],
        }),
      );
      rbac.findByChapter.mockResolvedValue([
        ...chapterRoles(),
        role({
          id: 'rush-role',
          name: 'Rush Chair',
          permissions: ['channels:read:rush-chair'],
        }),
      ]);
      await svc.setRoleMapping(IMPORT_ID, CHAPTER, newRush, true);
      expect(repo.update.mock.calls[0][2].role_mapping[0]).toMatchObject({
        action: 'new',
        frapp_role_id: 'rush-role',
        read_permission: 'channels:read:rush-chair',
      });
    });
  });

  describe('mapping a channel "Same as Discord"', () => {
    const privateChannel = (overrides: Record<string, unknown> = {}) =>
      botChannel({
        discord_channel_id: '900000000000000002',
        discord_channel_name: 'exec',
        private_in_discord: true,
        discord_reader_role_ids: [D_EXEC, D_RUSH, D_PLEDGE],
        ...overrides,
      });
    const sameAsDiscord = {
      discord_channel_id: '900000000000000002',
      discord_channel_name: 'exec',
      mapping_action: 'create_new' as const,
      new_channel_name: 'exec',
      new_channel_visibility: 'discord' as const,
      // Sent, and ignored: the API works the gate out itself.
      new_channel_required_permissions: ['billing:manage'],
    };

    it('gates it on the mapped readers, leaves the ignored one out, and carries it to its threads', async () => {
      const svc = await build(
        job({ source: 'bot', role_mapping: savedMapping() }),
      );
      repo.findChannels.mockResolvedValue([
        privateChannel(),
        privateChannel({
          id: 'mapping-2',
          discord_channel_id: '900000000000000003',
          discord_channel_name: 'exec › dues',
          parent_discord_channel_id: '900000000000000002',
          discord_reader_role_ids: null,
        }),
      ]);

      await svc.applyDiscoveredChannelMapping(IMPORT_ID, CHAPTER, [
        sameAsDiscord,
      ]);

      const [, , rows] = repo.replaceChannels.mock.calls[0];
      for (const row of rows) {
        expect(row).toMatchObject({
          mapping_action: 'create_new',
          new_channel_type: 'ROLE_GATED',
          new_channel_required_permissions: [
            'channels:read:exec',
            'channels:read:rush-chair',
          ],
          new_channel_same_as_discord: true,
        });
      }
      // The scan's fact is carried across the re-map, never taken from the caller.
      expect(rows[0].discord_reader_role_ids).toEqual([
        D_EXEC,
        D_RUSH,
        D_PLEDGE,
      ]);
    });

    it('refuses it when none of the readers is mapped', async () => {
      const svc = await build(
        job({ source: 'bot', role_mapping: savedMapping() }),
      );
      repo.findChannels.mockResolvedValue([
        privateChannel({ discord_reader_role_ids: [D_PLEDGE] }),
      ]);
      await expect(
        svc.applyDiscoveredChannelMapping(IMPORT_ID, CHAPTER, [sameAsDiscord]),
      ).rejects.toThrow(/None of the Discord roles that could read #exec/);
      expect(repo.replaceChannels).not.toHaveBeenCalled();
    });

    it('refuses it for a channel the scan did not see was private', async () => {
      const svc = await build(
        job({ source: 'bot', role_mapping: savedMapping() }),
      );
      repo.findChannels.mockResolvedValue([
        privateChannel({
          private_in_discord: null,
          discord_reader_role_ids: null,
        }),
      ]);
      await expect(
        svc.applyDiscoveredChannelMapping(IMPORT_ID, CHAPTER, [sameAsDiscord]),
      ).rejects.toThrow(/cannot be "Same as Discord"/);
    });

    it('refuses it on an uploaded export, which carries no roles', async () => {
      const svc = await build(job({ source: 'upload' }));
      await expect(
        svc.setChannelMapping(IMPORT_ID, CHAPTER, [sameAsDiscord]),
      ).rejects.toThrow(/cannot be "Same as Discord"/);
      expect(repo.replaceChannels).not.toHaveBeenCalled();
    });
  });

  describe('starting the import', () => {
    const gated = (overrides: Record<string, unknown> = {}) =>
      botChannel({
        discord_channel_name: 'exec',
        mapping_action: 'create_new',
        status: 'pending',
        new_channel_name: 'exec',
        private_in_discord: true,
        discord_reader_role_ids: [D_EXEC, D_RUSH, D_PLEDGE],
        new_channel_type: 'ROLE_GATED',
        new_channel_required_permissions: [
          'channels:read:exec',
          'channels:read:rush-chair',
        ],
        new_channel_same_as_discord: true,
        ...overrides,
      });

    it('creates the new roles with only their read gate, grants existing roles theirs, and assigns nobody', async () => {
      const svc = await build(
        job({ source: 'bot', guild_id: GUILD, role_mapping: savedMapping() }),
      );
      repo.findChannels.mockResolvedValue([gated()]);
      rbac.findByChapter.mockResolvedValue(chapterRoles());
      rbac.create.mockImplementation(async (_chapter, data) => ({
        ...role({ id: 'new-role-1' }),
        ...data,
      }));
      rbac.update.mockImplementation(async (id, _chapter, data) => ({
        ...role({ id }),
        ...data,
      }));

      await svc.start(IMPORT_ID, CHAPTER, true);

      expect(rbac.create).toHaveBeenCalledTimes(1);
      expect(rbac.create).toHaveBeenCalledWith(CHAPTER, {
        name: 'Rush Chair',
        permissions: ['channels:read:rush-chair'],
        // After every existing role, so it lists below the seeded ones.
        display_order: 6,
        color: null,
      });
      expect(rbac.update).toHaveBeenCalledTimes(1);
      expect(rbac.update).toHaveBeenCalledWith(EXEC_ROLE, CHAPTER, {
        permissions: ['members:view', 'channels:read:exec'],
      });
      const [, , patch] = repo.update.mock.calls.at(-1);
      expect(patch.status).toBe('ready');
      expect(
        patch.role_mapping.find(
          (entry: { discord_role_id: string }) =>
            entry.discord_role_id === D_RUSH,
        ),
      ).toMatchObject({ action: 'new', frapp_role_id: 'new-role-1' });
    });

    it('creates a new role that gates nothing with no permissions at all', async () => {
      const svc = await build(
        job({ source: 'bot', guild_id: GUILD, role_mapping: savedMapping() }),
      );
      repo.findChannels.mockResolvedValue([
        gated({
          discord_reader_role_ids: [D_EXEC],
          new_channel_required_permissions: ['channels:read:exec'],
        }),
      ]);
      rbac.findByChapter.mockResolvedValue(chapterRoles());
      rbac.create.mockImplementation(async (_chapter, data) => ({
        ...role({ id: 'new-role-1' }),
        ...data,
      }));
      rbac.update.mockImplementation(async (id, _chapter, data) => ({
        ...role({ id }),
        ...data,
      }));

      await svc.start(IMPORT_ID, CHAPTER, true);

      expect(rbac.create).toHaveBeenCalledWith(
        CHAPTER,
        expect.objectContaining({ name: 'Rush Chair', permissions: [] }),
      );
    });

    it("refuses, rather than adopts, a role someone added under a new role's name since", async () => {
      // Saving would have refused the clash; adopting it at start would give
      // its members the imported channels without anyone choosing that.
      const svc = await build(
        job({ source: 'bot', guild_id: GUILD, role_mapping: savedMapping() }),
      );
      repo.findChannels.mockResolvedValue([gated()]);
      rbac.findByChapter.mockResolvedValue([
        ...chapterRoles(),
        role({ id: 'someone-elses', name: 'rush chair', permissions: [] }),
      ]);

      await expect(svc.start(IMPORT_ID, CHAPTER, true)).rejects.toThrow(
        /A role named "rush chair" was added since the roles were mapped/,
      );
      expect(rbac.create).not.toHaveBeenCalled();
      expect(rbac.update).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('needs roles:manage to grant a read permission to an existing role, even when it creates none', async () => {
      const grantOnly = savedMapping().map((entry) =>
        entry.discord_role_id === D_RUSH
          ? {
              ...entry,
              action: 'ignore' as const,
              new_role_name: null,
              read_permission: null,
            }
          : entry,
      );
      const svc = await build(
        job({ source: 'bot', guild_id: GUILD, role_mapping: grantOnly }),
      );
      repo.findChannels.mockResolvedValue([
        gated({
          discord_reader_role_ids: [D_EXEC],
          new_channel_required_permissions: ['channels:read:exec'],
        }),
      ]);
      rbac.findByChapter.mockResolvedValue(chapterRoles());

      await expect(svc.start(IMPORT_ID, CHAPTER, false)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(rbac.update).not.toHaveBeenCalled();
    });

    it('checks the gate of a channel this import merges into, which it did not create', async () => {
      const svc = await build(
        job({ source: 'bot', guild_id: GUILD, role_mapping: savedMapping() }),
      );
      repo.findChannels.mockResolvedValue([
        gated(),
        botChannel({
          id: 'row-board',
          discord_channel_id: '900000000000000007',
          mapping_action: 'use_existing',
          status: 'pending',
          target_channel_id: 'board',
        }),
      ]);
      rbac.findByChapter.mockResolvedValue(chapterRoles());
      // #board's role was deleted; its gate is left on the string.
      channelRepo.findRoleGates.mockResolvedValue([
        { id: 'board', required_permissions: ['channels:read:rush-chair'] },
      ]);

      await expect(svc.start(IMPORT_ID, CHAPTER, true)).rejects.toThrow(
        /channels:read:rush-chair is already in use/,
      );
      expect(rbac.create).not.toHaveBeenCalled();
    });

    it('refuses a channel whose gate no longer matches the role mapping, before creating anything', async () => {
      // Rush Chair was set to Ignore after the channels were mapped.
      const mapping = savedMapping().map((entry) =>
        entry.discord_role_id === D_RUSH
          ? {
              ...entry,
              action: 'ignore' as const,
              new_role_name: null,
              read_permission: null,
            }
          : entry,
      );
      const svc = await build(
        job({ source: 'bot', guild_id: GUILD, role_mapping: mapping }),
      );
      repo.findChannels.mockResolvedValue([gated()]);

      await expect(svc.start(IMPORT_ID, CHAPTER, true)).rejects.toThrow(
        /role mapping changed after #exec was mapped/,
      );
      expect(rbac.create).not.toHaveBeenCalled();
      expect(rbac.update).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
    });

    const provisionable = () => {
      rbac.findByChapter.mockResolvedValue(chapterRoles());
      rbac.create.mockImplementation(async (_chapter, data) => ({
        ...role({ id: 'new-role-1' }),
        ...data,
      }));
      rbac.update.mockImplementation(async (id, _chapter, data) => ({
        ...role({ id }),
        ...data,
      }));
    };

    it('refuses, before writing anything, a read permission another role now holds', async () => {
      const svc = await build(
        job({ source: 'bot', guild_id: GUILD, role_mapping: savedMapping() }),
      );
      repo.findChannels.mockResolvedValue([gated()]);
      provisionable();
      rbac.findByChapter.mockResolvedValue([
        ...chapterRoles(),
        role({
          id: 'alumni',
          name: 'Alumni',
          permissions: ['channels:read:exec'],
        }),
      ]);
      await expect(svc.start(IMPORT_ID, CHAPTER, true)).rejects.toThrow(
        /channels:read:exec is already in use/,
      );
      expect(rbac.create).not.toHaveBeenCalled();
      expect(rbac.update).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('refuses to grant a string that already gates a channel this import did not create', async () => {
      const svc = await build(
        job({ source: 'bot', guild_id: GUILD, role_mapping: savedMapping() }),
      );
      repo.findChannels.mockResolvedValue([gated()]);
      provisionable();
      channelRepo.findRoleGates.mockResolvedValue([
        { id: 'old-exec', required_permissions: ['channels:read:exec'] },
      ]);
      await expect(svc.start(IMPORT_ID, CHAPTER, true)).rejects.toThrow(
        /channels:read:exec is already in use/,
      );
      expect(rbac.create).not.toHaveBeenCalled();
    });

    it('is not put off by the gate of a channel this import already created', async () => {
      // A resumed import: #exec exists (and is gated) from the first run,
      // #rush is still to come.
      const svc = await build(
        job({ source: 'bot', guild_id: GUILD, role_mapping: savedMapping() }),
      );
      repo.findChannels.mockResolvedValue([
        gated({ id: 'row-exec', target_channel_id: 'created-exec' }),
        gated({
          id: 'row-rush',
          discord_channel_id: '900000000000000009',
          discord_channel_name: 'rush',
        }),
      ]);
      provisionable();
      channelRepo.findRoleGates.mockResolvedValue([
        {
          id: 'created-exec',
          required_permissions: [
            'channels:read:exec',
            'channels:read:rush-chair',
          ],
        },
      ]);
      await svc.start(IMPORT_ID, CHAPTER, true);
      expect(rbac.create).toHaveBeenCalledTimes(1);
    });

    it('needs roles:manage from whoever starts it when it creates or grants, and says so', async () => {
      const svc = await build(
        job({ source: 'bot', guild_id: GUILD, role_mapping: savedMapping() }),
      );
      repo.findChannels.mockResolvedValue([gated()]);
      provisionable();
      await expect(svc.start(IMPORT_ID, CHAPTER, false)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(rbac.create).not.toHaveBeenCalled();
      expect(rbac.update).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('needs nothing more when every role and grant is already in place', async () => {
      const svc = await build(
        job({
          source: 'bot',
          guild_id: GUILD,
          role_mapping: savedMapping().map((entry) =>
            entry.discord_role_id === D_RUSH
              ? { ...entry, frapp_role_id: 'rush-role' }
              : entry,
          ),
        }),
      );
      repo.findChannels.mockResolvedValue([gated()]);
      rbac.findByChapter.mockResolvedValue([
        role({
          id: EXEC_ROLE,
          name: 'Exec',
          permissions: ['channels:read:exec'],
        }),
        role({
          id: 'rush-role',
          name: 'Rush Chair',
          permissions: ['channels:read:rush-chair'],
        }),
      ]);
      await svc.start(IMPORT_ID, CHAPTER, false);
      expect(repo.update).toHaveBeenCalledWith(
        IMPORT_ID,
        CHAPTER,
        expect.objectContaining({ status: 'ready' }),
      );
    });

    it('records each new role on the import as soon as it exists, so a failed start still points at it', async () => {
      const svc = await build(
        job({ source: 'bot', guild_id: GUILD, role_mapping: savedMapping() }),
      );
      repo.findChannels.mockResolvedValue([gated()]);
      provisionable();
      rbac.update.mockRejectedValue(new Error('roles table unavailable'));

      await expect(svc.start(IMPORT_ID, CHAPTER, true)).rejects.toThrow(
        'roles table unavailable',
      );
      expect(repo.update).toHaveBeenCalledTimes(1);
      const [, , patch] = repo.update.mock.calls[0];
      expect(patch.status).toBeUndefined();
      expect(
        patch.role_mapping.find(
          (entry: { discord_role_id: string }) =>
            entry.discord_role_id === D_RUSH,
        ),
      ).toMatchObject({ frapp_role_id: 'new-role-1' });
    });

    it('does not re-check a channel already created, whose gate is already set', async () => {
      // Resuming after the role step was saved again: #exec's Frapp channel
      // exists, so its old gate is history, not a mismatch.
      const svc = await build(
        job({ source: 'bot', guild_id: GUILD, role_mapping: savedMapping() }),
      );
      repo.findChannels.mockResolvedValue([
        gated({
          target_channel_id: 'created-exec',
          new_channel_required_permissions: ['channels:read:old'],
        }),
        gated({
          id: 'row-done',
          discord_channel_id: '900000000000000008',
          status: 'completed',
          new_channel_required_permissions: ['channels:read:old'],
        }),
      ]);
      provisionable();
      await svc.start(IMPORT_ID, CHAPTER, true);
      expect(repo.update).toHaveBeenCalledWith(
        IMPORT_ID,
        CHAPTER,
        expect.objectContaining({ status: 'ready' }),
      );
    });

    it('reads a mapping saved before #2818 as granting nothing', async () => {
      const svc = await build(
        job({
          source: 'bot',
          guild_id: GUILD,
          role_mapping: [
            {
              discord_role_id: D_EXEC,
              discord_role_name: 'Exec',
              signet_role_key: 'PRESIDENT',
            },
          ] as never,
        }),
      );
      repo.findChannels.mockResolvedValue([
        botChannel({
          mapping_action: 'use_existing',
          target_channel_id: OWN_CHANNEL,
        }),
      ]);

      await svc.start(IMPORT_ID, CHAPTER, true);

      expect(rbac.findByChapter).not.toHaveBeenCalled();
      expect(rbac.create).not.toHaveBeenCalled();
      expect(rbac.update).not.toHaveBeenCalled();
    });
  });
});
