import { SupabaseDiscordImportRepository } from './supabase-discord-import.repository';
import {
  CHAPTER_A,
  CHAPTER_B,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '../../../../test/helpers/tenant-scope.harness';

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
