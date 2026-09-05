import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import {
  DiscordImportWorkerService,
  IMPORT_BATCH_SIZE,
  LEASE_MS,
  PURGE_BATCH_SIZE,
} from './discord-import-worker.service';
import { DiscordExportWorkerService } from './discord-export-worker.service';
import { DISCORD_IMPORT_REPOSITORY } from '#domain/repositories/discord-import.repository.interface';
import { DISCORD_CONNECTION_REPOSITORY } from '#domain/repositories/discord-connection.repository.interface';
import { STORAGE_PROVIDER } from '#domain/adapters/storage.interface';
import { CHAT_CHANNEL_REPOSITORY } from '#domain/repositories/chat.repository.interface';
import type {
  DiscordImport,
  DiscordImportChannel,
  DiscordImportFile,
} from '#domain/entities/discord-import.entity';

const FIXTURES = join(__dirname, '../../../test/fixtures/discord');
const CHAPTER = 'chapter-1';
const IMPORT_ID = 'import-1';
const SIGNET_CHANNEL = 'signet-channel-1';
const NOW = new Date('2026-08-24T12:00:00Z');

/**
 * Pin the system clock to `NOW` for every test in this file.
 *
 * Without this the suite is a time bomb, and it has already gone off once: the
 * worker takes an explicit `now` for its lease arithmetic but measures its
 * 45-second slice budget against the REAL `Date.now()`, so
 * `Date.now() >= now + SLICE_BUDGET_MS` is true the moment the wall clock
 * passes `NOW` by 45 seconds. Every slice then yields before importing
 * anything, and half this file fails with "finished: false" — on `main`, with
 * no code change, purely because the day moved on.
 *
 * Faking the clock rather than deriving `NOW` from `new Date()` keeps the fixed
 * timestamps the assertions rely on. Only the clock is faked; the worker awaits
 * no timers, so promises still resolve on real microtasks.
 */
beforeAll(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
});
afterAll(() => {
  jest.useRealTimers();
});

function job(overrides: Partial<DiscordImport> = {}): DiscordImport {
  return {
    id: IMPORT_ID,
    chapter_id: CHAPTER,
    created_by: 'user-1',
    status: 'ready',
    guild_id: null,
    guild_name: 'Tau Nu',
    consent_acknowledged_at: NOW.toISOString(),
    role_mapping: [],
    storage_prefix: `chapters/${CHAPTER}/chat-archive/imports/${IMPORT_ID}`,
    total_messages: 0,
    imported_messages: 0,
    messages_skipped: 0,
    attachments_imported: 0,
    attachments_skipped: 0,
    parts_total: 1,
    cursor_part_index: 0,
    cursor_message_index: 0,
    cursor_part_message_count: 0,
    warnings: [],
    error: null,
    lock_token: null,
    locked_by: null,
    lease_expires_at: null,
    attempt_count: 0,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    completed_at: null,
    purged_at: null,
    ...overrides,
  };
}

function exportFile(
  overrides: Partial<DiscordImportFile> = {},
): DiscordImportFile {
  return {
    id: 'file-1',
    import_id: IMPORT_ID,
    chapter_id: CHAPTER,
    kind: 'export',
    part_index: 0,
    relative_path: 'part-000.json',
    bucket: 'chat-archive',
    storage_path: `chapters/${CHAPTER}/chat-archive/imports/${IMPORT_ID}/export/0000-part-000.json`,
    content_type: 'application/json',
    byte_size: 1234,
    uploaded_at: NOW.toISOString(),
    created_at: NOW.toISOString(),
    ...overrides,
  };
}

function mediaFile(
  relativePath: string,
  overrides: Partial<DiscordImportFile> = {},
): DiscordImportFile {
  return {
    ...exportFile(),
    id: `media-${relativePath}`,
    kind: 'media',
    part_index: null,
    relative_path: relativePath,
    storage_path: `chapters/${CHAPTER}/chat-archive/imports/${IMPORT_ID}/media/x-${relativePath.replace(/[^a-z0-9.]/gi, '_')}`,
    content_type: 'application/pdf',
    ...overrides,
  };
}

function channelMapping(
  overrides: Partial<DiscordImportChannel> = {},
): DiscordImportChannel {
  return {
    id: 'map-1',
    import_id: IMPORT_ID,
    discord_channel_id: '800000000000000001',
    discord_channel_name: 'general',
    discord_category: 'General',
    mapping_action: 'use_existing',
    target_channel_id: SIGNET_CHANNEL,
    new_channel_name: null,
    new_channel_is_read_only: true,
    message_count: 8,
    imported_count: 0,
    status: 'pending',
    error: null,
    ...overrides,
  };
}

