import { AiRunWorkerService } from './ai-run-worker.service';
import {
  AiRunFailure,
  AiRunRegistry,
  type AiRunContext,
  type AiRunHandler,
} from '../services/ai-run-registry';
import { FakeAiRunRepository } from '#test/helpers/fake-ai-run.repository';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import type { AiRunRef } from '#domain/entities/ai-run.entity';
import { AI_RUN_LEASE_MS, aiRunFailureMessage } from '#domain/utils/ai-runs';

/**
 * The AI run worker (#4310) against an in-memory queue that keeps the
 * table's rules (`FakeAiRunRepository`), on a fake clock: each claim takes
 * `now` from the spec, and the worker's own clock is pinned to it.
 */

const CHAPTER = '11111111-1111-4111-8111-111111111111';
const OFFICER = '33333333-3333-4333-8333-333333333333';
const MEETING = '0a000000-0000-4000-8000-000000004310';
const DRAFT = '0b000000-0000-4000-8000-000000004310';
const T0 = new Date('2026-11-12T10:00:00.000Z');
const at = (ms: number) => new Date(T0.getTime() + ms);

function handler(overrides: Partial<AiRunHandler> = {}): AiRunHandler {
  return {
    kind: 'minutes_draft',
    label: 'Drafting minutes',
    actsForMember: true,
    run: jest.fn(async () => ({ draft_id: DRAFT })),
    ...overrides,
  };
}

