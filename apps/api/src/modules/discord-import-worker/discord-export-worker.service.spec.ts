import { Test } from '@nestjs/testing';
import {
  COPY_BATCH_MAX_ITEMS,
  DiscordExportWorkerService,
  EXPORT_PAGE_SIZE,
} from './discord-export-worker.service';
import {
  MAX_ARCHIVE_CHAPTER_BYTES,
  MAX_ARCHIVE_IMPORT_BYTES,
} from '@repo/validation';
import {
  ArchiveQuotaExceededError,
  DISCORD_IMPORT_REPOSITORY,
} from '#domain/repositories/discord-import.repository.interface';
import { DISCORD_CONNECTION_REPOSITORY } from '#domain/repositories/discord-connection.repository.interface';
import { DISCORD_BOT_GATEWAY } from '#domain/adapters/discord.interface';
import {
  ARCHIVE_MEDIA_COPIER,
  ArchiveMediaCopyError,
  type ArchiveMediaCopyItem,
  type ArchiveMediaCopyResult,
} from '#domain/adapters/archive-media-copier.interface';
import { MISSING_MESSAGE_CONTENT_INTENT_ERROR } from '#domain/utils/discord-api-message';
import type {
  DiscordImport,
  DiscordImportChannel,
  DiscordImportFile,
} from '#domain/entities/discord-import.entity';
import { snowflakeAtOrAfter } from '#domain/utils/discord-snowflake';

const NOW = new Date('2026-08-24T12:00:00Z');
const CHAPTER = 'chapter-1';
const OTHER_CHAPTER = 'chapter-2';
const IMPORT_ID = 'import-1';
const GUILD = '800000000000000001';
const OTHER_GUILD = '800000000000000099';
const DISCORD_CHANNEL = '900000000000000001';
const THREAD = '900000000000000002';
const SIGNET_CHANNEL = 'signet-channel-1';

beforeAll(() => {
  // Same reasoning as the sibling worker spec: the slice budget is measured
  // against the real `Date.now()`, so a fixed `NOW` without a faked clock makes
  // this suite pass only within 45 seconds of that timestamp.
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
    status: 'running',
    source: 'bot',
    guild_id: GUILD,
    guild_name: 'Tau Nu',
    consent_acknowledged_at: NOW.toISOString(),
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
    lock_token: 'lock-1',
    locked_by: 'worker-1',
    lease_expires_at: null,
    attempt_count: 1,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    completed_at: null,
    purged_at: null,
    cleared_at: null,
    ...overrides,
  };
}

function channel(
  overrides: Partial<DiscordImportChannel> = {},
): DiscordImportChannel {
  return {
    id: 'mapping-1',
    import_id: IMPORT_ID,
    discord_channel_id: DISCORD_CHANNEL,
    discord_channel_name: 'general',
    discord_category: null,
    mapping_action: 'use_existing',
    target_channel_id: SIGNET_CHANNEL,
    new_channel_name: null,
    new_channel_is_read_only: true,
    message_count: 0,
    imported_count: 0,
    status: 'pending',
    error: null,
    cursor_before_snowflake: null,
    parent_discord_channel_id: null,
    position: 0,
    ...overrides,
  };
}

function apiMessage(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    channel_id: DISCORD_CHANNEL,
    type: 0,
    content: `message ${id}`,
    timestamp: '2019-03-04T18:22:11.000+00:00',
    author: { id: '2', username: 'paul', global_name: 'Paul' },
    attachments: [],
    embeds: [],
    ...extra,
  };
}

interface Harness {
  worker: DiscordExportWorkerService;
  repo: Record<string, jest.Mock>;
  connectionRepo: Record<string, jest.Mock>;
  bot: Record<string, jest.Mock>;
  copier: {
    copy: jest.Mock<
      Promise<ArchiveMediaCopyResult[]>,
      [ArchiveMediaCopyItem[]]
    >;
  };
  channels: DiscordImportChannel[];
  files: DiscordImportFile[];
}