/** A repository fake that records writes and simulates the dedupe index. */
function makeRepo(initial: DiscordImport) {
  let current = initial;
  const insertedByChannel = new Map<string, Map<string, string>>();
  let nextId = 0;

  return {
    state: () => current,
    inserted: () => insertedByChannel,
    updates: [] as Record<string, unknown>[],
    channelUpdates: [] as Record<string, unknown>[],
    attachments: [] as Record<string, unknown>[],
    deletedRounds: [] as number[],
    leaseHeld: true,

    files: [exportFile()] as DiscordImportFile[],
    channels: [channelMapping()] as DiscordImportChannel[],

    claimNextRunnable: jest.fn(async () => ({
      job: current,
      lockToken: 'token-1',
    })),
    renewLease: jest.fn(async function (this: { leaseHeld: boolean }) {
      return repoRef.leaseHeld;
    }),
    releaseLease: jest.fn(async () => undefined),
    findFiles: jest.fn(async () => repoRef.files),
    findChannels: jest.fn(async () => repoRef.channels),
    update: jest.fn(
      async (_id: string, _chapter: string, patch: Record<string, unknown>) => {
        repoRef.updates.push(patch);
        current = { ...current, ...(patch as Partial<DiscordImport>) };
        return current;
      },
    ),
    updateIfStatus: jest.fn(
      async (
        _id: string,
        _chapter: string,
        expected: string[],
        patch: Record<string, unknown>,
      ) => {
        // The real guard: the UPDATE matches no row unless the import is still
        // in one of the expected statuses, which is how the worker learns an
        // admin cancelled it mid-slice.
        if (!expected.includes(current.status)) return null;
        repoRef.updates.push(patch);
        current = { ...current, ...(patch as Partial<DiscordImport>) };
        return current;
      },
    ),
    updateChannel: jest.fn(
      async (
        _id: string,
        _importId: string,
        patch: Record<string, unknown>,
      ) => {
        repoRef.channelUpdates.push(patch);
      },
    ),
    findExistingExternalIds: jest.fn(
      async (channelId: string, ids: string[]) => {
        const seen = insertedByChannel.get(channelId) ?? new Map();
        return new Map([...seen].filter(([id]) => ids.includes(id)));
      },
    ),
    insertMessages: jest.fn(
      async (rows: { channel_id: string; external_message_id: string }[]) => {
        const out = new Map<string, string>();
        for (const row of rows) {
          const seen =
            insertedByChannel.get(row.channel_id) ?? new Map<string, string>();
          // The partial unique index, simulated: a second insert of the same
          // (channel, snowflake) never produces a second row.
          if (seen.has(row.external_message_id)) continue;
          nextId += 1;
          const id = `msg-${nextId}`;
          seen.set(row.external_message_id, id);
          insertedByChannel.set(row.channel_id, seen);
          out.set(row.external_message_id, id);
        }
        return out;
      },
    ),
    replyPairs: [] as { id: string; reply_to_id: string }[],
    setReplyTargets: jest.fn(
      async (pairs: { id: string; reply_to_id: string }[]) => {
        repoRef.replyPairs.push(...pairs);
        return pairs.length;
      },
    ),
    insertAttachments: jest.fn(async (rows: Record<string, unknown>[]) => {
      repoRef.attachments.push(...rows);
      return rows.length;
    }),
    deleteImportedMessages: jest.fn(async () => {
      const round = repoRef.deletedRounds.shift() ?? 0;
      return round;
    }),
    create: jest.fn(),
    findById: jest.fn(async () => current),
    findByChapter: jest.fn(async () => [current]),
    replaceChannels: jest.fn(),
    createFiles: jest.fn(),
    markFilesUploaded: jest.fn(),
  };
}
let repoRef: ReturnType<typeof makeRepo>;

