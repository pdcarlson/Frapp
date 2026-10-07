import { SupabaseCustomFieldRepository } from './supabase-custom-field.repository';
import { CustomFieldKeyConflictError } from '#domain/repositories/custom-field.repository.interface';
import { SupabaseQueryError } from '../supabase-query-error';
import type { FrappSupabaseClient } from '../database.types';
import {
  CHAPTER_A,
  CHAPTER_B,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `chapter_custom_fields` and the `member_custom_field_values`
 * reads behind the member directory and search.
 *
 * The value reads carry no chapter predicate of their own: they take field ids
 * the caller already resolved through a chapter-scoped definition read, and the
 * composite `(field_id, chapter_id)` foreign key keeps a value row in its
 * field's chapter. So those cases assert the field-id narrowing directly
 * instead of through `expectTenantScoped`, which would rightly report the
 * missing predicate.
 */

const FIELD_A = '0a000000-0000-4000-8000-000000000300';
const FIELD_B = '0b000000-0000-4000-8000-000000000300';
const MEMBER_A = '0a000000-0000-4000-8000-000000000301';
const MEMBER_B = '0b000000-0000-4000-8000-000000000301';

const fieldRow = () => ({
  key: 'major',
  label: 'Major',
  type: 'text' as const,
  required: false,
  visibility: 'chapter' as const,
  sensitive: false,
  options: null,
  sort: 3,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
});

const valueRow = () => ({
  value: 'Physics',
  created_at: '2026-01-02T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
});

const seed = () => ({
  chapter_custom_fields: [
    inA({ id: FIELD_A, ...fieldRow() }),
    inB({ id: FIELD_B, ...fieldRow() }),
  ],
  member_custom_field_values: [
    inA({
      id: '0a000000-0000-4000-8000-000000000302',
      member_id: MEMBER_A,
      field_id: FIELD_A,
      ...valueRow(),
    }),
    inB({
      id: '0b000000-0000-4000-8000-000000000302',
      member_id: MEMBER_B,
      field_id: FIELD_B,
      ...valueRow(),
    }),
  ],
});

describe('SupabaseCustomFieldRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseCustomFieldRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: seed(),
      collisionExempt: {
        // A value row points at its own chapter's field and member.
        member_custom_field_values: ['member_id', 'field_id'],
      },
    });
    repo = new SupabaseCustomFieldRepository(harness.client);
  });

  it('findByChapter returns only the caller chapter fields', async () => {
    const fields = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B),
    );

    expect(fields.map((f) => f.id)).toEqual([FIELD_B]);
  });

  it('findByVisibility and findIdsByVisibility stay in the chapter', async () => {
    const fields = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByVisibility(CHAPTER_B, ['chapter']),
    );
    const ids = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findIdsByVisibility(CHAPTER_B, ['chapter']),
    );

    expect(fields.map((f) => f.id)).toEqual([FIELD_B]);
    expect(ids.map((f) => f.id)).toEqual([FIELD_B]);
  });

  it('findById misses an id belonging to another chapter', async () => {
    await expect(
      harness.expectTenantScoped(CHAPTER_B, () =>
        repo.findById(FIELD_A, CHAPTER_B),
      ),
    ).resolves.toBeNull();
  });

  it('findMaxSort reads the caller chapter, highest first', async () => {
    harness = createTenantHarness({
      tables: {
        chapter_custom_fields: [
          inA({ id: FIELD_A, ...fieldRow(), sort: 9 }),
          inB({ id: FIELD_B, ...fieldRow(), sort: 9 }),
          inA({
            id: '0a000000-0000-4000-8000-000000000303',
            ...fieldRow(),
            key: 'minor',
            sort: 2,
          }),
          inB({
            id: '0b000000-0000-4000-8000-000000000303',
            ...fieldRow(),
            key: 'minor',
            sort: 2,
          }),
        ],
      },
    });
    repo = new SupabaseCustomFieldRepository(harness.client);

    await expect(
      harness.expectTenantScoped(CHAPTER_B, () => repo.findMaxSort(CHAPTER_B)),
    ).resolves.toBe(9);
  });

  it('findMaxSort is null for a chapter with no fields', async () => {
    const EMPTY_CHAPTER = '66666666-6666-4666-8666-666666666666';

    await expect(repo.findMaxSort(EMPTY_CHAPTER)).resolves.toBeNull();
  });

  it('create writes into the caller chapter', async () => {
    const created = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.create({
        id: '0b000000-0000-4000-8000-000000000304',
        chapter_id: CHAPTER_B,
        ...fieldRow(),
        key: 'hometown',
      }),
    );

    expect(created.chapter_id).toBe(CHAPTER_B);
  });

  it('update refuses an id belonging to another chapter and writes nothing', async () => {
    await expect(
      harness.expectTenantScoped(CHAPTER_B, () =>
        repo.update(FIELD_A, CHAPTER_B, { label: 'Hijacked' }),
      ),
    ).resolves.toBeNull();

    expect(
      harness.rows('chapter_custom_fields').find((r) => r.id === FIELD_A)
        ?.label,
    ).toBe('Major');
  });

  it('delete leaves another chapter field in place', async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.delete(FIELD_A, CHAPTER_B),
    );

    expect(harness.rows('chapter_custom_fields').map((r) => r.id)).toContain(
      FIELD_A,
    );
  });

  it('value reads return only rows for the field ids they are handed', async () => {
    const forMember = await repo.findValuesForMember(MEMBER_B, [FIELD_B]);
    const byField = await repo.findValuesByFieldIds([FIELD_B]);

    expect(forMember).toEqual([
      expect.objectContaining({ field_id: FIELD_B, value: 'Physics' }),
    ]);
    expect(byField).toEqual([
      expect.objectContaining({ member_id: MEMBER_B, field_id: FIELD_B }),
    ]);
  });

  it('findValuesByFieldIds does not query for an empty id list', async () => {
    await expect(repo.findValuesByFieldIds([])).resolves.toEqual([]);
    expect(harness.ops).toHaveLength(0);
  });
});

