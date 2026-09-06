import { SupabaseSemesterArchiveRepository } from './supabase-semester-archive.repository';
import {
  CHAPTER_B,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `semester_archives` (backs `use-semesters`, whose
 * `["semesters"]` query key is one of the ungated ones due to move onto
 * `createChapterQueryKeys`).
 *
 * `findLatestByChapter` drives semester rollover, so a cross-chapter match does
 * not merely display the wrong label — it decides which points get archived.
 */

const ARCHIVE_A = '0a000000-0000-4000-8000-000000000120';
const ARCHIVE_B = '0b000000-0000-4000-8000-000000000120';

const seed = () => ({
  semester_archives: [
    inA({
      id: ARCHIVE_A,
      label: 'Spring 2026',
      start_date: '2026-01-01',
      end_date: '2026-05-31',
      created_at: '2026-06-01T00:00:00.000Z',
    }),
    inB({
      id: ARCHIVE_B,
      label: 'Spring 2026',
      start_date: '2026-01-01',
      end_date: '2026-05-31',
      created_at: '2026-06-01T00:00:00.000Z',
    }),
  ],
});

describe('SupabaseSemesterArchiveRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseSemesterArchiveRepository;

  beforeEach(() => {
    harness = createTenantHarness({ tables: seed() });
    repo = new SupabaseSemesterArchiveRepository(harness.client);
  });

  it('findByChapter returns only the caller chapter archives', async () => {
    const archives = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B),
    );

    expect(archives.map((a) => a.id)).toEqual([ARCHIVE_B]);
  });

  it('findLatestByChapter does not fall through to another chapter', async () => {
    const latest = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findLatestByChapter(CHAPTER_B),
    );

    // `.limit(1)` without the chapter predicate returns whichever chapter sorts
    // first, and the caller has no way to tell.
    expect(latest?.id).toBe(ARCHIVE_B);
  });

  it('findById returns the archive when it belongs to the caller chapter', async () => {
    const found = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findById(ARCHIVE_B, CHAPTER_B),
    );

    expect(found?.id).toBe(ARCHIVE_B);
  });

  it('findById returns null for an archive id that belongs to another chapter', async () => {
    // The #377 picker endpoints 404 on this — a caller must not be able to
    // read another chapter's archive by guessing or reusing its id.
    const found = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findById(ARCHIVE_A, CHAPTER_B),
    );

    expect(found).toBeNull();
  });

  it('findById returns null for an id that does not exist at all', async () => {
    const found = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findById('0b000000-0000-4000-8000-000000000199', CHAPTER_B),
    );

    expect(found).toBeNull();
  });

  it('create writes the archive under the caller chapter', async () => {
    const created = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.create({
        id: '0b000000-0000-4000-8000-000000000121',
        chapter_id: CHAPTER_B,
        label: 'Fall 2026',
        start_date: '2026-08-01',
        end_date: '2026-12-31',
      }),
    );

    expect(created.chapter_id).toBe(CHAPTER_B);
  });
});
