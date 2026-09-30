import { SupabaseDiscordImportRepository } from './supabase-discord-import.repository';
import { ArchiveQuotaExceededError } from '#domain/repositories/discord-import.repository.interface';
import { ID_CHUNK_SIZE } from '#domain/utils/chunk-ids';
import {
  CHAPTER_A,
  CHAPTER_B,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for the Discord importer's three tables.
 *
 * `discord_imports` and `discord_import_files` carry `chapter_id` directly and
 * are scoped on it. `discord_import_channels` does not — it hangs off the
 * import — so it is scoped through the `discord_imports!inner` embed, the same
 * one-hop shape `chat_message_attachments` uses through `chat_channels`.
 *
 * The two tables that matter most here are the ones a leak would be worst on:
 * `discord_imports` names another chapter's Discord guild and the state of its
 * migration, and `discord_import_files` maps that chapter's uploaded archive
 * objects by storage path.
 *
 * Not covered here, for the reason the sibling chat specs state: the harness
 * records the `select()` string without parsing it, so dropping `!inner` from
 * `'*, discord_imports!inner(chapter_id)'` — which turns a filtering join into
 * a non-filtering one against real PostgREST — is invisible. That belongs to the
 * live-PostgREST integration suite.
 *
 * The worker's own lease methods (`claimNextRunnable`, `renewLease`,
 * `releaseLease`) are deliberately NOT chapter-scoped and are excluded below:
 * the sweeper serves every chapter, and the job row it claims carries the
 * chapter it then works within. Their correctness is the compare-and-swap, which
 * `discord-import-worker.service.spec.ts` covers.
 */

const IMPORT_A = '0a000000-0000-4000-8000-0000000001a0';
const IMPORT_B = '0b000000-0000-4000-8000-0000000001a0';
const MAP_A = '0a000000-0000-4000-8000-0000000001a1';
const MAP_B = '0b000000-0000-4000-8000-0000000001a1';
const FILE_A = '0a000000-0000-4000-8000-0000000001a2';
const FILE_B = '0b000000-0000-4000-8000-0000000001a2';
const CHANNEL_A = '0a000000-0000-4000-8000-0000000001a3';

