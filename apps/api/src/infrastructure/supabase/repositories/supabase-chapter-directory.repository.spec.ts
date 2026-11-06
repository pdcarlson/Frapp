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
 * `search` has nothing to scope; it is an RPC, outside the PostgREST subset
 * the tenant harness implements, so the call shape is pinned against a
 * recording client below instead. The function itself runs against Postgres
 * in the PGlite job (`scripts/pglite/tiers/chapter-directory-seed.mjs`). `chapter_directory_requests` does carry the chapter that
 * raised the request, and that is what the harness pins: the insert lands in
 * the chapter it names and nowhere else.
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

describe('SupabaseChapterDirectoryRepository — search query', () => {
  function recordingClient(rows: unknown[] = []) {
    const builder: Record<string, unknown> = {};
    builder.select = jest.fn(() => builder);
    builder.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve);
    const client = { rpc: jest.fn(() => builder) };
    const repo = new SupabaseChapterDirectoryRepository(
      client as unknown as ConstructorParameters<
        typeof SupabaseChapterDirectoryRepository
      >[0],
    );
    return { client, builder: builder as Record<string, jest.Mock>, repo };
  }

  it('passes the raw query, school and cap to search_chapter_directory', async () => {
    const { client, builder, repo } = recordingClient([{ id: 'dir-1' }]);

    await expect(repo.search('phi gam rens', 'RPI', 20)).resolves.toEqual([
      { id: 'dir-1' },
    ]);

    expect(client.rpc).toHaveBeenCalledWith('search_chapter_directory', {
      p_query: 'phi gam rens',
      p_university: 'RPI',
      p_limit: 20,
    });
    // The projection is the autocomplete contract; the generated `search_*`
    // columns and the aliases stay out.
    const [columns] = builder.select.mock.calls[0] as [string];
    expect(columns.split(', ')).toEqual([
      'id',
      'org_letters',
      'org_name',
      'archetype',
      'chapter_designation',
      'university',
      'university_short',
      'founded_year',
      'default_colors',
      'website',
    ]);
  });

  it('sends no school when it was not given one', async () => {
    const { client, repo } = recordingClient();

    await repo.search('fiji', undefined, 20);

    expect(client.rpc).toHaveBeenCalledWith('search_chapter_directory', {
      p_query: 'fiji',
      p_university: null,
      p_limit: 20,
    });
  });
});
