import { SupabaseBackworkResourceRepository } from './supabase-backwork-resource.repository';
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
 * Tenant scope for `backwork_resources` (backs `use-backwork`).
 *
 * `findByFileHash` is the interesting one: it backs upload de-duplication, and
 * two chapters uploading the same past exam produce the same hash by design.
 * Without the chapter predicate the second chapter's upload silently resolves to
 * the first chapter's row.
 */

const RESOURCE_A = '0a000000-0000-4000-8000-0000000000e0';
const RESOURCE_B = '0b000000-0000-4000-8000-0000000000e0';
const FILE_HASH = 'sha256-identical-exam';

const seed = () => ({
  backwork_resources: [
    inA({
      id: RESOURCE_A,
      department_id: null,
      course_number: 'CHEM 101',
      professor_id: null,
      uploader_id: USER_SHARED,
      title: 'Midterm 1',
      year: 2026,
      semester: 'FALL',
      assignment_type: 'EXAM',
      assignment_number: 1,
      document_variant: 'BLANK',
      storage_path: 'a/midterm.pdf',
      file_hash: FILE_HASH,
      is_redacted: false,
      tags: [],
      created_at: '2026-01-01T00:00:00.000Z',
    }),
    inB({
      id: RESOURCE_B,
      department_id: null,
      course_number: 'CHEM 101',
      professor_id: null,
      uploader_id: USER_SHARED,
      title: 'Midterm 1',
      year: 2026,
      semester: 'FALL',
      assignment_type: 'EXAM',
      assignment_number: 1,
      document_variant: 'BLANK',
      storage_path: 'b/midterm.pdf',
      file_hash: FILE_HASH,
      is_redacted: false,
      tags: [],
      created_at: '2026-01-01T00:00:00.000Z',
    }),
  ],
});

describe('SupabaseBackworkResourceRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseBackworkResourceRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: seed(),
      collisionExempt: { backwork_resources: ['storage_path'] },
    });
    repo = new SupabaseBackworkResourceRepository(harness.client);
  });

  it('findByChapter returns only the caller chapter resources', async () => {
    const resources = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B),
    );

    expect(resources.map((r) => r.id)).toEqual([RESOURCE_B]);
  });

  it('findByChapter keeps the chapter predicate alongside filters', async () => {
    const resources = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B, {
        course_number: 'CHEM 101',
        year: 2026,
      }),
    );

    expect(resources.map((r) => r.id)).toEqual([RESOURCE_B]);
  });

  it('findByFileHash does not match an identical upload in another chapter', async () => {
    const existing = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByFileHash(CHAPTER_B, FILE_HASH),
    );

    expect(existing?.id).toBe(RESOURCE_B);
  });

  it('delete leaves another chapter resource in place', async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.delete(RESOURCE_A, CHAPTER_B),
    );

    expect(
      harness
        .rows('backwork_resources')
        .filter((r) => r.chapter_id === CHAPTER_A),
    ).toHaveLength(1);
  });
});
