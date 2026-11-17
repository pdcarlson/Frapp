import { SupabaseServiceEntryRepository } from './supabase-service-entry.repository';
import type { FrappSupabaseClient } from '../database.types';
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

  it('findByProofPath reads only the caller chapter entries', async () => {
    const path = 'chapters/x/service/p/proof.pdf';
    reseed((entry) => {
      entry.proof_path = path;
    });

    const holder = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByProofPath(CHAPTER_B, path),
    );
    expect(holder?.id).toBe(ENTRY_B);
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

/**
 * A create resent after a lost response, racing the first past the service's
 * lookup, meets `service_entries_chapter_proof_path_key`. The tenant harness
 * cannot reach that: its `insert` appends unconditionally, so it never raises
 * the `23505` the index does.
 */
describe('SupabaseServiceEntryRepository — create when the proof path is taken', () => {
  const PATH = 'chapters/c/service/p/proof.jpg';
  const holder = {
    id: '0c000000-0000-4000-8000-0000000000f0',
    chapter_id: CHAPTER_A,
    user_id: USER_SHARED,
    proof_path: PATH,
  };

  /**
   * Minimal PostgREST double: `.insert(...).select().single()` answers with
   * `insertError`, and the re-read's `.select().eq().eq().order().limit()
   * .maybeSingle()` answers with `reread`. `filters` records its predicates.
   */
  function createClient(options: {
    insertError: unknown;
    reread: Record<string, unknown> | null;
  }) {
    const filters: Array<[string, unknown]> = [];
    const builder: Record<string, unknown> = {
      insert: jest.fn(() => builder),
      select: jest.fn(() => builder),
      order: jest.fn(() => builder),
      limit: jest.fn(() => builder),
      eq: jest.fn((column: string, value: unknown) => {
        filters.push([column, value]);
        return builder;
      }),
      single: jest.fn(() =>
        Promise.resolve({ data: null, error: options.insertError }),
      ),
      maybeSingle: jest.fn(() =>
        Promise.resolve({ data: options.reread, error: null }),
      ),
    };
    const client = {
      from: jest.fn(() => builder),
    } as unknown as FrappSupabaseClient;
    return { client, filters };
  }

  const insert = {
    chapter_id: CHAPTER_A,
    user_id: USER_SHARED,
    date: '2026-05-01',
    duration_minutes: 60,
    description: 'Food bank',
    proof_path: PATH,
  };

  it('returns the entry holding the path instead of surfacing 23505, read in the caller chapter', async () => {
    const { client, filters } = createClient({
      insertError: { code: '23505', message: 'duplicate key value' },
      reread: holder,
    });

    await expect(
      new SupabaseServiceEntryRepository(client).create(insert),
    ).resolves.toEqual(holder);
    expect(filters).toEqual([
      ['chapter_id', CHAPTER_A],
      ['proof_path', PATH],
    ]);
  });

  it('rethrows when the holder vanished between the insert and the re-read', async () => {
    const { client } = createClient({
      insertError: { code: '23505', message: 'duplicate key value' },
      reread: null,
    });

    await expect(
      new SupabaseServiceEntryRepository(client).create(insert),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('rethrows an error that is not a unique violation', async () => {
    const { client, filters } = createClient({
      insertError: { code: '23503', message: 'foreign key violation' },
      reread: holder,
    });

    await expect(
      new SupabaseServiceEntryRepository(client).create(insert),
    ).rejects.toMatchObject({ code: '23503' });
    expect(filters).toEqual([]);
  });
});
