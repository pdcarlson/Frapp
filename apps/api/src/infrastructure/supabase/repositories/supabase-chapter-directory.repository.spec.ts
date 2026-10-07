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
 * `search` has nothing to scope; its full-text operator is also outside the
 * PostgREST subset the tenant harness implements, so the query shape is
 * pinned against a recording client below instead. Nothing here runs it
 * against Postgres. `chapter_directory_requests` does carry the chapter that
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
    for (const method of ['select', 'limit', 'ilike', 'textSearch']) {
      builder[method] = jest.fn(() => builder);
    }
    builder.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve);
    const client = { from: jest.fn(() => builder) };
    const repo = new SupabaseChapterDirectoryRepository(
      client as unknown as ConstructorParameters<
        typeof SupabaseChapterDirectoryRepository
      >[0],
    );
    return { client, builder: builder as Record<string, jest.Mock>, repo };
  }

  it('caps the result, narrows by school, and full-text searches the vector', async () => {
    const { client, builder, repo } = recordingClient([{ id: 'dir-1' }]);

    await expect(repo.search('phi gamma', 'UCLA', 20)).resolves.toEqual([
      { id: 'dir-1' },
    ]);

    expect(client.from).toHaveBeenCalledWith('chapter_directory');
    expect(builder.limit).toHaveBeenCalledWith(20);
    expect(builder.ilike).toHaveBeenCalledWith('university_short', '%UCLA%');
    expect(builder.textSearch).toHaveBeenCalledWith(
      'search_vector',
      'phi gamma',
      { type: 'websearch', config: 'english' },
    );
    // The projection is the autocomplete contract; `search_vector` stays out.
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

  it('skips the filters it was not given', async () => {
    const { builder, repo } = recordingClient();

    await repo.search('', undefined, 20);

    expect(builder.ilike).not.toHaveBeenCalled();
    expect(builder.textSearch).not.toHaveBeenCalled();
  });
});
