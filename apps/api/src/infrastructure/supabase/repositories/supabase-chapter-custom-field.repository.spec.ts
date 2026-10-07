import { SupabaseChapterCustomFieldRepository } from './supabase-chapter-custom-field.repository';
import {
  CHAPTER_B,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `chapter_custom_fields` as onboarding seeds it. The rows
 * are identical for every chapter of an archetype, so the conflict target is
 * the only thing that keeps one chapter's seed off another's definitions.
 */

const FIELD_A = '0a000000-0000-4000-8000-0000000000d1';
const FIELD_B = '0b000000-0000-4000-8000-0000000000d1';

const seed = () => ({
  chapter_custom_fields: [
    inA({ id: FIELD_A, key: 'major', label: 'Major', type: 'text', sort: 0 }),
    inB({ id: FIELD_B, key: 'major', label: 'Major', type: 'text', sort: 0 }),
  ],
});

describe('SupabaseChapterCustomFieldRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseChapterCustomFieldRepository;

  beforeEach(() => {
    harness = createTenantHarness({ tables: seed() });
    repo = new SupabaseChapterCustomFieldRepository(harness.client);
  });

  it('seedDefaults writes only into the caller chapter', async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.seedDefaults([
        {
          chapter_id: CHAPTER_B,
          key: 'hometown',
          label: 'Hometown',
          type: 'text',
        },
      ]),
    );

    const seeded = harness
      .rows('chapter_custom_fields')
      .filter((r) => r.key === 'hometown');
    expect(seeded.map((r) => r.chapter_id)).toEqual([CHAPTER_B]);
  });

  it('seedDefaults conflicts on (chapter_id, key), so a same-key twin in another chapter is untouched', async () => {
    // Both chapters already hold `major`. A conflict target of `key` alone
    // would land this row on A's definition.
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.seedDefaults([
        {
          chapter_id: CHAPTER_B,
          key: 'major',
          label: 'Field of study',
          type: 'text',
        },
      ]),
    );

    const rows = harness.rows('chapter_custom_fields');
    expect(rows.find((r) => r.id === FIELD_A)?.label).toBe('Major');
    expect(rows.filter((r) => r.key === 'major')).toHaveLength(2);
  });
});

describe('SupabaseChapterCustomFieldRepository — seed options', () => {
  // Named for what it asserts: the upsert options reaching the client. That
  // this yields true idempotency is a PostgREST/Postgres property of the
  // `unique (chapter_id, key)` constraint, which a mocked client cannot
  // demonstrate — only an integration test against a real DB could.
  it('asks PostgREST to skip existing (chapter_id, key) rows', async () => {
    const upsert = jest.fn().mockResolvedValue({ error: null });
    const client = { from: jest.fn(() => ({ upsert })) };
    const repo = new SupabaseChapterCustomFieldRepository(
      client as unknown as ConstructorParameters<
        typeof SupabaseChapterCustomFieldRepository
      >[0],
    );

    await repo.seedDefaults([
      { chapter_id: CHAPTER_B, key: 'major', label: 'Major', type: 'text' },
    ]);

    expect(client.from).toHaveBeenCalledWith('chapter_custom_fields');
    expect(upsert.mock.calls[0][1]).toEqual({
      onConflict: 'chapter_id,key',
      ignoreDuplicates: true,
    });
  });
});