describe('SupabaseDiscordImportRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseDiscordImportRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tenantColumns: {
        discord_import_channels: 'discord_imports.chapter_id',
      },
      untenantedTables: ['discord_import_channels'],
      parentTenant: {
        discord_import_channels: {
          column: 'import_id',
          table: 'discord_imports',
        },
      },
      collisionExempt: {
        // The import id is the row's identity in both chapters; the channel row
        // and the file row must differ on it or they would name the same
        // import.
        discord_import_channels: ['import_id', 'discord_imports'],
        discord_import_files: ['import_id'],
      },
      tables: {
        discord_imports: [
          inA({ id: IMPORT_A, status: 'ready', guild_name: 'Guild' }),
          inB({ id: IMPORT_B, status: 'ready', guild_name: 'Guild' }),
        ],
        discord_import_channels: [
          {
            id: MAP_A,
            import_id: IMPORT_A,
            discord_channel_id: '800000000000000001',
            discord_channel_name: 'general',
            mapping_action: 'use_existing',
            target_channel_id: CHANNEL_A,
            imported_count: 0,
            discord_imports: { chapter_id: CHAPTER_A },
          },
          {
            id: MAP_B,
            import_id: IMPORT_B,
            discord_channel_id: '800000000000000001',
            discord_channel_name: 'general',
            mapping_action: 'use_existing',
            target_channel_id: CHANNEL_A,
            imported_count: 0,
            discord_imports: { chapter_id: CHAPTER_B },
          },
        ],
        discord_import_files: [
          inA({
            id: FILE_A,
            import_id: IMPORT_A,
            kind: 'export',
            part_index: 0,
            relative_path: 'part-000.json',
            bucket: 'chat-archive',
            storage_path: 'shared/part-000.json',
            uploaded_at: null,
          }),
          inB({
            id: FILE_B,
            import_id: IMPORT_B,
            kind: 'export',
            part_index: 0,
            relative_path: 'part-000.json',
            bucket: 'chat-archive',
            storage_path: 'shared/part-000.json',
            uploaded_at: null,
          }),
        ],
      },
    });
    repo = new SupabaseDiscordImportRepository(harness.client);
  });

  it('findById is scoped to the caller chapter', async () => {
    const found = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findById(IMPORT_B, CHAPTER_B),
    );
    expect(found?.id).toBe(IMPORT_B);
  });

  it('findById answers nothing for an import id from another chapter', async () => {
    // The point of binding the chapter into the query rather than trusting the
    // caller: a real import id must not answer for a caller scoped elsewhere.
    expect(await repo.findById(IMPORT_A, CHAPTER_B)).toBeNull();
  });

  it('findByChapter returns only the caller chapter', async () => {
    const rows = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.findByChapter(CHAPTER_A),
    );
    expect(rows.map((r) => r.id)).toEqual([IMPORT_A]);
  });

  it('update cannot reach another chapter row', async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.update(IMPORT_B, CHAPTER_B, { status: 'running' }),
    );
    expect(
      harness.rows('discord_imports').find((r) => r.id === IMPORT_A)?.status,
    ).toBe('ready');
  });

  it('findChannels filters through the import embed', async () => {
    const rows = await repo.findChannels(IMPORT_B, CHAPTER_B);

    expect(rows.map((r) => r.id)).toEqual([MAP_B]);
    expect(
      harness.ops[0].filters.map((f) => [f.column, f.value]),
    ).toContainEqual(['discord_imports.chapter_id', CHAPTER_B]);
  });

  it('findChannels answers nothing for an import in another chapter', async () => {
    expect(await repo.findChannels(IMPORT_A, CHAPTER_B)).toEqual([]);
  });

  it('strips the import embed off returned channel rows', async () => {
    // The embed carries the tenant filter; it is not part of the entity.
    const [row] = await repo.findChannels(IMPORT_B, CHAPTER_B);
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty('discord_imports');
  });

  it('replaceChannels refuses an import that is not the caller chapter', async () => {
    // Scoped through the import rather than re-resolving the chapter here: a
    // read-then-check would leave a window where the delete had already run.
    const before = harness.rows('discord_import_channels').length;
    const result = await repo.replaceChannels(IMPORT_A, CHAPTER_B, []);

    expect(result).toEqual([]);
    expect(harness.rows('discord_import_channels')).toHaveLength(before);
  });

  it('findByChapter leaves out an import the chapter cleared', async () => {
    await repo.findByChapter(CHAPTER_A);
    expect(
      harness.ops[0].filters.map((f) => [f.column, f.op, f.value]),
    ).toContainEqual(['cleared_at', 'is', null]);
  });

  it('markCleared cannot reach another chapter row, and only clears a clearable import', async () => {
    // IMPORT_B is `ready` in the fixture: not clearable, so nothing changes.
    const result = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.markCleared(IMPORT_B, CHAPTER_B, ['purged'], 'now'),
    );
    expect(result).toBeNull();
    expect(
      harness.rows('discord_imports').find((r) => r.id === IMPORT_A)
        ?.cleared_at,
    ).toBeUndefined();
  });

  it('countChannels filters through the import embed', async () => {
    await repo.countChannels(IMPORT_B, CHAPTER_B);
    for (const op of harness.ops) {
      expect(op.filters.map((f) => [f.column, f.value])).toContainEqual([
        'discord_imports.chapter_id',
        CHAPTER_B,
      ]);
    }
  });

  it('findChannelProgress filters every read through the import embed (#2857)', async () => {
    await repo.findChannelProgress(IMPORT_B, CHAPTER_B);
    // Five counts and three short lists.
    expect(harness.ops).toHaveLength(8);
    for (const op of harness.ops) {
      expect(op.filters.map((f) => [f.column, f.value])).toContainEqual([
        'discord_imports.chapter_id',
        CHAPTER_B,
      ]);
      expect(op.filters.map((f) => [f.column, f.op, f.value])).toContainEqual([
        'mapping_action',
        'neq',
        'skip',
      ]);
    }
  });

  it('countChannels counts the rows being imported, and a skipped one as done', async () => {
    await repo.countChannels(IMPORT_B, CHAPTER_B);
    const [total, done] = harness.ops.map((op) =>
      op.filters.map((f) => [f.column, f.op, f.value]),
    );
    expect(harness.ops).toHaveLength(2);
    // A row mapped to skip is not being imported, so it is in neither count.
    expect(total).toContainEqual(['mapping_action', 'neq', 'skip']);
    expect(done).toContainEqual(['mapping_action', 'neq', 'skip']);
    expect(total.some(([column]) => column === 'status')).toBe(false);
    // The worker skips a channel Discord no longer shows the bot; it is
    // finished, or progress would stop short of the total for good.
    expect(done).toContainEqual(['status', 'in', ['completed', 'skipped']]);
  });

  it('findFiles is scoped to the caller chapter', async () => {
    const rows = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.findFiles(IMPORT_A, CHAPTER_A),
    );
    expect(rows.map((r) => r.id)).toEqual([FILE_A]);
  });

  it('markFilesUploaded cannot confirm another chapter uploads on a shared path', async () => {
    // Both chapters seed the same `storage_path` on purpose. Without the
    // chapter predicate the `in('storage_path', …)` filter alone would mark
    // both — which is the exact shape of a cross-tenant write this guards.
    const confirmed = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.markFilesUploaded(
        IMPORT_B,
        CHAPTER_B,
        ['shared/part-000.json'],
        '2026-08-24T12:00:00Z',
      ),
    );

    expect(confirmed).toBe(1);
    expect(
      harness.rows('discord_import_files').find((r) => r.id === FILE_A)
        ?.uploaded_at,
    ).toBeNull();
  });

  it('markFilesUploaded splits a long path list so no request line overflows', async () => {
    // One bot slice marks a busy channel's attachments at once: on staging,
    // about 230 paths made a 30 KB request line the gateway refused (#2825).
    harness.reset();
    const paths = Array.from(
      { length: 230 },
      (_, i) =>
        `chapters/${CHAPTER_B}/chat-archive/imports/${IMPORT_B}/media/${i}/attachment-${i}.png`,
    );
    await repo.markFilesUploaded(IMPORT_B, CHAPTER_B, paths, 'now');
    const lists = harness.ops.map(
      (op) =>
        op.filters.find((f) => f.column === 'storage_path')?.value as string[],
    );
    expect(lists.length).toBeGreaterThan(1);
    expect(lists.flat()).toEqual(paths);
    for (const op of harness.ops) {
      expect(op.filters.map((f) => [f.column, f.value])).toContainEqual([
        'chapter_id',
        CHAPTER_B,
      ]);
    }
  });

  it('deleteImportedMessages binds the chapter into the lookup', async () => {
    harness.reset();
    await repo.deleteImportedMessages(IMPORT_B, CHAPTER_B, 100);

    expect(
      harness.ops[0].filters.map((f) => [f.column, f.value]),
    ).toContainEqual(['chat_channels.chapter_id', CHAPTER_B]);
    expect(
      harness.ops[0].filters.map((f) => [f.column, f.value]),
    ).toContainEqual(['metadata->>discord_import_id', IMPORT_B]);
  });
});

