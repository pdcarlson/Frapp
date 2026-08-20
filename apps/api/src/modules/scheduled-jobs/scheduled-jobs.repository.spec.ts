import { Test } from '@nestjs/testing';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import { ScheduledJobsRepository } from './scheduled-jobs.repository';
import {
  CHAPTER_A,
  CHAPTER_B,
  USER_SHARED,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '../../../test/helpers/tenant-scope.harness';

/** Mirrors `SWEEP_PAGE_SIZE` in the repository under test. */
const PAGE_SIZE = 500;

type Page = { data: unknown[] | null; error: unknown };

/**
 * Minimal PostgREST query-builder stand-in: every filter method returns the
 * builder, and the terminal call resolves. `range` records its bounds so the
 * paging walk itself can be asserted.
 */
function makeSupabase(pages: Page[]) {
  const ranges: Array<[number, number]> = [];
  let pageIndex = 0;
  let insertPayload: Record<string, unknown> | null = null;
  const deleteFilters: Record<string, unknown> = {};
  let deleting = false;

  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'gte', 'lte', 'in', 'or', 'order']) {
    builder[method] = jest.fn(() => builder);
  }

  builder.eq = jest.fn((column: string, value: unknown) => {
    if (deleting) deleteFilters[column] = value;
    return builder;
  });

  builder.range = jest.fn((from: number, to: number) => {
    ranges.push([from, to]);
    return Promise.resolve(pages[pageIndex++] ?? { data: [], error: null });
  });

  builder.insert = jest.fn((payload: Record<string, unknown>) => {
    insertPayload = payload;
    return Promise.resolve(pages[pageIndex++] ?? { error: null });
  });

  builder.delete = jest.fn(() => {
    deleting = true;
    return builder;
  });

  // The delete path awaits the end of the `.eq()` chain rather than a
  // terminal method, so the builder itself has to be thenable.
  builder.then = (resolve: (value: Page) => unknown) =>
    resolve(pages[pageIndex++] ?? { data: null, error: null });

  return {
    client: { from: jest.fn(() => builder) },
    ranges,
    getInsertPayload: () => insertPayload,
    deleteFilters,
  };
}

async function buildRepo(pages: Page[]) {
  const supabase = makeSupabase(pages);
  const mod = await Test.createTestingModule({
    providers: [
      ScheduledJobsRepository,
      { provide: SUPABASE_CLIENT, useValue: supabase.client },
    ],
  }).compile();
  return { repo: mod.get(ScheduledJobsRepository), supabase };
}

function rows(count: number, base: Record<string, unknown> = {}) {
  return Array.from({ length: count }, (_, i) => ({
    id: `row-${i}`,
    chapter_id: 'chap-1',
    ...base,
  }));
}

