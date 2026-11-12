import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { ReportedCron } from './reported-cron.decorator';
import { reportCaughtFailure } from '../../infrastructure/observability/report-caught-failure';
import type {
  AiRun,
  AiRunFailureReason,
  AiRunRef,
} from '#domain/entities/ai-run.entity';
import {
  AI_RUN_REPOSITORY,
  type IAiRunRepository,
} from '#domain/repositories/ai-run.repository.interface';
import {
  MEMBER_REPOSITORY,
  type IMemberRepository,
} from '#domain/repositories/member.repository.interface';
import {
  AI_RUN_DEFAULT_TIMEOUT_MS,
  AI_RUN_HEARTBEAT_MS,
  AI_RUN_LEASE_MS,
  AI_RUN_MAX_CONCURRENT,
  AI_RUN_RETENTION_DAYS,
  aiRunRetryDelayMs,
  isAiEnabled,
  isAiRunRef,
} from '#domain/utils/ai-runs';
import {
  AiRunFailure,
  AiRunRegistry,
  type AiRunHandler,
  type AiRunHandlerRun,
} from '../services/ai-run-registry';
import { RbacService } from '../services/rbac.service';

/** Why a try stopped before its handler settled. */
type Stop = 'timeout' | 'lease_lost' | 'shutdown';

const STOP_MESSAGES: Record<Stop, string> = {
  timeout: 'The try ran past its time limit',
  lease_lost: 'Lost the lease',
  shutdown: 'The process is shutting down',
};

class TryStopped extends Error {
  constructor(readonly stop: Stop) {
    super(STOP_MESSAGES[stop]);
  }
}

/** How long shutdown waits for stopped tries to give their runs back. */
const SHUTDOWN_WAIT_MS = 10_000;

/**
 * Runs the AI run queue (#4310): claims runs from `ai_runs` with a lease and
 * hands each to its kind's handler.
 *
 * The shape is the Discord import worker's (ADR-09): in-process on the API,
 * woken by `@ReportedCron`, with the database claim (`claim_ai_run`) keeping
 * two replicas off the same run. Unlike that worker it runs several runs at
 * once, since a run mostly waits on a model, and it is also woken straight
 * after an enqueue (`wake`), so a member who asks for a draft does not wait
 * for the next tick. What wakes it is not part of the claim: on Google Cloud a
 * Cloud Tasks push can call `drain` instead of the cron (ADR-28).
 *
 * With `AI_ENABLED` off it does nothing at all, not even a query.
 *
 * Logs carry run ids, kinds and attempt numbers only, never a prompt, an
 * answer or member text (ADR-28 decision 8).
 */
@Injectable()
export class AiRunWorkerService implements OnApplicationShutdown {
  private readonly logger = new Logger(AiRunWorkerService.name);

  /** This process's name in the lease, for reading logs only. */
  private readonly workerId = `${process.pid}-${randomUUID().slice(0, 8)}`;

  /** Runs this process is working on now. */
  private readonly active = new Set<Promise<void>>();

  /**
   * Stops one process running two claim loops at once (a cron tick landing
   * during a wake). The database claim is what keeps separate processes
   * apart; this keeps the in-process count honest.
   */
  private claiming = false;

  /** A wake that arrived while claiming: claim once more before stopping. */
  private claimAgain = false;

  /** Claims started because a run finished and freed a slot. */
  private readonly refills = new Set<Promise<void>>();

  /** Stops the try in progress, for each run this process holds. */
  private readonly halts = new Set<(why: Stop) => void>();

  /** Set once the process starts shutting down; nothing new is claimed. */
  private stopping = false;

  /** The clock for lease renewals and finish times. A spec replaces it. */
  now: () => Date = () => new Date();

  /** How often a try renews its lease. A spec shortens it. */
  heartbeatMs = AI_RUN_HEARTBEAT_MS;

  constructor(
    @Inject(AI_RUN_REPOSITORY) private readonly runs: IAiRunRepository,
    @Inject(MEMBER_REPOSITORY) private readonly members: IMemberRepository,
    private readonly registry: AiRunRegistry,
    private readonly rbac: RbacService,
  ) {}

