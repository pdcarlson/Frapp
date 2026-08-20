import { SupabasePointTransactionRepository } from './supabase-point-transaction.repository';
import {
  CHAPTER_B,
  USER_SHARED,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '../../../../test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `point_transactions` — the points ledger. Every method here
 * already takes a `chapterId`, which is exactly the situation where a dropped
 * predicate is invisible in review: the signature keeps promising a scope the
 * query no longer applies.
 *
 * `countRecentAdjustments` is the one that matters most. It backs the
 * admin-adjustment rate limit, so a count that silently spans chapters does not
 * leak data — it mis-throttles, which is the kind of bug that gets diagnosed as
 * "flaky" for months.
 */

const TXN_A = '0a000000-0000-4000-8000-000000000030';
const TXN_B = '0b000000-0000-4000-8000-000000000030';

const seed = () => ({
  point_transactions: [
    inA({
      id: TXN_A,
      user_id: USER_SHARED,
      amount: 5,
      category: 'MANUAL',
      description: 'Adjustment',
      metadata: { adjusted_by: USER_SHARED },
      created_at: '2026-06-01T00:00:00.000Z',
    }),
    inB({
      id: TXN_B,
      user_id: USER_SHARED,
      amount: 5,
      category: 'MANUAL',
      description: 'Adjustment',
      metadata: { adjusted_by: USER_SHARED },
      created_at: '2026-06-01T00:00:00.000Z',
    }),
  ],
});

describe('SupabasePointTransactionRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabasePointTransactionRepository;

  beforeEach(() => {
    harness = createTenantHarness({ tables: seed() });
    repo = new SupabasePointTransactionRepository(harness.client);
  });

  it('findByChapter returns only the caller chapter ledger', async () => {
    const rows = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B),
    );

    expect(rows.map((r) => r.id)).toEqual([TXN_B]);
  });

  it('findByUser scopes a member ledger to the caller chapter', async () => {
    // The same user earns points in both chapters. `user_id` alone would total
    // their points across every chapter they belong to.
    const rows = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByUser(CHAPTER_B, USER_SHARED),
    );

    expect(rows.map((r) => r.id)).toEqual([TXN_B]);
  });

  it('findByChapterFiltered keeps the chapter predicate alongside optional filters', async () => {
    const rows = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapterFiltered(CHAPTER_B, {
        userId: USER_SHARED,
        category: 'MANUAL',
        limit: 50,
      }),
    );

    expect(rows.map((r) => r.id)).toEqual([TXN_B]);
  });

  it('countRecentAdjustments counts only the caller chapter', async () => {
    const count = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.countRecentAdjustments(
        USER_SHARED,
        CHAPTER_B,
        new Date('2026-01-01T00:00:00.000Z'),
      ),
    );

    // Two identical adjustments exist, one per chapter. A cross-chapter count
    // returns 2 and rate-limits an admin for activity in a chapter they may not
    // even be able to see.
    expect(count).toBe(1);
  });

  it('create writes the ledger row under the caller chapter', async () => {
    const created = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.create({
        id: '0b000000-0000-4000-8000-000000000031',
        chapter_id: CHAPTER_B,
        user_id: USER_SHARED,
        amount: 10,
        category: 'MANUAL',
        description: 'Bonus',
      }),
    );

    expect(created.chapter_id).toBe(CHAPTER_B);
  });
});