async function build(
  options: {
    channels?: DiscordImportChannel[];
    guildId?: string | null;
    pages?: unknown[][];
  } = {},
): Promise<Harness> {
  const channels = options.channels ?? [channel()];
  const files: DiscordImportFile[] = [];
  const pages = options.pages ?? [[apiMessage('1'), apiMessage('2')]];
  let pageIndex = 0;

  const repo = {
    findChannels: jest.fn(async () => channels),
    findFiles: jest.fn(async () => files),
    updateChannel: jest.fn(
      async (id: string, _importId: string, patch: Record<string, unknown>) => {
        const target = channels.find((entry) => entry.id === id);
        if (target) Object.assign(target, patch);
      },
    ),
    registerFiles: jest.fn(
      async (
        _chapterId: string,
        _importId: string,
        rows: Record<string, unknown>[],
      ) => {
        const created = rows.map((row, index) => ({
          id: `file-${files.length + index}`,
          created_at: NOW.toISOString(),
          uploaded_at: null,
          ...row,
        })) as DiscordImportFile[];
        files.push(...created);
        return created;
      },
    ),
    // Writes through to `files`, so a later slice's `findFiles` sees what an
    // earlier one marked, as the real table would.
    markFilesUploaded: jest.fn(
      async (
        _importId: string,
        _chapterId: string,
        paths: string[],
        uploadedAt: string,
      ) => {
        for (const file of files) {
          if (paths.includes(file.storage_path)) file.uploaded_at = uploadedAt;
        }
        return paths.length;
      },
    ),
  };

  const connectionRepo = {
    findByChapter: jest.fn(async (chapterId: string) =>
      options.guildId === null
        ? null
        : { chapter_id: chapterId, guild_id: options.guildId ?? GUILD },
    ),
  };

  const bot = {
    verifyChannelInGuild: jest.fn(async (channelId: string) => ({
      id: channelId,
      name: 'general',
      guildId: GUILD,
      categoryName: null,
      parentChannelId: null,
      isThread: false,
    })),
    fetchMessagePage: jest.fn(async () => {
      const page = pages[pageIndex] ?? [];
      pageIndex += 1;
      return page;
    }),
  };

  // Stores everything it is given, unless a test says otherwise.
  const copier = {
    copy: jest.fn(async (items: ArchiveMediaCopyItem[]) =>
      items.map((item): ArchiveMediaCopyResult => ({
        path: item.path,
        status: 'stored',
        bytes: 3,
      })),
    ),
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      DiscordExportWorkerService,
      { provide: DISCORD_IMPORT_REPOSITORY, useValue: repo },
      { provide: DISCORD_CONNECTION_REPOSITORY, useValue: connectionRepo },
      { provide: DISCORD_BOT_GATEWAY, useValue: bot },
      { provide: ARCHIVE_MEDIA_COPIER, useValue: copier },
    ],
  }).compile();

  return {
    worker: moduleRef.get(DiscordExportWorkerService),
    repo,
    connectionRepo,
    bot,
    copier,
    channels,
    files,
  };
}

function runArgs(
  harness: Harness,
  overrides: Partial<
    Parameters<DiscordExportWorkerService['runSlice']>[0]
  > = {},
) {
  return {
    job: job(),
    deadline: Date.now() + 45_000,
    checkpoint: jest.fn(async () => true),
    resolveTargetChannel: jest.fn(async () => SIGNET_CHANNEL),
    importBatch: jest.fn(async (batch: { messages: unknown[] }) => ({
      imported: batch.messages.length,
      skipped: 0,
      attachmentsImported: 0,
      attachmentsSkipped: 0,
      warnings: [] as string[],
    })),
    ...overrides,
  };
}

describe('DiscordExportWorkerService — the tenant boundary', () => {
  it('reads the guild from the CHAPTER’s connection, never from the job row', async () => {
    const harness = await build();
    await harness.worker.runSlice(runArgs(harness));

    expect(harness.connectionRepo.findByChapter).toHaveBeenCalledWith(CHAPTER);
    // Everything downstream was asked for that guild, not the job's copy.
    expect(harness.bot.verifyChannelInGuild).toHaveBeenCalledWith(
      DISCORD_CHANNEL,
      GUILD,
    );
    expect(harness.bot.fetchMessagePage).toHaveBeenCalledWith(
      expect.objectContaining({ guildId: GUILD }),
    );
  });

  it('REFUSES a job whose guild no longer matches the chapter’s connection', async () => {
    // The tampering case, and the reconnect case. Both must stop rather than
    // import a different server's history under the old job's consent.
    const harness = await build({ guildId: OTHER_GUILD });

    await expect(
      harness.worker.runSlice(
        runArgs(harness, { job: job({ guild_id: GUILD }) }),
      ),
    ).rejects.toThrow(/was created for Discord server/);

    expect(harness.bot.fetchMessagePage).not.toHaveBeenCalled();
  });

  it('REFUSES when the chapter has disconnected Discord entirely', async () => {
    const harness = await build({ guildId: null });

    await expect(harness.worker.runSlice(runArgs(harness))).rejects.toThrow(
      /no longer has a Discord server connected/,
    );
    expect(harness.bot.fetchMessagePage).not.toHaveBeenCalled();
  });

  it('re-verifies every channel against Discord before reading a message', async () => {
    // The row says which channel; Discord says which guild it is in. A stored
    // row is not evidence — one token reads every connected chapter.
    const harness = await build();
    await harness.worker.runSlice(runArgs(harness));

    const verifyOrder =
      harness.bot.verifyChannelInGuild.mock.invocationCallOrder[0];
    const fetchOrder = harness.bot.fetchMessagePage.mock.invocationCallOrder[0];
    expect(verifyOrder).toBeLessThan(fetchOrder);
  });

  it('propagates a wrong-guild channel as a failure, never as a skip', async () => {
    const harness = await build();
    harness.bot.verifyChannelInGuild.mockRejectedValue(
      new Error('Channel belongs to Discord server 999, not to 800.'),
    );

    await expect(harness.worker.runSlice(runArgs(harness))).rejects.toThrow(
      /belongs to Discord server/,
    );
  });

  it('scopes every repository read by the job’s chapter', async () => {
    const harness = await build();
    await harness.worker.runSlice(
      runArgs(harness, { job: job({ chapter_id: OTHER_CHAPTER }) }),
    );

    expect(harness.repo.findChannels).toHaveBeenCalledWith(
      IMPORT_ID,
      OTHER_CHAPTER,
    );
    expect(harness.repo.findFiles).toHaveBeenCalledWith(
      IMPORT_ID,
      OTHER_CHAPTER,
    );
  });

  it('skips a channel that is simply gone, which is an ordinary outcome', async () => {
    const harness = await build();
    harness.bot.verifyChannelInGuild.mockResolvedValue(null);

    const result = await harness.worker.runSlice(runArgs(harness));

    expect(result.finished).toBe(true);
    expect(harness.repo.updateChannel).toHaveBeenCalledWith(
      'mapping-1',
      IMPORT_ID,
      expect.objectContaining({ status: 'skipped' }),
    );
    expect(harness.bot.fetchMessagePage).not.toHaveBeenCalled();
  });
});

