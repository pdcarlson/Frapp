import {
  REPORT_PAGE_SIZE,
  SupabaseReportRepository,
} from './supabase-report.repository';
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
 * The report reads: tenant scope first, then paging and the query contracts a
 * passthrough harness cannot see. The live-PostgREST half of this (the real
 * embeds, the real `max_rows`) is `test/integration/report-queries.integration-spec.ts`.
 */

const EVENT_A = '0a000000-0000-4000-8000-000000000600';
const EVENT_B = '0b000000-0000-4000-8000-000000000600';

const event = (id: string, chapterId: string) => ({
  id,
  chapter_id: chapterId,
  name: 'Meeting',
  start_time: '2026-02-26T10:00:00Z',
});

const seed = () => ({
  events: [
    inA({ id: EVENT_A, name: 'Meeting', start_time: '2026-02-26T10:00:00Z' }),
    inB({ id: EVENT_B, name: 'Meeting', start_time: '2026-02-26T10:00:00Z' }),
  ],
  // `event_attendance` has no chapter column: the read filters on the embedded
  // event, so each row carries the event the real join would embed.
  event_attendance: [
    {
      id: '0a000000-0000-4000-8000-000000000602',
      event_id: EVENT_A,
      status: 'PRESENT',
      check_in_time: null,
      events: event(EVENT_A, CHAPTER_A),
      users: { display_name: 'Ann' },
    },
    {
      id: '0b000000-0000-4000-8000-000000000602',
      event_id: EVENT_B,
      status: 'PRESENT',
      check_in_time: null,
      events: event(EVENT_B, CHAPTER_B),
      users: { display_name: 'Ann' },
    },
  ],
  members: [
    inA({
      id: '0a000000-0000-4000-8000-000000000603',
      user_id: USER_SHARED,
      role_ids: [],
      created_at: '2026-01-15T00:00:00Z',
    }),
    inB({
      id: '0b000000-0000-4000-8000-000000000603',
      user_id: USER_SHARED,
      role_ids: [],
      created_at: '2026-01-15T00:00:00Z',
    }),
  ],
  service_entries: [
    inA({
      id: '0a000000-0000-4000-8000-000000000604',
      user_id: USER_SHARED,
      date: '2026-02-20',
      duration_minutes: 60,
      description: 'Food bank',
      status: 'APPROVED',
    }),
    inB({
      id: '0b000000-0000-4000-8000-000000000604',
      user_id: USER_SHARED,
      date: '2026-02-20',
      duration_minutes: 60,
      description: 'Food bank',
      status: 'APPROVED',
    }),
  ],
});

describe('SupabaseReportRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseReportRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: seed(),
      untenantedTables: ['event_attendance'],
      parentTenant: {
        event_attendance: { column: 'event_id', table: 'events' },
      },
      rpc: {
        get_points_report: {
          data: [
            { member_name: 'Ann', total_points: 3, breakdown_by_category: {} },
          ],
        },
        get_points_leaderboard: {
          data: [{ user_id: USER_SHARED, total: 3 }],
        },
      },
    });
    repo = new SupabaseReportRepository(harness.client);
  });

  it('findAttendance reads only attendance at the caller chapter events', async () => {
    // The tenant predicate rides on the embedded event, so the harness's
    // read-side walk (which finds the embedded `chapter_id`) is the check here.
    const { rows } = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findAttendance(CHAPTER_B, {}, 10),
    );

    expect(rows.map((r) => r.events?.id)).toEqual([EVENT_B]);
  });

  it('findRosterMembers and findServiceEntries stay in the chapter', async () => {
    const members = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findRosterMembers(CHAPTER_B, 10),
    );
    const entries = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findServiceEntries(CHAPTER_B, {}, 10),
    );

    expect(members.rows).toHaveLength(1);
    expect(entries.rows).toHaveLength(1);
  });

  it('both point RPCs carry the caller chapter', async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findPointsTotals(
        CHAPTER_B,
        { userId: null, since: null, until: null },
        10,
      ),
    );
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findMemberBalances(CHAPTER_B, 10),
    );

    // Each read pages, so it ends on one empty trailing call per RPC.
    expect(harness.rpcCalls.map((c) => [c.fn, c.args.p_chapter_id])).toEqual([
      ['get_points_report', CHAPTER_B],
      ['get_points_report', CHAPTER_B],
      ['get_points_leaderboard', CHAPTER_B],
      ['get_points_leaderboard', CHAPTER_B],
    ]);
  });
});

