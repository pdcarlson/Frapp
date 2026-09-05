// `get_points_leaderboard` against a real PostgREST + Postgres.
//
// `points.service.spec.ts` proves the SERVICE resolves the right `(since,
// until]` bounds. It cannot prove the SQL applies them, because it swaps the
// repository for a TypeScript transcription of the function — flip `>` to `>=`
// in the migration and every one of those tests still passes.
//
// That gap is not hypothetical here. #522 moved the leaderboard aggregation
// out of Node and into this function, which means the chapter predicate that
// carries tenant isolation, the bound comparisons, and the ordering are now all
// SQL. `CREATE FUNCTION` on a plpgsql body is only a syntax check — identifier
// resolution and `ORDER BY` semantics are deferred to the first call — so the
// PGlite gate applying the migration proves none of it either.
//
// So this suite asserts the things only a real server can answer, mirroring
// `report-queries.integration-spec.ts`, which exists for the same reason on the
// sibling `get_points_report` (#746 shipped a 500 through a green mocked suite).
//
// Run: `npm run test:integration -w apps/api` (needs a local Supabase stack;
// skips cleanly without one).

import { randomUUID } from 'node:crypto';
import type { FrappSupabaseClient } from '../../src/infrastructure/supabase/database.types';
import { createServiceRoleClient, describeIntegration } from './stack';

/**
 * Instants used by the bound tests.
 *
 * `ON_BOUND` is the one that matters: a row sits at exactly this instant, and
 * the same value is passed as `p_since` in one test and `p_until` in another.
 * An inclusive/exclusive mix-up therefore shows up as a row appearing on the
 * wrong side rather than as a count that is merely off.
 */
const EARLY = '2026-01-01T00:00:00.000Z';
const ON_BOUND = '2026-03-01T00:00:00.000Z';
const LATE = '2026-09-01T00:00:00.000Z';

interface Fixture {
  chapterId: string;
  otherChapterId: string;
  /** Ranked members of the primary chapter. */
  alice: string;
  bob: string;
  /** Two members deliberately given equal totals, to pin the tie-break. */
  tieLow: string;
  tieHigh: string;
  cleanup: () => Promise<void>;
}

const assertOk = (label: string, error: { message: string } | null): void => {
  if (error) throw new Error(`${label}: ${error.message}`);
};

/**
 * Two chapters holding deliberately overlapping data.
 *
 * The same user earns points in both, and the other chapter's amounts are far
 * larger than anything in the primary one — so a query that lost its
 * `chapter_id` predicate produces a visibly wrong board (a stranger at the top)
 * rather than merely a longer one.
 */
async function seed(supabase: FrappSupabaseClient): Promise<Fixture> {
  const runTag = `lb-${randomUUID().slice(0, 8)}`;
  const chapterId = randomUUID();
  const otherChapterId = randomUUID();

  const { error: chapterError } = await supabase.from('chapters').insert([
    { id: chapterId, name: `${runTag} Primary`, university: 'Test University' },
    {
      id: otherChapterId,
      name: `${runTag} Other`,
      university: 'Test University',
    },
  ]);
  assertOk('insert chapters', chapterError);

  // Ids are sorted so the tie-break assertion can name which of the two equal
  // scorers must come first without depending on how randomUUID happened to
  // order them.
  const [tieHigh, tieLow] = [randomUUID(), randomUUID()].sort();
  const alice = randomUUID();
  const bob = randomUUID();

  const users = [alice, bob, tieHigh, tieLow].map((id, i) => ({
    id,
    supabase_auth_id: randomUUID(),
    email: `${runTag}-${i}@example.test`,
    display_name: `${runTag} ${i}`,
  }));
  const { error: userError } = await supabase.from('users').insert(users);
  assertOk('insert users', userError);

  const txn = (
    chapter: string,
    user: string,
    amount: number,
    created_at: string,
  ) => ({
    chapter_id: chapter,
    user_id: user,
    amount,
    category: 'MANUAL' as const,
    description: runTag,
    created_at,
  });

  const { error: txnError } = await supabase.from('point_transactions').insert([
    // alice: 10 early + 5 late = 15 all-time
    txn(chapterId, alice, 10, EARLY),
    txn(chapterId, alice, 5, LATE),
    // bob: 30 sitting exactly ON the shared boundary instant
    txn(chapterId, bob, 30, ON_BOUND),
    // A fine, so a negative total is exercised end to end.
    txn(chapterId, bob, -35, LATE),
    // Two members tied at 7 apiece.
    txn(chapterId, tieHigh, 7, EARLY),
    txn(chapterId, tieLow, 7, EARLY),
    // The same user, scoring far higher, in a chapter this board must not see.
    txn(otherChapterId, alice, 9_999, EARLY),
  ]);
  assertOk('insert point_transactions', txnError);

  const cleanup = async (): Promise<void> => {
    // Chapters first: the cascade clears the rows referencing users, so the
    // user delete cannot trip a foreign key.
    const { error: chapterCleanup } = await supabase
      .from('chapters')
      .delete()
      .in('id', [chapterId, otherChapterId]);
    const { error: userCleanup } = await supabase
      .from('users')
      .delete()
      .like('email', `${runTag}-%`);

    // Warn rather than throw: this runs in `afterAll`, where throwing would
    // mask whichever real assertion the run was reporting. Silence instead
    // would leave rows behind on a stack other runs share.
    for (const [label, error] of [
      ['chapters', chapterCleanup],
      ['users', userCleanup],
    ] as const) {
      if (error) {
        console.warn(
          `[integration] leaderboard fixture cleanup: deleting ${label} failed — ` +
            `${error.message}. Rows tagged '${runTag}' may remain in the local stack.`,
        );
      }
    }
  };

  return { chapterId, otherChapterId, alice, bob, tieHigh, tieLow, cleanup };
}

