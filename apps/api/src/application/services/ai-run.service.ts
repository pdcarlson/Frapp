import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AiRun,
  AiRunFailureReason,
  AiRunRef,
  AiRunStatus,
} from '#domain/entities/ai-run.entity';
import {
  AI_RUN_REPOSITORY,
  type IAiRunRepository,
} from '#domain/repositories/ai-run.repository.interface';
import {
  AI_RUN_DEDUPE_KEY,
  AI_RUN_DEFAULT_MAX_ATTEMPTS,
  aiRunFailureMessage,
  isAiEnabled,
  isAiRunRef,
} from '#domain/utils/ai-runs';
import { AiRunRegistry } from './ai-run-registry';
import {
  AiRunWorkerService,
  handlerView,
} from '../workers/ai-run-worker.service';

/** The refusal every AI run route gives while `AI_ENABLED` is off. */
export function aiNotAvailable(): NotFoundException {
  return new NotFoundException({
    code: 'ai.not_available',
    message: 'AI features are not available.',
  });
}

export interface EnqueueAiRunRequest {
  chapterId: string;
  /** A kind some module registered with `AiRunRegistry`. */
  kind: string;
  /**
   * Built from ids, so the same request makes the same key
   * (`meeting:<uuid>`). Enqueueing a key twice returns the first run.
   */
  dedupeKey: string;
  /** The member asking, or null when the system starts it. */
  requestedBy: string | null;
  /** The member the run reads as; required when the kind acts for a member. */
  actingUserId: string | null;
  /** Ids and counts only (`isAiRunRef`). */
  input: AiRunRef;
}

/** A run as a client reads it: status and outcome, no lease and no input. */
export interface AiRunView {
  id: string;
  kind: string;
  /** "Drafting minutes"; the kind itself when no handler serves it. */
  label: string;
  status: AiRunStatus;
  attempt_count: number;
  max_attempts: number;
  failure_reason: AiRunFailureReason | null;
  /** The reason in plain words, for the screen. Null unless failed. */
  failure_message: string | null;
  result_ref: AiRunRef | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

/**
 * The AI run queue's front door (#4310): features enqueue and cancel runs
 * here, and members read them.
 *
 * Who may read a run: the member who started it, the member it acts for
 * unless the run is the chapter's upkeep (`chapterUpkeep`, #4504), and anyone
 * its kind's handler lets read it (`canView`), all in the run's own chapter. Everyone else gets the same 404 as for a run that does not exist.
 */
@Injectable()
export class AiRunService {
  constructor(
    @Inject(AI_RUN_REPOSITORY) private readonly runs: IAiRunRepository,
    private readonly registry: AiRunRegistry,
    private readonly worker: AiRunWorkerService,
  ) {}

  /**
   * Queues a run, or returns the run already made for this dedupe key while
   * it is queued, running or succeeded. A failed or cancelled run for the key
   * is queued again as a fresh run, so asking again after a failure tries
   * again. The errors other than "not available" are a
   * feature's bugs, not a member's: an unregistered kind, a key or input
   * that is not ids, or a member-reading kind with no member.
   */
  async enqueue(request: EnqueueAiRunRequest): Promise<AiRun> {
    if (!isAiEnabled()) throw aiNotAvailable();

    const handler = this.registry.get(request.kind);
    if (!handler) {
      throw new Error(
        `No handler is registered for AI run kind "${request.kind}"`,
      );
    }
    if (!AI_RUN_DEDUPE_KEY.test(request.dedupeKey)) {
      throw new Error(
        `AI run dedupe key for "${request.kind}" must be built from ids (letters, digits, ":", "_", ".", "-")`,
      );
    }
    if (!isAiRunRef(request.input)) {
      throw new Error(
        `AI run input for "${request.kind}" must hold ids and counts only, never text`,
      );
    }
    if (handler.actsForMember && !request.actingUserId) {
      throw new Error(
        `AI run kind "${request.kind}" reads as a member and needs an acting member`,
      );
    }

    const run = await this.runs.enqueue({
      chapterId: request.chapterId,
      kind: request.kind,
      dedupeKey: request.dedupeKey,
      requestedBy: request.requestedBy,
      actingUserId: request.actingUserId,
      input: request.input,
      maxAttempts: handler.maxAttempts ?? AI_RUN_DEFAULT_MAX_ATTEMPTS,
    });
    if (run.status === 'queued') this.worker.wake();
    return run;
  }

  /** Cancels a queued or running run. False when it had already finished. */
  async cancel(chapterId: string, runId: string): Promise<boolean> {
    return this.runs.cancel(chapterId, runId, new Date());
  }

  async getForMember(
    chapterId: string,
    userId: string,
    runId: string,
  ): Promise<AiRunView> {
    if (!isAiEnabled()) throw aiNotAvailable();
    const run = await this.runs.findById(chapterId, runId);
    if (!run || !(await this.canRead(run, userId))) {
      throw new NotFoundException('AI run not found');
    }
    return this.toView(run);
  }

  /**
   * Runs the member started or that act for them, newest first. A run of the
   * chapter's upkeep that only acts for them is left out (#4504).
   */
  async listForMember(
    chapterId: string,
    userId: string,
    options: { kind?: string; limit: number },
  ): Promise<AiRunView[]> {
    if (!isAiEnabled()) throw aiNotAvailable();
    const runs = await this.runs.listForMember(chapterId, userId, {
      ...options,
      upkeepKinds: this.registry.upkeepKinds(),
    });
    return runs.map((run) => this.toView(run));
  }

  private async canRead(run: AiRun, userId: string): Promise<boolean> {
    const handler = this.registry.get(run.kind);
    if (run.requested_by === userId) return true;
    if (run.acting_user_id === userId && !handler?.chapterUpkeep) return true;
    if (!handler?.canView) return false;
    return handler.canView(handlerView(run), userId);
  }

  private toView(run: AiRun): AiRunView {
    return {
      id: run.id,
      kind: run.kind,
      label: this.registry.get(run.kind)?.label ?? run.kind,
      status: run.status,
      attempt_count: run.attempt_count,
      max_attempts: run.max_attempts,
      failure_reason: run.failure_reason,
      failure_message: run.failure_reason
        ? aiRunFailureMessage(run.failure_reason, run.max_attempts)
        : null,
      result_ref: run.result_ref,
      created_at: run.created_at,
      started_at: run.started_at,
      finished_at: run.finished_at,
    };
  }
}
