import { SupabaseChapterDocumentRepository } from './supabase-chapter-document.repository';
import type { FrappSupabaseClient } from '../database.types';
import {
  CHAPTER_A,
  CHAPTER_B,
  USER_SHARED,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `chapter_documents` (backs `use-documents`).
 *
 * The folder bulk-writes are covered as well as the reads. `moveToRoot` and
 * `renameFolder` match on a *folder name*, which chapters pick independently and
 * therefore collide across tenants constantly — an unscoped rename would rewrite
 * every chapter that happens to have a folder called "Bylaws".
 */

const DOC_A = '0a000000-0000-4000-8000-0000000000a0';
const DOC_B = '0b000000-0000-4000-8000-0000000000a0';
const FOLDER = 'Bylaws';
const DRIVE_A = '0a000000-0000-4000-8000-0000000000a1';
const DRIVE_B = '0b000000-0000-4000-8000-0000000000a1';

const seed = () => ({
  chapter_documents: [
    inA({
      id: DOC_A,
      title: 'Constitution',
      description: null,
      folder: FOLDER,
      storage_path: 'a/constitution.pdf',
      uploaded_by: USER_SHARED,
      created_at: '2026-01-01T00:00:00.000Z',
    }),
    inB({
      id: DOC_B,
      title: 'Constitution',
      description: null,
      folder: FOLDER,
      storage_path: 'b/constitution.pdf',
      uploaded_by: USER_SHARED,
      created_at: '2026-01-01T00:00:00.000Z',
    }),
  ],
});

describe('SupabaseChapterDocumentRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseChapterDocumentRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: seed(),
      // Storage paths are chapter-prefixed, so they cannot collide.
      collisionExempt: { chapter_documents: ['storage_path'] },
    });
    repo = new SupabaseChapterDocumentRepository(harness.client);
  });

  it('findDriveCopies returns only the chapter’s Drive copies (#5157)', async () => {
    harness = createTenantHarness({
      tables: {
        chapter_documents: [
          ...seed().chapter_documents,
          inA({
            id: DRIVE_A,
            title: 'Minutes',
            folder: null,
            storage_path: 'a/minutes.pdf',
            uploaded_by: USER_SHARED,
            drive_file_id: 'drive-file-1',
          }),
          inB({
            id: DRIVE_B,
            title: 'Minutes',
            folder: null,
            storage_path: 'b/minutes.pdf',
            uploaded_by: USER_SHARED,
            drive_file_id: 'drive-file-1',
          }),
        ],
      },
      collisionExempt: { chapter_documents: ['storage_path'] },
    });
    repo = new SupabaseChapterDocumentRepository(harness.client);

    const copies = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.findDriveCopies(CHAPTER_A),
    );
    expect(copies.map((d) => d.id)).toEqual([DRIVE_A]);

    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.updateDriveCopy(DRIVE_A, CHAPTER_B, { title: 'Crossed' }),
    );
    expect(
      harness.rows('chapter_documents').find((r) => r.id === DRIVE_A)?.title,
    ).toBe('Minutes');

    // An upload is never rewritten as a Drive copy.
    await repo.updateDriveCopy(DOC_A, CHAPTER_A, { title: 'Crossed' });
    expect(
      harness.rows('chapter_documents').find((r) => r.id === DOC_A)?.title,
    ).toBe('Constitution');
  });

  // #5434: a file added by its own link is the link's, never the folder's.
  it('tells linked files from folder copies, each read in the caller chapter only', async () => {
    const LINKED_A = '0a000000-0000-4000-8000-0000000000a2';
    const LINKED_B = '0b000000-0000-4000-8000-0000000000a2';
    const row = (over: Record<string, unknown>) => ({
      title: 'Minutes',
      folder: null,
      uploaded_by: USER_SHARED,
      ...over,
    });
    harness = createTenantHarness({
      tables: {
        chapter_documents: [
          ...seed().chapter_documents,
          inA(
            row({
              id: DRIVE_A,
              storage_path: 'a/m.pdf',
              drive_file_id: 'folder-file',
              drive_link_status: null,
            }),
          ),
          inB(
            row({
              id: DRIVE_B,
              storage_path: 'b/m.pdf',
              drive_file_id: 'folder-file',
              drive_link_status: null,
            }),
          ),
          inA(
            row({
              id: LINKED_A,
              storage_path: 'a/l.pdf',
              drive_file_id: 'linked-file',
              drive_link_status: 'active',
            }),
          ),
          inB(
            row({
              id: LINKED_B,
              storage_path: 'b/l.pdf',
              drive_file_id: 'linked-file',
              drive_link_status: 'active',
            }),
          ),
        ],
      },
      collisionExempt: { chapter_documents: ['storage_path'] },
    });
    repo = new SupabaseChapterDocumentRepository(harness.client);

    const copies = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.findDriveCopies(CHAPTER_A),
    );
    expect(copies.map((d) => d.id)).toEqual([DRIVE_A]);

    const linked = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.findLinkedDriveFileIds(CHAPTER_A),
    );
    expect([...linked]).toEqual(['linked-file']);

    const found = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByDriveFileId(CHAPTER_B, 'linked-file'),
    );
    expect(found?.id).toBe(LINKED_B);

    await expect(
      harness.expectTenantScoped(CHAPTER_A, () =>
        repo.updateDriveCopy(LINKED_A, CHAPTER_A, { title: 'Minutes v2' }),
      ),
    ).resolves.toBe(true);
    await expect(
      repo.updateDriveCopy(LINKED_A, CHAPTER_B, { title: 'Crossed' }),
    ).resolves.toBe(false);
  });

  it('findByChapter returns only the caller chapter documents', async () => {
    const docs = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B),
    );

    expect(docs.map((d) => d.id)).toEqual([DOC_B]);
  });

  it('findByChapter keeps the chapter predicate alongside a folder filter', async () => {
    const docs = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B, { folder: FOLDER }),
    );

    expect(docs.map((d) => d.id)).toEqual([DOC_B]);
  });

  it('delete leaves another chapter document in place', async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.delete(DOC_A, CHAPTER_B),
    );

    expect(
      harness
        .rows('chapter_documents')
        .filter((d) => d.chapter_id === CHAPTER_A),
    ).toHaveLength(1);
  });

  it('setPinnedAt pins in the caller chapter and never reaches another (#3934)', async () => {
    const pinned = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.setPinnedAt(DOC_B, CHAPTER_B, '2026-11-11T00:00:00.000Z'),
    );
    expect(pinned?.id).toBe(DOC_B);

    const missed = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.setPinnedAt(DOC_A, CHAPTER_B, '2026-11-11T00:00:00.000Z'),
    );
    expect(missed).toBeNull();
    expect(
      harness.rows('chapter_documents').find((d) => d.id === DOC_A)?.pinned_at,
    ).toBeUndefined();
  });
});