describe('SupabaseCustomFieldRepository — error mapping', () => {
  /** A client whose every chain settles with `result`. */
  const failingClient = (result: { data: unknown; error: unknown }) => {
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'insert', 'update', 'eq', 'order']) {
      chain[method] = jest.fn(() => chain);
    }
    chain.single = jest.fn(() => Promise.resolve(result));
    chain.maybeSingle = jest.fn(() => Promise.resolve(result));
    chain.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve(result).then(resolve);
    return { from: jest.fn(() => chain) } as unknown as FrappSupabaseClient;
  };

  it('translates a duplicate key into CustomFieldKeyConflictError', async () => {
    const repo = new SupabaseCustomFieldRepository(
      failingClient({ data: null, error: { code: '23505', message: 'dup' } }),
    );

    await expect(
      repo.create({ chapter_id: CHAPTER_A, key: 'major' }),
    ).rejects.toBeInstanceOf(CustomFieldKeyConflictError);
  });

  it('wraps any other insert failure in SupabaseQueryError', async () => {
    const repo = new SupabaseCustomFieldRepository(
      failingClient({ data: null, error: { code: '42P01', message: 'gone' } }),
    );

    await expect(
      repo.create({ chapter_id: CHAPTER_A, key: 'major' }),
    ).rejects.toBeInstanceOf(SupabaseQueryError);
  });

  // #2459, preserved: these report a failed read or write as a miss. When
  // #2459 is fixed these two cases flip to expecting a SupabaseQueryError.
  it('reports a failed findById as a miss (#2459)', async () => {
    const repo = new SupabaseCustomFieldRepository(
      failingClient({ data: null, error: { code: '57014', message: 'slow' } }),
    );

    await expect(repo.findById(FIELD_A, CHAPTER_A)).resolves.toBeNull();
  });

  it('reports a failed update as a miss (#2459)', async () => {
    const repo = new SupabaseCustomFieldRepository(
      failingClient({ data: null, error: { code: '57014', message: 'slow' } }),
    );

    await expect(
      repo.update(FIELD_A, CHAPTER_A, { label: 'New' }),
    ).resolves.toBeNull();
  });
});
