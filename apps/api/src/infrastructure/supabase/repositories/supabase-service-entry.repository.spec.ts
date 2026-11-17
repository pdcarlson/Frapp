import { SupabaseServiceEntryRepository } from './supabase-service-entry.repository';
import {
  CHAPTER_B,
  USER_SHARED,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `service_entries` (backs `use-service-entries`).
 *
 * Approving an entry awards points, so both write paths are covered: the
 * `.eq()`-scoped `update` and the `approve_service_entry` RPC, whose only
 * tenancy control is the `p_chapter_id` argument.
 */

const ENTRY_A = '0a000000-0000-4000-8000-0000000000f0';
const ENTRY_B = '0b000000-0000-4000-8000-0000000000f0';

const seed = () => ({
  service_entries: [
    inA({
      id: ENTRY_A,
      user_id: USER_SHARED,
      date: '2026-05-01',
      duration_minutes: 120,
      description: 'Food bank',
      proof_path: null,
      status: 'PENDING',
      reviewed_by: null,
      review_comment: null,
      points_awarded: 0,
      created_at: '2026-01-01T00:00:00.000Z',
    }),
    inB({
      id: ENTRY_B,
      user_id: USER_SHARED,
      date: '2026-05-01',
      duration_minutes: 120,
      description: 'Food bank',
      proof_path: null,
      status: 'PENDING',
      reviewed_by: null,
      review_comment: null,
      points_awarded: 0,
      created_at: '2026-01-01T00:00:00.000Z',
    }),
  ],
});

describe('SupabaseServiceEntryRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseServiceEntryRepository;

  beforeEach(() => {
    harness = createTenantHarness({ tables: seed() });
    repo = new SupabaseServiceEntryRepository(harness.client);
  });

  it('findByChapterFiltered returns only the caller chapter entries', async () => {
    const entries = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapterFiltered(CHAPTER_B, {}),
    );

    expect(entries.map((e) => e.id)).toEqual([ENTRY_B]);
  });

  it('findByChapterFiltered keeps the chapter predicate alongside filters', async () => {
    const entries = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapterFiltered(CHAPTER_B, {
        status: 'PENDING',
        userId: USER_SHARED,
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      }),
    );

    expect(entries.map((e) => e.id)).toEqual([ENTRY_B]);
  });

  it('findById refuses an id belonging to another chapter', async () => {
    const foreign = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findById(ENTRY_A, CHAPTER_B),
    );

    expect(foreign).toBeNull();
  });

  it('rejectIfPending leaves another chapter entry untouched', async () => {
    const rejected = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.rejectIfPending(ENTRY_B, CHAPTER_B, USER_SHARED, 'No receipt'),
    );

    expect(rejected?.status).toBe('REJECTED');
    const rows = harness.rows('service_entries');
    expect(rows.find((e) => e.id === ENTRY_B)?.review_comment).toBe(
      'No receipt',
    );
    expect(rows.find((e) => e.id === ENTRY_A)?.status).toBe('PENDING');
  });

  /** The seed with some entries changed, in a fresh harness. */
  const reseed = (change: (entry: Record<string, unknown>) => void) => {
    const tables = seed();
    tables.service_entries.forEach(change);
    harness = createTenantHarness({ tables });
    repo = new SupabaseServiceEntryRepository(harness.client);
  };

  it('rejectIfPending changes nothing on an entry no longer PENDING', async () => {
    reseed((entry) => {
      entry.status = 'APPROVED';
    });

    await expect(
      harness.expectTenantScoped(CHAPTER_B, () =>
        repo.rejectIfPending(ENTRY_B, CHAPTER_B, USER_SHARED, null),
      ),
    ).resolves.toBeNull();
    expect(
      harness.rows('service_entries').find((e) => e.id === ENTRY_B)?.status,
    ).toBe('APPROVED');
  });

  it('deleteIfPending deletes a PENDING entry in the caller chapter only', async () => {
    const deleted = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.deleteIfPending(ENTRY_B, CHAPTER_B),
    );
    expect(deleted?.id).toBe(ENTRY_B);
    expect(harness.rows('service_entries').map((e) => e.id)).toEqual([ENTRY_A]);
  });

  it('deleteIfPending keeps an entry no longer PENDING', async () => {
    reseed((entry) => {
      entry.status = 'APPROVED';
    });
    await expect(
      harness.expectTenantScoped(CHAPTER_B, () =>
        repo.deleteIfPending(ENTRY_B, CHAPTER_B),
      ),
    ).resolves.toBeNull();
    expect(harness.rows('service_entries')).toHaveLength(2);
  });

  it('countByProofPath counts only the caller chapter entries', async () => {
    const path = 'chapters/x/service/p/proof.pdf';
    reseed((entry) => {
      entry.proof_path = path;
    });

    await expect(
      harness.expectTenantScoped(CHAPTER_B, () =>
        repo.countByProofPath(CHAPTER_B, path),
      ),
    ).resolves.toBe(1);
  });

  it('approveAtomic and leaderboard pass the chapter to their RPCs', async () => {
    harness = createTenantHarness({
      tables: seed(),
      rpc: {
        approve_service_entry: { data: [{ id: ENTRY_B }] },
        get_service_leaderboard: { data: [] },
      },
    });
    repo = new SupabaseServiceEntryRepository(harness.client);

    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.approveAtomic(ENTRY_B, CHAPTER_B, USER_SHARED, null, 10),
    );
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.leaderboard(CHAPTER_B, {}),
    );

    expect(harness.rpcCalls.map((c) => c.args)).toEqual([
      expect.objectContaining({ p_chapter_id: CHAPTER_B }),
      expect.objectContaining({ p_chapter_id: CHAPTER_B }),
    ]);
  });
});