describe('SupabaseDiscordImportRepository — findFiles paging', () => {
  /** Mirrors `FILE_PAGE_SIZE` in the repository under test. */
  const PAGE_SIZE = 500;

  function repoWithPages(pages: Array<{ data: unknown[] | null }>) {
    const ranges: Array<[number, number]> = [];
    let index = 0;
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'order']) {
      builder[method] = jest.fn(() => builder);
    }
    builder.range = jest.fn((from: number, to: number) => {
      ranges.push([from, to]);
      return Promise.resolve(pages[index++] ?? { data: [], error: null });
    });
    const client = { from: jest.fn(() => builder) };
    const repo = new SupabaseDiscordImportRepository(
      client as unknown as ConstructorParameters<
        typeof SupabaseDiscordImportRepository
      >[0],
    );
    return { repo, ranges };
  }

  const fileRows = (count: number) =>
    Array.from({ length: count }, (_, i) => ({ id: `file-${i}` }));

  // #1628. On the UPLOAD path a dropped manifest row is never re-created, so a
  // short page read as end-of-data means `resolveAsset` returns null and the
  // message lands with an under-counted `attachment_count` — on an import the
  // admin was told succeeded.
  it('does not end the read on a short-but-non-empty page', async () => {
    const { repo, ranges } = repoWithPages([
      // Asked for 500, capped at 150 by the server.
      { data: fileRows(150) },
      { data: fileRows(150) },
      { data: fileRows(20) },
      { data: [] },
    ]);

    const files = await repo.findFiles(IMPORT_A, CHAPTER_A);

    expect(files).toHaveLength(320);
    expect(ranges).toEqual([
      [0, PAGE_SIZE - 1],
      [150, 150 + PAGE_SIZE - 1],
      [300, 300 + PAGE_SIZE - 1],
      [320, 320 + PAGE_SIZE - 1],
    ]);
  });

  it('confirms the end with one empty request after a full page', async () => {
    const { repo, ranges } = repoWithPages([
      { data: fileRows(PAGE_SIZE) },
      { data: [] },
    ]);

    const files = await repo.findFiles(IMPORT_A, CHAPTER_A);

    expect(files).toHaveLength(PAGE_SIZE);
    expect(ranges).toEqual([
      [0, PAGE_SIZE - 1],
      [PAGE_SIZE, PAGE_SIZE * 2 - 1],
    ]);
  });
});

