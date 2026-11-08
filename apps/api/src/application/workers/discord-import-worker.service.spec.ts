import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import * as Sentry from '@sentry/nestjs';
import {
  DiscordImportWorkerService,
  IMPORT_BATCH_SIZE,
  LEASE_MS,
  PURGE_BATCH_SIZE,
} from './discord-import-worker.service';
import { DiscordExportWorkerService } from './discord-export-worker.service';
import {
  MAX_IMPORT_ATTEMPTS,
  importRetryDelayMs,
  isTransientImportFailure,
  willRetryImport,
} from './discord-import-retry';
import { ArchiveMediaCopyError } from '#domain/adapters/archive-media-copier.interface';
import { ARCHIVE_MEDIA_COPY_BUDGET_MS } from '../../infrastructure/storage/supabase-archive-media-copier.service';
import { ChannelCacheService } from '../services/channel-cache.service';
import { CHAT_MESSAGE_REPORT_REPOSITORY } from '#domain/repositories/chat-moderation.repository.interface';
import { RbacService } from '../services/rbac.service';
import { NotificationService } from '../services/notification.service';
import { DISCORD_IMPORT_REPOSITORY } from '#domain/repositories/discord-import.repository.interface';
import { DISCORD_CONNECTION_REPOSITORY } from '#domain/repositories/discord-connection.repository.interface';
import { STORAGE_PROVIDER } from '#domain/adapters/storage.interface';
import {
  CHAT_CATEGORY_REPOSITORY,
  CHAT_CHANNEL_REPOSITORY,
} from '#domain/repositories/chat.repository.interface';
import type {
  DiscordImport,
  DiscordImportChannel,
  DiscordImportFile,
} from '#domain/entities/discord-import.entity';
import type { ImportedMessageRow } from '#domain/utils/discord-export';
import { DiscordApiError } from '#domain/adapters/discord.interface';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

/** The `caught_at` site of every Sentry capture so far. */
function reportedSites(): string[] {
  return jest
    .mocked(Sentry.captureException)
    .mock.calls.map(
      (call) => (call[1] as { tags: { caught_at: string } }).tags.caught_at,
    );
}

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
    source: 'upload',
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
    purged_messages: 0,
    cleared_at: null,
    messages_after: null,
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
    new_channel_type: 'PUBLIC',
    new_channel_required_permissions: null,
    message_count: 8,
    imported_count: 0,
    status: 'pending',
    error: null,
    cursor_before_snowflake: null,
    parent_discord_channel_id: null,
    position: 0,
    // Always null on the upload path (see the entity).
    readable: null,
    private_in_discord: null,
    discord_reader_role_ids: null,
    read_only_in_discord: null,
    new_channel_same_as_discord: false,
    new_channel_group: null,
    discord_category_position: null,
    new_channel_category_id: null,
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
    renewLease: jest.fn(async function (this: {
      leaseHeld: boolean;
    }): Promise<boolean> {
      return repoRef.leaseHeld;
    }),
    releaseLease: jest.fn(async () => undefined),
    findFiles: jest.fn(async (): Promise<DiscordImportFile[]> => repoRef.files),
    findChannels: jest.fn(
      async (): Promise<DiscordImportChannel[]> => repoRef.channels,
    ),
    update: jest.fn(
      async (
        _id: string,
        _chapter: string,
        patch: Record<string, unknown>,
      ): Promise<DiscordImport> => {
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
      ): Promise<DiscordImport | null> => {
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
      ): Promise<void> => {
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
      async (rows: ImportedMessageRow[]): Promise<Map<string, string>> => {
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
      async (pairs: { id: string; reply_to_id: string }[]): Promise<number> => {
        repoRef.replyPairs.push(...pairs);
        return pairs.length;
      },
    ),
    insertAttachments: jest.fn(
      async (rows: Record<string, unknown>[]): Promise<number> => {
        repoRef.attachments.push(...rows);
        return rows.length;
      },
    ),
    deleteImportedMessages: jest.fn(async (): Promise<number> => {
      const round = repoRef.deletedRounds.shift() ?? 0;
      return round;
    }),
    deletedChannels: [] as string[],
    createdChannels: [] as string[],
    recordCreatedChannel: jest.fn(
      async (_importId: string, channelId: string): Promise<void> => {
        repoRef.createdChannels.push(channelId);
      },
    ),
    deleteEmptyCreatedChannels: jest.fn(
      async (): Promise<string[]> => repoRef.deletedChannels,
    ),
    deleteEmptyCreatedCategories: jest.fn(async (): Promise<string[]> => []),
    create: jest.fn(),
    findById: jest.fn(async () => current),
    findByChapter: jest.fn(async () => [current]),
    replaceChannels: jest.fn(),
    registerFiles: jest.fn(),
    markFilesUploaded: jest.fn(),
  };
}
let repoRef: ReturnType<typeof makeRepo>;

async function buildWorker(
  repo: ReturnType<typeof makeRepo>,
  storage: unknown,
  options: {
    exportWorker?: { runSlice: jest.Mock };
    reportRepo?: { findHeldObjects: jest.Mock };
    notifications?: { notifyUser: jest.Mock };
    /** Who holds `channels:manage` now; the import's creator by default. */
    admins?: string[];
  } = {},
) {
  const channelRepo = {
    create: jest.fn(async (data: { name: string }) => ({
      id: 'created-channel-1',
      name: data.name,
    })),
    // Merge targets' types decide whether a mention of a merged channel is
    // named (#2875). The harness's target is a whole-chapter channel.
    findByIds: jest.fn(async (chapterId: string, ids: string[]) =>
      chapterId === CHAPTER
        ? ids
            .filter((id) => id === SIGNET_CHANNEL)
            .map((id): { id: string; chapter_id: string; type: string } => ({
              id,
              chapter_id: chapterId,
              type: 'PUBLIC',
            }))
        : [],
    ),
    // Chapter-scoped: the worker re-verifies that the mapping's target channel
    // belongs to the import's chapter before writing a single message into it.
    findById: jest.fn(async (id: string, chapterId: string) =>
      chapterId === CHAPTER &&
      (id === SIGNET_CHANNEL || id === 'created-channel-1')
        ? {
            id,
            chapter_id: chapterId,
            name: 'general',
            type: 'PUBLIC',
            required_permissions: null,
            is_read_only: true,
            archived_at: null,
          }
        : null,
    ),
  };
  // The groups `start` resolved; any other id reads as deleted since.
  const categoryRepo = {
    findById: jest.fn(async (id: string, chapterId: string) =>
      chapterId === CHAPTER && id === 'group-1'
        ? { id, chapter_id: chapterId, name: 'Committees', display_order: 0 }
        : null,
    ),
  };
  const connectionRepo = { deleteExpiredStates: jest.fn(async () => 0) };
  const exportWorker = options.exportWorker ?? {
    runSlice: jest.fn(async () => {
      throw new Error(
        'The bot export worker must never be reached by an upload-sourced import.',
      );
    }),
  };
  // Role mentions read as the mapped Frapp role's current name (#2875).
  const rbac = {
    findByChapter: jest.fn(async () => [{ id: 'role-1', name: 'Brothers' }]),
    findUserIdsWithPermissions: jest.fn(
      async () => options.admins ?? ['user-1'],
    ),
  };
  const channelCache = { invalidate: jest.fn() };
  // No open chat report holds anything unless a case says so (#2481).
  const reportRepo = options.reportRepo ?? {
    findHeldObjects: jest.fn(async () => []),
  };
  const notifications = options.notifications ?? {
    notifyUser: jest.fn(async () => undefined),
  };
  const moduleRef = await Test.createTestingModule({
    providers: [
      DiscordImportWorkerService,
      { provide: NotificationService, useValue: notifications },
      { provide: DISCORD_IMPORT_REPOSITORY, useValue: repo },
      { provide: STORAGE_PROVIDER, useValue: storage },
      { provide: CHAT_CHANNEL_REPOSITORY, useValue: channelRepo },
      { provide: CHAT_CATEGORY_REPOSITORY, useValue: categoryRepo },
      // Every job in this file is `source: 'upload'`, so the sweeper never
      // delegates here. Stubbed rather than real so a regression that DID
      // delegate an upload job would fail loudly instead of hitting Discord.
      { provide: DiscordExportWorkerService, useValue: exportWorker },
      // Only the hourly OAuth-state reaper touches this; no import slice does.
      { provide: DISCORD_CONNECTION_REPOSITORY, useValue: connectionRepo },
      { provide: RbacService, useValue: rbac },
      // The purge evicts the channels it deletes (#2905).
      { provide: ChannelCacheService, useValue: channelCache },
      // The purge keeps what an open chat report holds (#2481).
      { provide: CHAT_MESSAGE_REPORT_REPOSITORY, useValue: reportRepo },
    ],
  }).compile();
  return {
    worker: moduleRef.get(DiscordImportWorkerService),
    channelRepo,
    categoryRepo,
    channelCache,
    connectionRepo,
    notifications,
  };
}