describe('SupabaseReportRepository — paging and query contracts', () => {
  /**
   * A PostgREST-shaped chain that honours `.range()` by actually slicing its
   * backing rows.
   *
   * This is load-bearing, not convenience: a mock that returns the same full
   * page for every `.range()` would either loop forever or make a paging bug
   * invisible. Slicing lets a test hand over more rows than one page and
   * assert all of them came back. `ranges` records what was asked for, so page
   * boundaries can be asserted directly.
   */
  const makeChain = (resolveValue: {
    data: unknown[];
    error: unknown;
    /** Server-side `max_rows`: caps any one page, like PostgREST does. */
    maxRowsCap?: number;
  }) => {
    const chain: Record<string, unknown> = {};
    const ranges: [number, number][] = [];
    let slice: [number, number] | null = null;

    const settle = () => {
      if (resolveValue.error) return { data: null, error: resolveValue.error };
      const rows = resolveValue.data;
      if (!slice) return { data: rows, error: null };
      const page = rows.slice(slice[0], slice[1] + 1);
      return {
        data: resolveValue.maxRowsCap
          ? page.slice(0, resolveValue.maxRowsCap)
          : page,
        error: null,
      };
    };

    Object.assign(chain, {
      select: jest.fn().mockReturnValue(chain),
      eq: jest.fn().mockReturnValue(chain),
      in: jest.fn().mockReturnValue(chain),
      gte: jest.fn().mockReturnValue(chain),
      lte: jest.fn().mockReturnValue(chain),
      order: jest.fn().mockReturnValue(chain),
      range: jest.fn((from: number, to: number) => {
        slice = [from, to];
        ranges.push([from, to]);
        return chain;
      }),
      ranges,
      then: (resolve: (v: unknown) => void) =>
        Promise.resolve(settle()).then(resolve),
    });
    return chain as Record<string, jest.Mock> & { ranges: [number, number][] };
  };

  /** `n` distinct rows, so a paged read can be checked for drops and repeats. */
  const rows = (n: number, build: (i: number) => Record<string, unknown>) =>
    Array.from({ length: n }, (_, i) => build(i));

  const clientWith = (opts: {
    from?: (table: string) => unknown;
    rpc?: (fn: string) => unknown;
  }) => {
    const from = jest.fn(
      opts.from ?? (() => makeChain({ data: [], error: null })),
    );
    const rpc = jest.fn(
      opts.rpc ?? (() => makeChain({ data: [], error: null })),
    );
    return {
      client: { from, rpc } as unknown as FrappSupabaseClient,
      from,
      rpc,
    };
  };

  const attendanceRow = (i: number) => ({
    id: `att-${String(i).padStart(6, '0')}`,
    status: 'PRESENT',
    check_in_time: null,
    events: { id: 'ev-1', name: 'Meeting', start_time: '2026-02-26T10:00:00Z' },
    users: { display_name: `Member ${i}` },
  });

  const LIMIT = 5_000;

  describe('paging past PostgREST max_rows', () => {
    // `supabase/config.toml` caps a single PostgREST response at 1000 rows.
    // Before paging, every report stopped there without saying so. Each test
    // hands the mock more rows than one page and asserts the whole set came
    // back.
    const PAGE = REPORT_PAGE_SIZE;

    it('assembles an attendance read larger than one page, dropping nothing', async () => {
      const chain = makeChain({
        data: rows(PAGE * 2 + 137, attendanceRow),
        error: null,
      });
      const { client } = clientWith({ from: () => chain });

      const result = await new SupabaseReportRepository(client).findAttendance(
        'ch-1',
        {},
        LIMIT,
      );

      expect(result.rows).toHaveLength(PAGE * 2 + 137);
      expect(result.truncated).toBe(false);
      // Distinct members, so a duplicated or skipped page would show up here
      // even if the count happened to line up.
      expect(new Set(result.rows.map((r) => r.users?.display_name)).size).toBe(
        PAGE * 2 + 137,
      );
      // Offsets advance by rows received, and the read ends on an empty page
      // rather than a short one.
      expect(chain.ranges).toEqual([
        [0, 999],
        [1000, 1999],
        [2000, 2999],
        [2137, 3136],
      ]);
    });

    it('stops once a page comes back empty', async () => {
      const chain = makeChain({ data: rows(10, attendanceRow), error: null });
      const { client } = clientWith({ from: () => chain });

      await new SupabaseReportRepository(client).findAttendance(
        'ch-1',
        {},
        LIMIT,
      );

      expect(chain.ranges).toEqual([
        [0, 999],
        [10, 1009],
      ]);
    });

    it('reads every row when the server caps pages below the requested size', async () => {
      // `REPORT_PAGE_SIZE` is a request, not a promise about the server.
      // `supabase/config.toml` governs the local stack only — the hosted
      // project's Max rows is a dashboard setting this code cannot see — so a
      // server capping harder than expected must cost extra trips, never rows.
      // Treating a short page as "the data ran out" is what would silently
      // truncate here, with `truncated: false` attached to it.
      const chain = makeChain({
        data: rows(1200, attendanceRow),
        error: null,
        maxRowsCap: 300,
      });
      const { client } = clientWith({ from: () => chain });

      const result = await new SupabaseReportRepository(client).findAttendance(
        'ch-1',
        {},
        LIMIT,
      );

      expect(result.rows).toHaveLength(1200);
      expect(result.truncated).toBe(false);
      expect(new Set(result.rows.map((r) => r.users?.display_name)).size).toBe(
        1200,
      );
    });

    it('assembles a service-entry read larger than one page', async () => {
      const chain = makeChain({
        data: rows(PAGE + 1, (i) => ({
          id: `se-${i}`,
          user_id: 'u-1',
          date: '2026-02-20',
          duration_minutes: 60,
          description: `Entry ${i}`,
          status: 'APPROVED',
        })),
        error: null,
      });
      const { client } = clientWith({ from: () => chain });

      const result = await new SupabaseReportRepository(
        client,
      ).findServiceEntries('ch-1', {}, LIMIT);

      expect(result.rows).toHaveLength(PAGE + 1);
      expect(result.truncated).toBe(false);
      expect(result.rows[PAGE].description).toBe(`Entry ${PAGE}`);
    });

    it('assembles every page of the balance read', async () => {
      // The sharpest form of this bug: a short balance read does not shorten
      // the roster, it makes the balances on it quietly wrong. An RPC result
      // set is subject to `max_rows` exactly like a table read.
      const TOTAL = PAGE + 500;
      const chain = makeChain({
        data: rows(TOTAL, (i) => ({
          user_id: `u-${String(i).padStart(6, '0')}`,
          total: 7,
        })),
        error: null,
      });
      const { client } = clientWith({ rpc: () => chain });

      const result = await new SupabaseReportRepository(
        client,
      ).findMemberBalances('ch-1', 50_000);

      expect(result.rows).toHaveLength(TOTAL);
      expect(new Set(result.rows.map((r) => r.user_id)).size).toBe(TOTAL);
      expect(result.truncated).toBe(false);
    });

    it('reads every points row when the RPC spans pages', async () => {
      const chain = makeChain({
        data: rows(1200, (i) => ({
          member_name: `Member ${String(i).padStart(5, '0')}`,
          total_points: 1,
          breakdown_by_category: {},
        })),
        error: null,
      });
      const { client } = clientWith({ rpc: () => chain });

      const result = await new SupabaseReportRepository(
        client,
      ).findPointsTotals(
        'ch-1',
        { userId: null, since: null, until: null },
        LIMIT,
      );

      expect(result.rows).toHaveLength(1200);
      expect(new Set(result.rows.map((r) => r.member_name)).size).toBe(1200);
    });

    it('reads every points row when the server caps RPC pages below the request', async () => {
      // The RPC pays a redundant aggregation on its terminating page rather
      // than ending on a short one, precisely so this case reads correctly
      // instead of stopping at the cap and calling itself complete.
      const chain = makeChain({
        data: rows(1200, (i) => ({
          member_name: `Member ${String(i).padStart(5, '0')}`,
          total_points: 1,
          breakdown_by_category: {},
        })),
        error: null,
        maxRowsCap: 200,
      });
      const { client } = clientWith({ rpc: () => chain });

      const result = await new SupabaseReportRepository(
        client,
      ).findPointsTotals(
        'ch-1',
        { userId: null, since: null, until: null },
        LIMIT,
      );

      expect(result.rows).toHaveLength(1200);
      expect(result.truncated).toBe(false);
    });
  });

  describe('the row ceiling', () => {
    const run = async (total: number) => {
      const chain = makeChain({
        data: rows(total, (i) => ({
          id: `se-${String(i).padStart(6, '0')}`,
          user_id: 'u-1',
          date: '2026-02-20',
          duration_minutes: 60,
          description: `Entry ${i}`,
          status: 'APPROVED',
        })),
        error: null,
      });
      const { client } = clientWith({ from: () => chain });
      return new SupabaseReportRepository(client).findServiceEntries(
        'ch-1',
        {},
        LIMIT,
      );
    };

    it('caps the rows and reports truncation past the ceiling', async () => {
      const result = await run(LIMIT + 1);

      expect(result.rows).toHaveLength(LIMIT);
      expect(result.truncated).toBe(true);
    });

    it('does not call a read of exactly the ceiling truncated', async () => {
      // The off-by-one that would matter most: a complete report labelled
      // incomplete teaches officers to ignore the warning.
      const result = await run(LIMIT);

      expect(result.rows).toHaveLength(LIMIT);
      expect(result.truncated).toBe(false);
    });
  });

  describe('the attendance query contract', () => {
    it('names the user_id foreign key so the users embed is unambiguous', async () => {
      // Regression for #746: `event_attendance` reaches `users` through both
      // `user_id` and `marked_by`, so a bare `users(...)` embed is rejected by
      // PostgREST with PGRST201 and the endpoint 500s in every environment.
      // The mock cannot reproduce that, so the select string itself is pinned.
      const chain = makeChain({ data: [], error: null });
      const { client } = clientWith({ from: () => chain });

      await new SupabaseReportRepository(client).findAttendance(
        'ch-1',
        {},
        LIMIT,
      );

      const select = chain.select.mock.calls[0][0] as string;
      expect(select).toContain('users!event_attendance_user_id_fkey');
      expect(select).not.toMatch(/(^|[^!_])\busers\s*\(/);
      // The chapter filter rides on the embedded events resource, which only
      // constrains the parent rows when the join is inner.
      expect(select).toContain('events!inner');
      expect(chain.eq).toHaveBeenCalledWith('events.chapter_id', 'ch-1');
      expect(chain.order).toHaveBeenCalledWith('id', { ascending: true });
    });

    it('filters event and dates on the embedded event, not the attendance row', async () => {
      const chain = makeChain({ data: [], error: null });
      const { client } = clientWith({ from: () => chain });

      await new SupabaseReportRepository(client).findAttendance(
        'ch-1',
        { eventId: 'ev-1', startDate: '2026-01-01', endDate: '2026-05-31' },
        LIMIT,
      );

      expect(chain.eq).toHaveBeenCalledWith('events.id', 'ev-1');
      expect(chain.gte).toHaveBeenCalledWith(
        'events.start_time',
        '2026-01-01T00:00:00.000Z',
      );
      expect(chain.lte).toHaveBeenCalledWith(
        'events.start_time',
        '2026-05-31T23:59:59.999Z',
      );
    });
  });

  describe('the points RPCs', () => {
    it('passes the window bounds as ISO strings and pages on member_name', async () => {
      const chain = makeChain({ data: [], error: null });
      const { client, rpc } = clientWith({ rpc: () => chain });

      await new SupabaseReportRepository(client).findPointsTotals(
        'ch-1',
        {
          userId: 'u-1',
          since: new Date('2026-01-14T23:59:59.999Z'),
          until: null,
        },
        LIMIT,
      );

      expect(rpc).toHaveBeenCalledWith('get_points_report', {
        p_chapter_id: 'ch-1',
        p_user_id: 'u-1',
        p_since: '2026-01-14T23:59:59.999Z',
        p_until: null,
      });
      expect(chain.order).toHaveBeenCalledWith('member_name', {
        ascending: true,
      });
    });

    it('sums balances in Postgres, unbounded, in a total order, never reading point_transactions (#567)', async () => {
      // The roster used to stream every transaction row in and reduce them in
      // Node. A reintroduced `from('point_transactions')` would still produce
      // the right number on a small fixture while restoring the cliff on a
      // real chapter, so the absence of that read is asserted directly.
      const chain = makeChain({ data: [], error: null });
      const { client, from, rpc } = clientWith({ rpc: () => chain });

      await new SupabaseReportRepository(client).findMemberBalances(
        'ch-1',
        50_000,
      );

      expect(from).not.toHaveBeenCalled();
      // Both bounds null: a roster balance is the member's all-time chapter
      // total, and that is what the leaderboard's "no window" case already
      // computes (#1743). A bound leaking in here would silently shorten every
      // balance on the document.
      expect(rpc).toHaveBeenCalledWith('get_points_leaderboard', {
        p_chapter_id: 'ch-1',
        p_since: null,
        p_until: null,
      });
      // A total order, which is what makes the paged read safe. It overrides
      // the function's own `order by total desc` — correct for the leaderboard
      // surface, unusable for paging here, since `total` is not unique.
      expect(chain.order).toHaveBeenCalledWith('user_id', { ascending: true });
    });
  });
});
