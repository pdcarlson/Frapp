import { SupabaseEventTypeRepository } from './supabase-event-type.repository';
import {
  CHAPTER_A,
  CHAPTER_B,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `event_types` (#3730). Both chapters have a "Chapter
 * meeting" at position 1, as every chapter is seeded with one, so only a
 * chapter filter tells them apart.
 */

const TYPE_A = '0a000000-0000-4000-8000-000000000080';
const TYPE_B = '0b000000-0000-4000-8000-000000000080';

const row = {
  name: 'Chapter meeting',
  point_value: 10,
  is_mandatory: true,
  position: 1,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const seed = () => ({
  event_types: [inA({ id: TYPE_A, ...row }), inB({ id: TYPE_B, ...row })],
});

describe('SupabaseEventTypeRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseEventTypeRepository;

  beforeEach(() => {
    harness = createTenantHarness({ tables: seed() });
    repo = new SupabaseEventTypeRepository(harness.client);
  });

  it("findByChapter returns only the caller chapter's types", async () => {
    const types = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B),
    );

    expect(types.map((t) => t.id)).toEqual([TYPE_B]);
  });

  it("findById misses another chapter's type", async () => {
    const found = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findById(TYPE_A, CHAPTER_B),
    );

    expect(found).toBeNull();
  });

  it("update leaves another chapter's type alone and reports it missing", async () => {
    const updated = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.update(TYPE_A, CHAPTER_B, { point_value: 99 }),
    );

    expect(updated).toBeUndefined();
    expect(
      harness.rows('event_types').find((r) => r.id === TYPE_A)?.point_value,
    ).toBe(10);
  });

  it("delete leaves another chapter's type alone", async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.delete(TYPE_A, CHAPTER_B),
    );

    expect(harness.rows('event_types').map((r) => r.id)).toContain(TYPE_A);
  });

  it('create writes into the chapter it is given', async () => {
    const created = await repo.create({
      chapter_id: CHAPTER_A,
      name: 'Work party',
      point_value: 5,
      is_mandatory: false,
      position: 2,
    });

    expect(created?.chapter_id).toBe(CHAPTER_A);
  });
});