function makeStorage(partBytes: Uint8Array | null) {
  return {
    downloadFile: jest.fn(
      async (_bucket: string, _path: string): Promise<Uint8Array | null> =>
        partBytes,
    ),
    listFiles: jest.fn(
      async (_bucket: string, _prefix: string): Promise<string[]> => [],
    ),
    deleteFiles: jest.fn(
      async (_bucket: string, _paths: string[]): Promise<void> => undefined,
    ),
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

describe('DiscordImportWorkerService — telling the admin it ended', () => {
  beforeEach(() => {
    repoRef = makeRepo(job());
  });

  const botSlice = (finished: boolean) => ({
    runSlice: jest.fn(async () => ({
      messagesImported: 6,
      finished,
      totals: {
        imported: 6,
        skipped: 0,
        attachmentsImported: 0,
        attachmentsSkipped: 0,
        totalMessages: 6,
        warnings: [],
      },
    })),
  });

  it('notifies the admin who set the import up once an upload completes', async () => {
    const { worker, notifications } = await buildWorker(
      repoRef,
      makeStorage(part000()),
    );

    await worker.sweepImports(NOW);

    expect(repoRef.state().status).toBe('completed');
    expect(notifications.notifyUser).toHaveBeenCalledTimes(1);
    expect(notifications.notifyUser).toHaveBeenCalledWith('user-1', CHAPTER, {
      title: 'Discord import finished',
      body: '6 messages from Tau Nu are now in Frapp chat.',
      priority: 'NORMAL',
      category: 'admin',
      data: { target: { screen: 'discord_import' } },
    });
  });

  // The bot path closes in its own write, the main way in.
  it('notifies once a bot import completes, and not on a slice that leaves it running', async () => {
    repoRef = makeRepo(job({ source: 'bot', status: 'running' }));
    const running = await buildWorker(repoRef, makeStorage(null), {
      exportWorker: botSlice(false),
    });
    await running.worker.sweepImports(NOW);
    expect(running.notifications.notifyUser).not.toHaveBeenCalled();

    repoRef = makeRepo(job({ source: 'bot', status: 'running' }));
    const done = await buildWorker(repoRef, makeStorage(null), {
      exportWorker: botSlice(true),
    });
    await done.worker.sweepImports(NOW);
    expect(repoRef.state().status).toBe('completed');
    expect(done.notifications.notifyUser).toHaveBeenCalledWith(
      'user-1',
      CHAPTER,
      expect.objectContaining({ title: 'Discord import finished' }),
    );
  });

  it('tells the admin when the import stops on an error', async () => {
    repoRef = makeRepo(job({ source: 'bot', status: 'running' }));
    const { worker, notifications } = await buildWorker(
      repoRef,
      makeStorage(null),
      {
        exportWorker: {
          runSlice: jest.fn(async () => {
            throw new DiscordApiError('Missing Access', 403);
          }),
        },
      },
    );

    await worker.sweepImports(NOW);

    expect(repoRef.state().status).toBe('failed');
    expect(notifications.notifyUser).toHaveBeenCalledWith('user-1', CHAPTER, {
      title: 'Discord import stopped',
      body: 'The import from Tau Nu stopped on an error. Open the Discord import page to see why.',
      priority: 'NORMAL',
      category: 'admin',
      data: { target: { screen: 'discord_import' } },
    });
  });

  it('sends nothing to an admin who no longer manages channels', async () => {
    const { worker, notifications } = await buildWorker(
      repoRef,
      makeStorage(part000()),
      { admins: ['someone-else'] },
    );

    await worker.sweepImports(NOW);

    expect(repoRef.state().status).toBe('completed');
    expect(notifications.notifyUser).not.toHaveBeenCalled();
  });

  it('says nothing when the closing write finds the import stopped', async () => {
    // An admin's cancel landed mid-slice: the guarded write matches no row.
    repoRef.updateIfStatus.mockResolvedValue(null);
    const { worker, notifications } = await buildWorker(
      repoRef,
      makeStorage(part000()),
    );

    await worker.sweepImports(NOW);

    expect(notifications.notifyUser).not.toHaveBeenCalled();
  });

  it('finishes the import even when the notice fails', async () => {
    const { worker } = await buildWorker(repoRef, makeStorage(part000()), {
      notifications: {
        notifyUser: jest.fn(async () => {
          throw new Error('push down');
        }),
      },
    });

    const result = await worker.sweepImports(NOW);

    expect(result.finished).toBe(true);
    expect(repoRef.state().status).toBe('completed');
  });
});

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
    await repoRef.update(IMPORT_ID, CHAPTER, {
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

    const rows = repoRef.insertMessages.mock.calls[0][0];
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
      "wasn't in the upload, so it was not imported",
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
    expect(last.warnings.join('\n')).toContain('had no place chosen in Frapp');
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

  // The purge deletes what an import created once it is empty (#2905). It
  // can't learn that from the mapping rows, which remapping a failed import
  // rewrites without their targets, so the worker records it as it creates.
  it('records a channel it creates for the purge, before the mapping row learns its target', async () => {
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

    expect(repoRef.recordCreatedChannel).toHaveBeenCalledTimes(1);
    expect(repoRef.recordCreatedChannel).toHaveBeenCalledWith(
      job().id,
      'created-channel-1',
    );
    expect(
      repoRef.recordCreatedChannel.mock.invocationCallOrder[0],
    ).toBeGreaterThan(channelRepo.create.mock.invocationCallOrder[0]);
    expect(
      repoRef.recordCreatedChannel.mock.invocationCallOrder[0],
    ).toBeLessThan(repoRef.updateChannel.mock.invocationCallOrder[0]);
  });

  it('records nothing for a channel it merges into', async () => {
    repoRef.channels = [
      channelMapping({
        mapping_action: 'use_existing',
        target_channel_id: SIGNET_CHANNEL,
      }),
    ];
    const { worker, channelRepo } = await buildWorker(
      repoRef,
      makeStorage(part000()),
    );

    await worker.sweepImports(NOW);

    expect(channelRepo.create).not.toHaveBeenCalled();
    expect(repoRef.recordCreatedChannel).not.toHaveBeenCalled();
  });

  it('creates a restricted channel ROLE_GATED, with the permissions the admin chose (#2787)', async () => {
    // Before #2787 every created channel was PUBLIC, so a private Discord
    // channel (#cabinet) became readable by the whole chapter.
    repoRef.channels = [
      channelMapping({
        mapping_action: 'create_new',
        target_channel_id: null,
        new_channel_name: 'cabinet',
        new_channel_type: 'ROLE_GATED',
        new_channel_required_permissions: ['chapter-config:manage'],
      }),
    ];
    const { worker, channelRepo } = await buildWorker(
      repoRef,
      makeStorage(part000()),
    );

    await worker.sweepImports(NOW);

    expect(channelRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'cabinet',
        type: 'ROLE_GATED',
        required_permissions: ['chapter-config:manage'],
      }),
    );
  });

  it('creates a public channel with no gate', async () => {
    repoRef.channels = [
      channelMapping({
        mapping_action: 'create_new',
        target_channel_id: null,
        new_channel_name: 'general',
        new_channel_type: 'PUBLIC',
        // Ignored for PUBLIC even if a row somehow carried one.
        new_channel_required_permissions: ['chapter-config:manage'],
      }),
    ];
    const { worker, channelRepo } = await buildWorker(
      repoRef,
      makeStorage(part000()),
    );

    await worker.sweepImports(NOW);

    expect(channelRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'PUBLIC', required_permissions: null }),
    );
  });

  it('creates a channel in the group the import resolved for it', async () => {
    repoRef.channels = [
      channelMapping({
        mapping_action: 'create_new',
        target_channel_id: null,
        new_channel_name: 'rush',
        new_channel_type: 'PUBLIC',
        new_channel_group: 'Committees',
        new_channel_category_id: 'group-1',
      }),
    ];
    const { worker, channelRepo, categoryRepo } = await buildWorker(
      repoRef,
      makeStorage(part000()),
    );

    await worker.sweepImports(NOW);

    expect(categoryRepo.findById).toHaveBeenCalledWith('group-1', CHAPTER);
    expect(channelRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'rush', category_id: 'group-1' }),
    );
  });

  it('creates the channel with no group when its group was deleted since the import started', async () => {
    repoRef.channels = [
      channelMapping({
        mapping_action: 'create_new',
        target_channel_id: null,
        new_channel_name: 'rush',
        new_channel_type: 'PUBLIC',
        new_channel_group: 'Committees',
        new_channel_category_id: 'group-deleted',
      }),
    ];
    const { worker, channelRepo } = await buildWorker(
      repoRef,
      makeStorage(part000()),
    );

    await worker.sweepImports(NOW);

    expect(channelRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'rush', category_id: null }),
    );
    expect(repoRef.state().status).not.toBe('failed');
  });

  it('creates the channel with no group when the group is deleted between its read and the insert', async () => {
    repoRef.channels = [
      channelMapping({
        mapping_action: 'create_new',
        target_channel_id: null,
        new_channel_name: 'rush',
        new_channel_type: 'PUBLIC',
        new_channel_group: 'Committees',
        new_channel_category_id: 'group-1',
      }),
    ];
    const { worker, channelRepo } = await buildWorker(
      repoRef,
      makeStorage(part000()),
    );
    const create = channelRepo.create as jest.Mock;
    const original = create.getMockImplementation();
    create.mockImplementationOnce(() =>
      Promise.reject(Object.assign(new Error('fk'), { code: '23503' })),
    );
    if (original) create.mockImplementation(original);

    await worker.sweepImports(NOW);

    expect(create.mock.calls.map(([data]) => data.category_id)).toEqual([
      'group-1',
      null,
    ]);
    expect(repoRef.state().status).not.toBe('failed');
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
      await repoRef.update(IMPORT_ID, CHAPTER, { status: 'cancelled' });
      return new Map();
    });

    await worker.sweepImports(NOW);

    expect(repoRef.state().status).toBe('cancelled');
  });

  it('does not mark a cancelled job failed either', async () => {
    const storage = makeStorage(part000());
    storage.downloadFile.mockImplementation(async () => {
      await repoRef.update(IMPORT_ID, CHAPTER, { status: 'cancelled' });
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

  it('stops rather than import into a direct message a mapping points at (#2856)', async () => {
    const { worker, channelRepo } = await buildWorker(
      repoRef,
      makeStorage(part000()),
    );
    channelRepo.findById.mockResolvedValue({
      id: SIGNET_CHANNEL,
      chapter_id: CHAPTER,
      name: 'officers',
      type: 'GROUP_DM',
      required_permissions: null,
      is_read_only: true,
      archived_at: null,
    });

    await worker.sweepImports(NOW);

    expect(repoRef.insertMessages).not.toHaveBeenCalled();
    expect(repoRef.state().error).toMatch(/points at a direct message/);
  });

  // An officer may delete any channel, one an import merges into included
  // (#2922). The row keeps its record with no target, and the import stops
  // with a sentence rather than guess a channel or surface a constraint.
  it('stops with a sentence when the channel a merge goes into was deleted before the slice (#2922)', async () => {
    repoRef.channels = [channelMapping({ target_channel_id: null })];
    const { worker, channelRepo } = await buildWorker(
      repoRef,
      makeStorage(part000()),
    );

    const result = await worker.sweepImports(NOW);

    expect(result.finished).toBe(true);
    expect(channelRepo.create).not.toHaveBeenCalled();
    expect(repoRef.insertMessages).not.toHaveBeenCalled();
    expect(repoRef.state().status).toBe('failed');
    expect(repoRef.state().error).toBe(
      'The Frapp channel #general was importing into was deleted, so the import stopped. To bring #general in, delete this import and import again.',
    );
  });

  it('says a channel deleted after the slice read its row may be why its target is gone (#2922)', async () => {
    const { worker, channelRepo } = await buildWorker(
      repoRef,
      makeStorage(part000()),
    );
    channelRepo.findById.mockResolvedValue(null);

    await worker.sweepImports(NOW);

    expect(repoRef.insertMessages).not.toHaveBeenCalled();
    expect(repoRef.state().status).toBe('failed');
    expect(repoRef.state().error).toBe(
      "The Frapp channel #general was importing into was deleted, or isn't one of this chapter's channels, so the import stopped. To bring #general in, delete this import and import again.",
    );
  });

  it('names the deleted channel when an insert meets the foreign key mid-batch (#2922)', async () => {
    const { worker, channelRepo } = await buildWorker(
      repoRef,
      makeStorage(part000()),
    );
    // Resolved while it existed; deleted before the insert landed.
    const live = await channelRepo.findById(SIGNET_CHANNEL, CHAPTER);
    channelRepo.findById
      .mockResolvedValueOnce(live)
      .mockResolvedValueOnce(null);
    repoRef.insertMessages.mockRejectedValueOnce({
      code: '23503',
      message:
        'insert or update on table "chat_messages" violates foreign key constraint "chat_messages_channel_id_fkey"',
    });

    await worker.sweepImports(NOW);

    expect(repoRef.state().status).toBe('failed');
    expect(repoRef.state().error).toBe(
      'The Frapp channel #general was importing into was deleted, so the import stopped. To bring #general in, delete this import and import again.',
    );
  });

  it('names the deleted channel when the attachment insert meets the foreign key (#2922)', async () => {
    // Deleted between the batch's message insert and its attachment insert.
    repoRef.files = [
      exportFile(),
      mediaFile('general [800000000000000001]_Files/rush-schedule-c3d4.pdf'),
    ];
    const { worker, channelRepo } = await buildWorker(
      repoRef,
      makeStorage(part000()),
    );
    const live = await channelRepo.findById(SIGNET_CHANNEL, CHAPTER);
    channelRepo.findById
      .mockResolvedValueOnce(live)
      .mockResolvedValueOnce(null);
    repoRef.insertAttachments.mockRejectedValueOnce({
      code: '23503',
      message:
        'insert or update on table "chat_message_attachments" violates foreign key constraint "chat_message_attachments_channel_id_fkey"',
    });

    await worker.sweepImports(NOW);

    expect(repoRef.insertAttachments).toHaveBeenCalled();
    expect(repoRef.state().status).toBe('failed');
    expect(repoRef.state().error).toBe(
      'The Frapp channel #general was importing into was deleted, so the import stopped. To bring #general in, delete this import and import again.',
    );
  });

  it('keeps the foreign-key failure when the re-read that would explain it fails', async () => {
    const { worker, channelRepo } = await buildWorker(
      repoRef,
      makeStorage(part000()),
    );
    const live = await channelRepo.findById(SIGNET_CHANNEL, CHAPTER);
    channelRepo.findById
      .mockResolvedValueOnce(live)
      .mockRejectedValueOnce(new Error('PostgREST unavailable'));
    repoRef.insertMessages.mockRejectedValueOnce({
      code: '23503',
      message:
        'insert or update on table "chat_messages" violates foreign key constraint "chat_messages_reply_to_id_fkey"',
    });

    await worker.sweepImports(NOW);

    expect(repoRef.state().status).toBe('failed');
    expect(repoRef.state().error).toMatch(/chat_messages_reply_to_id_fkey/);
  });

  it('leaves the target out of the per-part write, so a channel deleted after the insert is not written back (#2922)', async () => {
    const { worker } = await buildWorker(repoRef, makeStorage(part000()));

    await worker.sweepImports(NOW);

    const afterPart = repoRef.channelUpdates.filter(
      (patch) => 'imported_count' in patch,
    );
    expect(afterPart.length).toBeGreaterThan(0);
    for (const patch of afterPart) {
      expect(patch).not.toHaveProperty('target_channel_id');
    }
  });

  it('keeps a foreign-key failure with another cause as the database said it', async () => {
    const { worker } = await buildWorker(repoRef, makeStorage(part000()));
    repoRef.insertMessages.mockRejectedValueOnce({
      code: '23503',
      message:
        'insert or update on table "chat_messages" violates foreign key constraint "chat_messages_reply_to_id_fkey"',
    });

    await worker.sweepImports(NOW);

    expect(repoRef.state().status).toBe('failed');
    expect(repoRef.state().error).toMatch(/chat_messages_reply_to_id_fkey/);
  });

  it('creates a channel once across every part of that channel', async () => {
    // `channelBySnowflake` hands the same object back for each part, so a
    // channel split by `--partition` would otherwise mint one identically-named
    // Frapp channel per part, each holding a slice of the history.
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

  describe('like-named channels (#2856)', () => {
    /** The fixture re-keyed as a second Discord channel, ids and all. */
    const otherChannelPart = () => {
      const part = JSON.parse(
        readFileSync(join(FIXTURES, 'part-000.json'), 'utf8'),
      ) as {
        channel: { id: string; name: string };
        messages: { id?: string | null; reference?: unknown }[];
      };
      part.channel = { ...part.channel, id: '800000000000000002' };
      part.messages = part.messages.map((message) => ({
        ...message,
        id: message.id ? message.id.replace(/^9/, '7') : message.id,
      }));
      return new TextEncoder().encode(JSON.stringify(part));
    };
    const twoParts = () => {
      repoRef.files = [
        exportFile({ id: 'f0', part_index: 0, relative_path: 'p0.json' }),
        exportFile({
          id: 'f1',
          part_index: 1,
          relative_path: 'p1.json',
          storage_path: `chapters/${CHAPTER}/chat-archive/imports/${IMPORT_ID}/export/0001-p1.json`,
        }),
      ];
      const storage = makeStorage(part000());
      const other = otherChannelPart();
      storage.downloadFile.mockImplementation(
        async (_bucket: string, path: string) =>
          path.endsWith('0001-p1.json') ? other : part000(),
      );
      return storage;
    };
    const newChannel = (overrides: Partial<DiscordImportChannel>) =>
      channelMapping({
        mapping_action: 'create_new',
        target_channel_id: null,
        new_channel_name: 'general',
        new_channel_type: 'PUBLIC',
        new_channel_required_permissions: null,
        ...overrides,
      });

    it('lands two Discord channels with one new name and the same readers in one channel', async () => {
      repoRef.channels = [
        newChannel({ id: 'map-1' }),
        newChannel({
          id: 'map-2',
          discord_channel_id: '800000000000000002',
          // Compared the way the wizard compares names.
          new_channel_name: ' #General ',
        }),
      ];
      const { worker, channelRepo } = await buildWorker(repoRef, twoParts());

      await worker.sweepImports(NOW);

      expect(channelRepo.create).toHaveBeenCalledTimes(1);
      expect(repoRef.channelUpdates).toContainEqual({
        target_channel_id: 'created-channel-1',
      });
      const landed = [
        ...(repoRef.inserted().get('created-channel-1')?.keys() ?? []),
      ];
      expect(landed.some((id) => id.startsWith('7'))).toBe(true);
      expect(landed.some((id) => id.startsWith('9'))).toBe(true);
    });

    it('gives each its own channel when they differ in who reads them', async () => {
      repoRef.channels = [
        newChannel({ id: 'map-1' }),
        newChannel({
          id: 'map-2',
          discord_channel_id: '800000000000000002',
          new_channel_type: 'ROLE_GATED',
          new_channel_required_permissions: ['channels:read:exec'],
        }),
      ];
      const { worker, channelRepo } = await buildWorker(repoRef, twoParts());

      await worker.sweepImports(NOW);

      expect(channelRepo.create).toHaveBeenCalledTimes(2);
    });

    it('lands the rest of a group in one replacement when its first channel is gone', async () => {
      repoRef.channels = [
        newChannel({
          id: 'map-0',
          discord_channel_id: '800000000000000009',
          target_channel_id: 'deleted-channel',
          status: 'completed',
        }),
        newChannel({ id: 'map-1' }),
        newChannel({ id: 'map-2', discord_channel_id: '800000000000000002' }),
      ];
      const { worker, channelRepo } = await buildWorker(repoRef, twoParts());

      await worker.sweepImports(NOW);

      // map-1 makes the replacement; map-2 passes over the gone channel to it.
      expect(channelRepo.create).toHaveBeenCalledTimes(1);
      expect(
        repoRef.channels.map((row) => [row.id, row.target_channel_id]),
      ).toEqual([
        ['map-0', 'deleted-channel'],
        ['map-1', 'created-channel-1'],
        ['map-2', 'created-channel-1'],
      ]);
    });

    it('never reuses a channel whose readers are not the row’s own', async () => {
      // An upload mapped before #2856 could carry a client-sent target on a
      // new-channel row; that channel is PUBLIC, the row is gated.
      const gated = {
        new_channel_type: 'ROLE_GATED' as const,
        new_channel_required_permissions: ['channels:read:exec'],
      };
      repoRef.channels = [
        newChannel({
          id: 'map-0',
          discord_channel_id: '800000000000000009',
          target_channel_id: SIGNET_CHANNEL,
          status: 'completed',
          ...gated,
        }),
        newChannel({ id: 'map-1', ...gated }),
      ];
      const { worker, channelRepo } = await buildWorker(
        repoRef,
        makeStorage(part000()),
      );

      await worker.sweepImports(NOW);

      expect(channelRepo.create).toHaveBeenCalledTimes(1);
      expect(repoRef.inserted().get(SIGNET_CHANNEL)).toBeUndefined();
    });

    it('stops rather than import into its own recorded channel when that channel has other readers', async () => {
      // An upload mapped before #2856 kept a client-sent target on a
      // new-channel row: here a gated row points at the PUBLIC channel.
      repoRef.channels = [
        newChannel({
          id: 'map-1',
          target_channel_id: SIGNET_CHANNEL,
          new_channel_type: 'ROLE_GATED',
          new_channel_required_permissions: ['channels:read:exec'],
        }),
      ];
      const { worker } = await buildWorker(repoRef, makeStorage(part000()));

      await worker.sweepImports(NOW);

      expect(repoRef.insertMessages).not.toHaveBeenCalled();
      expect(repoRef.state().status).toBe('failed');
      expect(repoRef.state().error).toMatch(
        /no longer has the readers its mapping asks for/,
      );
    });

    it('does not reuse a shared channel that is gone', async () => {
      repoRef.channels = [
        newChannel({
          id: 'map-0',
          discord_channel_id: '800000000000000009',
          target_channel_id: 'deleted-channel',
          status: 'completed',
        }),
        newChannel({ id: 'map-1' }),
      ];
      const { worker, channelRepo } = await buildWorker(
        repoRef,
        makeStorage(part000()),
      );

      await worker.sweepImports(NOW);

      expect(channelRepo.create).toHaveBeenCalledTimes(1);
      expect(repoRef.inserted().get('deleted-channel')).toBeUndefined();
    });
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
    storage.downloadFile.mockImplementation(async () => {
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

  it('records a repository\'s error text, not "[object Object]"', async () => {
    // A throwable that is not an Error, as every repository threw before
    // #1264. Staging's first real bot import failed with its cause reduced to
    // "[object Object]" on the page and in the log (#2825), and the worker
    // still normalizes whatever reaches it.
    const storage = makeStorage(part000());
    storage.downloadFile.mockImplementation().mockRejectedValue({
      // A code that is not a temporary fault, so the job fails rather than
      // waits to try again (#1692).
      code: '22P02',
      message: 'request line too long',
    });
    const { worker } = await buildWorker(repoRef, storage);

    await worker.sweepImports(NOW);

    expect(repoRef.updates.at(-1)).toMatchObject({
      status: 'failed',
      error: '22P02: request line too long',
    });
  });

  it('never lets a sweep failure escape the cron handler', async () => {
    // A rejection out of a @Cron reaches only Nest's raw logger.error, which
    // no alert sees.
    repoRef.claimNextRunnable = jest.fn(async () => {
      throw new Error('database down');
    });
    const { worker } = await buildWorker(repoRef, makeStorage(part000()));

    await expect(worker.handleImportSweep()).resolves.toBeUndefined();
  });

  describe('what reaches Sentry', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('reports a failed tick once, however many ticks fail', async () => {
      repoRef.claimNextRunnable = jest.fn(async () => {
        throw new Error('database down');
      });
      const { worker } = await buildWorker(repoRef, makeStorage(part000()));

      await expect(worker.handleImportSweep()).resolves.toBeUndefined();
      await expect(worker.handleImportSweep()).resolves.toBeUndefined();

      expect(reportedSites()).toEqual(['discord-import-sweep-tick']);
    });

    it('reports an import that a fault stopped, and still marks it failed', async () => {
      const storage = makeStorage(part000());
      storage.downloadFile.mockImplementation(async () => {
        throw new Error('storage exploded');
      });
      const { worker } = await buildWorker(repoRef, storage);

      const result = await worker.sweepImports(NOW);

      expect(result).toMatchObject({ claimed: true, finished: true });
      expect(repoRef.state().status).toBe('failed');
      expect(reportedSites()).toEqual(['discord-import-job-failed']);
    });

    it('does not report a stop the admin can fix', async () => {
      repoRef.channels = [channelMapping({ target_channel_id: null })];
      const { worker } = await buildWorker(repoRef, makeStorage(part000()));

      await worker.sweepImports(NOW);

      expect(repoRef.state().status).toBe('failed');
      expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it('does not report Discord refusing the bot', async () => {
      repoRef = makeRepo(job({ source: 'bot', status: 'running' }));
      const exportWorker = {
        runSlice: jest.fn(async () => {
          throw new DiscordApiError('Missing Access', 403);
        }),
      };
      const { worker } = await buildWorker(repoRef, makeStorage(null), {
        exportWorker,
      });

      await worker.sweepImports(NOW);

      expect(repoRef.state()).toMatchObject({
        status: 'failed',
        error: 'Missing Access',
      });
      expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it('reports a failed OAuth state reap as a warning', async () => {
      const { worker, connectionRepo } = await buildWorker(
        repoRef,
        makeStorage(null),
      );
      connectionRepo.deleteExpiredStates.mockRejectedValue(
        new Error('database down'),
      );

      await expect(worker.handleOAuthStateSweep()).resolves.toBeUndefined();

      expect(reportedSites()).toEqual(['discord-oauth-state-sweep']);
      expect(
        jest.mocked(Sentry.captureException).mock.calls[0]?.[1],
      ).toMatchObject({
        level: 'warning',
      });
    });
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

describe('DiscordImportWorkerService — Discord mention tokens (#2875)', () => {
  beforeEach(() => {
    repoRef = makeRepo(job());
  });

  it('names the tokens an upload still carries, linking a channel merged into a whole-chapter one', async () => {
    // DCE renders tokens as text by default; an export made with
    // `--markdown false` keeps them, and names no roles.
    const part = JSON.parse(
      readFileSync(join(FIXTURES, 'part-000.json'), 'utf8'),
    ) as { messages: Record<string, unknown>[] };
    part.messages = [
      {
        id: '990000000000000001',
        type: 'Default',
        timestamp: '2019-04-01T10:00:00Z',
        content: '<#800000000000000001> <@&500000000000000001> <@6>',
        author: { id: '6', name: 'pdcarlson', nickname: 'Paul' },
        mentions: [{ id: '6', name: 'pdcarlson', nickname: 'Paul' }],
      },
    ];
    const { worker } = await buildWorker(
      repoRef,
      makeStorage(new TextEncoder().encode(JSON.stringify(part))),
    );

    await worker.sweepImports(NOW);

    const rows = repoRef.insertMessages.mock.calls[0][0] as {
      content: string;
    }[];
    // An upload records no privacy, but this row merged into a channel every
    // member reads, so its messages are open to all and its name is too.
    expect(rows[0].content).toBe(
      `[#general](/chat?channel=${SIGNET_CHANNEL}) @unknown-role @Paul`,
    );
  });

  it('never names a channel merged into one only some members read', async () => {
    const part = JSON.parse(
      readFileSync(join(FIXTURES, 'part-000.json'), 'utf8'),
    ) as { messages: Record<string, unknown>[] };
    part.messages = [
      {
        id: '990000000000000002',
        type: 'Default',
        timestamp: '2019-04-01T10:00:00Z',
        content: 'see <#800000000000000001>',
        author: { id: '6', name: 'pdcarlson' },
      },
    ];
    const { worker, channelRepo } = await buildWorker(
      repoRef,
      makeStorage(new TextEncoder().encode(JSON.stringify(part))),
    );
    channelRepo.findByIds.mockImplementation(
      async (chapterId: string, ids: string[]) =>
        ids.map((id) => ({ id, chapter_id: chapterId, type: 'ROLE_GATED' })),
    );

    await worker.sweepImports(NOW);

    const rows = repoRef.insertMessages.mock.calls[0][0] as {
      content: string;
    }[];
    expect(rows[0].content).toBe('see #private-channel');
  });

  it('hands a bot slice role names by their Discord names', async () => {
    const brothers = '750151182395244584';
    const amongUs = '750151182395244585';
    repoRef = makeRepo(
      job({
        source: 'bot',
        status: 'running',
        guild_id: '700000000000000001',
        role_mapping: [
          {
            discord_role_id: brothers,
            discord_role_name: 'Brothers 🦁',
            action: 'existing',
            frapp_role_id: 'role-1',
            new_role_name: null,
            read_permission: 'channels:read:brothers',
          },
          {
            discord_role_id: amongUs,
            discord_role_name: 'Among Us',
            action: 'ignore',
            frapp_role_id: null,
            new_role_name: null,
            read_permission: null,
          },
        ],
      }),
    );
    const exportWorker = {
      runSlice: jest.fn(
        async (
          _args: Parameters<DiscordExportWorkerService['runSlice']>[0],
        ) => ({
          messagesImported: 0,
          finished: false,
          totals: {
            imported: 0,
            skipped: 0,
            attachmentsImported: 0,
            attachmentsSkipped: 0,
            totalMessages: 0,
            warnings: [],
          },
        }),
      ),
    };
    const { worker } = await buildWorker(repoRef, makeStorage(null), {
      exportWorker,
    });

    await worker.sweepImports(NOW);

    const { roleName } = exportWorker.runSlice.mock.calls[0][0];
    // The Discord name, not the Frapp role it maps to ('Brothers' here).
    expect(roleName(brothers)).toBe('Brothers 🦁');
    expect(roleName(amongUs)).toBe('Among Us');
    expect(roleName('700000000000000001')).toBe('everyone');
    expect(roleName('1')).toBeNull();
  });
});

describe('DiscordImportWorkerService — purging', () => {
  beforeEach(() => {
    repoRef = makeRepo(job({ status: 'purging' }));
  });

  it('deletes rows first, then the archive objects, then marks it purged', async () => {
    repoRef.deletedRounds = [PURGE_BATCH_SIZE, 12];
    const storage = makeStorage(null);
    storage.listFiles.mockImplementation(async () => [
      'a/one.png',
      'a/two.png',
    ]);
    const { worker } = await buildWorker(repoRef, storage);

    const result = await worker.sweepImports(NOW);

    expect(result.finished).toBe(true);
    // Three rounds, not two: the 12-row round is short but not empty, so it
    // does not prove the rows ran out (#1628). The stub answers 0 on the third.
    expect(repoRef.deleteImportedMessages).toHaveBeenCalledTimes(3);
    // Storage is swept after the rows: a row pointing at a deleted object would
    // keep minting signed URLs for bytes that are not there.
    expect(storage.deleteFiles).toHaveBeenCalled();
    expect(repoRef.updates.at(-1)).toMatchObject({ status: 'purged' });
    expect(
      (repoRef.updates.at(-1) as { purged_at: string }).purged_at,
    ).toBeTruthy();
  });

  // The admin's progress bar (#2944). Counting the rows left on every poll
  // would scan up to the whole import; the worker already renews its lease
  // after every round, and the count rides that lock-bound write.
  it('records the running deleted count with each lease renewal, continuing from the stored one', async () => {
    // A purge resumed from an earlier slice, or re-requested after one failed.
    repoRef = makeRepo(job({ status: 'purging', purged_messages: 1000 }));
    repoRef.deletedRounds = [PURGE_BATCH_SIZE, 12];
    const storage = makeStorage(null);
    const { worker } = await buildWorker(repoRef, storage);

    const result = await worker.sweepImports(NOW);

    expect(result.finished).toBe(true);
    // Two non-empty rounds, two renewals, each with the total so far; the
    // empty round that ends the loop deleted nothing, so renews nothing.
    expect(
      repoRef.renewLease.mock.calls.map((call: unknown[]) => [
        call[1],
        call[4],
      ]),
    ).toEqual([
      ['token-1', { purged_messages: 1000 + PURGE_BATCH_SIZE }],
      ['token-1', { purged_messages: 1000 + PURGE_BATCH_SIZE + 12 }],
    ]);
  });

  // The direct regression test for #1628 on the purge path. A project whose
  // `max_rows` sits below PURGE_BATCH_SIZE caps the candidate select, so the
  // first round comes back short. Breaking there stranded every imported
  // message after it — and then deleted the storage objects and marked the job
  // purged, so nothing ever revisited the rows left pointing at missing bytes.
  it('does not stop purging on a short-but-non-empty round', async () => {
    repoRef.deletedRounds = [200, 200, 40, 0];
    const storage = makeStorage(null);
    storage.listFiles.mockImplementation(async () => ['a/one.png']);
    const { worker } = await buildWorker(repoRef, storage);

    const result = await worker.sweepImports(NOW);

    expect(result.finished).toBe(true);
    expect(repoRef.deleteImportedMessages).toHaveBeenCalledTimes(4);
    // Only after every row is gone may the objects go and the job be marked.
    expect(storage.deleteFiles).toHaveBeenCalled();
    expect(repoRef.updates.at(-1)).toMatchObject({ status: 'purged' });
  });

  // A re-import of the same server used to mint a second, like-named channel
  // beside each one a deleted import left behind (#2905).
  it('deletes the channels it created and emptied after the rows, before the objects, and evicts them', async () => {
    repoRef.deletedRounds = [12];
    repoRef.deletedChannels = ['created-a', 'created-b'];
    const storage = makeStorage(null);
    storage.listFiles.mockImplementation(async () => ['a/one.png']);
    const { worker, channelCache } = await buildWorker(repoRef, storage);

    const result = await worker.sweepImports(NOW);

    expect(result.finished).toBe(true);
    expect(repoRef.deleteEmptyCreatedChannels).toHaveBeenCalledWith(
      job().id,
      CHAPTER,
    );
    const lastRowRound = Math.max(
      ...repoRef.deleteImportedMessages.mock.invocationCallOrder,
    );
    const channels =
      repoRef.deleteEmptyCreatedChannels.mock.invocationCallOrder[0];
    expect(channels).toBeGreaterThan(lastRowRound);
    expect(storage.deleteFiles.mock.invocationCallOrder[0]).toBeGreaterThan(
      channels,
    );
    expect(channelCache.invalidate.mock.calls).toEqual([
      ['created-a'],
      ['created-b'],
    ]);
    expect(repoRef.updates.at(-1)).toMatchObject({ status: 'purged' });
  });

  it('deletes the channel groups it created after its channels, before the objects', async () => {
    repoRef.deletedRounds = [12];
    const storage = makeStorage(null);
    storage.listFiles.mockImplementation(async () => ['a/one.png']);
    const { worker } = await buildWorker(repoRef, storage);

    await worker.sweepImports(NOW);

    expect(repoRef.deleteEmptyCreatedCategories).toHaveBeenCalledWith(
      job().id,
      CHAPTER,
    );
    const groups =
      repoRef.deleteEmptyCreatedCategories.mock.invocationCallOrder[0];
    expect(groups).toBeGreaterThan(
      repoRef.deleteEmptyCreatedChannels.mock.invocationCallOrder[0],
    );
    expect(storage.deleteFiles.mock.invocationCallOrder[0]).toBeGreaterThan(
      groups,
    );
    expect(repoRef.updates.at(-1)).toMatchObject({ status: 'purged' });
  });

  // An open chat report on an imported message holds its attachments (#2481):
  // deleting the import must not erase the evidence, any more than the
  // sender's own delete may. The report's release deletes them later.
  it('keeps the archive objects an open chat report holds, and deletes the rest', async () => {
    repoRef.deletedRounds = [0];
    const storage = makeStorage(null);
    storage.listFiles.mockImplementation(
      async (_bucket: string, prefix: string) =>
        prefix.endsWith('/media') ? ['m/held.png', 'm/free.png'] : ['e/x.json'],
    );
    const reportRepo = {
      findHeldObjects: jest.fn(async () => [
        { bucket: 'chat-archive', storage_path: 'm/held.png' },
        // Same path, another bucket: holds nothing here.
        { bucket: 'chat', storage_path: 'e/x.json' },
      ]),
    };
    const { worker } = await buildWorker(repoRef, storage, { reportRepo });

    await worker.sweepImports(NOW);

    expect(reportRepo.findHeldObjects).toHaveBeenCalledWith(CHAPTER);
    const deleted = storage.deleteFiles.mock.calls.flatMap(
      ([, paths]: [string, string[]]) => paths,
    );
    expect(deleted).toEqual(['e/x.json', 'm/free.png']);
    expect(repoRef.updates.at(-1)).toMatchObject({ status: 'purged' });
  });

  it('deletes no archive object and does not mark it purged when the report holds cannot be read', async () => {
    repoRef.deletedRounds = [0];
    const storage = makeStorage(null);
    storage.listFiles.mockImplementation(async () => ['m/one.png']);
    const reportRepo = {
      // A failed query. Any rejection must stop the purge, whatever its shape.
      findHeldObjects: jest.fn(() =>
        Promise.reject({ code: 'XX000', message: 'boom' }),
      ),
    };
    const { worker } = await buildWorker(repoRef, storage, { reportRepo });

    await worker.sweepImports(NOW);

    expect(storage.deleteFiles).not.toHaveBeenCalled();
    expect(repoRef.updates).not.toContainEqual(
      expect.objectContaining({ status: 'purged' }),
    );
  });

  it('fails the slice, keeping the objects and not marking it purged, when the channels cannot be deleted', async () => {
    repoRef.deletedRounds = [0];
    repoRef.deleteEmptyCreatedChannels.mockRejectedValueOnce({
      code: 'XX000',
      message: 'boom',
    });
    const storage = makeStorage(null);
    storage.listFiles.mockImplementation(async () => ['a/one.png']);
    const { worker, channelCache, notifications } = await buildWorker(
      repoRef,
      storage,
    );

    await worker.sweepImports(NOW);

    expect(storage.deleteFiles).not.toHaveBeenCalled();
    expect(channelCache.invalidate).not.toHaveBeenCalled();
    expect(repoRef.updates.at(-1)).toMatchObject({ status: 'failed' });
    // The admin who asked for the deletion is watching it; a failed one is
    // not sent as news.
    expect(notifications.notifyUser).not.toHaveBeenCalled();
    expect(repoRef.updates).not.toContainEqual(
      expect.objectContaining({ status: 'purged' }),
    );
  });

  it('touches no channel while imported rows may remain (lease lost mid-purge)', async () => {
    repoRef.deletedRounds = [PURGE_BATCH_SIZE, 12];
    repoRef.leaseHeld = false;
    const storage = makeStorage(null);
    const { worker } = await buildWorker(repoRef, storage);

    const result = await worker.sweepImports(NOW);

    expect(result.finished).toBe(false);
    expect(repoRef.deleteEmptyCreatedChannels).not.toHaveBeenCalled();
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
    // null error, so each batch stays under the cap to keep a round trip
    // small. This is throughput, not correctness: the paged reads terminate on
    // an empty page, never a short one (#1628), so a cap below these values
    // costs extra round trips rather than silently dropping rows.
    expect(IMPORT_BATCH_SIZE).toBeLessThan(1000);
    expect(PURGE_BATCH_SIZE).toBeLessThan(1000);
  });

  it('leases for longer than one tick', () => {
    expect(LEASE_MS).toBeGreaterThan(60_000);
  });

  it('keeps one archive media copy call inside the import lease', () => {
    // The worker renews the lease before each copier call; one call must not
    // outlast it. Asserted here rather than in the copier's spec, because
    // infrastructure/ must not import the application-layer worker.
    expect(ARCHIVE_MEDIA_COPY_BUDGET_MS).toBeLessThan(LEASE_MS);
  });
});

// A PostgREST blip, a reset connection or a migration's schema-cache reload
// used to fail an import for good, hours in. It now waits and tries again,
// up to MAX_IMPORT_ATTEMPTS in one streak (#1692).
describe('DiscordImportWorkerService — temporary failures (#1692)', () => {
  /** A slice whose download throws `error`, on a job `failures` into a streak. */
  async function failingWith(
    error: unknown,
    failures: number,
    onFail: () => void = () => undefined,
  ) {
    repoRef = makeRepo(job({ status: 'running', attempt_count: failures }));
    const storage = makeStorage(part000());
    storage.downloadFile.mockImplementation(async () => {
      onFail();
      throw error;
    });
    const notifications = { notifyUser: jest.fn(async () => undefined) };
    const { worker } = await buildWorker(repoRef, storage, { notifications });
    jest.mocked(Sentry.captureException).mockClear();
    const result = await worker.sweepImports(NOW);
    return { result, notifications };
  }

  /** The `pauseUntil` the release carried, if any. */
  function releasedPause(): Date | undefined {
    const calls = repoRef.releaseLease.mock.calls as unknown as [
      string,
      string,
      { pauseUntil?: Date }?,
    ][];
    return calls.at(-1)?.[2]?.pauseUntil;
  }

  /** Within a few seconds of `delayMs` past NOW: the slice's own run time. */
  function expectPauseOf(delayMs: number) {
    const pause = releasedPause();
    expect(pause).toBeInstanceOf(Date);
    const past = pause!.getTime() - NOW.getTime();
    expect(past).toBeGreaterThanOrEqual(delayMs);
    expect(past).toBeLessThan(delayMs + 5_000);
  }

  const schemaCacheMiss = {
    code: 'PGRST202',
    message: 'Could not find the function in the schema cache',
  };

  it('keeps the job running, pauses it, and says so', async () => {
    const { result, notifications } = await failingWith(schemaCacheMiss, 0);

    expect(result).toMatchObject({ claimed: true, finished: false });
    expect(repoRef.state().status).toBe('running');
    expect(repoRef.state().error).toBe(
      'The import hit a temporary problem and paused. Try 2 of 5 starts in about a minute.',
    );
    expect(repoRef.state().attempt_count).toBe(1);
    // Released with its lease running to the end of the pause, so no tick
    // claims it sooner and it holds no worker meanwhile.
    expectPauseOf(importRetryDelayMs(1));
    expect(reportedSites()).toEqual(['discord-import-job-retrying']);
    // Nothing ended, so nobody is told it did.
    expect(notifications.notifyUser).not.toHaveBeenCalled();
  });

  it('waits longer after each try', async () => {
    await failingWith(new TypeError('fetch failed'), 2);

    expectPauseOf(4 * 60_000);
    expect(repoRef.state().error).toContain('Try 4 of 5');
    expect(repoRef.state().attempt_count).toBe(3);
  });

  it('counts the pause from when the slice failed, not when the tick began', async () => {
    let clock = 1_000_000;
    const now = jest.spyOn(Date, 'now').mockImplementation(() => clock);
    try {
      // The slice ran 40 s before it failed.
      await failingWith(schemaCacheMiss, 0, () => {
        clock += 40_000;
      });
    } finally {
      now.mockRestore();
    }

    expect(releasedPause()?.getTime()).toBe(NOW.getTime() + 40_000 + 60_000);
  });

  it('stops after the last try and says why', async () => {
    const { result } = await failingWith(
      schemaCacheMiss,
      MAX_IMPORT_ATTEMPTS - 1,
    );

    expect(result).toMatchObject({ finished: true });
    expect(repoRef.state().status).toBe('failed');
    expect(repoRef.state().error).toBe(
      `Stopped after ${MAX_IMPORT_ATTEMPTS} tries that each hit a temporary error. The last one: PGRST202: Could not find the function in the schema cache`,
    );
    expect(releasedPause()).toBeUndefined();
    expect(reportedSites()).toEqual(['discord-import-job-failed']);
  });

  it('reads a count left from before the streak was kept as no streak', async () => {
    // The claim used to bump `attempt_count` on every slice.
    await failingWith(schemaCacheMiss, 37);

    expect(repoRef.state().status).toBe('running');
    expect(repoRef.state().error).toContain('Try 2 of 5');
    expect(repoRef.state().attempt_count).toBe(1);
  });

  it('fails at once on an error that will not clear', async () => {
    await failingWith(new Error('storage exploded'), 0);

    expect(repoRef.state().status).toBe('failed');
    expect(repoRef.state().error).toBe('storage exploded');
    expect(releasedPause()).toBeUndefined();
  });

  it('fails at once on a refusal the admin must act on', async () => {
    // Discord refusing the bot is the admin's to fix; trying again cannot.
    await failingWith(new DiscordApiError('Missing Access', 403), 0);

    expect(repoRef.state().status).toBe('failed');
    expect(reportedSites()).toEqual([]);
  });

  it('ends the streak on the next clean slice', async () => {
    repoRef = makeRepo(
      job({
        status: 'running',
        attempt_count: 2,
        error: 'The import hit a temporary problem and paused.',
      }),
    );
    const { worker } = await buildWorker(repoRef, makeStorage(part000()));

    await worker.sweepImports(NOW);

    expect(repoRef.releaseLease).toHaveBeenCalledWith(IMPORT_ID, 'token-1', {
      endRetryStreak: true,
      pauseUntil: undefined,
    });
  });

  it('writes nothing extra after a clean slice with no streak', async () => {
    repoRef = makeRepo(job({ status: 'running', attempt_count: 0 }));
    const { worker } = await buildWorker(repoRef, makeStorage(part000()));

    await worker.sweepImports(NOW);

    expect(repoRef.releaseLease).toHaveBeenCalledWith(IMPORT_ID, 'token-1', {
      endRetryStreak: false,
      pauseUntil: undefined,
    });
  });
});

describe('isTransientImportFailure (#1692)', () => {
  it.each([
    ['a schema cache still loading', { code: 'PGRST202' }],
    ['no database connection', { code: 'PGRST000' }],
    ['a deadlock', { code: '40P01' }],
    ['a connection exception class', { code: '08006' }],
    [
      'a request that never reached PostgREST',
      Object.assign(new Error('TypeError: fetch failed'), {
        name: 'SupabaseQueryError',
      }),
    ],
    [
      'a PostgREST request that timed out',
      Object.assign(
        new Error(
          'AbortError: This operation was aborted: Request was aborted (timeout or manual cancellation)',
        ),
        { name: 'SupabaseQueryError' },
      ),
    ],
    [
      'Storage unreachable',
      Object.assign(new Error('fetch failed'), {
        name: 'StorageUnknownError',
        originalError: new TypeError('fetch failed'),
      }),
    ],
    [
      'the copy service having a bad moment',
      new ArchiveMediaCopyError('the copy service answered 503', {
        retryable: true,
      }),
    ],
    ['undici giving up', new TypeError('fetch failed')],
    ['a reset socket', Object.assign(new Error('x'), { code: 'ECONNRESET' })],
    [
      'a reset socket under a wrapper',
      new Error('wrapped', {
        cause: Object.assign(new Error('x'), { code: 'ECONNRESET' }),
      }),
    ],
    ['a Discord 502', { name: 'HTTPError', status: 502 }],
    ['a rate limit', { status: 429 }],
    ['Storage answering 503 as a string', { statusCode: '503' }],
    ['a timeout', Object.assign(new Error('x'), { name: 'AbortError' })],
  ])('retries %s', (_what, error) => {
    expect(isTransientImportFailure(error)).toBe(true);
  });

  it.each([
    ['a unique violation', { code: '23505' }],
    ['a PostgREST no-row', { code: 'PGRST116' }],
    ['a plain error', new Error('storage exploded')],
    ['a Discord refusal', new DiscordApiError('Missing Access', 403)],
    ['a Discord integrity refusal', new DiscordApiError('Refusing to import')],
    ['a Storage 400', { statusCode: '400' }],
    [
      'a codeless PostgREST error that is not a dropped request',
      Object.assign(new Error('<html>Bad Request</html>'), {
        name: 'SupabaseQueryError',
      }),
    ],
    [
      'a request whose own headers were too big',
      Object.assign(
        new Error(
          'TypeError: fetch failed: HTTP headers exceeded server limits (typically 16KB)',
        ),
        { name: 'SupabaseQueryError' },
      ),
    ],
    [
      'Storage failing for a reason that will not clear',
      Object.assign(new Error('Unexpected token'), {
        name: 'StorageUnknownError',
        originalError: new SyntaxError('Unexpected token'),
      }),
    ],
    [
      'the copy service refusing the request',
      new ArchiveMediaCopyError('the copy service answered 401'),
    ],
    ['nothing', undefined],
    ['a string', 'PGRST202'],
  ])('does not retry %s', (_what, error) => {
    expect(isTransientImportFailure(error)).toBe(false);
  });

  it('tries again only while the streak has tries left', () => {
    const blip = { code: 'PGRST000' };
    expect(willRetryImport(blip, 0)).toBe(true);
    expect(willRetryImport(blip, MAX_IMPORT_ATTEMPTS - 2)).toBe(true);
    expect(willRetryImport(blip, MAX_IMPORT_ATTEMPTS - 1)).toBe(false);
    // A pre-#1692 claim count is no streak at all.
    expect(willRetryImport(blip, 40)).toBe(true);
    expect(willRetryImport(new Error('nope'), 0)).toBe(false);
  });

  it('pauses 1, 2, 4, then 8 minutes, and never more than 15', () => {
    expect([1, 2, 3, 4, 5, 9].map(importRetryDelayMs)).toEqual(
      [1, 2, 4, 8, 15, 15].map((m) => m * 60_000),
    );
  });
});
