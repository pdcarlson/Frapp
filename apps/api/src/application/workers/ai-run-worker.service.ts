import { Inject, Injectable, Logger } from '@nestjs/common';
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

/** Why a try stopped before its handler settled. */
type Stop = 'timeout' | 'lease_lost';

class TryStopped extends Error {
  constructor(readonly stop: Stop) {
    super(
      stop === 'timeout' ? 'The try ran past its time limit' : 'Lost the lease',
    );
  }
}

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
export class AiRunWorkerService {
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

  /** The clock for lease renewals and finish times. A spec replaces it. */
  now: () => Date = () => new Date();

  constructor(
    @Inject(AI_RUN_REPOSITORY) private readonly runs: IAiRunRepository,
    @Inject(MEMBER_REPOSITORY) private readonly members: IMemberRepository,
    private readonly registry: AiRunRegistry,
  ) {}

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
    if (this.claiming) return 0;
    this.claiming = true;
    let started = 0;
    try {
      while (this.active.size < AI_RUN_MAX_CONCURRENT) {
        const run = await this.runs.claimNext(
          this.workerId,
          now,
          AI_RUN_LEASE_MS,
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
          .finally(() => this.active.delete(work));
        this.active.add(work);
      }
    } finally {
      this.claiming = false;
    }
    return started;
  }

  /** Resolves when every run this process started has settled. */
  async idle(): Promise<void> {
    while (this.active.size > 0) {
      await Promise.allSettled([...this.active]);
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
      // Switched off between the claim and here: put it back for later.
      await this.runs.retryLater(
        run.id,
        token,
        new Date(this.now().getTime() + AI_RUN_LEASE_MS),
        this.now(),
      );
      return;
    }

    if (!(await this.actingMemberStillBelongs(handler, run))) {
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
   * A run that reads as a member checks that the member is still in the
   * chapter. One that names a member without needing one checks the same,
   * since a run never reads as someone who has left. Whether that member can
   * open each source is the handler's to check as it reads, at that moment.
   */
  private async actingMemberStillBelongs(
    handler: AiRunHandler,
    run: AiRun,
  ): Promise<boolean> {
    if (!run.acting_user_id) return !handler.actsForMember;
    const member = await this.members.findByUserAndChapter(
      run.acting_user_id,
      run.chapter_id,
    );
    return member !== null;
  }

  /**
   * Runs one try, renewing the lease while it works. Rejects with
   * `TryStopped` when the try runs past its limit or the lease is lost, even
   * if the handler ignores its signal, so one stuck handler cannot hold a
   * slot forever.
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

    const timeout = setTimeout(
      () => halt('timeout'),
      handler.timeoutMs ?? AI_RUN_DEFAULT_TIMEOUT_MS,
    );
    const heartbeat = setInterval(() => {
      this.runs
        .renewLease(run.id, token, this.now(), AI_RUN_LEASE_MS)
        .then((held) => {
          if (!held) halt('lease_lost');
        })
        .catch(() => {
          // A missed renewal is tried again on the next beat; the lease
          // outlasts several beats.
        });
    }, AI_RUN_HEARTBEAT_MS);
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
        error,
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

/** What a handler sees of its run: no lease, no dedupe key. */
function handlerView(run: AiRun): AiRunHandlerRun {
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
