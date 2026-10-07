import { SupabaseChapterDirectoryRepository } from './supabase-chapter-directory.repository';
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
 * Tenant scope for the onboarding directory.
 *
 * `chapter_directory` is a global curated catalog with no chapter column, so
 * `search` has nothing to scope and is not exercised here; its full-text
 * operator is outside the PostgREST subset this harness implements, and the
 * live suite owns it. `chapter_directory_requests` does carry the chapter that
 * raised the request, and that is what this spec pins: the insert lands in the
 * chapter it names and nowhere else.
 */

const REQUEST = {
  requested_by: USER_SHARED,
  org_letters: 'ΦΓΔ',
  org_name: 'Phi Gamma Delta',
  chapter_designation: 'Tau Nu',
  university: 'State University',
  university_short: 'SU',
  founded_year: 1990,
  archetype: 'ifc',
};

describe('SupabaseChapterDirectoryRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseChapterDirectoryRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: {
        chapter_directory_requests: [
          inA({ id: 'request-a', ...REQUEST }),
          inB({ id: 'request-b', ...REQUEST }),
        ],
      },
    });
    repo = new SupabaseChapterDirectoryRepository(harness.client);
  });

  it('createRequest writes the request under the chapter that raised it', async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.createRequest({ ...REQUEST, chapter_id: CHAPTER_B }),
    );

    const rows = harness.rows('chapter_directory_requests');
    expect(rows.filter((r) => r.chapter_id === CHAPTER_B)).toHaveLength(2);
    expect(rows.filter((r) => r.chapter_id === CHAPTER_A)).toHaveLength(1);
  });
});