describe('SupabaseDiscordImportRepository — purging a large import', () => {
  it('deletes a round of message ids in batches small enough for the request line', async () => {
    // A purge round reads up to 500 ids; one `in` list of 500 UUIDs is ~19 KB,
    // past what the local gateway takes (`chunkIds`' measurement, #2825).
    const candidates = Array.from({ length: 500 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    }));
    const deleted: string[][] = [];
    const reader: Record<string, unknown> = {};
    for (const method of ['select', 'eq']) {
      reader[method] = jest.fn(() => reader);
    }
    reader.limit = jest.fn(() =>
      Promise.resolve({ data: candidates, error: null }),
    );
    const writer: Record<string, unknown> = {
      delete: jest.fn(() => writer),
      in: jest.fn((_column: string, ids: string[]) => {
        deleted.push(ids);
        return Promise.resolve({ error: null });
      }),
    };
    let calls = 0;
    const client = {
      from: jest.fn(() => (calls++ === 0 ? reader : writer)),
    };
    const repo = new SupabaseDiscordImportRepository(
      client as unknown as ConstructorParameters<
        typeof SupabaseDiscordImportRepository
      >[0],
    );

    expect(await repo.deleteImportedMessages(IMPORT_A, CHAPTER_A, 500)).toBe(
      500,
    );
    expect(deleted.flat()).toEqual(candidates.map((row) => row.id));
    for (const batch of deleted) {
      expect(batch.length).toBeLessThanOrEqual(ID_CHUNK_SIZE);
    }
  });

  // The deleted count (#2944) is written in the lease renewal's own statement,
  // so it is bound to the lock token: a worker that lost the lease matches no
  // row and cannot overwrite the new holder's count.
  it('records the deleted count in the lock-token-bound lease renewal', async () => {
    const patches: Record<string, unknown>[] = [];
    const filters: [string, unknown][] = [];
    const builder: Record<string, jest.Mock> = {};
    builder.update = jest.fn((patch: Record<string, unknown>) => {
      patches.push(patch);
      return builder;
    });
    builder.eq = jest.fn((column: string, value: unknown) => {
      filters.push([column, value]);
      return builder;
    });
    builder.select = jest.fn(() =>
      Promise.resolve({ data: [{ id: IMPORT_A }], error: null }),
    );
    const repo = new SupabaseDiscordImportRepository({
      from: jest.fn(() => builder),
    } as unknown as ConstructorParameters<
      typeof SupabaseDiscordImportRepository
    >[0]);
    const now = new Date('2026-09-30T13:00:00Z');

    await expect(
      repo.renewLease(IMPORT_A, 'token-1', now, 60_000, {
        purged_messages: 5874,
      }),
    ).resolves.toBe(true);

    expect(patches).toEqual([
      {
        purged_messages: 5874,
        lease_expires_at: '2026-09-30T13:01:00.000Z',
        updated_at: now.toISOString(),
      },
    ]);
    expect(filters).toEqual([
      ['id', IMPORT_A],
      ['lock_token', 'token-1'],
    ]);
  });
});