/**
 * A confirm retried with a path that is already filed (#3399), which the
 * tenant harness cannot reach: its `insert` appends unconditionally, so it
 * never raises the `23505` that `chapter_documents_storage_path_key` does.
 */
describe('SupabaseChapterDocumentRepository — create when the path is already filed', () => {
  const PATH = 'chapters/c/documents/d/minutes.jpg';
  const filed = {
    id: '0c000000-0000-4000-8000-0000000000a0',
    chapter_id: CHAPTER_A,
    title: 'Minutes',
    storage_path: PATH,
    uploaded_by: USER_SHARED,
  };

  /**
   * Minimal PostgREST double: `.insert(...).select().single()` answers with
   * `insertError`, and the re-select's `.select().eq().eq().maybeSingle()`
   * answers with `reselect`. `filters` records the re-select's predicates.
   */
  function createClient(options: {
    insertError: unknown;
    reselect: Record<string, unknown> | null;
  }) {
    const filters: Array<[string, unknown]> = [];
    const builder: Record<string, unknown> = {
      insert: jest.fn(() => builder),
      select: jest.fn(() => builder),
      eq: jest.fn((column: string, value: unknown) => {
        filters.push([column, value]);
        return builder;
      }),
      single: jest.fn(() =>
        Promise.resolve({ data: null, error: options.insertError }),
      ),
      maybeSingle: jest.fn(() =>
        Promise.resolve({ data: options.reselect, error: null }),
      ),
    };
    const client = {
      from: jest.fn(() => builder),
    } as unknown as FrappSupabaseClient;
    return { client, filters };
  }

  const insert = {
    chapter_id: CHAPTER_A,
    title: 'Minutes',
    storage_path: PATH,
    uploaded_by: USER_SHARED,
  };

  it('returns the filed row instead of surfacing 23505, read in the caller chapter', async () => {
    const { client, filters } = createClient({
      insertError: { code: '23505', message: 'duplicate key value' },
      reselect: filed,
    });

    await expect(
      new SupabaseChapterDocumentRepository(client).create(insert),
    ).resolves.toEqual(filed);
    expect(filters).toEqual([
      ['storage_path', PATH],
      ['chapter_id', CHAPTER_A],
    ]);
  });

  it('rethrows when the filed row vanished between the insert and the re-select', async () => {
    const { client } = createClient({
      insertError: { code: '23505', message: 'duplicate key value' },
      reselect: null,
    });

    await expect(
      new SupabaseChapterDocumentRepository(client).create(insert),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('rethrows an error that is not a unique violation', async () => {
    const { client, filters } = createClient({
      insertError: { code: '23503', message: 'foreign key violation' },
      reselect: filed,
    });

    await expect(
      new SupabaseChapterDocumentRepository(client).create(insert),
    ).rejects.toMatchObject({ code: '23503' });
    expect(filters).toEqual([]);
  });
});

// #5585: the library is read in pages, so a chapter past PostgREST's row cap
// keeps every file; #5563: renames and moves never reach a Drive folder copy.
describe('SupabaseChapterDocumentRepository — paging and refiling', () => {
  const id = (chapter: 'a' | 'b', n: number) =>
    `0${chapter}000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`;
  type Over = Record<string, unknown>;
  /** The same files in both chapters, as the harness's twin check wants. */
  const twins = (files: [number, Over?][]) =>
    (['a', 'b'] as const).flatMap((chapter) =>
      files.map(([n, over]) =>
        (chapter === 'a' ? inA : inB)({
          id: id(chapter, n),
          title: `File ${n}`,
          description: null,
          folder: n % 2 === 0 ? 'Rush' : null,
          storage_path: `${chapter}/file-${n}.pdf`,
          uploaded_by: USER_SHARED,
          created_at: `2026-11-${String(n).padStart(2, '0')}T00:00:00.000Z`,
          drive_file_id: null,
          drive_link_status: null,
          ...over,
        }),
      ),
    );

  // A cap of 2 makes every page short: a read that stopped on the first short
  // page would return two files.
  const harnessWith = (rows: ReturnType<typeof twins>) =>
    createTenantHarness({
      tables: { chapter_documents: rows },
      collisionExempt: { chapter_documents: ['storage_path'] },
      maxRows: 2,
    });

  it('reads every file past the row cap, newest first, in the caller chapter only', async () => {
    const harness = harnessWith(twins([[1], [2], [3], [4], [5], [6], [7]]));
    const repo = new SupabaseChapterDocumentRepository(harness.client);

    const all = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.findByChapter(CHAPTER_A),
    );
    expect(all.map((doc) => doc.id)).toEqual(
      [7, 6, 5, 4, 3, 2, 1].map((n) => id('a', n)),
    );

    const inRush = await repo.findByChapter(CHAPTER_A, { folder: 'Rush' });
    expect(inRush.map((doc) => doc.id)).toEqual(
      [6, 4, 2].map((n) => id('a', n)),
    );
  });

  it('orders files added at the same moment by id, across pages', async () => {
    const sameMoment = { created_at: '2026-11-19T12:00:00.000Z' };
    const harness = harnessWith(
      twins([[5, sameMoment], [1, sameMoment], [9], [3, sameMoment]]),
    );
    const repo = new SupabaseChapterDocumentRepository(harness.client);

    const all = await repo.findByChapter(CHAPTER_A);
    expect(all.map((doc) => doc.id)).toEqual(
      [1, 3, 5, 9].map((n) => id('a', n)),
    );
  });

  it('reads every Drive copy and linked file past the row cap', async () => {
    const harness = harnessWith(
      twins([
        ...[1, 2, 3, 4, 5].map((n): [number, Over] => [
          n,
          { drive_file_id: `copy-${n}` },
        ]),
        ...[6, 7, 8].map((n): [number, Over] => [
          n,
          { drive_file_id: `linked-${n}`, drive_link_status: 'active' },
        ]),
      ]),
    );
    const repo = new SupabaseChapterDocumentRepository(harness.client);

    const copies = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.findDriveCopies(CHAPTER_A),
    );
    expect(copies.map((doc) => doc.id).sort()).toEqual(
      [1, 2, 3, 4, 5].map((n) => id('a', n)),
    );
    await expect(
      harness.expectTenantScoped(CHAPTER_A, () =>
        repo.findLinkedDriveFileIds(CHAPTER_A),
      ),
    ).resolves.toEqual(new Set(['linked-6', 'linked-7', 'linked-8']));
  });

  it('renames and moves uploads and linked files, never a folder copy or another chapter’s row', async () => {
    const harness = harnessWith(
      twins([
        [1],
        [2, { drive_file_id: 'copy-2' }],
        [3, { drive_file_id: 'linked-3', drive_link_status: 'active' }],
      ]),
    );
    const repo = new SupabaseChapterDocumentRepository(harness.client);
    const row = (rowId: string) =>
      harness.rows('chapter_documents').find((r) => r.id === rowId);

    const renamed = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.updateFiling(id('a', 1), CHAPTER_A, { title: 'Bylaws' }),
    );
    expect(renamed?.title).toBe('Bylaws');
    expect(row(id('b', 1))?.title).toBe('File 1');

    await expect(
      repo.updateFiling(id('a', 2), CHAPTER_A, { folder: 'Exec' }),
    ).resolves.toBeNull();
    await expect(
      repo.updateFiling(id('b', 1), CHAPTER_A, { title: 'Crossed' }),
    ).resolves.toBeNull();

    const moved = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.moveMany(
        [id('a', 1), id('a', 2), id('a', 3), id('b', 1)],
        CHAPTER_A,
        'Exec',
      ),
    );
    expect(moved.map((doc) => doc.id).sort()).toEqual([id('a', 1), id('a', 3)]);
    expect(row(id('a', 2))?.folder).toBe('Rush');
    expect(row(id('b', 1))?.folder).toBeNull();
  });
});
