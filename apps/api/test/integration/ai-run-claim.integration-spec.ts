// Two workers never run the same AI run, against the real database (#4310).
//
// The worker and service specs drive an in-memory queue, and the PGlite tier
// (`scripts/pglite/tiers/ai-runs.mjs`) runs the claim's SQL one statement at a
// time on one connection. What only a real Postgres with real connections can
// answer is whether `claim_ai_run`'s `for update skip locked` holds when
// several claims arrive at the same instant, as they do when every API
// replica's cron fires on the same second. Each claim below is its own HTTP
// request, so its own database connection.
//
// Run: `npm run test:integration -w apps/api` (needs a local Supabase stack;
// skips cleanly without one). Not run by CI today (#1568); the PGlite tier is
// the CI-run proof of everything here but the concurrent race.

import { randomUUID } from 'node:crypto';
import { SupabaseAiRunRepository } from '../../src/infrastructure/supabase/repositories/supabase-ai-run.repository';
import type { FrappSupabaseClient } from '../../src/infrastructure/supabase/database.types';
import { createServiceRoleClient, describeIntegration } from './stack';

describeIntegration('AI runs are claimed by one worker at a time', () => {
  let supabase: FrappSupabaseClient;
  let repo: SupabaseAiRunRepository;
  const chapterId = randomUUID();
  const LEASE_MS = 5 * 60_000;
  const WORKERS = 8;

  const assertOk = (label: string, error: { message: string } | null) => {
    if (error) throw new Error(`${label}: ${error.message}`);
  };

  beforeAll(async () => {
    supabase = createServiceRoleClient();
    repo = new SupabaseAiRunRepository(supabase);
    assertOk(
      'chapters',
      (
        await supabase.from('chapters').insert({
          id: chapterId,
          name: `ai-runs-${chapterId.slice(0, 8)}`,
          university: 'Integration Test University',
        } as never)
      ).error,
    );
  });

  afterAll(async () => {
    if (!supabase) return;
    await supabase.from('ai_runs').delete().eq('chapter_id', chapterId);
    await supabase.from('chapters').delete().eq('id', chapterId);
  });

  it('enqueueing one key from many requests at once makes one run', async () => {
    const results = await Promise.all(
      Array.from({ length: WORKERS }, () =>
        repo.enqueue({
          chapterId,
          kind: 'integration_probe',
          dedupeKey: 'race:enqueue',
          requestedBy: null,
          actingUserId: null,
          input: {},
          maxAttempts: 3,
        }),
      ),
    );

    expect(new Set(results.map((run) => run.id)).size).toBe(1);
    const { count, error } = await supabase
      .from('ai_runs')
      .select('id', { count: 'exact', head: true })
      .eq('chapter_id', chapterId)
      .eq('dedupe_key', 'race:enqueue');
    assertOk('count', error);
    expect(count).toBe(1);
  });

  it('many workers claiming at the same instant: exactly one gets the run', async () => {
    // Anything else claimable would be taken by the losing workers, so the
    // spec refuses to run over someone's local queue.
    const { count: others, error: othersError } = await supabase
      .from('ai_runs')
      .select('id', { count: 'exact', head: true })
      .neq('chapter_id', chapterId)
      .in('status', ['queued', 'running']);
    assertOk('other runs', othersError);
    if ((others ?? 0) > 0) {
      throw new Error(
        `ai_runs holds ${others} other claimable runs; clear them before running this spec`,
      );
    }
    // Only the race run is claimable: the enqueue test's run is finished.
    await supabase
      .from('ai_runs')
      .update({ status: 'cancelled', finished_at: new Date().toISOString() })
      .eq('chapter_id', chapterId);
    const target = await repo.enqueue({
      chapterId,
      kind: 'integration_probe',
      dedupeKey: 'race:claim',
      requestedBy: null,
      actingUserId: null,
      input: {},
      maxAttempts: 3,
    });

    const now = new Date();
    const claims = await Promise.all(
      Array.from({ length: WORKERS }, (_, i) =>
        new SupabaseAiRunRepository(supabase).claimNext(
          `race-${i}`,
          now,
          LEASE_MS,
        ),
      ),
    );

    const winners = claims.filter((run) => run?.id === target.id);
    expect(winners).toHaveLength(1);
    expect(claims.filter((run) => run !== null)).toHaveLength(1);

    const { data, error } = await supabase
      .from('ai_runs')
      .select('status, attempt_count, lock_token')
      .eq('id', target.id)
      .single();
    assertOk('read back', error);
    expect(data).toEqual({
      status: 'running',
      attempt_count: 1,
      lock_token: winners[0]!.lock_token,
    });
  });
});