/**
 * What the counts and the clear actually write and answer, against rows with
 * the statuses the workers leave. The tenant block above pins the scoping; this
 * one pins the numbers a progress bar and a hidden row depend on.
 */
describe('SupabaseDiscordImportRepository — progress counts and clearing', () => {
  const channel = (
    id: string,
    fields: Record<string, unknown>,
    importId = IMPORT_A,
    chapterId = CHAPTER_A,
  ) => ({
    id,
    import_id: importId,
    discord_channel_id: id,
    discord_channel_name: id,
    discord_imports: { chapter_id: chapterId },
    ...fields,
  });

  function build(importStatus: string, extra: Record<string, unknown>[] = []) {
    const harness = createTenantHarness({
      tenantColumns: {
        discord_import_channels: 'discord_imports.chapter_id',
      },
      untenantedTables: ['discord_import_channels'],
      parentTenant: {
        discord_import_channels: {
          column: 'import_id',
          table: 'discord_imports',
        },
      },
      collisionExempt: {
        discord_import_channels: ['import_id', 'discord_imports'],
      },
      tables: {
        discord_imports: [
          inA({ id: IMPORT_A, status: importStatus }),
          inB({ id: IMPORT_B, status: importStatus }),
        ],
        discord_import_channels: [
          // Another chapter's finished row, which neither count may see.
          channel(
            'elsewhere',
            { mapping_action: 'create_new', status: 'completed' },
            IMPORT_B,
            CHAPTER_B,
          ),
          channel('imported', {
            mapping_action: 'create_new',
            status: 'completed',
          }),
          // Discord no longer showed it to the bot: finished all the same.
          channel('vanished', {
            mapping_action: 'use_existing',
            status: 'skipped',
          }),
          channel('waiting', {
            mapping_action: 'create_new',
            status: 'pending',
          }),
          channel('reading', {
            mapping_action: 'create_new',
            status: 'running',
          }),
          // Mapped to skip: not being imported, so in neither count.
          channel('left-out', { mapping_action: 'skip', status: 'skipped' }),
          ...extra,
        ],
      },
    });
    return {
      harness,
      repo: new SupabaseDiscordImportRepository(harness.client),
    };
  }

  it('findChannelProgress counts by status and names the running, recent and failed rows (#2857)', async () => {
    const { repo } = build('running', [
      channel('broke', {
        mapping_action: 'create_new',
        status: 'failed',
        error: 'Missing Access',
      }),
    ]);
    const progress = await repo.findChannelProgress(IMPORT_A, CHAPTER_A);

    // Rows mapped to skip, and another chapter's rows, are in no count.
    expect(progress.counts).toEqual({
      pending: 1,
      running: 1,
      completed: 1,
      failed: 1,
      skipped: 1,
    });
    expect(progress.running.map((row) => row.discord_channel_id)).toEqual([
      'reading',
    ]);
    expect(progress.recent.map((row) => row.discord_channel_id)).toEqual([
      'imported',
    ]);
    expect(progress.failed).toEqual([
      expect.objectContaining({
        discord_channel_id: 'broke',
        error: 'Missing Access',
      }),
    ]);
    // The scoping embed stays behind.
    expect(progress.running[0]).not.toHaveProperty('discord_imports');
  });

  it('findChannelProgress names the last finished first, and only a few', async () => {
    const finished = Array.from({ length: 8 }, (_, index) =>
      channel(`done-${index}`, {
        mapping_action: 'create_new',
        status: 'completed',
        position: index + 10,
      }),
    );
    const { repo } = build('running', finished);
    const progress = await repo.findChannelProgress(IMPORT_A, CHAPTER_A);

    expect(progress.counts.completed).toBe(9);
    expect(progress.recent.map((row) => row.discord_channel_id)).toEqual([
      'done-7',
      'done-6',
      'done-5',
      'done-4',
      'done-3',
    ]);
  });

  it('counts the rows being imported as the total, and the finished ones as done', async () => {
    const { repo } = build('running');
    expect(await repo.countChannels(IMPORT_A, CHAPTER_A)).toEqual({
      total: 4,
      done: 2,
    });
  });

  it('writes cleared_at on a clearable import', async () => {
    const { harness, repo } = build('purged');
    const cleared = await repo.markCleared(
      IMPORT_A,
      CHAPTER_A,
      ['purged'],
      '2026-09-28T19:00:00Z',
    );
    expect(cleared?.cleared_at).toBe('2026-09-28T19:00:00Z');
    expect(
      harness.rows('discord_imports').find((r) => r.id === IMPORT_A)
        ?.cleared_at,
    ).toBe('2026-09-28T19:00:00Z');
  });
});

