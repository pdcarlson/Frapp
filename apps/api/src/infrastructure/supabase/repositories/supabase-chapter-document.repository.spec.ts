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

  it('findByChapter returns only the caller chapter documents', async () => {
    const docs = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B),
    );

    expect(docs.map((d) => d.id)).toEqual([DOC_B]);
  });

  it('findByChapter keeps the chapter predicate alongside an uploader filter', async () => {
    // The same member uploaded a document in each chapter.
    const mine = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B, { uploaded_by: USER_SHARED }),
    );
    const theirs = await repo.findByChapter(CHAPTER_B, {
      uploaded_by: '0c000000-0000-4000-8000-0000000000ff',
    });

    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((d) => d.chapter_id === CHAPTER_B)).toBe(true);
    expect(theirs).toEqual([]);
  });

  it('findByChapter keeps the chapter predicate alongside a folder filter', async () => {
    const docs = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B, { folder: FOLDER }),
    );

    expect(docs.map((d) => d.id)).toEqual([DOC_B]);
  });

  it('moveToRoot does not unfile an identically-named folder in another chapter', async () => {
    // Reached from `ChapterDocumentService.deleteFolder`. Same shape as
    // `renameFolder`: a bulk update matched on a chapter-chosen folder name.
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.moveToRoot(FOLDER, CHAPTER_B),
    );

    const rows = harness.rows('chapter_documents');
    expect(rows.find((r) => r.id === DOC_B)?.folder).toBeNull();
    expect(rows.find((r) => r.id === DOC_A)?.folder).toBe(FOLDER);
  });

  it('renameFolder does not rename an identically-named folder in another chapter', async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.renameFolder(FOLDER, 'Governing documents', CHAPTER_B),
    );

    const rows = harness.rows('chapter_documents');
    expect(rows.find((r) => r.id === DOC_B)?.folder).toBe(
      'Governing documents',
    );
    expect(rows.find((r) => r.id === DOC_A)?.folder).toBe(FOLDER);
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