describe('ScheduledJobsRepository', () => {
  describe('paging', () => {
    // PostgREST caps responses at max_rows and reports truncation as a plain
    // 200 with a null error, so an unpaged read drops rows silently.
    it('keeps reading until a page comes back short', async () => {
      const { repo, supabase } = await buildRepo([
        { data: rows(PAGE_SIZE, { due_date: '2026-08-06' }), error: null },
        { data: rows(7, { due_date: '2026-08-06' }), error: null },
      ]);

      const result = await repo.findOpenInvoicesDueBetween(
        '2026-08-01',
        '2026-08-06',
      );

      expect(result).toHaveLength(PAGE_SIZE + 7);
      expect(supabase.ranges).toEqual([
        [0, PAGE_SIZE - 1],
        [PAGE_SIZE, PAGE_SIZE * 2 - 1],
      ]);
    });

    it('terminates when the row count is an exact multiple of the page size', async () => {
      const { repo, supabase } = await buildRepo([
        { data: rows(PAGE_SIZE, { due_date: '2026-08-06' }), error: null },
        { data: [], error: null },
      ]);

      const result = await repo.findOpenInvoicesDueBetween(
        '2026-08-01',
        '2026-08-06',
      );

      expect(result).toHaveLength(PAGE_SIZE);
      expect(supabase.ranges).toHaveLength(2);
    });

    it('reads a single page without asking for a second', async () => {
      const { repo, supabase } = await buildRepo([
        { data: rows(3, { due_date: '2026-08-06' }), error: null },
      ]);

      await repo.findOpenInvoicesDueBetween('2026-08-01', '2026-08-06');

      expect(supabase.ranges).toEqual([[0, PAGE_SIZE - 1]]);
    });

    // A partial batch is worse than none: the sweep would treat the missing
    // rows as "nothing to do" and the next tick would not revisit them.
    it('returns nothing when a later page errors, rather than a partial batch', async () => {
      const { repo } = await buildRepo([
        { data: rows(PAGE_SIZE, { due_date: '2026-08-06' }), error: null },
        { data: null, error: { message: 'connection reset' } },
      ]);

      const result = await repo.findOpenInvoicesDueBetween(
        '2026-08-01',
        '2026-08-06',
      );

      expect(result).toEqual([]);
    });
  });

  describe('findEventsPendingAutoAbsent', () => {
    it('drops events whose required_role_ids is an empty array', async () => {
      const { repo } = await buildRepo([
        {
          data: [
            {
              id: 'evt-mandatory',
              chapter_id: 'chap-1',
              end_time: '2026-08-05T10:00:00Z',
              is_mandatory: true,
              required_role_ids: null,
            },
            {
              id: 'evt-targeted',
              chapter_id: 'chap-1',
              end_time: '2026-08-05T10:00:00Z',
              is_mandatory: false,
              required_role_ids: ['role-1'],
            },
            {
              // Cleared multi-select: stored as [], not null, so the
              // `not.is.null` filter still matches it server-side.
              id: 'evt-empty-target',
              chapter_id: 'chap-1',
              end_time: '2026-08-05T10:00:00Z',
              is_mandatory: false,
              required_role_ids: [],
            },
          ],
          error: null,
        },
      ]);

      const result = await repo.findEventsPendingAutoAbsent(
        new Date('2026-08-04T12:00:00Z'),
        new Date('2026-08-05T11:45:00Z'),
      );

      expect(result.map((e) => e.id)).toEqual([
        'evt-mandatory',
        'evt-targeted',
      ]);
      // The service only needs these three fields; the filter columns stay in
      // the repository.
      expect(result[0]).toEqual({
        id: 'evt-mandatory',
        chapter_id: 'chap-1',
        end_time: '2026-08-05T10:00:00Z',
      });
    });
  });

  describe('claimDispatch', () => {
    it('claims the reminder and records the due date in the key', async () => {
      const { repo, supabase } = await buildRepo([{ data: null, error: null }]);

      const claimed = await repo.claimDispatch(
        'chap-1',
        'INVOICE',
        'inv-1',
        'DUE_SOON',
        '2026-08-06',
      );

      expect(claimed).toBe(true);
      expect(supabase.getInsertPayload()).toEqual({
        chapter_id: 'chap-1',
        entity_type: 'INVOICE',
        entity_id: 'inv-1',
        threshold: 'DUE_SOON',
        due_date: '2026-08-06',
      });
    });

    it('loses the claim on a unique violation without treating it as an error', async () => {
      const { repo } = await buildRepo([
        { data: null, error: { code: '23505' } },
      ]);

      await expect(
        repo.claimDispatch('chap-1', 'TASK', 'task-1', 'OVERDUE', '2026-08-04'),
      ).resolves.toBe(false);
    });

    // An insert whose outcome is unknown must not authorize a send: a
    // duplicate reminder is worse than a missed one.
    it('does not claim when the insert fails for any other reason', async () => {
      const { repo } = await buildRepo([
        { data: null, error: { code: '08006', message: 'connection failure' } },
      ]);

      await expect(
        repo.claimDispatch('chap-1', 'TASK', 'task-1', 'OVERDUE', '2026-08-04'),
      ).resolves.toBe(false);
    });
  });

  describe('releaseDispatch', () => {
    it('deletes exactly the claimed row', async () => {
      const { repo, supabase } = await buildRepo([{ data: null, error: null }]);

      await repo.releaseDispatch(
        'chap-1',
        'EVENT',
        'evt-1',
        'AUTO_ABSENT',
        '2026-08-05',
      );

      expect(supabase.deleteFilters).toEqual({
        chapter_id: 'chap-1',
        entity_type: 'EVENT',
        entity_id: 'evt-1',
        threshold: 'AUTO_ABSENT',
        due_date: '2026-08-05',
      });
    });
  });
});

/**
 * Tenant-scope half of this file. Sweeps (`findEventsPendingAutoAbsent`,
 * invoice/task due windows) are cross-chapter by design: the worker has no
 * caller chapter and pages every tenant. Those paths are characterised as
 * unscoped, not asserted with `expectTenantScoped`.
 *
 * `claimDispatch` and `releaseDispatch` are the tenant-bound writes: they
 * insert and delete `scheduled_notification_dispatches` with the chapter
 * taken from the sweep row, not from ambient context. A colliding twin in
 * another chapter is neither claimed nor released.
 */

const EVENT_A = '0a000000-0000-4000-8000-000000000220';
const EVENT_B = '0b000000-0000-4000-8000-000000000220';
const INVOICE_A = '0a000000-0000-4000-8000-000000000221';
const INVOICE_B = '0b000000-0000-4000-8000-000000000221';
const DISPATCH_A = '0a000000-0000-4000-8000-000000000222';
const DISPATCH_B = '0b000000-0000-4000-8000-000000000222';
const DISPATCH_ENTITY = '0c000000-0000-4000-8000-000000000223';

