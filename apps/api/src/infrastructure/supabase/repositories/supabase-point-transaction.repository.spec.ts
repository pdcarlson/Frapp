import { SupabasePointTransactionRepository } from './supabase-point-transaction.repository';
import {
  CHAPTER_B,
  USER_SHARED,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

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
const SHARED_KEY = '0c000000-0000-4000-8000-000000000030';

const seed = () => ({
  point_transactions: [
    inA({
      id: TXN_A,
      user_id: USER_SHARED,
      amount: 5,
      category: 'MANUAL',
      description: 'Adjustment',
      metadata: { adjusted_by: USER_SHARED },
      // Both chapters carry the SAME idempotency key. The dedupe index is
      // scoped `(chapter_id, client_message_id)`, so this is legal — and it is
      // what makes the lookup's chapter predicate testable.
      client_message_id: SHARED_KEY,
      created_at: '2026-06-01T00:00:00.000Z',
    }),
    inB({
      id: TXN_B,
      user_id: USER_SHARED,
      amount: 5,
      category: 'MANUAL',
      description: 'Adjustment',
      metadata: { adjusted_by: USER_SHARED },
      client_message_id: SHARED_KEY,
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

  it('findByClientMessageId resolves the key within the caller chapter only', async () => {
    // #1719: this lookup decides whether an adjustment already committed. If it
    // dropped the chapter predicate, chapter B's replay would return chapter
    // A's row and the officer would be told a grant landed that never did —
    // and a legitimate first grant would be silently refused as a duplicate.
    const row = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByClientMessageId(CHAPTER_B, SHARED_KEY),
    );

    expect(row?.id).toBe(TXN_B);
  });

  it('findByClientMessageId returns null for an unused key', async () => {
    const row = await repo.findByClientMessageId(
      CHAPTER_B,
      '0d000000-0000-4000-8000-000000000030',
    );

    expect(row).toBeNull();
  });
});

describe('SupabasePointTransactionRepository — dedupe error mapping', () => {
  const KEY = '0c000000-0000-4000-8000-000000000030';

  /** A client whose insert fails with one given PostgREST error. */
  const clientRejecting = (error: unknown) =>
    ({
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => ({ data: null, error }),
          }),
        }),
      }),
    }) as never;

  it('maps a unique violation to PointTransactionDuplicateError', async () => {
    // The service relies on the TYPE, not the code, to tell "already granted"
    // from a real failure. If this mapping regressed to a bare throw, a replay
    // would 500 instead of returning the original row.
    const repo = new SupabasePointTransactionRepository(
      clientRejecting({ code: '23505', message: 'duplicate key value' }),
    );

    await expect(
      repo.create({
        chapter_id: CHAPTER_B,
        user_id: USER_SHARED,
        amount: 5,
        category: 'MANUAL',
        client_message_id: KEY,
      }),
    ).rejects.toMatchObject({
      name: 'PointTransactionDuplicateError',
      chapter_id: CHAPTER_B,
      client_message_id: KEY,
    });
  });

  it('rethrows a non-unique-violation error unchanged', async () => {
    const original = { code: '23503', message: 'foreign key violation' };
    const repo = new SupabasePointTransactionRepository(
      clientRejecting(original),
    );

    await expect(
      repo.create({
        chapter_id: CHAPTER_B,
        user_id: USER_SHARED,
        amount: 5,
        category: 'MANUAL',
        client_message_id: KEY,
      }),
    ).rejects.toBe(original);
  });

  it('rethrows a unique violation carrying no key rather than mislabelling it', async () => {
    // A 23505 on a dashboard adjustment cannot be this index — it sends no key.
    // Reporting it as a dedupe would send the service looking for an original
    // that does not exist.
    const original = { code: '23505', message: 'some other unique index' };
    const repo = new SupabasePointTransactionRepository(
      clientRejecting(original),
    );

    await expect(
      repo.create({
        chapter_id: CHAPTER_B,
        user_id: USER_SHARED,
        amount: 5,
        category: 'MANUAL',
      }),
    ).rejects.toBe(original);
  });
});
