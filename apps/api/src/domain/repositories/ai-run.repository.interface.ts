import type {
  AiRun,
  AiRunFailureReason,
  AiRunRef,
} from '../entities/ai-run.entity';

export const AI_RUN_REPOSITORY = 'AI_RUN_REPOSITORY';

export interface EnqueueAiRunInput {
  chapterId: string;
  kind: string;
  dedupeKey: string;
  requestedBy: string | null;
  actingUserId: string | null;
  input: AiRunRef;
  maxAttempts: number;
}

/**
 * The AI run queue's storage (#4310). Every write the worker makes after a
 * claim is conditional on the claim's `lock_token` and on the run still being
 * `running`, so a worker whose lease ran out (another worker took the run) or
 * whose run was cancelled writes nothing, and learns it from the `false`.
 */
export interface IAiRunRepository {
  /** Creates the run, or returns the one already made for this (chapter, kind, dedupe key). */
  enqueue(input: EnqueueAiRunInput): Promise<AiRun>;

  /**
   * Leases the oldest claimable run to `workerId` until `now + leaseMs`, and
   * raises its attempt count. Runs that already used every attempt end as
   * `failed` (`attempts_exhausted`) on the way. Null when nothing is claimable.
   */
  claimNext(
    workerId: string,
    now: Date,
    leaseMs: number,
  ): Promise<AiRun | null>;

  /** Pushes the lease forward. False: the lease is no longer this worker's. */
  renewLease(
    id: string,
    lockToken: string,
    now: Date,
    leaseMs: number,
  ): Promise<boolean>;

  complete(
    id: string,
    lockToken: string,
    result: AiRunRef | null,
    now: Date,
  ): Promise<boolean>;

  fail(
    id: string,
    lockToken: string,
    reason: AiRunFailureReason,
    now: Date,
  ): Promise<boolean>;

  /** Releases the lease and queues the run again, not claimable before `notBefore`. */
  retryLater(
    id: string,
    lockToken: string,
    notBefore: Date,
    now: Date,
  ): Promise<boolean>;

  /** Cancels a queued or running run. False when it had already finished. */
  cancel(chapterId: string, id: string, now: Date): Promise<boolean>;

  findById(chapterId: string, id: string): Promise<AiRun | null>;

  /** Runs a member started or that act for them, newest first. */
  listForMember(
    chapterId: string,
    userId: string,
    options: { kind?: string; limit: number },
  ): Promise<AiRun[]>;

  /** Deletes finished runs that finished before `cutoff`. Returns how many. */
  deleteFinishedBefore(cutoff: Date): Promise<number>;
}
