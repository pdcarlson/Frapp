import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  MAX_ARCHIVE_CHAPTER_BYTES,
  MAX_ARCHIVE_EXPORT_PART_BYTES,
  MAX_ARCHIVE_IMPORT_BYTES,
} from '#domain/constants/discord-archive-limits';
import { ArchiveQuotaExceededError } from '#domain/repositories/discord-import.repository.interface';
import { isUnsafeStoragePath } from '#domain/utils/storage-path';
import type { DiscordImport } from '#domain/entities/discord-import.entity';
import {
  CHAPTER,
  GUILD,
  IMPORT_ID,
  OWN_CHANNEL,
  USER,
  botChannel,
  createDiscordImportFixture,
  job,
  type DiscordImportFixture,
} from '#test/helpers/discord-import-service.fixture';

let repo: DiscordImportFixture['repo'];
let storage: DiscordImportFixture['storage'];
let bot: DiscordImportFixture['bot'];
let oauthService: DiscordImportFixture['oauthService'];
let service: DiscordImportFixture['service'];
let roleMapping: DiscordImportFixture['roleMapping'];

async function build(current: DiscordImport = job()) {
  ({ repo, storage, bot, oauthService, service, roleMapping } =
    await createDiscordImportFixture(current));
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

    const caught = (await service
      .requestUploadUrls(IMPORT_ID, CHAPTER, [file()])
      .catch((error: unknown) => error)) as Error;

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

describe('DiscordImportService — starting', () => {
  it('refuses to start with no uploaded export', async () => {
    await build();
    await expect(service.start(IMPORT_ID, CHAPTER, USER, true)).rejects.toThrow(
      /Upload the exported JSON/,
    );
  });

  it('refuses to start while files are still uploading', async () => {
    await build();
    repo.findFiles.mockResolvedValue([
      { kind: 'export', uploaded_at: '2026-08-24T12:00:00Z' },
      { kind: 'media', uploaded_at: null },
    ]);
    await expect(service.start(IMPORT_ID, CHAPTER, USER, true)).rejects.toThrow(
      /have not finished uploading/,
    );
  });

  it('refuses to start with no channel mapping', async () => {
    await build();
    repo.findFiles.mockResolvedValue([
      { kind: 'export', uploaded_at: '2026-08-24T12:00:00Z' },
    ]);
    await expect(service.start(IMPORT_ID, CHAPTER, USER, true)).rejects.toThrow(
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

    await expect(service.start(IMPORT_ID, CHAPTER, USER, true)).rejects.toThrow(
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

    await service.start(IMPORT_ID, CHAPTER, USER, true);

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

    await expect(service.start(IMPORT_ID, CHAPTER, USER, true)).rejects.toThrow(
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

    await service.start(IMPORT_ID, CHAPTER, USER, true);

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

  // Each service runs `assertImportMutable` itself (#3271), so each of its
  // call sites is pinned here or in the mapping services' own specs.
  describe.each(['running', 'completed', 'purging'] as const)(
    'refuses to change a %s import',
    (status) => {
      it.each([
        [
          'requestUploadUrls',
          () =>
            service.requestUploadUrls(IMPORT_ID, CHAPTER, [
              {
                kind: 'export' as const,
                relative_path: 'export.json',
                content_type: 'application/json',
                byte_size: 10,
              },
            ]),
        ],
        [
          'confirmUploads',
          () => service.confirmUploads(IMPORT_ID, CHAPTER, ['a/b.json']),
        ],
        ['start', () => service.start(IMPORT_ID, CHAPTER, USER, true)],
      ])('%s', async (_name, call) => {
        await build(job({ status }));
        await expect(call()).rejects.toThrow(/can no longer be changed/);
        expect(repo.registerFiles).not.toHaveBeenCalled();
        expect(repo.markFilesUploaded).not.toHaveBeenCalled();
        expect(repo.update).not.toHaveBeenCalled();
      });
    },
  );

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
    await service.start(IMPORT_ID, CHAPTER, USER, true);
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
    await service.start(IMPORT_ID, CHAPTER, USER, true, {
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
    await service.start(IMPORT_ID, CHAPTER, USER, true);
    expect(repo.update.mock.calls[0][2]).not.toHaveProperty('messages_after');
  });

  it('lets a restart repeat it, and refuses to change it once started', async () => {
    await build(botDraft({ status: 'failed', messages_after: CUTOFF }));
    mapped();
    await service.start(IMPORT_ID, CHAPTER, USER, true, {
      messagesAfter: CUTOFF,
    });
    expect(repo.update.mock.calls[0][2]).not.toHaveProperty('messages_after');

    await expect(
      service.start(IMPORT_ID, CHAPTER, USER, true, {
        messagesAfter: '2023-01-01T00:00:00Z',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.start(IMPORT_ID, CHAPTER, USER, true, { messagesAfter: null }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a date in the future, before creating any role', async () => {
    await build(botDraft());
    mapped();
    await expect(
      service.start(IMPORT_ID, CHAPTER, USER, true, {
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
      service.start(IMPORT_ID, CHAPTER, USER, true, {
        messagesAfter: '2025-W01',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('writes nothing for an explicit null on a row read before the migration', async () => {
    // No column yet: the row carries no messages_after at all.
    const unmigrated = botDraft() as Partial<DiscordImport>;
    delete unmigrated.messages_after;
    await build(unmigrated as DiscordImport);
    mapped();
    await service.start(IMPORT_ID, CHAPTER, USER, true, {
      messagesAfter: null,
    });
    expect(repo.update.mock.calls[0][2]).not.toHaveProperty('messages_after');
  });

  it('refuses one on an upload, whose range is set when exporting', async () => {
    await build(job({ status: 'draft' }));
    await expect(
      service.start(IMPORT_ID, CHAPTER, USER, true, { messagesAfter: CUTOFF }),
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

describe('DiscordImportService — starting a bot import', () => {
  it('does not demand uploaded files, and re-checks the connection', async () => {
    const svc = await build(job({ source: 'bot', guild_id: GUILD }));
    repo.findChannels.mockResolvedValue([
      botChannel({
        mapping_action: 'use_existing',
        target_channel_id: OWN_CHANNEL,
      }),
    ]);

    await svc.start(IMPORT_ID, CHAPTER, USER, true);

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

    await expect(svc.start(IMPORT_ID, CHAPTER, USER, true)).rejects.toThrow(
      /at least one Discord channel/,
    );
  });

  it('refuses to start against a server the chapter has since replaced', async () => {
    const svc = await build(job({ source: 'bot', guild_id: 'old-guild' }));
    repo.findChannels.mockResolvedValue([botChannel()]);

    await expect(svc.start(IMPORT_ID, CHAPTER, USER, true)).rejects.toThrow(
      /different Discord server/,
    );
  });
});