async function buildWorker(
  repo: ReturnType<typeof makeRepo>,
  storage: unknown,
) {
  const channelRepo = {
    create: jest.fn(async (data: { name: string }) => ({
      id: 'created-channel-1',
      name: data.name,
    })),
    // Chapter-scoped: the worker re-verifies that the mapping's target channel
    // belongs to the import's chapter before writing a single message into it.
    findById: jest.fn(async (id: string, chapterId: string) =>
      chapterId === CHAPTER &&
      (id === SIGNET_CHANNEL || id === 'created-channel-1')
        ? { id, chapter_id: chapterId, name: 'general' }
        : null,
    ),
  };
  const connectionRepo = { deleteExpiredStates: jest.fn(async () => 0) };
  const exportWorker = {
    runSlice: jest.fn(async () => {
      throw new Error(
        'The bot export worker must never be reached by an upload-sourced import.',
      );
    }),
  };
  const moduleRef = await Test.createTestingModule({
    providers: [
      DiscordImportWorkerService,
      { provide: DISCORD_IMPORT_REPOSITORY, useValue: repo },
      { provide: STORAGE_PROVIDER, useValue: storage },
      { provide: CHAT_CHANNEL_REPOSITORY, useValue: channelRepo },
      // Every job in this file is `source: 'upload'`, so the sweeper never
      // delegates here. Stubbed rather than real so a regression that DID
      // delegate an upload job would fail loudly instead of hitting Discord.
      { provide: DiscordExportWorkerService, useValue: exportWorker },
      // Only the hourly OAuth-state reaper touches this; no import slice does.
      { provide: DISCORD_CONNECTION_REPOSITORY, useValue: connectionRepo },
    ],
  }).compile();
  return {
    worker: moduleRef.get(DiscordImportWorkerService),
    channelRepo,
  };
}

function makeStorage(partBytes: Uint8Array | null) {
  return {
    downloadFile: jest.fn(async () => partBytes),
    listFiles: jest.fn(async () => [] as string[]),
    deleteFiles: jest.fn(async () => undefined),
    getSignedUploadUrl: jest.fn(),
    getSignedDownloadUrl: jest.fn(),
    uploadFile: jest.fn(),
    deleteFile: jest.fn(),
    listObjects: jest.fn(),
    listFolders: jest.fn(),
  };
}

const part000 = () =>
  new Uint8Array(readFileSync(join(FIXTURES, 'part-000.json')));

