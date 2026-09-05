import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
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
} from '../../domain/repositories/discord-import.repository.interface';
import { CHAT_CHANNEL_REPOSITORY } from '../../domain/repositories/chat.repository.interface';
import { STORAGE_PROVIDER } from '../../domain/adapters/storage.interface';
import { DISCORD_BOT_GATEWAY } from '../../domain/adapters/discord.interface';
import { DiscordOAuthService } from './discord-oauth.service';
import type { DiscordImport } from '../../domain/entities/discord-import.entity';
import { isUnsafeStoragePath } from '../../domain/utils/storage-path';

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
    ...overrides,
  };
}

let repo: Record<string, jest.Mock>;
let storage: Record<string, jest.Mock>;
let channelRepo: Record<string, jest.Mock>;
let bot: Record<string, jest.Mock>;
let oauthService: Record<string, jest.Mock>;
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
    listRoles: jest.fn(),
    verifyChannelInGuild: jest.fn(),
    fetchMessagePage: jest.fn(),
    openAttachment: jest.fn(),
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
    ).rejects.toThrow(/Pick a Signet channel/);
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
    ...overrides,
  };
}

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
    });
    bot.listRoles.mockResolvedValue([{ id: '3', name: 'Exec' }]);

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
    });
    bot.listRoles.mockResolvedValue([]);

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
    });
    bot.listRoles.mockResolvedValue([]);

    const result = await svc.discoverBotChannels(IMPORT_ID, CHAPTER);

    expect(result.warnings).toHaveLength(1);
    expect(repo.update).toHaveBeenCalledWith(
      IMPORT_ID,
      CHAPTER,
      expect.objectContaining({ guild_id: GUILD }),
    );
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

    await svc.start(IMPORT_ID, CHAPTER);

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

    await expect(svc.start(IMPORT_ID, CHAPTER)).rejects.toThrow(
      /at least one Discord channel/,
    );
  });

  it('refuses to start against a server the chapter has since replaced', async () => {
    const svc = await build(job({ source: 'bot', guild_id: 'old-guild' }));
    repo.findChannels.mockResolvedValue([botChannel()]);

    await expect(svc.start(IMPORT_ID, CHAPTER)).rejects.toThrow(
      /different Discord server/,
    );
  });
});