describe('DiscordExportWorkerService — walking a channel', () => {
  it('pages backwards on the OLDEST id, and stops on a short page', async () => {
    const harness = await build({
      pages: [
        Array.from({ length: EXPORT_PAGE_SIZE }, (_, i) =>
          apiMessage(String(1000 - i)),
        ),
        [apiMessage('900')],
      ],
    });

    const result = await harness.worker.runSlice(runArgs(harness));

    // First call starts at the newest message.
    expect(harness.bot.fetchMessagePage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ before: null }),
    );
    // Second call resumes before the oldest id on the first page. Discord
    // returns newest-first, so that is the LAST entry.
    expect(harness.bot.fetchMessagePage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        before: String(1000 - (EXPORT_PAGE_SIZE - 1)),
      }),
    );
    // A short page is the only end-of-channel signal Discord gives.
    expect(harness.bot.fetchMessagePage).toHaveBeenCalledTimes(2);
    expect(result.finished).toBe(true);
  });

  it('persists the cursor so a restart resumes rather than re-reads', async () => {
    const harness = await build();
    await harness.worker.runSlice(runArgs(harness));

    expect(harness.repo.updateChannel).toHaveBeenCalledWith(
      'mapping-1',
      IMPORT_ID,
      expect.objectContaining({ cursor_before_snowflake: '2' }),
    );
  });

  it('starts from the persisted cursor when one exists', async () => {
    const harness = await build({
      channels: [channel({ cursor_before_snowflake: '555' })],
    });
    await harness.worker.runSlice(runArgs(harness));

    expect(harness.bot.fetchMessagePage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ before: '555' }),
    );
  });

  it('takes the cursor from the RAW page, not from what the mapper kept', async () => {
    // A message the mapper drops (no timestamp) would otherwise be the page's
    // tail forever, and the walk would never advance past it.
    const harness = await build({
      pages: [[apiMessage('10'), { id: '9', channel_id: DISCORD_CHANNEL }]],
    });
    await harness.worker.runSlice(runArgs(harness));

    expect(harness.repo.updateChannel).toHaveBeenCalledWith(
      'mapping-1',
      IMPORT_ID,
      expect.objectContaining({ cursor_before_snowflake: '9' }),
    );
  });

  it('yields without finishing when the checkpoint says to stop', async () => {
    // A cancel mid-slice, or a lost lease. Either way: stop, do not finish.
    const harness = await build({
      pages: [
        Array.from({ length: EXPORT_PAGE_SIZE }, (_, i) =>
          apiMessage(String(i)),
        ),
        [apiMessage('x')],
      ],
    });

    const result = await harness.worker.runSlice(
      runArgs(harness, { checkpoint: jest.fn(async () => false) }),
    );

    expect(result.finished).toBe(false);
    expect(harness.bot.fetchMessagePage).toHaveBeenCalledTimes(1);
  });

  it('yields when the slice budget is already spent', async () => {
    const harness = await build();
    const result = await harness.worker.runSlice(
      runArgs(harness, { deadline: Date.now() - 1 }),
    );

    expect(result.finished).toBe(false);
    expect(harness.bot.fetchMessagePage).not.toHaveBeenCalled();
  });

  it('leaves an already-finished channel alone on a resumed slice', async () => {
    const harness = await build({
      channels: [channel({ status: 'completed' })],
    });
    const result = await harness.worker.runSlice(runArgs(harness));

    expect(harness.bot.fetchMessagePage).not.toHaveBeenCalled();
    expect(result.finished).toBe(true);
  });

  it('marks a skip-mapped channel skipped without reading it', async () => {
    const harness = await build({
      channels: [channel({ mapping_action: 'skip', status: 'pending' })],
    });
    await harness.worker.runSlice(runArgs(harness));

    expect(harness.bot.verifyChannelInGuild).not.toHaveBeenCalled();
    expect(harness.repo.updateChannel).toHaveBeenCalledWith(
      'mapping-1',
      IMPORT_ID,
      expect.objectContaining({ status: 'skipped' }),
    );
  });

  it('hands each page to the shared batch writer, not to a second importer', async () => {
    const harness = await build();
    const args = runArgs(harness);
    await harness.worker.runSlice(args);

    expect(args.importBatch).toHaveBeenCalledWith(
      expect.objectContaining({ targetChannelId: SIGNET_CHANNEL }),
    );
    // Already in the phase-2 intermediate shape, so `toImportedMessage` needs
    // no knowledge that a bot fetched it.
    const batch = args.importBatch.mock.calls[0][0] as {
      messages: { id?: string | null; timestamp?: string | null }[];
    };
    expect(batch.messages[0].timestamp).toBe('2019-03-04T18:22:11.000+00:00');
  });
});

