import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesUpdate } from '../database.types';
import { SupabaseQueryError } from '../supabase-query-error';
import type {
  AiRun,
  AiRunFailureReason,
  AiRunRef,
} from '#domain/entities/ai-run.entity';
import { AI_RUN_FINISHED_STATUSES } from '#domain/entities/ai-run.entity';
import type {
  EnqueueAiRunInput,
  IAiRunRepository,
} from '#domain/repositories/ai-run.repository.interface';

/**
 * `ai_runs` through the service role (#4310).
 *
 * Enqueue and claim are database functions (`enqueue_ai_run`,
 * `claim_ai_run` in `20261112131400_ai_runs.sql`), so the dedupe and the
 * claim's attempt count are each one statement, and the PGlite gate runs the
 * same SQL. Every write after a claim is a compare-and-set on `lock_token` and
 * `status = 'running'`, as `discord_imports` does: a worker that lost its
 * lease, or whose run was cancelled, matches no row and learns it from the
 * `false`.
 */
@Injectable()
export class SupabaseAiRunRepository implements IAiRunRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: FrappSupabaseClient,
  ) {}

  async enqueue(input: EnqueueAiRunInput): Promise<AiRun> {
    const { data, error } = await this.supabase.rpc('enqueue_ai_run', {
      p_chapter_id: input.chapterId,
      p_kind: input.kind,
      p_dedupe_key: input.dedupeKey,
      p_requested_by: input.requestedBy,
      p_acting_user_id: input.actingUserId,
      p_input_ref: input.input,
      p_max_attempts: input.maxAttempts,
    });
    if (error) throw new SupabaseQueryError(error);
    const run = (data ?? [])[0];
    // The function returns the new row or the existing one, so an empty
    // answer means the row vanished between the insert and the read (its
    // chapter was deleted). Nothing to hand back.
    if (!run) throw new Error('enqueue_ai_run returned no run');
    return run;
  }

  async claimNext(
    workerId: string,
    now: Date,
    leaseMs: number,
    kinds: readonly string[],
  ): Promise<AiRun | null> {
    if (kinds.length === 0) return null;
    const { data, error } = await this.supabase.rpc('claim_ai_run', {
      p_worker_id: workerId,
      p_now: now.toISOString(),
      p_lease_seconds: Math.round(leaseMs / 1000),
      p_kinds: [...kinds],
    });
    if (error) throw new SupabaseQueryError(error);
    return (data ?? [])[0] ?? null;
  }

  async renewLease(
    id: string,
    lockToken: string,
    now: Date,
    leaseMs: number,
  ): Promise<boolean> {
    return this.writeHeld(id, lockToken, {
      lease_expires_at: new Date(now.getTime() + leaseMs).toISOString(),
      updated_at: now.toISOString(),
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
      ...released(now),
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
      ...released(now),
      finished_at: now.toISOString(),
    });
  }

  async retryLater(
    id: string,
    lockToken: string,
    notBefore: Date,
    now: Date,
  ): Promise<boolean> {
    return this.writeHeld(id, lockToken, {
      status: 'queued',
      ...released(now),
      // A pause, as on `discord_imports`: no token, an expiry ahead. The
      // claim skips the run until then.
      lease_expires_at: notBefore.toISOString(),
    });
  }

  async release(
    id: string,
    lockToken: string,
    attemptCount: number,
    notBefore: Date | null,
    now: Date,
  ): Promise<boolean> {
    return this.writeHeld(id, lockToken, {
      status: 'queued',
      attempt_count: Math.max(0, attemptCount),
      ...released(now),
      lease_expires_at: notBefore ? notBefore.toISOString() : null,
    });
  }

  async cancel(chapterId: string, id: string, now: Date): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('ai_runs')
      .update({
        status: 'cancelled',
        ...released(now),
        finished_at: now.toISOString(),
      })
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .in('status', ['queued', 'running'])
      .select('id');
    if (error) throw new SupabaseQueryError(error);
    return (data ?? []).length > 0;
  }

  async findById(chapterId: string, id: string): Promise<AiRun | null> {
    const { data, error } = await this.supabase
      .from('ai_runs')
      .select('*')
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async listForMember(
    chapterId: string,
    userId: string,
    options: { kind?: string; limit: number },
  ): Promise<AiRun[]> {
    let query = this.supabase
      .from('ai_runs')
      .select('*')
      .eq('chapter_id', chapterId)
      // Both ids are uuids the API resolved from the request, never
      // client-chosen text, so the filter string carries no member input.
      .or(`requested_by.eq.${userId},acting_user_id.eq.${userId}`);
    if (options.kind) query = query.eq('kind', options.kind);
    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(options.limit);
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async deleteFinishedBefore(cutoff: Date): Promise<number> {
    const { data, error } = await this.supabase
      .from('ai_runs')
      .delete()
      .in('status', [...AI_RUN_FINISHED_STATUSES])
      .lt('finished_at', cutoff.toISOString())
      .select('id');
    if (error) throw new SupabaseQueryError(error);
    return (data ?? []).length;
  }

  /** A write that lands only while this worker still holds the run. */
  private async writeHeld(
    id: string,
    lockToken: string,
    patch: TablesUpdate<'ai_runs'>,
  ): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('ai_runs')
      .update(patch)
      .eq('id', id)
      .eq('lock_token', lockToken)
      .eq('status', 'running')
      .select('id');
    if (error) throw new SupabaseQueryError(error);
    return (data ?? []).length > 0;
  }
}

/** The lease columns cleared, for any write that lets go of a run. */
function released(now: Date) {
  return {
    lock_token: null,
    locked_by: null,
    lease_expires_at: null,
    updated_at: now.toISOString(),
  } satisfies TablesUpdate<'ai_runs'>;
}