  /**
   * A deploy stops each try in progress and gives its run back without using
   * a try, so another replica picks it up at once instead of after the lease,
   * and a run is not failed by deploys landing during its tries.
   */
  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    for (const halt of this.halts) halt('shutdown');
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      this.idle(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, SHUTDOWN_WAIT_MS);
        timer.unref?.();
      }),
    ]);
    clearTimeout(timer);
  }

  /**
   * The fallback tick: picks up runs whose worker died, runs paused for a
   * retry, and anything a wake missed (a restart between enqueue and run).
   */
  @ReportedCron(CronExpression.EVERY_30_SECONDS)
  async handleTick(): Promise<void> {
    if (!isAiEnabled()) return;
    try {
      await this.drain(this.now());
    } catch (error) {
      reportCaughtFailure(this.logger, {
        level: 'error',
        site: 'ai-run-sweep-tick',
        message: 'AI run sweep failed; skipping this tick',
        error,
      });
    }
  }

  /** Deletes finished runs older than the retention window. */
  @ReportedCron(CronExpression.EVERY_DAY_AT_4AM)
  async handlePrune(): Promise<void> {
    if (!isAiEnabled()) return;
    try {
      const cutoff = new Date(
        this.now().getTime() - AI_RUN_RETENTION_DAYS * 24 * 60 * 60_000,
      );
      const deleted = await this.runs.deleteFinishedBefore(cutoff);
      if (deleted > 0) this.logger.log(`Pruned ${deleted} finished AI runs.`);
    } catch (error) {
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site: 'ai-run-prune',
        message: 'AI run prune failed',
        error,
      });
    }
  }

  /** Starts on new work now instead of at the next tick. Never throws. */
  wake(): void {
    if (!isAiEnabled()) return;
    this.drain(this.now()).catch((error: unknown) => {
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site: 'ai-run-wake',
        message: 'AI run wake failed; the next tick will claim it',
        error,
      });
    });
  }

  /**
   * Claims runs until this process is at its limit or nothing is claimable,
   * and starts each one. Resolves once the claims are made, not when the
   * runs finish (`idle` waits for those). Takes `now` so a spec drives the
   * claim's clock.
   */
  async drain(now: Date): Promise<number> {
    if (this.claiming) {
      // The loop in progress may already have found nothing; make it look
      // once more, so the work this wake was for is not left to the tick.
      this.claimAgain = true;
      return 0;
    }
    // Only kinds this build serves: an old replica mid-deploy leaves a new
    // kind to the replicas that know it.
    const kinds = this.registry.kinds();
    if (kinds.length === 0 || this.stopping) return 0;
    this.claiming = true;
    let started = 0;
    try {
      do {
        this.claimAgain = false;
        started += await this.claimUpTo(now, kinds);
      } while (this.claimAgain && this.active.size < AI_RUN_MAX_CONCURRENT);
    } finally {
      this.claiming = false;
    }
    return started;
  }

  private async claimUpTo(now: Date, kinds: string[]): Promise<number> {
    let started = 0;
    while (this.active.size < AI_RUN_MAX_CONCURRENT && !this.stopping) {
      const run = await this.runs.claimNext(
        this.workerId,
        now,
        AI_RUN_LEASE_MS,
        kinds,
      );
      if (!run) break;
      started += 1;
      const work: Promise<void> = this.execute(run)
        .catch((error: unknown) => {
          // `execute` handles the handler's own errors; this is the
          // database failing under it. The lease runs out and the next
          // tick tries again.
          reportCaughtFailure(this.logger, {
            level: 'error',
            site: 'ai-run-execute',
            message: `AI run ${run.id} could not record its outcome`,
            error,
          });
        })
        .finally(() => {
          this.active.delete(work);
          this.refill();
        });
      this.active.add(work);
    }
    return started;
  }

  /**
   * A finished run frees a slot: claim the next one now, so a backlog drains
   * at four at a time rather than four per tick.
   */
  private refill(): void {
    if (this.stopping || !isAiEnabled()) return;
    const claim: Promise<void> = this.drain(this.now())
      .then(() => undefined)
      .catch((error: unknown) => {
        reportCaughtFailure(this.logger, {
          level: 'warning',
          site: 'ai-run-refill',
          message: 'AI run refill failed; the next tick will claim it',
          error,
        });
      })
      .finally(() => this.refills.delete(claim));
    this.refills.add(claim);
  }

  /** Resolves when every run this process started has settled. */
  async idle(): Promise<void> {
    while (this.active.size > 0 || this.refills.size > 0) {
      await Promise.allSettled([...this.active, ...this.refills]);
    }
  }

  private async execute(run: AiRun): Promise<void> {
    // `claim_ai_run` always sets one; a row without is not this worker's.
    const token = run.lock_token;
    if (!token) return;

    const handler = this.registry.get(run.kind);
    if (!handler) {
      // Another build of the API may know the kind (a deploy in progress),
      // but this one cannot run it, and trying again here would only use the
      // run's tries. End it plainly.
      this.logger.warn(
        `AI run ${run.id} has kind "${run.kind}", which no handler serves`,
      );
      await this.runs.fail(run.id, token, 'unknown_kind', this.now());
      return;
    }

    if (!isAiEnabled()) {
      // Switched off between the claim and here: give it back for later,
      // without counting this claim as a try.
      await this.runs.release(
        run.id,
        token,
        run.attempt_count - 1,
        new Date(this.now().getTime() + AI_RUN_LEASE_MS),
        this.now(),
      );
      return;
    }

    if (!(await this.actingMemberMayRun(handler, run))) {
      await this.runs.fail(run.id, token, 'not_permitted', this.now());
      return;
    }

    let result: AiRunRef | void;
    try {
      result = await this.runHandler(handler, run, token);
    } catch (error) {
      await this.afterFailure(run, token, error);
      return;
    }

    if (result !== undefined && result !== null && !isAiRunRef(result)) {
      reportCaughtFailure(this.logger, {
        level: 'error',
        site: 'ai-run-invalid-result',
        message: `AI run ${run.id} (${run.kind}) returned a result that is not ids and counts`,
        tags: { kind: run.kind },
      });
      await this.runs.fail(run.id, token, 'invalid_result', this.now());
      return;
    }

    const recorded = await this.runs.complete(
      run.id,
      token,
      result ?? null,
      this.now(),
    );
    if (!recorded) {
      this.logger.warn(
        `AI run ${run.id} finished but was cancelled or taken over first; its result is dropped`,
      );
    }
  }

  /**
   * Checked on every try, so what the member could do when they asked does
   * not carry over: a run that reads as a member checks that the member is
   * still in the chapter and, when the kind names `runPermissions`, still
   * holds one. One that names a member without needing one checks the same,
   * since a run never reads as someone who has left. Whether that member can
   * open each source is the handler's to check as it reads, at that moment.
   */
  private async actingMemberMayRun(
    handler: AiRunHandler,
    run: AiRun,
  ): Promise<boolean> {
    if (!run.acting_user_id) {
      return !handler.actsForMember && !handler.runPermissions?.length;
    }
    const member = await this.members.findByUserAndChapter(
      run.acting_user_id,
      run.chapter_id,
    );
    if (member === null) return false;
    if (!handler.runPermissions?.length) return true;
    return this.rbac.memberHasAnyPermission(
      run.chapter_id,
      run.acting_user_id,
      [...handler.runPermissions],
    );
  }

  /**
   * Runs one try, renewing the lease while it works. Rejects with
   * `TryStopped` when the try runs past its limit, the lease is lost, or the
   * process shuts down, even if the handler ignores its signal, so one stuck
   * handler cannot hold a slot forever.
   *
   * A renewal that errors (the database unreachable) is reported and tried
   * on the next beat. Once the last lease this worker holds for certain has
   * run out, the try stops itself: another worker may have claimed the run
   * by then, and two must never work on it at once.
   */
  private async runHandler(
    handler: AiRunHandler,
    run: AiRun,
    token: string,
  ): Promise<AiRunRef | void> {
    const controller = new AbortController();
    let stopped!: (reason: TryStopped) => void;
    const stop = new Promise<never>((_, reject) => {
      stopped = reject;
    });
    const halt = (why: Stop) => {
      if (controller.signal.aborted) return;
      controller.abort();
      stopped(new TryStopped(why));
    };

    this.halts.add(halt);

    // The lease the claim wrote; each renewal that lands moves it on.
    let heldUntil = run.lease_expires_at
      ? new Date(run.lease_expires_at).getTime()
      : this.now().getTime() + AI_RUN_LEASE_MS;
    const timeout = setTimeout(
      () => halt('timeout'),
      handler.timeoutMs ?? AI_RUN_DEFAULT_TIMEOUT_MS,
    );
    const heartbeat = setInterval(() => {
      const at = this.now();
      if (at.getTime() >= heldUntil) {
        halt('lease_lost');
        return;
      }
      this.runs
        .renewLease(run.id, token, at, AI_RUN_LEASE_MS)
        .then((held) => {
          if (held) heldUntil = at.getTime() + AI_RUN_LEASE_MS;
          else halt('lease_lost');
        })
        .catch((error: unknown) => {
          // Tried again on the next beat; the lease outlasts several beats,
          // and the check above stops the try once it has run out.
          reportCaughtFailure(this.logger, {
            level: 'warning',
            site: 'ai-run-lease-renewal',
            message: `AI run ${run.id} could not renew its lease`,
            error,
          });
        });
    }, this.heartbeatMs);
    timeout.unref?.();
    heartbeat.unref?.();

    try {
      return await Promise.race([
        handler.run({
          run: handlerView(run),
          input: run.input_ref,
          signal: controller.signal,
        }),
        stop,
      ]);
    } finally {
      this.halts.delete(halt);
      clearTimeout(timeout);
      clearInterval(heartbeat);
      // A handler that settles after `halt` is ignored; keep its rejection
      // from surfacing as unhandled.
      stop.catch(() => undefined);
    }
  }

  private async afterFailure(
    run: AiRun,
    token: string,
    error: unknown,
  ): Promise<void> {
    const now = this.now();
    if (error instanceof TryStopped && error.stop === 'lease_lost') {
      this.logger.warn(
        `AI run ${run.id} was cancelled or taken over during try ${run.attempt_count}; stopping`,
      );
      return;
    }
    if (error instanceof TryStopped && error.stop === 'shutdown') {
      this.logger.log(
        `AI run ${run.id} given back on shutdown, try ${run.attempt_count} not counted`,
      );
      await this.runs.release(run.id, token, run.attempt_count - 1, null, now);
      return;
    }

    const failure = error instanceof AiRunFailure ? error : null;
    const timedOut = error instanceof TryStopped;
    const retryable = timedOut || failure === null || failure.retryable;

    if (failure) {
      this.logger.warn(
        `AI run ${run.id} (${run.kind}) try ${run.attempt_count} of ${run.max_attempts} ended: ${failure.reason}`,
      );
    } else if (timedOut) {
      this.logger.warn(
        `AI run ${run.id} (${run.kind}) try ${run.attempt_count} of ${run.max_attempts} ran past its time limit`,
      );
    } else {
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site: 'ai-run-handler-threw',
        message: `AI run ${run.id} (${run.kind}) threw on try ${run.attempt_count} of ${run.max_attempts}`,
        error: withoutMessage(error),
        tags: { kind: run.kind },
      });
    }

    if (retryable && run.attempt_count < run.max_attempts) {
      await this.runs.retryLater(
        run.id,
        token,
        new Date(now.getTime() + aiRunRetryDelayMs(run.attempt_count)),
        now,
      );
      return;
    }
    const reason: AiRunFailureReason =
      retryable || !failure ? 'attempts_exhausted' : failure.reason;
    await this.runs.fail(run.id, token, reason, now);
  }
}

/**
 * A handler's unexpected error with its message left out: the error class and
 * the stack frames, which say where it broke, and nothing a provider or a
 * model said, which can quote the prompt (ADR-28 decision 8). The log and
 * Sentry both get this copy.
 */
export function withoutMessage(error: unknown): Error {
  const name =
    error instanceof Error
      ? error.constructor.name || error.name || 'Error'
      : typeof error;
  const safe = new Error(`AI run handler threw ${name}`);
  safe.name = name;
  const frames =
    error instanceof Error && typeof error.stack === 'string'
      ? error.stack.split('\n').filter((line) => /^\s+at /.test(line))
      : [];
  safe.stack = [`${name}: AI run handler threw ${name}`, ...frames].join('\n');
  return safe;
}

/** What a handler sees of its run: no lease, no dedupe key. */
export function handlerView(run: AiRun): AiRunHandlerRun {
  return {
    id: run.id,
    chapter_id: run.chapter_id,
    kind: run.kind,
    requested_by: run.requested_by,
    acting_user_id: run.acting_user_id,
    attempt_count: run.attempt_count,
    max_attempts: run.max_attempts,
  };
}
