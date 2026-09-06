import { SupabaseChapterDocumentFolderRepository } from './supabase-chapter-document-folder.repository';
import {
  CHAPTER_A,
  CHAPTER_B,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `chapter_document_folders` (backs `use-documents`).
 *
 * Folder names are chapter-chosen and collide constantly, which makes
 * `findByName` the method worth pinning: without its chapter predicate it
 * resolves whichever chapter's "Bylaws" folder PostgREST returns first. The
 * argument order is `(chapterId, name)` — chapter-first, same as
 * `professorRepo.findByName`.
 */

const FOLDER_A = '0a000000-0000-4000-8000-0000000000b0';
const FOLDER_B = '0b000000-0000-4000-8000-0000000000b0';

const seed = () => ({
  chapter_document_folders: [
    inA({
      id: FOLDER_A,
      name: 'Bylaws',
      sort_order: 1,
      created_at: '2026-01-01T00:00:00.000Z',
    }),
    inB({
      id: FOLDER_B,
      name: 'Bylaws',
      sort_order: 1,
      created_at: '2026-01-01T00:00:00.000Z',
    }),
  ],
});

describe('SupabaseChapterDocumentFolderRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseChapterDocumentFolderRepository;

  beforeEach(() => {
    harness = createTenantHarness({ tables: seed() });
    repo = new SupabaseChapterDocumentFolderRepository(harness.client);
  });

  it('findByChapter returns only the caller chapter folders', async () => {
    const folders = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B),
    );

    expect(folders.map((f) => f.id)).toEqual([FOLDER_B]);
  });

  it('findByName does not resolve the same folder name in another chapter', async () => {
    const folder = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByName(CHAPTER_B, 'Bylaws'),
    );

    expect(folder?.id).toBe(FOLDER_B);
  });

  it('update leaves another chapter folder untouched', async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.update(FOLDER_B, CHAPTER_B, { name: 'Governing documents' }),
    );

    const rows = harness.rows('chapter_document_folders');
    expect(rows.find((f) => f.chapter_id === CHAPTER_A)?.name).toBe('Bylaws');
  });
});