describe('DiscordExportWorkerService — the date cutoff (#2858)', () => {
  const CUTOFF = '2024-06-01T00:00:00.000Z';
  const at = snowflakeAtOrAfter(Date.parse(CUTOFF));
  /** A message `offset` ids from the cutoff: newer when positive. */
  const around = (offset: number, extra: Record<string, unknown> = {}) =>
    apiMessage(String(at + BigInt(offset)), extra);

  it('imports what came after the cutoff and ends the channel there, even on a full page', async () => {
    // Newest first, as Discord answers: 60 newer, then older ones.
    const fullPage = Array.from({ length: EXPORT_PAGE_SIZE }, (_, i) =>
      around(60 - i),
    );
    const harness = await build({ pages: [fullPage, [around(-500)]] });
    const args = runArgs(harness, {
      job: job({ messages_after: CUTOFF }),
    });

    const result = await harness.worker.runSlice(args);

    // Offsets 60..1 are newer, 0 is AT the cutoff and kept too.
    expect(args.importBatch).toHaveBeenCalledTimes(1);
    expect(args.importBatch.mock.calls[0][0].messages).toHaveLength(61);
    // A full page would normally ask for the next; the cutoff ends it.
    expect(harness.bot.fetchMessagePage).toHaveBeenCalledTimes(1);
    expect(harness.repo.updateChannel).toHaveBeenCalledWith(
      'mapping-1',
      IMPORT_ID,
      expect.objectContaining({ status: 'completed', imported_count: 61 }),
    );
    expect(result.finished).toBe(true);
  });

  it('counts only the messages it imports into the total', async () => {
    const harness = await build({
      pages: [[around(2), around(1), around(-1), around(-2)]],
    });
    const result = await harness.worker.runSlice(
      runArgs(harness, { job: job({ messages_after: CUTOFF }) }),
    );
    expect(result.totals.totalMessages).toBe(2);
  });

  it('never copies an older message’s attachments', async () => {
    const photo = (id: string) => ({
      attachments: [
        {
          id: `att-${id}`,
          filename: 'photo.png',
          size: 2048,
          url: `https://cdn.discordapp.com/attachments/1/att-${id}/photo.png`,
          content_type: 'image/png',
        },
      ],
    });
    const harness = await build({
      pages: [[around(1, photo('new')), around(-1, photo('old'))]],
    });
    await harness.worker.runSlice(
      runArgs(harness, { job: job({ messages_after: CUTOFF }) }),
    );

    const urls = harness.copier.copy.mock.calls.flatMap(([items]) =>
      items.map((item) => item.url),
    );
    expect(urls.some((url) => url.includes('att-new'))).toBe(true);
    expect(urls.some((url) => url.includes('att-old'))).toBe(false);
  });

  it('finishes a channel whose newest message is older, reading one page and writing nothing', async () => {
    const harness = await build({ pages: [[around(-1), around(-2)]] });
    const args = runArgs(harness, { job: job({ messages_after: CUTOFF }) });

    const result = await harness.worker.runSlice(args);

    expect(args.importBatch).not.toHaveBeenCalled();
    expect(harness.copier.copy).not.toHaveBeenCalled();
    expect(harness.bot.fetchMessagePage).toHaveBeenCalledTimes(1);
    expect(result.finished).toBe(true);
  });

  it('reads all history without one', async () => {
    const harness = await build({ pages: [[around(-1), around(-2)]] });
    const args = runArgs(harness, { job: job({ messages_after: null }) });
    await harness.worker.runSlice(args);
    expect(args.importBatch.mock.calls[0][0].messages).toHaveLength(2);
  });
});

describe('DiscordExportWorkerService — threads inherit their parent', () => {
  it('sends a thread into its parent’s channel, never creating a second one', async () => {
    // `chat_channels` has no unique (chapter_id, name), so a thread resolved
    // independently under `create_new` would silently mint a duplicate.
    const parent = channel({
      id: 'mapping-parent',
      mapping_action: 'create_new',
      target_channel_id: null,
      new_channel_name: 'General',
      position: 0,
    });
    const thread = channel({
      id: 'mapping-thread',
      discord_channel_id: THREAD,
      discord_channel_name: 'general › planning',
      mapping_action: 'create_new',
      target_channel_id: null,
      new_channel_name: 'General',
      parent_discord_channel_id: DISCORD_CHANNEL,
      position: 1,
    });

    const harness = await build({
      channels: [parent, thread],
      pages: [[], []],
    });
    const resolveTargetChannel = jest.fn(async () => SIGNET_CHANNEL);

    await harness.worker.runSlice(runArgs(harness, { resolveTargetChannel }));

    // Always resolved for the PARENT, never for the thread — the thread has no
    // destination of its own. `create_new` mints a channel, so resolving a
    // thread independently would produce a second channel with the same name,
    // which `chat_channels` has no unique `(chapter_id, name)` to reject.
    // Every call carries the import's rows as its second argument, which
    // like-named channels share a destination through (#2856). Matched with
    // `expect.anything()` so the negative check cannot pass on arity alone.
    expect(resolveTargetChannel).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'mapping-parent' }),
      expect.anything(),
    );
    expect(resolveTargetChannel).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: 'mapping-thread' }),
      expect.anything(),
    );
    expect(
      resolveTargetChannel.mock.calls.every(
        (call: unknown[]) => call.length === 2,
      ),
    ).toBe(true);
  });

  it('re-verifies an inherited target through the chapter, never trusting the row', async () => {
    // `target_channel_id` is a client-supplied UUID that reached the database
    // at mapping time, and `chat_messages` has no `chapter_id` — its FK accepts
    // ANY channel in the product. Returning this column straight to
    // `importBatch` was the one path in a bot import where a foreign channel id
    // could reach an insert unchecked, and the purge (scoped by the import's
    // own chapter) could never remove what landed there.
    //
    // Reachable exactly as set up here: a parent whose Discord channel is gone
    // is marked skipped and returns BEFORE resolving its own target, so a
    // poisoned id was never verified — and its threads then inherited it.
    const parent = channel({
      id: 'mapping-parent',
      status: 'completed',
      target_channel_id: 'FOREIGN-CHANNEL-FROM-ANOTHER-CHAPTER',
      position: 0,
    });
    const thread = channel({
      id: 'mapping-thread',
      discord_channel_id: THREAD,
      parent_discord_channel_id: DISCORD_CHANNEL,
      target_channel_id: null,
      position: 1,
    });

    const harness = await build({ channels: [parent, thread], pages: [[]] });
    // Stands in for the real resolver, which re-reads the channel through the
    // chapter and throws on one that is not this chapter's.
    const resolveTargetChannel = jest.fn(async () => {
      throw new Error('points at a channel outside this chapter');
    });

    await expect(
      harness.worker.runSlice(runArgs(harness, { resolveTargetChannel })),
    ).rejects.toThrow(/outside this chapter/);

    expect(resolveTargetChannel).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'mapping-parent' }),
      expect.anything(),
    );
  });
});