/** A promise the spec settles by hand: a handler stuck mid-try. */
function stuck() {
  let resolve!: (value: AiRunRef) => void;
  const promise = new Promise<AiRunRef>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('AiRunWorkerService', () => {
  const env = process.env.AI_ENABLED;
  let runs: FakeAiRunRepository;
  let members: jest.Mocked<Pick<IMemberRepository, 'findByUserAndChapter'>>;
  let registry: AiRunRegistry;

  const worker = (clock: Date = T0) => {
    const w = new AiRunWorkerService(
      runs,
      members as unknown as IMemberRepository,
      registry,
    );
    w.now = () => clock;
    return w;
  };

  const enqueue = (overrides: Partial<{ actingUserId: string | null }> = {}) =>
    runs.enqueue({
      chapterId: CHAPTER,
      kind: 'minutes_draft',
      dedupeKey: `meeting:${MEETING}`,
      requestedBy: OFFICER,
      actingUserId: OFFICER,
      input: { meeting_id: MEETING },
      maxAttempts: 3,
      ...overrides,
    });

  beforeEach(() => {
    process.env.AI_ENABLED = 'true';
    runs = new FakeAiRunRepository();
    members = {
      findByUserAndChapter: jest.fn().mockResolvedValue({ id: 'member' }),
    };
    registry = new AiRunRegistry();
  });

  afterAll(() => {
    process.env.AI_ENABLED = env;
  });

  it('runs a queued run through its handler and records the result', async () => {
    const minutes = handler();
    registry.register(minutes);
    const queued = await enqueue();
    const w = worker();

    await expect(w.drain(T0)).resolves.toBe(1);
    await w.idle();

    const [context] = (minutes.run as jest.Mock).mock.calls[0] as [
      AiRunContext,
    ];
    expect(context.input).toEqual({ meeting_id: MEETING });
    expect(context.run).toEqual(
      expect.objectContaining({
        id: queued.id,
        chapter_id: CHAPTER,
        acting_user_id: OFFICER,
        attempt_count: 1,
      }),
    );
    expect(context.run).not.toHaveProperty('lock_token');
    expect(runs.row(queued.id)).toEqual(
      expect.objectContaining({
        status: 'succeeded',
        result_ref: { draft_id: DRAFT },
        attempt_count: 1,
        lock_token: null,
        finished_at: T0.toISOString(),
      }),
    );
  });

  it('picks up a run whose worker died once its lease runs out, and counts the try', async () => {
    const first = stuck();
    const minutes = handler({
      run: jest
        .fn()
        .mockImplementationOnce(() => first.promise)
        .mockImplementation(async () => ({ draft_id: DRAFT })),
    });
    registry.register(minutes);
    const queued = await enqueue();

    // Worker A claims and hangs, as a process that died mid-job would.
    const dying = worker(T0);
    await dying.drain(T0);
    expect(runs.row(queued.id)).toEqual(
      expect.objectContaining({ status: 'running', attempt_count: 1 }),
    );

    // Worker B, while A's lease still holds: nothing to claim.
    const rescuer = worker(at(AI_RUN_LEASE_MS - 1));
    await expect(rescuer.drain(at(AI_RUN_LEASE_MS - 1))).resolves.toBe(0);

    // After the lease ran out, B takes it over as try 2 and finishes it.
    const later = at(AI_RUN_LEASE_MS);
    const rescued = worker(later);
    await expect(rescued.drain(later)).resolves.toBe(1);
    await rescued.idle();
    expect(runs.row(queued.id)).toEqual(
      expect.objectContaining({ status: 'succeeded', attempt_count: 2 }),
    );

    // A wakes up with an answer, but its token is stale: nothing is written.
    first.resolve({ draft_id: MEETING });
    await dying.idle();
    expect(runs.row(queued.id).result_ref).toEqual({ draft_id: DRAFT });
  });

  it('a run whose workers keep dying fails after its tries, with a reason a person can read', async () => {
    registry.register(
      handler({ run: () => new Promise<never>(() => undefined) }),
    );
    const queued = await enqueue();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const now = at(attempt * AI_RUN_LEASE_MS);
      await worker(now).drain(now);
      expect(runs.row(queued.id).attempt_count).toBe(attempt + 1);
    }
    const end = at(3 * AI_RUN_LEASE_MS);
    await expect(worker(end).drain(end)).resolves.toBe(0);

    const failed = runs.row(queued.id);
    expect(failed).toEqual(
      expect.objectContaining({
        status: 'failed',
        failure_reason: 'attempts_exhausted',
        attempt_count: 3,
      }),
    );
    expect(aiRunFailureMessage('attempts_exhausted', failed.max_attempts)).toBe(
      'It stopped after 3 tries that did not finish.',
    );
  });

  it('tries a failed try again after a pause, and stops after the last try', async () => {
    const run = jest.fn(async () => {
      throw new AiRunFailure('handler_failed', 'provider answered 529', true);
    });
    registry.register(handler({ run }));
    const queued = await enqueue();

    let now = T0;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const w = worker(now);
      await expect(w.drain(now)).resolves.toBe(1);
      await w.idle();
      if (attempt < 3) {
        const paused = runs.row(queued.id);
        expect(paused).toEqual(
          expect.objectContaining({ status: 'queued', lock_token: null }),
        );
        // Not claimable during the pause.
        await expect(worker(now).drain(now)).resolves.toBe(0);
        now = new Date(paused.lease_expires_at!);
      }
    }

    expect(run).toHaveBeenCalledTimes(3);
    expect(runs.row(queued.id)).toEqual(
      expect.objectContaining({
        status: 'failed',
        failure_reason: 'attempts_exhausted',
        attempt_count: 3,
      }),
    );
  });

  it('a failure the handler says will not clear ends the run at once, with its reason', async () => {
    const run = jest.fn(async () => {
      throw new AiRunFailure('source_gone', 'meeting deleted');
    });
    registry.register(handler({ run }));
    const queued = await enqueue();
    const w = worker();

    await w.drain(T0);
    await w.idle();

    expect(run).toHaveBeenCalledTimes(1);
    expect(runs.row(queued.id)).toEqual(
      expect.objectContaining({
        status: 'failed',
        failure_reason: 'source_gone',
      }),
    );
  });

  it('an error the handler did not expect is tried again', async () => {
    registry.register(
      handler({
        run: jest
          .fn()
          .mockRejectedValueOnce(new Error('socket hang up'))
          .mockResolvedValue({ draft_id: DRAFT }),
      }),
    );
    const queued = await enqueue();

    const w = worker();
    await w.drain(T0);
    await w.idle();
    const resume = new Date(runs.row(queued.id).lease_expires_at!);
    const w2 = worker(resume);
    await w2.drain(resume);
    await w2.idle();

    expect(runs.row(queued.id)).toEqual(
      expect.objectContaining({ status: 'succeeded', attempt_count: 2 }),
    );
  });

  it('stops a try that runs past its time limit and frees the slot', async () => {
    registry.register(
      handler({ timeoutMs: 5, run: () => new Promise<never>(() => undefined) }),
    );
    const queued = await enqueue();
    const w = worker();

    await w.drain(T0);
    await w.idle();

    expect(runs.row(queued.id)).toEqual(
      expect.objectContaining({
        status: 'queued',
        attempt_count: 1,
        lock_token: null,
      }),
    );
  });

  it('fails a run whose acting member has left the chapter, without running it', async () => {
    const minutes = handler();
    registry.register(minutes);
    const queued = await enqueue();
    members.findByUserAndChapter.mockResolvedValue(null);
    const w = worker();

    await w.drain(T0);
    await w.idle();

    expect(minutes.run).not.toHaveBeenCalled();
    expect(members.findByUserAndChapter).toHaveBeenCalledWith(OFFICER, CHAPTER);
    expect(runs.row(queued.id)).toEqual(
      expect.objectContaining({
        status: 'failed',
        failure_reason: 'not_permitted',
      }),
    );
  });

  it('fails a member-reading run that names no member', async () => {
    const minutes = handler();
    registry.register(minutes);
    const queued = await enqueue({ actingUserId: null });
    const w = worker();

    await w.drain(T0);
    await w.idle();

    expect(minutes.run).not.toHaveBeenCalled();
    expect(runs.row(queued.id).failure_reason).toBe('not_permitted');
  });

  it('fails a run of a kind no handler serves', async () => {
    const queued = await enqueue();
    const w = worker();

    await w.drain(T0);
    await w.idle();

    expect(runs.row(queued.id).failure_reason).toBe('unknown_kind');
  });

  it('refuses a result that is not ids and counts', async () => {
    registry.register(
      handler({
        // Fits the type (a string is a ref value); only a uuid passes the check.
        run: async () => ({ summary: 'The chapter voted to' }),
      }),
    );
    const queued = await enqueue();
    const w = worker();

    await w.drain(T0);
    await w.idle();

    expect(runs.row(queued.id)).toEqual(
      expect.objectContaining({
        status: 'failed',
        failure_reason: 'invalid_result',
        result_ref: null,
      }),
    );
  });

  it('drops the result of a run cancelled while it ran', async () => {
    const slow = stuck();
    registry.register(handler({ run: () => slow.promise }));
    const queued = await enqueue();
    const w = worker();

    await w.drain(T0);
    await runs.cancel(CHAPTER, queued.id, T0);
    slow.resolve({ draft_id: DRAFT });
    await w.idle();

    expect(runs.row(queued.id)).toEqual(
      expect.objectContaining({ status: 'cancelled', result_ref: null }),
    );
  });

  it('runs at most four runs at once in one process', async () => {
    const hold = stuck();
    registry.register(handler({ run: () => hold.promise }));
    for (let i = 0; i < 6; i += 1) {
      await runs.enqueue({
        chapterId: CHAPTER,
        kind: 'minutes_draft',
        dedupeKey: `meeting:${i}`,
        requestedBy: OFFICER,
        actingUserId: OFFICER,
        input: {},
        maxAttempts: 3,
      });
    }
    const w = worker();

    await expect(w.drain(T0)).resolves.toBe(4);
    await expect(w.drain(T0)).resolves.toBe(0);
    hold.resolve({ draft_id: DRAFT });
    await w.idle();
    await expect(w.drain(T0)).resolves.toBe(2);
    await w.idle();
    expect(runs.rows.every((row) => row.status === 'succeeded')).toBe(true);
  });

  describe('with AI_ENABLED off', () => {
    it('never touches the queue on a tick, a wake or a prune', async () => {
      process.env.AI_ENABLED = '';
      const spy = {
        claimNext: jest.spyOn(runs, 'claimNext'),
        deleteFinishedBefore: jest.spyOn(runs, 'deleteFinishedBefore'),
      };
      const w = worker();

      await w.handleTick();
      w.wake();
      await w.handlePrune();

      expect(spy.claimNext).not.toHaveBeenCalled();
      expect(spy.deleteFinishedBefore).not.toHaveBeenCalled();
    });
  });

  it('prunes runs that finished more than 90 days ago, and nothing else', async () => {
    registry.register(handler());
    const old = await enqueue();
    const recent = await runs.enqueue({
      chapterId: CHAPTER,
      kind: 'minutes_draft',
      dedupeKey: 'meeting:recent',
      requestedBy: OFFICER,
      actingUserId: OFFICER,
      input: {},
      maxAttempts: 3,
    });
    runs.row(old.id).status = 'succeeded';
    runs.row(old.id).finished_at = '2026-08-01T00:00:00.000Z';
    runs.row(recent.id).status = 'succeeded';
    runs.row(recent.id).finished_at = '2026-11-01T00:00:00.000Z';

    await worker().handlePrune();

    expect(runs.rows.map((row) => row.id)).toEqual([recent.id]);
  });
});
