import { randomUUID } from 'node:crypto';
import type {
  AiRun,
  AiRunFailureReason,
  AiRunRef,
} from '#domain/entities/ai-run.entity';
import type {
  EnqueueAiRunInput,
  IAiRunRepository,
} from '#domain/repositories/ai-run.repository.interface';

/**
 * An in-memory `ai_runs` that keeps the queue's rules (#4310): one run per
 * (chapter, kind, dedupe key) that a failure or cancel lets be queued again, a claim that skips held leases and raises the
 * attempt count, runs that used every try failing on the next claim, and
 * writes conditional on the lock token and `running`.
 *
 * It mirrors `claim_ai_run` and `enqueue_ai_run` in
 * `20261112165000_ai_runs.sql`, so worker and service specs can drive whole
 * lifecycles on a fake clock. It is not the proof of the SQL: the PGlite tier
 * (`scripts/pglite/tiers/ai-runs.mjs`) runs that.
 */
export class FakeAiRunRepository implements IAiRunRepository {
  readonly rows: AiRun[] = [];

  async enqueue(input: EnqueueAiRunInput): Promise<AiRun> {
    const existing = this.rows.find(
      (row) =>
        row.chapter_id === input.chapterId &&
        row.kind === input.kind &&
        row.dedupe_key === input.dedupeKey,
    );
    if (
      existing &&
      (existing.status === 'failed' || existing.status === 'cancelled')
    ) {
      const at = new Date().toISOString();
      Object.assign(existing, {
        status: 'queued',
        requested_by: input.requestedBy,
        acting_user_id: input.actingUserId,
        input_ref: structuredClone(input.input),
        max_attempts: input.maxAttempts,
        attempt_count: 0,
        failure_reason: null,
        result_ref: null,
        ...released(),
        started_at: null,
        finished_at: null,
        created_at: at,
        updated_at: at,
      } satisfies Partial<AiRun>);
      return { ...existing };
    }
    if (existing) return { ...existing };
    const at = new Date().toISOString();
    const row: AiRun = {
      id: randomUUID(),
      chapter_id: input.chapterId,
      kind: input.kind,
      dedupe_key: input.dedupeKey,
      status: 'queued',
      requested_by: input.requestedBy,
      acting_user_id: input.actingUserId,
      input_ref: structuredClone(input.input),
      result_ref: null,
      attempt_count: 0,
      max_attempts: input.maxAttempts,
      failure_reason: null,
      lock_token: null,
      locked_by: null,
      lease_expires_at: null,
      created_at: at,
      updated_at: at,
      started_at: null,
      finished_at: null,
    };
    this.rows.push(row);
    return { ...row };
  }

  async claimNext(
    workerId: string,
    now: Date,
    leaseMs: number,
    kinds: readonly string[],
  ): Promise<AiRun | null> {
    const nowIso = now.toISOString();
    for (const row of this.rows) {
      if (row.status !== 'queued' && row.status !== 'running') continue;
      if (!kinds.includes(row.kind)) continue;
      if (row.lease_expires_at !== null && row.lease_expires_at > nowIso)
        continue;
      if (row.attempt_count >= row.max_attempts) {
        Object.assign(row, {
          status: 'failed',
          failure_reason: 'attempts_exhausted',
          lock_token: null,
          locked_by: null,
          lease_expires_at: null,
          finished_at: nowIso,
          updated_at: nowIso,
        } satisfies Partial<AiRun>);
        continue;
      }
      Object.assign(row, {
        status: 'running',
        attempt_count: row.attempt_count + 1,
        lock_token: randomUUID(),
        locked_by: workerId,
        lease_expires_at: new Date(now.getTime() + leaseMs).toISOString(),
        started_at: row.started_at ?? nowIso,
        updated_at: nowIso,
      } satisfies Partial<AiRun>);
      return { ...row };
    }
    return null;
  }

  async renewLease(
    id: string,
    lockToken: string,
    now: Date,
    leaseMs: number,
  ): Promise<boolean> {
    return this.writeHeld(id, lockToken, {
      lease_expires_at: new Date(now.getTime() + leaseMs).toISOString(),
    });
  }

  async complete(
    id: string,
    lockToken: string,
    result: AiRunRef | null,
    now: Date,
  ): Promise<boolean> {
    return this.writeHeld(id, lockToken, {
      status: 'succeeded',
      result_ref: result,
      ...released(),
      finished_at: now.toISOString(),
    });
  }

  async fail(
    id: string,
    lockToken: string,
    reason: AiRunFailureReason,
    now: Date,
  ): Promise<boolean> {
    return this.writeHeld(id, lockToken, {
      status: 'failed',
      failure_reason: reason,
      ...released(),
      finished_at: now.toISOString(),
    });
  }

  async retryLater(
    id: string,
    lockToken: string,
    notBefore: Date,
  ): Promise<boolean> {
    return this.writeHeld(id, lockToken, {
      status: 'queued',
      ...released(),
      lease_expires_at: notBefore.toISOString(),
    });
  }

  async release(
    id: string,
    lockToken: string,
    attemptCount: number,
    notBefore: Date | null,
  ): Promise<boolean> {
    return this.writeHeld(id, lockToken, {
      status: 'queued',
      attempt_count: Math.max(0, attemptCount),
      ...released(),
      lease_expires_at: notBefore ? notBefore.toISOString() : null,
    });
  }

  async cancel(chapterId: string, id: string, now: Date): Promise<boolean> {
    const row = this.rows.find(
      (r) =>
        r.id === id &&
        r.chapter_id === chapterId &&
        (r.status === 'queued' || r.status === 'running'),
    );
    if (!row) return false;
    Object.assign(row, {
      status: 'cancelled',
      ...released(),
      finished_at: now.toISOString(),
    } satisfies Partial<AiRun>);
    return true;
  }

  async findById(chapterId: string, id: string): Promise<AiRun | null> {
    const row = this.rows.find(
      (r) => r.id === id && r.chapter_id === chapterId,
    );
    return row ? { ...row } : null;
  }

  async listForMember(
    chapterId: string,
    userId: string,
    options: { kind?: string; limit: number },
  ): Promise<AiRun[]> {
    return this.rows
      .filter(
        (r) =>
          r.chapter_id === chapterId &&
          (r.requested_by === userId || r.acting_user_id === userId) &&
          (!options.kind || r.kind === options.kind),
      )
      .slice()
      .reverse()
      .slice(0, options.limit)
      .map((r) => ({ ...r }));
  }

  async deleteFinishedBefore(cutoff: Date): Promise<number> {
    const before = this.rows.length;
    const keep = this.rows.filter(
      (r) => r.finished_at === null || r.finished_at >= cutoff.toISOString(),
    );
    this.rows.splice(0, this.rows.length, ...keep);
    return before - keep.length;
  }

  /** The stored row, for assertions. */
  row(id: string): AiRun {
    const row = this.rows.find((r) => r.id === id);
    if (!row) throw new Error(`no run ${id}`);
    return row;
  }

  private writeHeld(
    id: string,
    lockToken: string,
    patch: Partial<AiRun>,
  ): Promise<boolean> {
    const row = this.rows.find(
      (r) =>
        r.id === id && r.lock_token === lockToken && r.status === 'running',
    );
    if (!row) return Promise.resolve(false);
    Object.assign(row, patch);
    return Promise.resolve(true);
  }
}

function released(): Partial<AiRun> {
  return { lock_token: null, locked_by: null, lease_expires_at: null };
}