describe('SupabaseDiscordImportRepository — channel rows past the response cap', () => {
  /** Mirrors `CHANNEL_PAGE_SIZE` in the repository under test. */
  const PAGE_SIZE = 500;

  function repoWithChannelPages(pages: Array<{ data: unknown[] | null }>) {
    const ranges: Array<[number, number]> = [];
    const inserts: unknown[][] = [];
    const orders: string[] = [];
    let index = 0;
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'delete', 'maybeSingle']) {
      builder[method] = jest.fn(() => builder);
    }
    builder.order = jest.fn((column: string) => {
      orders.push(column);
      return builder;
    });
    builder.range = jest.fn((from: number, to: number) => {
      ranges.push([from, to]);
      return Promise.resolve(pages[index++] ?? { data: [], error: null });
    });
    builder.insert = jest.fn((rows: unknown[]) => {
      inserts.push(rows);
      return Promise.resolve({ error: null });
    });
    // `delete().eq()` and `findById(...).maybeSingle()` resolve through `then`.
    builder.then = (resolve: (value: unknown) => unknown) =>
      resolve({ data: { id: IMPORT_A }, error: null });
    const client = { from: jest.fn(() => builder) };
    const repo = new SupabaseDiscordImportRepository(
      client as unknown as ConstructorParameters<
        typeof SupabaseDiscordImportRepository
      >[0],
    );
    return { repo, ranges, inserts, orders };
  }

  const channelRows = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      id: `map-${i}`,
      discord_imports: { chapter_id: CHAPTER_A },
    }));

  it('reads every channel row, not just the first response', async () => {
    // A bot import keeps a row per thread: the first real server had 945.
    const { repo, ranges } = repoWithChannelPages([
      { data: channelRows(PAGE_SIZE) },
      { data: channelRows(PAGE_SIZE) },
      { data: channelRows(200) },
      { data: [] },
    ]);
    const rows = await repo.findChannels(IMPORT_A, CHAPTER_A);
    expect(rows).toHaveLength(1200);
    expect(rows[0]).not.toHaveProperty('discord_imports');
    expect(ranges[0]).toEqual([0, PAGE_SIZE - 1]);
  });

  it('pages over an order with no ties', async () => {
    // Upload rows all sit at position 0, and two channels can share a name:
    // without the id last, `.range()` pages over an order Postgres may change
    // between requests, repeating some rows and dropping others.
    const { repo, orders } = repoWithChannelPages([
      { data: channelRows(PAGE_SIZE) },
      { data: [] },
    ]);
    await repo.findChannels(IMPORT_A, CHAPTER_A);
    expect(orders.slice(0, 3)).toEqual([
      'position',
      'discord_channel_name',
      'id',
    ]);
  });

  it('inserts the set in one write and answers with the paged read', async () => {
    const { repo, inserts } = repoWithChannelPages([
      { data: channelRows(PAGE_SIZE) },
      { data: channelRows(PAGE_SIZE) },
      { data: channelRows(200) },
      { data: [] },
    ]);
    const rows = Array.from({ length: 1200 }, (_, i) => ({
      discord_channel_id: String(i),
    })) as unknown as Parameters<typeof repo.replaceChannels>[2];
    const result = await repo.replaceChannels(IMPORT_A, CHAPTER_A, rows);
    // One statement, so a failure leaves no partial set for the "has it been
    // scanned" checks to accept.
    expect(inserts.map((batch) => batch.length)).toEqual([1200]);
    expect(result).toHaveLength(1200);
  });
});

