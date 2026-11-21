import { SupabaseAiRunRepository } from './supabase-ai-run.repository';
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
 * Tenant scope for `ai_runs` (#4310).
 *
 * The A/B twins agree on everything but their chapter: same kind, same key,
 * same members. So a member read that drops the chapter predicate reaches the
 * other chapter's twin. The worker's writes after a claim are the exception
 * on purpose: one worker serves every chapter, and what scopes those writes is
 * the claim's `lock_token`, which is unique per claim. That is pinned below
 * as its own rule.
 *
 * Enqueue and claim are database functions, whose SQL the PGlite gate runs
 * (`scripts/pglite/tiers/ai-runs.mjs`); here only their arguments are seen.
 */

const RUN = '0a000000-0000-4000-8000-000000004310';
const TOKEN = '0b000000-0000-4000-8000-000000004310';
const NOW = new Date('2026-11-12T10:00:00.000Z');

const run = (overrides: Record<string, unknown> = {}) => ({
  kind: 'minutes_draft',
  dedupe_key: 'meeting:1',
  status: 'running',
  requested_by: USER_SHARED,
  acting_user_id: USER_SHARED,
  input_ref: {},
  result_ref: null,
  attempt_count: 1,
  max_attempts: 3,
  failure_reason: null,
  lock_token: TOKEN,
  locked_by: 'worker',
  lease_expires_at: '2026-11-12T10:05:00.000Z',
  created_at: '2026-11-12T09:59:00.000Z',
  updated_at: '2026-11-12T10:00:00.000Z',
  started_at: '2026-11-12T10:00:00.000Z',
  finished_at: null,
  ...overrides,
});

const seed = () => ({
  ai_runs: [
    inA({ id: 'run-a', ...run() }),
    inB({ id: 'run-b', ...run() }),
    inA({
      id: 'run-a-other',
      ...run({ requested_by: USER_A, acting_user_id: USER_A }),
    }),
    inB({
      id: 'run-b-other',
      ...run({ requested_by: USER_A, acting_user_id: USER_A }),
    }),
    // Indexing acts for whoever last changed a source; nobody asked (#4504).
    inA({
      id: 'run-a-upkeep',
      ...run({
        kind: 'corpus_index',
        requested_by: null,
        acting_user_id: USER_SHARED,
      }),
    }),
    inB({
      id: 'run-b-upkeep',
      ...run({
        kind: 'corpus_index',
        requested_by: null,
        acting_user_id: USER_SHARED,
      }),
    }),
  ],
});

describe('SupabaseAiRunRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseAiRunRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: seed(),
      rpc: {
        enqueue_ai_run: {
          data: [inA({ id: RUN, ...run({ status: 'queued' }) })],
        },
        claim_ai_run: { data: [] },
      },
    });
    repo = new SupabaseAiRunRepository(harness.client);
  });

  describe('member reads', () => {
    it('findById reads only inside the chapter', async () => {
      const found = await harness.expectTenantScoped(CHAPTER_A, () =>
        repo.findById(CHAPTER_A, 'run-a'),
      );
      expect(found).toEqual(expect.objectContaining({ chapter_id: CHAPTER_A }));
      await expect(repo.findById(CHAPTER_A, 'run-b')).resolves.toBeNull();
    });

    it('listForMember returns the member’s runs in the chapter, and no one else’s', async () => {
      const rows = await harness.expectTenantScoped(CHAPTER_A, () =>
        repo.listForMember(CHAPTER_A, USER_SHARED, { limit: 20 }),
      );
      expect(rows.map((row) => row.id).sort()).toEqual([
        'run-a',
        'run-a-upkeep',
      ]);
    });

    it('listForMember leaves out upkeep runs that only act for the member (#4504)', async () => {
      const rows = await harness.expectTenantScoped(CHAPTER_A, () =>
        repo.listForMember(CHAPTER_A, USER_SHARED, {
          limit: 20,
          upkeepKinds: ['corpus_index'],
        }),
      );
      expect(rows.map((row) => row.id)).toEqual(['run-a']);
    });

    it('listForMember filters by kind when asked', async () => {
      const rows = await harness.expectTenantScoped(CHAPTER_A, () =>
        repo.listForMember(CHAPTER_A, USER_SHARED, {
          kind: 'document_index',
          limit: 20,
        }),
      );
      expect(rows).toEqual([]);
    });

    it('cancel reaches only the chapter’s run', async () => {
      const cancelled = await harness.expectTenantScoped(CHAPTER_A, () =>
        repo.cancel(CHAPTER_A, 'run-a', NOW),
      );
      expect(cancelled).toBe(true);
      const statuses = Object.fromEntries(
        harness.rows('ai_runs').map((row) => [row.id, row.status]),
      );
      expect(statuses).toEqual({
        'run-a': 'cancelled',
        'run-b': 'running',
        'run-a-other': 'running',
        'run-b-other': 'running',
        'run-a-upkeep': 'running',
        'run-b-upkeep': 'running',
      });
      expect(harness.rows('ai_runs').find((row) => row.id === 'run-a')).toEqual(
        expect.objectContaining({
          lock_token: null,
          finished_at: NOW.toISOString(),
        }),
      );
    });
  });

  describe('enqueue', () => {
    it('passes the chapter as p_chapter_id, and the input as given', async () => {
      await repo.enqueue({
        chapterId: CHAPTER_A,
        kind: 'minutes_draft',
        dedupeKey: 'meeting:1',
        requestedBy: USER_A,
        actingUserId: USER_A,
        input: { meeting_id: RUN },
        maxAttempts: 3,
      });
      expect(harness.rpcCalls).toEqual([
        {
          fn: 'enqueue_ai_run',
          args: {
            p_chapter_id: CHAPTER_A,
            p_kind: 'minutes_draft',
            p_dedupe_key: 'meeting:1',
            p_requested_by: USER_A,
            p_acting_user_id: USER_A,
            p_input_ref: { meeting_id: RUN },
            p_max_attempts: 3,
          },
        },
      ]);
    });
  });

  describe('the worker’s writes', () => {
    it('claimNext sends the lease in whole seconds and the kinds served, and reads an empty answer as nothing to do', async () => {
      await expect(
        repo.claimNext('w1', NOW, 300_000, ['minutes_draft']),
      ).resolves.toBeNull();
      expect(harness.rpcCalls).toEqual([
        {
          fn: 'claim_ai_run',
          args: {
            p_worker_id: 'w1',
            p_now: NOW.toISOString(),
            p_lease_seconds: 300,
            p_kinds: ['minutes_draft'],
          },
        },
      ]);
    });

    it('claimNext with no kinds served asks nothing', async () => {
      await expect(repo.claimNext('w1', NOW, 300_000, [])).resolves.toBeNull();
      expect(harness.rpcCalls).toEqual([]);
    });

    it('scopes every write after a claim to the run, its lock token, and running', async () => {
      await repo.renewLease('run-a', TOKEN, NOW, 300_000);
      await repo.retryLater(
        'run-a',
        TOKEN,
        new Date('2026-11-12T10:01:00.000Z'),
        NOW,
      );
      await repo.complete('run-b', TOKEN, null, NOW);
      await repo.fail('run-a-other', TOKEN, 'source_gone', NOW);
      await repo.release('run-a', TOKEN, 0, null, NOW);

      const writes = harness.ops.filter((op) => op.mode === 'update');
      expect(writes).toHaveLength(5);
      for (const op of writes) {
        expect(op.filters).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ column: 'lock_token', value: TOKEN }),
            expect.objectContaining({ column: 'status', value: 'running' }),
          ]),
        );
      }
    });

    it('a worker holding a stale token writes nothing', async () => {
      const written = await repo.complete(
        'run-a',
        '0c000000-0000-4000-8000-000000000000',
        null,
        NOW,
      );
      expect(written).toBe(false);
      expect(
        harness.rows('ai_runs').find((row) => row.id === 'run-a')?.status,
      ).toBe('running');
    });

    it('a retry releases the lease and pauses the run until its next try', async () => {
      const notBefore = new Date('2026-11-12T10:01:00.000Z');
      await expect(
        repo.retryLater('run-a', TOKEN, notBefore, NOW),
      ).resolves.toBe(true);
      expect(harness.rows('ai_runs').find((row) => row.id === 'run-a')).toEqual(
        expect.objectContaining({
          status: 'queued',
          lock_token: null,
          locked_by: null,
          lease_expires_at: notBefore.toISOString(),
        }),
      );
    });

    it('a release queues the run again with the try given back, claimable at once', async () => {
      await expect(repo.release('run-a', TOKEN, 0, null, NOW)).resolves.toBe(
        true,
      );
      expect(harness.rows('ai_runs').find((row) => row.id === 'run-a')).toEqual(
        expect.objectContaining({
          status: 'queued',
          attempt_count: 0,
          lock_token: null,
          lease_expires_at: null,
        }),
      );
    });

    it('a failure records its reason and finish time', async () => {
      await expect(repo.fail('run-a', TOKEN, 'source_gone', NOW)).resolves.toBe(
        true,
      );
      expect(harness.rows('ai_runs').find((row) => row.id === 'run-a')).toEqual(
        expect.objectContaining({
          status: 'failed',
          failure_reason: 'source_gone',
          lock_token: null,
          finished_at: NOW.toISOString(),
        }),
      );
    });
  });
});