describe('DiscordImportWorkerService — importing', () => {
  beforeEach(() => {
    repoRef = makeRepo(job());
  });

  it('imports every placeable message with its historical timestamp', async () => {
    const { worker } = await buildWorker(repoRef, makeStorage(part000()));

    const result = await worker.sweepImports(NOW);

    expect(result.claimed).toBe(true);
    expect(result.finished).toBe(true);
    // 8 messages in the fixture; two are unplaceable (no id, no timestamp).
    expect(result.messagesImported).toBe(6);

    const rows = repoRef.insertMessages.mock.calls[0][0] as {
      created_at: string;
      kind: string;
      sender_id: null;
    }[];
    expect(rows[0].created_at).toBe('2019-04-01T10:00:00Z');
    expect(rows.every((r) => r.kind === 'imported')).toBe(true);
    expect(rows.every((r) => r.sender_id === null)).toBe(true);
  });

  it('is idempotent: re-running the same export imports nothing twice', async () => {
    // The guarantee the whole external_message_id migration exists for.
    const storage = makeStorage(part000());
    const { worker } = await buildWorker(repoRef, storage);

    await worker.sweepImports(NOW);
    const afterFirst = repoRef.inserted().get(SIGNET_CHANNEL)!.size;

    // Reset the cursor exactly as a re-import would, and run again.
    repoRef.update(IMPORT_ID, CHAPTER, {
      status: 'ready',
      cursor_part_index: 0,
      cursor_message_index: 0,
      imported_messages: 0,
    });
    const second = await worker.sweepImports(NOW);

    expect(repoRef.inserted().get(SIGNET_CHANNEL)!.size).toBe(afterFirst);
    expect(second.messagesImported).toBe(0);
  });

  it('writes attachment rows pointing at the uploaded object, not a CDN url', async () => {
    repoRef.files = [
      exportFile(),
      mediaFile('general [800000000000000001]_Files/rush-schedule-c3d4.pdf'),
      mediaFile('general [800000000000000001]_Files/photo-e5f6.png', {
        content_type: 'image/png',
      }),
    ];
    const { worker } = await buildWorker(repoRef, makeStorage(part000()));

    await worker.sweepImports(NOW);

    expect(repoRef.attachments.length).toBeGreaterThan(0);
    for (const attachment of repoRef.attachments) {
      expect(attachment.bucket).toBe('chat-archive');
      expect(attachment.external_url).toBeNull();
      expect(String(attachment.storage_path)).toContain('chat-archive/imports');
    }
  });

  it('resolves a reply whose target is in the same batch', async () => {
    // The existence read runs before the insert, so a reply to a message a few
    // rows above it in the same batch cannot resolve on the first pass. Caught
    // by running the importer against the live stack, not by a unit test — the
    // fake had been resolving it for free.
    const { worker } = await buildWorker(repoRef, makeStorage(part000()));

    await worker.sweepImports(NOW);

    expect(repoRef.replyPairs).toHaveLength(1);
    expect(repoRef.setReplyTargets).toHaveBeenCalled();
  });

  it('counts attachments that will exist, not entries the export listed', async () => {
    // Message ...003 references one object twice (DCE deduplicates media), and
    // the attachments table is unique per object per message — so it is ONE
    // row. Stamping 2 would tell every client to fetch attachments that are not
    // there, and the list would never resolve.
    repoRef.files = [
      exportFile(),
      mediaFile('general [800000000000000001]_Files/photo-e5f6.png', {
        content_type: 'image/png',
      }),
    ];
    const { worker } = await buildWorker(repoRef, makeStorage(part000()));

    await worker.sweepImports(NOW);

    const rows = repoRef.insertMessages.mock.calls[0][0] as {
      external_message_id: string;
      metadata: { attachment_count: number };
    }[];
    const doubled = rows.find(
      (r) => r.external_message_id === '900000000000000003',
    );
    expect(doubled?.metadata.attachment_count).toBe(1);

    // ...006 references a file that was never uploaded, so it has none.
    const unresolvable = rows.find(
      (r) => r.external_message_id === '900000000000000006',
    );
    expect(unresolvable?.metadata.attachment_count).toBe(0);
  });

  it('records a message total so progress has a denominator', async () => {
    const { worker } = await buildWorker(repoRef, makeStorage(part000()));

    await worker.sweepImports(NOW);

    const last = repoRef.updates.at(-1) as { total_messages: number };
    expect(last.total_messages).toBe(8);
  });

  it('reports a media reference with no uploaded file instead of dropping it silently', async () => {
    repoRef.files = [exportFile()];
    const { worker } = await buildWorker(repoRef, makeStorage(part000()));

    await worker.sweepImports(NOW);

    const last = repoRef.updates.at(-1) as {
      warnings: string[];
      attachments_skipped: number;
    };
    expect(last.attachments_skipped).toBeGreaterThan(0);
    expect(last.warnings.join('\n')).toContain(
      'No uploaded file for attachment',
    );
  });

  it('keys the channel on the id it reads from the bytes, not on the client claim', async () => {
    // A wizard that lied about which channel a part belongs to must not be able
    // to redirect a Discord channel's history into a channel the admin did not
    // choose. The mapping here names a different Discord channel, so nothing
    // imports.
    repoRef.channels = [
      channelMapping({ discord_channel_id: '899999999999999999' }),
    ];
    const { worker } = await buildWorker(repoRef, makeStorage(part000()));

    const result = await worker.sweepImports(NOW);

    expect(result.messagesImported).toBe(0);
    expect(repoRef.insertMessages).not.toHaveBeenCalled();
    const last = repoRef.updates.at(-1) as { warnings: string[] };
    expect(last.warnings.join('\n')).toContain('No mapping for');
  });

  it('skips a channel the admin chose to skip', async () => {
    repoRef.channels = [
      channelMapping({ mapping_action: 'skip', target_channel_id: null }),
    ];
    const { worker } = await buildWorker(repoRef, makeStorage(part000()));

    expect((await worker.sweepImports(NOW)).messagesImported).toBe(0);
  });

  it('creates a channel once and records it, so a re-run does not mint a second', async () => {
    // chat_channels has no unique (chapter_id, name) constraint, so nothing in
    // the database would catch a duplicate.
    repoRef.channels = [
      channelMapping({
        mapping_action: 'create_new',
        target_channel_id: null,
        new_channel_name: 'discord-general',
      }),
    ];
    const { worker, channelRepo } = await buildWorker(
      repoRef,
      makeStorage(part000()),
    );

    await worker.sweepImports(NOW);

    expect(channelRepo.create).toHaveBeenCalledTimes(1);
    expect(repoRef.channelUpdates[0]).toMatchObject({
      target_channel_id: 'created-channel-1',
    });
  });

  it('stops when the admin cancels mid-slice, instead of resurrecting the job', async () => {
    // The lease arbitrates between workers; it does nothing against an admin
    // calling cancel, which is an ordinary write on the same row. Without the
    // status guard the slice's closing `status: 'running'` overwrites
    // `cancelled` and the next tick picks it straight back up — a cancel button
    // that does nothing.
    const { worker } = await buildWorker(repoRef, makeStorage(part000()));
    repoRef.insertMessages.mockImplementationOnce(async () => {
      // The admin cancels while the first batch is in flight.
      repoRef.update(IMPORT_ID, CHAPTER, { status: 'cancelled' });
      return new Map();
    });

    await worker.sweepImports(NOW);

    expect(repoRef.state().status).toBe('cancelled');
  });

  it('does not mark a cancelled job failed either', async () => {
    const storage = makeStorage(part000());
    storage.downloadFile = jest.fn(async () => {
      repoRef.update(IMPORT_ID, CHAPTER, { status: 'cancelled' });
      throw new Error('storage exploded');
    });
    const { worker } = await buildWorker(repoRef, storage);

    await worker.sweepImports(NOW);

    expect(repoRef.state().status).toBe('cancelled');
  });

  it("refuses a mapping that points at another chapter's channel", async () => {
    // `chat_messages` has no `chapter_id`, so its FK accepts ANY channel in the
    // product — nothing in the database would catch history written into
    // another chapter. Worse, it would be unremovable: the purge scopes its
    // delete by this import's chapter.
    repoRef.channels = [
      channelMapping({ target_channel_id: 'a-channel-in-another-chapter' }),
    ];
    const { worker } = await buildWorker(repoRef, makeStorage(part000()));

    await worker.sweepImports(NOW);

    expect(repoRef.insertMessages).not.toHaveBeenCalled();
    expect(repoRef.state().status).toBe('failed');
  });

  it('creates a channel once across every part of that channel', async () => {
    // `channelBySnowflake` hands the same object back for each part, so a
    // channel split by `--partition` would otherwise mint one identically-named
    // Signet channel per part, each holding a slice of the history.
    repoRef.files = [
      exportFile({ id: 'f0', part_index: 0, relative_path: 'p0.json' }),
      exportFile({ id: 'f1', part_index: 1, relative_path: 'p1.json' }),
      exportFile({ id: 'f2', part_index: 2, relative_path: 'p2.json' }),
    ];
    repoRef.channels = [
      channelMapping({
        mapping_action: 'create_new',
        target_channel_id: null,
        new_channel_name: 'discord-general',
      }),
    ];
    const { worker, channelRepo } = await buildWorker(
      repoRef,
      makeStorage(part000()),
    );

    await worker.sweepImports(NOW);

    expect(channelRepo.create).toHaveBeenCalledTimes(1);
  });

  it("counts a part's messages once even if it is re-opened by a later slice", async () => {
    // A slice can end after parsing and before any batch advances the cursor,
    // so the next slice re-opens the same part at message 0. Counting on
    // `messageIndex === 0` alone would inflate the denominator every minute and
    // walk the progress bar backwards.
    repoRef = makeRepo(
      job({
        cursor_part_index: 0,
        cursor_part_message_count: 8,
        total_messages: 8,
      }),
    );
    const { worker } = await buildWorker(repoRef, makeStorage(part000()));

    await worker.sweepImports(NOW);

    const last = repoRef.updates.at(-1) as { total_messages: number };
    expect(last.total_messages).toBe(8);
  });

  it('stops mid-slice when the lease is lost rather than writing alongside the new owner', async () => {
    repoRef.leaseHeld = false;
    const { worker } = await buildWorker(repoRef, makeStorage(part000()));

    const result = await worker.sweepImports(NOW);

    expect(result.finished).toBeUndefined();
    // One batch was written before the lease check; nothing after it.
    expect(repoRef.insertMessages).toHaveBeenCalledTimes(1);
  });

  it('does not start a second slice while one is running', async () => {
    const storage = makeStorage(part000());
    const { worker } = await buildWorker(repoRef, storage);

    const [first, second] = await Promise.all([
      worker.sweepImports(NOW),
      worker.sweepImports(NOW),
    ]);

    expect([first.claimed, second.claimed].filter(Boolean)).toHaveLength(1);
  });

  it('records a malformed part as a warning and moves past it', async () => {
    const malformed = new Uint8Array(
      readFileSync(join(FIXTURES, 'malformed.json')),
    );
    const { worker } = await buildWorker(repoRef, makeStorage(malformed));

    const result = await worker.sweepImports(NOW);

    expect(result.finished).toBe(true);
    const last = repoRef.updates.at(-1) as { warnings: string[] };
    expect(last.warnings.join('\n')).toMatch(/Not valid JSON|no channel id/);
  });

  it('records a missing uploaded part instead of failing the whole import', async () => {
    const { worker } = await buildWorker(repoRef, makeStorage(null));

    const result = await worker.sweepImports(NOW);

    expect(result.finished).toBe(true);
    const last = repoRef.updates.at(-1) as { warnings: string[] };
    expect(last.warnings.join('\n')).toContain('missing');
  });

  it('marks the job failed and releases the lease when a slice throws', async () => {
    const storage = makeStorage(part000());
    storage.downloadFile = jest.fn(async () => {
      throw new Error('storage exploded');
    });
    const { worker } = await buildWorker(repoRef, storage);

    await worker.sweepImports(NOW);

    expect(repoRef.updates.at(-1)).toMatchObject({
      status: 'failed',
      error: 'storage exploded',
    });
    expect(repoRef.releaseLease).toHaveBeenCalled();
  });

  it('never lets a sweep failure escape the cron handler', async () => {
    // An unhandled rejection out of a @Cron takes the API process down under
    // Node's default --unhandled-rejections=throw.
    repoRef.claimNextRunnable = jest.fn(async () => {
      throw new Error('database down');
    });
    const { worker } = await buildWorker(repoRef, makeStorage(part000()));

    await expect(worker.handleImportSweep()).resolves.toBeUndefined();
  });

  it('bounds the warning list', async () => {
    repoRef.files = Array.from({ length: 60 }, (_, i) =>
      exportFile({
        id: `file-${i}`,
        part_index: i,
        relative_path: `part-${i}.json`,
        storage_path: `missing-${i}.json`,
      }),
    );
    const { worker } = await buildWorker(repoRef, makeStorage(null));

    await worker.sweepImports(NOW);

    const last = repoRef.updates.at(-1) as { warnings: string[] };
    expect(last.warnings.length).toBeLessThanOrEqual(50);
  });
});