describe('DiscordExportWorkerService — attachments', () => {
  const withAttachment = (id: string) =>
    apiMessage(id, {
      attachments: [
        {
          id: `att-${id}`,
          filename: 'photo.png',
          size: 2048,
          url: `https://cdn.discordapp.com/attachments/1/att-${id}/photo.png?ex=aaa`,
          content_type: 'image/png',
        },
      ],
    });

  /** One message carrying `count` small attachments. */
  const withAttachments = (count: number, size = 10) =>
    apiMessage('1', {
      attachments: Array.from({ length: count }, (_, i) => ({
        id: `att-${i}`,
        filename: `p${i}.png`,
        size,
        url: `https://cdn.discordapp.com/a/p${i}.png`,
        content_type: 'image/png',
      })),
    });

  /** Answer each item with the status `pick` chooses for its index. */
  const answer =
    (pick: (index: number) => ArchiveMediaCopyResult['status']) =>
    async (items: ArchiveMediaCopyItem[]) =>
      items.map((item, index): ArchiveMediaCopyResult => ({
        path: item.path,
        status: pick(index),
        reason: pick(index) === 'stored' ? undefined : 'CDN answered 503.',
      }));

  it('hands the copier the CDN url, never the bytes', async () => {
    // #2848: the API sending the file to Storage is what Render bills.
    const harness = await build({ pages: [[withAttachment('1')]] });
    await harness.worker.runSlice(runArgs(harness));

    expect(harness.copier.copy).toHaveBeenCalledTimes(1);
    const [items] = harness.copier.copy.mock.calls[0];
    expect(items).toEqual([
      {
        url: 'https://cdn.discordapp.com/attachments/1/att-1/photo.png?ex=aaa',
        bucket: 'chat-archive',
        // Shared layout, so the per-import purge's prefix sweep finds it.
        path: expect.stringContaining(
          `chapters/${CHAPTER}/chat-archive/imports/${IMPORT_ID}/media/`,
        ),
        contentType: 'image/png',
        declaredSize: 2048,
      },
    ]);
    // The gateway no longer opens attachments at all.
    expect(harness.bot).not.toHaveProperty('openAttachment');
  });

  it('registers the manifest row BEFORE the copy and marks it after', async () => {
    const harness = await build({ pages: [[withAttachment('1')]] });
    await harness.worker.runSlice(runArgs(harness));

    const created = harness.repo.registerFiles.mock.invocationCallOrder[0];
    const copied = harness.copier.copy.mock.invocationCallOrder[0];
    const marked = harness.repo.markFilesUploaded.mock.invocationCallOrder[0];
    // A row with a null `uploaded_at` is exactly "a transfer that did not
    // finish", which is what makes an interrupted slice resume correctly.
    expect(created).toBeLessThan(copied);
    expect(copied).toBeLessThan(marked);
  });

  it('keys the manifest on the attachment id, not the rotating CDN url', async () => {
    const harness = await build({ pages: [[withAttachment('1')]] });
    await harness.worker.runSlice(runArgs(harness));

    expect(harness.repo.registerFiles).toHaveBeenCalledWith(
      CHAPTER,
      expect.any(String),
      [
        expect.objectContaining({
          relative_path: 'att-1/photo.png',
          chapter_id: CHAPTER,
          kind: 'media',
        }),
      ],
      // The bot path carries the same ceilings as the upload path (#1243).
      {
        importBytes: MAX_ARCHIVE_IMPORT_BYTES,
        chapterBytes: MAX_ARCHIVE_CHAPTER_BYTES,
      },
    );
  });

  it('does not re-send an attachment an earlier slice already stored', async () => {
    const harness = await build({ pages: [[withAttachment('1')]] });
    harness.files.push({
      id: 'file-existing',
      import_id: IMPORT_ID,
      chapter_id: CHAPTER,
      kind: 'media',
      part_index: null,
      relative_path: 'att-1/photo.png',
      bucket: 'chat-archive',
      storage_path: 'chapters/x/media/att-1',
      content_type: 'image/png',
      byte_size: 2048,
      uploaded_at: NOW.toISOString(),
      created_at: NOW.toISOString(),
    });

    await harness.worker.runSlice(runArgs(harness));

    expect(harness.copier.copy).not.toHaveBeenCalled();
  });

  it('deduplicates the same attachment repeated within one page', async () => {
    const duplicated = apiMessage('1', {
      attachments: [
        {
          id: 'att-same',
          filename: 'x.png',
          size: 10,
          url: 'https://cdn.discordapp.com/a/x.png',
          content_type: 'image/png',
        },
        {
          id: 'att-same',
          filename: 'x.png',
          size: 10,
          url: 'https://cdn.discordapp.com/a/x.png',
          content_type: 'image/png',
        },
      ],
    });
    const harness = await build({ pages: [[duplicated]] });
    await harness.worker.runSlice(runArgs(harness));

    expect(harness.copier.copy).toHaveBeenCalledTimes(1);
    expect(harness.copier.copy.mock.calls[0][0]).toHaveLength(1);
  });

  it('warns and keeps the message when the attachment is gone from the CDN', async () => {
    const harness = await build({ pages: [[withAttachment('1')]] });
    harness.copier.copy.mockImplementation(answer(() => 'gone'));

    const args = runArgs(harness);
    const result = await harness.worker.runSlice(args);

    expect(result.finished).toBe(true);
    const warnings = args.checkpoint.mock.calls.at(-1)?.[0].warnings ?? [];
    expect(warnings.join(' ')).toContain('no longer available from Discord');
    expect(harness.repo.markFilesUploaded).not.toHaveBeenCalled();
    // The message itself still imported — it still has its text.
    expect(args.importBatch).toHaveBeenCalled();
  });

  it('marks uploaded only what the copier reports stored', async () => {
    const harness = await build({ pages: [[withAttachments(3)]] });
    harness.copier.copy.mockImplementation(
      answer((index) => (index === 1 ? 'failed' : 'stored')),
    );

    const args = runArgs(harness, {
      importBatch: jest.fn(
        async (batch: {
          messages: unknown[];
          mediaByRelativePath: Map<string, DiscordImportFile>;
        }) => ({
          imported: batch.messages.length,
          skipped: 0,
          attachmentsImported: batch.mediaByRelativePath.size,
          attachmentsSkipped: 0,
          // What the real batch writer says about a file with no stored object.
          warnings: ['No uploaded file for attachment: att-1/p1.png'],
        }),
      ),
    });
    await harness.worker.runSlice(args);

    const [, , marked] = harness.repo.markFilesUploaded.mock.calls[0];
    expect(marked).toHaveLength(2);
    expect(marked).not.toContain(
      harness.files.find((file) => file.relative_path === 'att-1/p1.png')
        ?.storage_path,
    );
    // The resolver the batch writer reads holds only the stored two.
    const [batch] = args.importBatch.mock.calls[0];
    expect([...batch.mediaByRelativePath.keys()].sort()).toEqual([
      'att-0/p0.png',
      'att-2/p2.png',
    ]);
    const warnings: string[] =
      args.checkpoint.mock.calls.at(-1)?.[0].warnings ?? [];
    expect(warnings).toContain(
      'Could not import attachment "p1.png": CDN answered 503.',
    );
    // Explained by name and reason already, so the generic line is dropped.
    expect(warnings.join(' ')).not.toContain('No uploaded file');
  });

  it('sends a large page in batches', async () => {
    const harness = await build({
      pages: [[withAttachments(COPY_BATCH_MAX_ITEMS * 2 + 5)]],
    });
    await harness.worker.runSlice(runArgs(harness));

    expect(
      harness.copier.copy.mock.calls.map(([items]) => items.length),
    ).toEqual([COPY_BATCH_MAX_ITEMS, COPY_BATCH_MAX_ITEMS, 5]);
    // Marked after each call, so a later call that throws costs only its own.
    expect(harness.repo.markFilesUploaded).toHaveBeenCalledTimes(3);
  });

  it('caps a batch by declared bytes, but always sends at least one file', async () => {
    // 90 MiB each: two fit under the 256 MiB hint, a third does not.
    const harness = await build({
      pages: [[withAttachments(5, 90 * 1024 * 1024)]],
    });
    await harness.worker.runSlice(runArgs(harness));

    expect(
      harness.copier.copy.mock.calls.map(([items]) => items.length),
    ).toEqual([2, 2, 1]);
  });

  it('sends deferred files again until each one resolves', async () => {
    const harness = await build({ pages: [[withAttachments(3)]] });
    harness.copier.copy
      .mockImplementationOnce(
        answer((index) => (index === 0 ? 'stored' : 'deferred')),
      )
      .mockImplementationOnce(answer(() => 'stored'));

    const args = runArgs(harness);
    await harness.worker.runSlice(args);

    const sent = harness.copier.copy.mock.calls.map(([items]) =>
      items.map((item) => item.path),
    );
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0].slice(1));
    const [batch] = args.importBatch.mock.calls[0];
    expect(batch.mediaByRelativePath.size).toBe(3);
  });

  it('finishes a page past the slice deadline, renewing the lease before each later call', async () => {
    // Yielding mid-page would lose every outcome but `stored`, so the page's
    // copies finish in the slice that started them; the lease bounds it.
    const harness = await build({ pages: [[withAttachments(3)]] });
    harness.copier.copy
      .mockImplementationOnce(async (items) => {
        // The first call took the slice past its budget.
        jest.setSystemTime(Date.now() + 60_000);
        return answer((index) => (index === 0 ? 'stored' : 'deferred'))(items);
      })
      .mockImplementationOnce(answer(() => 'stored'));

    try {
      const args = runArgs(harness);
      await harness.worker.runSlice(args);

      const calls = harness.copier.copy.mock.invocationCallOrder;
      const renewals = args.checkpoint.mock.invocationCallOrder;
      expect(calls).toHaveLength(2);
      // The first call goes straight after the page fetch; the second only
      // once the lease is renewed, and the page's own checkpoint follows.
      expect(renewals.filter((order) => order < calls[0])).toHaveLength(0);
      expect(
        renewals.filter((order) => order > calls[0] && order < calls[1]),
      ).toHaveLength(1);
      const [batch] = args.importBatch.mock.calls[0];
      expect(batch.mediaByRelativePath.size).toBe(3);
      expect(harness.repo.updateChannel).toHaveBeenCalledWith(
        'mapping-1',
        IMPORT_ID,
        expect.objectContaining({ cursor_before_snowflake: '1' }),
      );
    } finally {
      jest.setSystemTime(NOW);
    }
  });

  it('sends the first batch even when the slice deadline has already passed', async () => {
    // At least one batch per page is what keeps a slow page moving.
    const harness = await build({ pages: [[withAttachments(2)]] });
    const args = runArgs(harness);
    harness.bot.fetchMessagePage.mockImplementationOnce(async () => {
      // Discord was slow: the budget is spent before the copy starts.
      jest.setSystemTime(args.deadline + 1);
      return [withAttachments(2)];
    });

    try {
      await harness.worker.runSlice(args);
      expect(harness.copier.copy).toHaveBeenCalledTimes(1);
      expect(args.importBatch).toHaveBeenCalledTimes(1);
    } finally {
      jest.setSystemTime(NOW);
    }
  });

  it('stops a page mid-copy when the job may no longer advance, and a resume sends only the unfinished files', async () => {
    // The same page twice: the resume must fetch it again, because the first
    // run never advanced the cursor past it.
    const page = [withAttachments(3)];
    const harness = await build({ pages: [page, page] });
    harness.copier.copy.mockImplementationOnce(
      answer((index) => (index === 0 ? 'stored' : 'deferred')),
    );

    const first = runArgs(harness, {
      // The admin cancelled (or the lease was lost) during the first call.
      checkpoint: jest.fn(async () => false),
    });
    const result = await harness.worker.runSlice(first);

    expect(result.finished).toBe(false);
    expect(harness.copier.copy).toHaveBeenCalledTimes(1);
    // Nothing about the page was written: no rows, no cursor.
    expect(first.importBatch).not.toHaveBeenCalled();
    expect(harness.repo.updateChannel).not.toHaveBeenCalledWith(
      'mapping-1',
      IMPORT_ID,
      expect.objectContaining({ cursor_before_snowflake: expect.anything() }),
    );
    expect(result.totals.totalMessages).toBe(0);

    const second = runArgs(harness);
    await harness.worker.runSlice(second);

    // The same page again, from the same cursor.
    expect(harness.bot.fetchMessagePage.mock.calls[1][0]).toEqual(
      expect.objectContaining({ before: null }),
    );
    const sent = harness.copier.copy.mock.calls.map(([items]) =>
      items.map((item) => item.path),
    );
    expect(sent[1]).toEqual(sent[0].slice(1));
    const [batch] = second.importBatch.mock.calls[0];
    expect(batch.mediaByRelativePath.size).toBe(3);
  });

  it('fails the import when a call copied nothing at all', async () => {
    // Every call resolving at least one file is what ends the loop; a copier
    // that breaks it must not spin forever.
    const harness = await build({ pages: [[withAttachments(2)]] });
    harness.copier.copy.mockImplementation(answer(() => 'deferred'));

    await expect(harness.worker.runSlice(runArgs(harness))).rejects.toThrow(
      ArchiveMediaCopyError,
    );
  });

  it('fails the import, rather than skipping the files, when the copier itself fails', async () => {
    const harness = await build({ pages: [[withAttachment('1')]] });
    harness.copier.copy.mockRejectedValue(
      new ArchiveMediaCopyError('the copy service answered 404'),
    );

    const args = runArgs(harness);
    await expect(harness.worker.runSlice(args)).rejects.toThrow(/answered 404/);
    expect(args.importBatch).not.toHaveBeenCalled();
    expect(harness.repo.markFilesUploaded).not.toHaveBeenCalled();
  });

  it('fails the import when the bot path crosses an archive ceiling, and never copies', async () => {
    // The bot path writes to the same bucket as the upload path, so it carries
    // the same ceilings (#1243). Enforced BEFORE the copy, because that is the
    // only point at which refusing still saves the storage — after the copy the
    // bytes are already in the bucket.
    //
    // It fails the job rather than skipping the attachment: a partial archive
    // that reports success would tell the admin their history imported when it
    // did not.
    const harness = await build({ pages: [[withAttachment('1')]] });
    harness.repo.registerFiles.mockRejectedValue(
      new ArchiveQuotaExceededError(
        'chapter',
        MAX_ARCHIVE_CHAPTER_BYTES + 1,
        MAX_ARCHIVE_CHAPTER_BYTES,
      ),
    );

    await expect(harness.worker.runSlice(runArgs(harness))).rejects.toThrow(
      /archive would hold .* past its .* limit/,
    );
    expect(harness.copier.copy).not.toHaveBeenCalled();
  });

  it('skips a file type the archive bucket refuses, and says which', async () => {
    const harness = await build({
      pages: [
        [
          apiMessage('1', {
            attachments: [
              {
                id: 'att-exe',
                filename: 'setup.exe',
                size: 10,
                url: 'https://cdn.discordapp.com/a/setup.exe',
                content_type: 'application/x-msdownload',
              },
            ],
          }),
        ],
      ],
    });

    const args = runArgs(harness);
    await harness.worker.runSlice(args);

    expect(harness.copier.copy).not.toHaveBeenCalled();
    const warnings = args.checkpoint.mock.calls.at(-1)?.[0].warnings ?? [];
    expect(warnings.join(' ')).toContain('setup.exe');
  });

  it('skips an oversized attachment rather than failing the whole import', async () => {
    const harness = await build({
      pages: [
        [
          apiMessage('1', {
            attachments: [
              {
                id: 'att-big',
                filename: 'movie.mp4',
                size: 500 * 1024 * 1024,
                url: 'https://cdn.discordapp.com/a/movie.mp4',
                content_type: 'video/mp4',
              },
            ],
          }),
        ],
      ],
    });

    const args = runArgs(harness);
    const result = await harness.worker.runSlice(args);

    expect(harness.copier.copy).not.toHaveBeenCalled();
    expect(result.finished).toBe(true);
    const warnings = args.checkpoint.mock.calls.at(-1)?.[0].warnings ?? [];
    expect(warnings.join(' ')).toContain('movie.mp4');
  });
});