const tenantSeed = () => ({
  events: [
    inA({
      id: EVENT_A,
      name: 'Chapter meeting',
      description: null,
      location: 'House',
      start_time: '2026-09-01T18:00:00.000Z',
      end_time: '2026-09-01T19:00:00.000Z',
      point_value: 10,
      is_mandatory: true,
      required_role_ids: [],
      created_at: '2026-01-01T00:00:00.000Z',
    }),
    inB({
      id: EVENT_B,
      name: 'Chapter meeting',
      description: null,
      location: 'House',
      start_time: '2026-09-01T18:00:00.000Z',
      end_time: '2026-09-01T19:00:00.000Z',
      point_value: 10,
      is_mandatory: true,
      required_role_ids: [],
      created_at: '2026-01-01T00:00:00.000Z',
    }),
  ],
  financial_invoices: [
    inA({
      id: INVOICE_A,
      user_id: USER_SHARED,
      title: 'Dues',
      description: null,
      amount: 25000,
      status: 'OPEN',
      due_date: '2026-09-15',
      paid_at: null,
      stripe_payment_intent_id: null,
      created_at: '2026-01-01T00:00:00.000Z',
    }),
    inB({
      id: INVOICE_B,
      user_id: USER_SHARED,
      title: 'Dues',
      description: null,
      amount: 25000,
      status: 'OPEN',
      due_date: '2026-09-15',
      paid_at: null,
      stripe_payment_intent_id: null,
      created_at: '2026-01-01T00:00:00.000Z',
    }),
  ],
  scheduled_notification_dispatches: [
    inA({
      id: DISPATCH_A,
      entity_type: 'INVOICE',
      entity_id: DISPATCH_ENTITY,
      threshold: 'DUE_SOON',
      due_date: '2026-09-01',
      dispatched_at: '2026-08-31T12:00:00.000Z',
    }),
    inB({
      id: DISPATCH_B,
      entity_type: 'INVOICE',
      entity_id: DISPATCH_ENTITY,
      threshold: 'DUE_SOON',
      due_date: '2026-09-01',
      dispatched_at: '2026-08-31T12:00:00.000Z',
    }),
  ],
});

describe('ScheduledJobsRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: ScheduledJobsRepository;

  beforeEach(() => {
    harness = createTenantHarness({ tables: tenantSeed() });
    repo = new ScheduledJobsRepository(harness.client);
  });

  it('findEventsPendingAutoAbsent is a cross-chapter sweep (characterised)', async () => {
    const rows = await repo.findEventsPendingAutoAbsent(
      new Date('2026-09-01T00:00:00.000Z'),
      new Date('2026-09-02T00:00:00.000Z'),
    );

    expect(rows.map((r) => r.id).sort()).toEqual([EVENT_A, EVENT_B].sort());
    const [op] = harness.ops;
    expect(op.filters.some((f) => f.column === 'chapter_id')).toBe(false);
  });

  it('findOpenInvoicesDueBetween is a cross-chapter sweep (characterised)', async () => {
    const rows = await repo.findOpenInvoicesDueBetween(
      '2026-09-01',
      '2026-09-30',
    );

    expect(rows.map((r) => r.id).sort()).toEqual([INVOICE_A, INVOICE_B].sort());
    const [op] = harness.ops;
    expect(op.filters.some((f) => f.column === 'chapter_id')).toBe(false);
  });

  it('claimDispatch writes the dispatch row under the given chapter', async () => {
    const claimed = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.claimDispatch(
        CHAPTER_B,
        'EVENT',
        EVENT_B,
        'AUTO_ABSENT',
        '2026-09-01',
      ),
    );

    expect(claimed).toBe(true);
    const inserted = harness
      .rows('scheduled_notification_dispatches')
      .filter((r) => r.entity_type === 'EVENT');
    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.chapter_id).toBe(CHAPTER_B);
    expect(
      harness
        .rows('scheduled_notification_dispatches')
        .find((r) => r.id === DISPATCH_A)?.chapter_id,
    ).toBe(CHAPTER_A);
  });

  it('releaseDispatch leaves another chapter dispatch in place', async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.releaseDispatch(
        CHAPTER_B,
        'INVOICE',
        DISPATCH_ENTITY,
        'DUE_SOON',
        '2026-09-01',
      ),
    );

    const remaining = harness.rows('scheduled_notification_dispatches');
    expect(remaining.map((r) => r.id).sort()).toEqual([DISPATCH_A]);
    expect(remaining[0]?.chapter_id).toBe(CHAPTER_A);
  });
});
