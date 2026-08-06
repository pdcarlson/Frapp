import { Test } from '@nestjs/testing';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import { ScheduledJobsRepository } from './scheduled-jobs.repository';

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

      await repo.releaseDispatch('EVENT', 'evt-1', 'AUTO_ABSENT', '2026-08-05');

      expect(supabase.deleteFilters).toEqual({
        entity_type: 'EVENT',
        entity_id: 'evt-1',
        threshold: 'AUTO_ABSENT',
        due_date: '2026-08-05',
      });
    });
  });
});