describe('DiscordExportWorkerService — reporting what happened', () => {
  it('returns warnings raised OUTSIDE the page loop, so they are not lost', async () => {
    // A slice can finish having never entered the page loop — every channel
    // deleted in Discord, say. `checkpoint` is the only writer inside the loop,
    // so a closing write that read only from it would report
    // "Completed, 0 messages" with an empty warning list and no sign anything
    // went wrong.
    const harness = await build();
    harness.bot.verifyChannelInGuild.mockResolvedValue(null);

    const args = runArgs(harness);
    const result = await harness.worker.runSlice(args);

    expect(args.checkpoint).not.toHaveBeenCalled();
    expect(result.finished).toBe(true);
    expect(result.totals.warnings.join(' ')).toContain('no longer readable');
  });

  it('counts a gate-rejected attachment once, not twice', async () => {
    // The size/MIME gate skips a file AND leaves it out of the resolver map, so
    // the batch writer independently reports it unresolved. Adding both counts
    // doubled every skipped attachment and flooded a bounded warning list.
    const harness = await build({
      pages: [
        [
          apiMessage('1', {
            attachments: [
              {
                id: 'att-big',
                filename: 'movie.mp4',
                size: 500 * 1024 * 1024,
                url: 'https://cdn.discordapp.com/a/movie.mp4',
                content_type: 'video/mp4',
              },
            ],
          }),
        ],
      ],
    });

    const args = runArgs(harness, {
      importBatch: jest.fn(async (batch: { messages: unknown[] }) => ({
        imported: batch.messages.length,
        skipped: 0,
        attachmentsImported: 0,
        // What the real batch writer reports for a file with no manifest row.
        attachmentsSkipped: 1,
        warnings: [] as string[],
      })),
    });
    const result = await harness.worker.runSlice(args);

    expect(result.totals.attachmentsSkipped).toBe(1);
  });
});

