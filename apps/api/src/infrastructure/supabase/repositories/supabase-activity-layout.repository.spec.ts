import { SupabaseActivityLayoutRepository } from './supabase-activity-layout.repository';
import {
  CHAPTER_A,
  CHAPTER_B,
  USER_A,
  USER_SHARED,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `activity_layouts` (#5520).
 *
 * The table carries its own `chapter_id`, so the ordinary predicate check
 * applies. It has a second scope the harness doesn't know about, `user_id`: a
 * query that filtered the chapter but not the member would pass a tenant
 * check and still hand one member another's arrangement. So the seed gives
 * each chapter a row for the same member and a row for a different member,
 * and both predicates are asserted.
 */

const layout = (overrides: Record<string, unknown>) => ({
  card_order: ['todo', 'calendar'],
  hidden_cards: ['links'],
  created_at: '2026-11-18T00:00:00.000Z',
  updated_at: '2026-11-18T00:00:00.000Z',
  ...overrides,
});

const seed = () => ({
  activity_layouts: [
    inA(layout({ id: 'layout-a', user_id: USER_SHARED })),
    inB(layout({ id: 'layout-b', user_id: USER_SHARED })),
    inA(layout({ id: 'layout-a-other', user_id: USER_A })),
    inB(layout({ id: 'layout-b-other', user_id: USER_A })),
  ],
});

describe('SupabaseActivityLayoutRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseActivityLayoutRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: seed(),
      collisionExempt: {
        // The twins differ on this by construction; everything else matches.
        activity_layouts: ['user_id'],
      },
    });
    repo = new SupabaseActivityLayoutRepository(harness.client);
  });

  it('find stays in the chapter it is given', async () => {
    const row = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.find(CHAPTER_A, USER_SHARED),
    );

    expect(row?.chapter_id).toBe(CHAPTER_A);
    expect(row?.user_id).toBe(USER_SHARED);
  });

  it("find never returns another member's row", async () => {
    const row = await repo.find(CHAPTER_A, USER_A);

    expect((row as { id?: string } | null)?.id).toBe('layout-a-other');
  });

  it('find is null for a member with no row', async () => {
    await expect(
      repo.find(CHAPTER_A, '66666666-6666-4666-8666-666666666666'),
    ).resolves.toBeNull();
  });

  it('upsert rewrites only this member, this chapter', async () => {
    await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.upsert(CHAPTER_A, USER_SHARED, {
        card_order: ['recap'],
        hidden_cards: ['todo', 'calendar'],
      }),
    );

    const row = harness
      .rows('activity_layouts')
      .find((r) => r.id === 'layout-a');
    expect(row).toMatchObject({
      card_order: ['recap'],
      hidden_cards: ['todo', 'calendar'],
    });
    const untouched = harness
      .rows('activity_layouts')
      .filter((r) => r.id !== 'layout-a');
    expect(
      untouched.every((r) => (r.hidden_cards as string[])[0] === 'links'),
    ).toBe(true);
  });

  it('upsert never writes into another chapter', async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.upsert(CHAPTER_B, USER_A, { card_order: [], hidden_cards: [] }),
    );
  });

  it("delete leaves another member's row and the other chapter alone", async () => {
    await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.delete(CHAPTER_A, USER_SHARED),
    );

    expect(
      harness
        .rows('activity_layouts')
        .map((r) => r.id)
        .sort(),
    ).toEqual(['layout-a-other', 'layout-b', 'layout-b-other']);
  });
});