describe('DiscordImportWorkerService — purging', () => {
  beforeEach(() => {
    repoRef = makeRepo(job({ status: 'purging' }));
  });

  it('deletes rows first, then the archive objects, then marks it purged', async () => {
    repoRef.deletedRounds = [PURGE_BATCH_SIZE, 12];
    const storage = makeStorage(null);
    storage.listFiles = jest.fn(async () => ['a/one.png', 'a/two.png']);
    const { worker } = await buildWorker(repoRef, storage);

    const result = await worker.sweepImports(NOW);

    expect(result.finished).toBe(true);
    expect(repoRef.deleteImportedMessages).toHaveBeenCalledTimes(2);
    // Storage is swept after the rows: a row pointing at a deleted object would
    // keep minting signed URLs for bytes that are not there.
    expect(storage.deleteFiles).toHaveBeenCalled();
    expect(repoRef.updates.at(-1)).toMatchObject({ status: 'purged' });
    expect(
      (repoRef.updates.at(-1) as { purged_at: string }).purged_at,
    ).toBeTruthy();
  });

  it('sweeps both the export and media prefixes', async () => {
    repoRef.deletedRounds = [0];
    const storage = makeStorage(null);
    const { worker } = await buildWorker(repoRef, storage);

    await worker.sweepImports(NOW);

    const prefixes = storage.listFiles.mock.calls.map((call) => call[1]);
    expect(prefixes.some((p) => String(p).endsWith('/export'))).toBe(true);
    expect(prefixes.some((p) => String(p).endsWith('/media'))).toBe(true);
  });
});

describe('worker constants', () => {
  it('keeps the batch below PostgREST max_rows', () => {
    // An unpaged read past max_rows (1000) truncates with a plain 200 and a
    // null error, so headroom is what makes a short page mean "no more rows".
    expect(IMPORT_BATCH_SIZE).toBeLessThan(1000);
    expect(PURGE_BATCH_SIZE).toBeLessThan(1000);
  });

  it('leases for longer than one tick', () => {
    expect(LEASE_MS).toBeGreaterThan(60_000);
  });
});