describe('DiscordExportWorkerService — the missing-intent guard', () => {
  it('fails loudly rather than importing a chapter’s history as blanks', async () => {
    const blanks = Array.from({ length: EXPORT_PAGE_SIZE }, (_, i) => ({
      id: String(i),
      channel_id: DISCORD_CHANNEL,
      type: 0,
      content: '',
      timestamp: '2019-03-04T18:22:11.000+00:00',
      author: { id: '2', username: 'paul' },
      attachments: [],
      embeds: [],
    }));
    const harness = await build({ pages: [blanks] });

    const args = runArgs(harness);
    await expect(harness.worker.runSlice(args)).rejects.toThrow(
      MISSING_MESSAGE_CONTENT_INTENT_ERROR,
    );

    // Checked BEFORE anything is written, so there are no empty rows to undo.
    expect(args.importBatch).not.toHaveBeenCalled();
  });

  it('does not trip on a channel that legitimately has system messages', async () => {
    const joins = Array.from({ length: EXPORT_PAGE_SIZE }, (_, i) => ({
      id: String(i),
      channel_id: DISCORD_CHANNEL,
      type: 7,
      content: '',
      timestamp: '2019-03-04T18:22:11.000+00:00',
      author: { id: '2', username: 'paul' },
      attachments: [],
      embeds: [],
    }));
    const harness = await build({ pages: [joins, []] });

    await expect(
      harness.worker.runSlice(runArgs(harness)),
    ).resolves.toMatchObject({ finished: true });
  });
});