/**
 * The archive quota (#1243).
 *
 * The arithmetic lives in SQL and is exercised against a real Postgres — the
 * tenant harness records queries without executing them, so it cannot answer
 * what the monotonic `greatest(...)` upsert or the advisory lock do. What is
 * worth pinning here is the wrapper's own contract: the payload it sends, and
 * that it turns the function's raised ceiling into the domain error rather than
 * letting a raw PostgREST error reach a caller that would report it as a 500.
 */
describe('SupabaseDiscordImportRepository — registerFiles', () => {
  const ROW = {
    import_id: IMPORT_A,
    chapter_id: CHAPTER_A,
    kind: 'media' as const,
    part_index: null,
    relative_path: 'a.png',
    bucket: 'chat-archive',
    storage_path: 'p/2',
    content_type: 'image/png',
    byte_size: 50,
  };

  function repoWithRpc(result: {
    data: unknown;
    error: unknown;
  }): [SupabaseDiscordImportRepository, jest.Mock] {
    const rpc = jest.fn(async () => result);
    const client = { rpc } as unknown as ConstructorParameters<
      typeof SupabaseDiscordImportRepository
    >[0];
    return [new SupabaseDiscordImportRepository(client), rpc];
  }

  it('sends the batch and both ceilings in one call', async () => {
    const [repo, rpc] = repoWithRpc({
      data: [{ ...ROW, id: 'f1', created_at: 'now', uploaded_at: null }],
      error: null,
    });

    await repo.registerFiles(CHAPTER_A, IMPORT_A, [ROW], {
      importBytes: 20,
      chapterBytes: 50,
    });

    expect(rpc).toHaveBeenCalledWith('discord_import_register_files', {
      p_chapter_id: CHAPTER_A,
      p_import_id: IMPORT_A,
      p_rows: [
        {
          relative_path: 'a.png',
          kind: 'media',
          part_index: null,
          bucket: 'chat-archive',
          storage_path: 'p/2',
          content_type: 'image/png',
          byte_size: 50,
        },
      ],
      p_import_cap: 20,
      p_chapter_cap: 50,
    });
  });

  it('translates a raised ceiling into ArchiveQuotaExceededError with its numbers', async () => {
    const [repo] = repoWithRpc({
      data: null,
      error: {
        code: '23514',
        message:
          'discord_import_archive_quota: chapter 1234 would hold 900 bytes, past its 850 byte ceiling',
      },
    });

    const caught = await repo
      .registerFiles(CHAPTER_A, IMPORT_A, [ROW], {
        importBytes: 1,
        chapterBytes: 850,
      })
      .catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(ArchiveQuotaExceededError);
    const quota = caught as ArchiveQuotaExceededError;
    expect(quota.scope).toBe('chapter');
    expect(quota.wouldHoldBytes).toBe(900);
    expect(quota.capBytes).toBe(850);
  });

  it('does not mistake an unrelated check_violation for a quota refusal', async () => {
    // The prefix match is what keeps a table constraint from being reported to
    // an admin as "your archive is full".
    const [repo] = repoWithRpc({
      data: null,
      error: {
        code: '23514',
        message:
          'new row for relation "discord_import_files" violates check constraint "discord_import_files_kind_check"',
      },
    });

    const caught = await repo
      .registerFiles(CHAPTER_A, IMPORT_A, [ROW], {
        importBytes: 1,
        chapterBytes: 1,
      })
      .catch((error: unknown) => error);

    expect(caught).not.toBeInstanceOf(ArchiveQuotaExceededError);
  });

  it('refuses to report success when the function returns no rows', async () => {
    // A silent empty result would mint upload URLs for files that have no
    // manifest row, and the worker skips every one of those.
    const [repo] = repoWithRpc({ data: [], error: null });

    await expect(
      repo.registerFiles(CHAPTER_A, IMPORT_A, [ROW], {
        importBytes: 1000,
        chapterBytes: 1000,
      }),
    ).rejects.toThrow(/returned no rows/);
  });

  it('is a no-op for an empty batch', async () => {
    const [repo, rpc] = repoWithRpc({ data: [], error: null });

    await expect(
      repo.registerFiles(CHAPTER_A, IMPORT_A, [], {
        importBytes: 1,
        chapterBytes: 1,
      }),
    ).resolves.toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('SupabaseDiscordImportRepository.deleteEmptyCreatedChannels (#2905)', () => {
  function repoWithRpc(result: {
    data: unknown;
    error: unknown;
  }): [SupabaseDiscordImportRepository, jest.Mock] {
    const rpc = jest.fn(async () => result);
    const client = { rpc } as unknown as ConstructorParameters<
      typeof SupabaseDiscordImportRepository
    >[0];
    return [new SupabaseDiscordImportRepository(client), rpc];
  }

  it('asks the function for this import in this chapter and returns what it deleted', async () => {
    const [repo, rpc] = repoWithRpc({ data: ['ch-1', 'ch-2'], error: null });

    await expect(
      repo.deleteEmptyCreatedChannels(IMPORT_A, CHAPTER_A),
    ).resolves.toEqual(['ch-1', 'ch-2']);
    expect(rpc).toHaveBeenCalledWith('delete_empty_discord_import_channels', {
      p_import_id: IMPORT_A,
      p_chapter_id: CHAPTER_A,
    });
  });

  it('records a created channel idempotently, keyed on the import and the channel', async () => {
    const upsert = jest.fn(async () => ({ error: null }));
    const from = jest.fn(() => ({ upsert }));
    const repo = new SupabaseDiscordImportRepository({
      from,
    } as unknown as ConstructorParameters<
      typeof SupabaseDiscordImportRepository
    >[0]);

    await repo.recordCreatedChannel(IMPORT_A, CHANNEL_A);

    expect(from).toHaveBeenCalledWith('discord_import_created_channels');
    expect(upsert).toHaveBeenCalledWith(
      { import_id: IMPORT_A, channel_id: CHANNEL_A },
      { onConflict: 'import_id,channel_id', ignoreDuplicates: true },
    );
  });

  it('reads no rows as nothing deleted', async () => {
    const [repo] = repoWithRpc({ data: null, error: null });

    await expect(
      repo.deleteEmptyCreatedChannels(IMPORT_A, CHAPTER_A),
    ).resolves.toEqual([]);
  });

  it('throws the function error, so the purge slice fails rather than marking the import purged', async () => {
    const failure = { message: 'boom', code: 'XX000' };
    const [repo] = repoWithRpc({ data: null, error: failure });

    await expect(
      repo.deleteEmptyCreatedChannels(IMPORT_A, CHAPTER_A),
    ).rejects.toBe(failure);
  });
});
