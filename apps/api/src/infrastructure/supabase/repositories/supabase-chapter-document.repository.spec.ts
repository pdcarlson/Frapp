import { SupabaseChapterDocumentRepository } from './supabase-chapter-document.repository';
import {
  CHAPTER_A,
  CHAPTER_B,
  USER_SHARED,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '../../../../test/helpers/tenant-scope.harness';

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