describeIntegration('get_points_leaderboard against live PostgREST', () => {
  let supabase: FrappSupabaseClient;
  let fixture: Fixture;

  const leaderboard = async (
    chapterId: string,
    since: string | null = null,
    until: string | null = null,
  ) => {
    const { data, error } = await supabase.rpc('get_points_leaderboard', {
      p_chapter_id: chapterId,
      p_since: since,
      p_until: until,
    });
    assertOk('get_points_leaderboard', error);
    return data ?? [];
  };

  beforeAll(async () => {
    supabase = createServiceRoleClient();
    fixture = await seed(supabase);
  }, 60_000);

  afterAll(async () => {
    await fixture?.cleanup();
  }, 60_000);

  it('resolves and returns rows at all — the function body actually runs', async () => {
    // The migration only proves this parses. `RETURNS TABLE (user_id, total)`
    // makes both names OUT parameters that collide with `point_transactions`'
    // own `user_id` column and with the `sum()` alias, and plpgsql resolves
    // that at call time. An unqualified reference would 500 here and nowhere
    // else in the test suite.
    const rows = await leaderboard(fixture.chapterId);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('sums per member over all time when both bounds are null', async () => {
    const rows = await leaderboard(fixture.chapterId);
    const totals = Object.fromEntries(rows.map((r) => [r.user_id, r.total]));

    expect(totals[fixture.alice]).toBe(15);
    expect(totals[fixture.bob]).toBe(-5); // 30 − 35: negatives survive
    expect(totals[fixture.tieHigh]).toBe(7);
    expect(totals[fixture.tieLow]).toBe(7);
  });

  it('scopes to the requested chapter', async () => {
    // Alice holds 9,999 points in the other chapter. If the predicate were
    // lost she would top this board with that total instead of holding 15.
    const rows = await leaderboard(fixture.chapterId);

    expect(rows).toHaveLength(4);
    expect(rows.find((r) => r.user_id === fixture.alice)?.total).toBe(15);
    expect(rows.every((r) => r.total !== 9_999)).toBe(true);

    const other = await leaderboard(fixture.otherChapterId);
    expect(other).toEqual([{ user_id: fixture.alice, total: 9_999 }]);
  });

  it('treats p_since as EXCLUSIVE', async () => {
    // Bob's only positive row sits exactly on ON_BOUND, so an off-by-one to
    // `>=` would put his 30 back on the board.
    const rows = await leaderboard(fixture.chapterId, ON_BOUND);
    const bob = rows.find((r) => r.user_id === fixture.bob);

    expect(bob?.total).toBe(-35);
  });

  it('treats p_until as INCLUSIVE', async () => {
    // Same instant, other side: here Bob's 30 must be counted, and his later
    // fine must not be.
    const rows = await leaderboard(fixture.chapterId, null, ON_BOUND);
    const bob = rows.find((r) => r.user_id === fixture.bob);

    expect(bob?.total).toBe(30);
  });

  it('applies both bounds together as a half-open range', async () => {
    const rows = await leaderboard(fixture.chapterId, EARLY, ON_BOUND);
    const totals = Object.fromEntries(rows.map((r) => [r.user_id, r.total]));

    // EARLY itself is excluded, so alice's 10 and both 7s drop out; only bob's
    // row on the upper bound survives.
    expect(totals).toEqual({ [fixture.bob]: 30 });
  });

  it('orders by total descending, breaking ties by user_id ascending', async () => {
    const rows = await leaderboard(fixture.chapterId);

    // Ordering is asserted on the server's row order, not re-sorted here: the
    // API passes this array through untouched and the web Points page derives
    // rank from the index, so the order PostgREST returns IS the rank.
    expect(rows.map((r) => r.total)).toEqual([15, 7, 7, -5]);
    expect(rows[0].user_id).toBe(fixture.alice);
    expect(rows[1].user_id).toBe(fixture.tieHigh);
    expect(rows[2].user_id).toBe(fixture.tieLow);
    expect(rows[3].user_id).toBe(fixture.bob);
  });

  it('returns an empty board for a chapter with no transactions in the window', async () => {
    const rows = await leaderboard(fixture.chapterId, LATE);
    expect(rows).toEqual([]);
  });
});
