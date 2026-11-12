import { Injectable } from '@nestjs/common';
import type {
  AiRun,
  AiRunFailureReason,
  AiRunRef,
} from '#domain/entities/ai-run.entity';
import {
  AI_RUN_KIND,
  AI_RUN_MAX_ATTEMPTS_CEILING,
  AI_RUN_MAX_TIMEOUT_MS,
} from '#domain/utils/ai-runs';

/** What a handler is told about the run it is working on. */
export type AiRunHandlerRun = Readonly<
  Pick<
    AiRun,
    | 'id'
    | 'chapter_id'
    | 'kind'
    | 'requested_by'
    | 'acting_user_id'
    | 'attempt_count'
    | 'max_attempts'
  >
>;

export interface AiRunContext {
  run: AiRunHandlerRun;
  /** The run's `input_ref`: ids and counts the feature stored at enqueue. */
  input: AiRunRef;
  /**
   * Aborted when the try must stop: it ran past the handler's time limit, the
   * worker lost the lease, or the run was cancelled. Pass it to the gateway
   * and to any long read, and stop when it fires; whatever the handler does
   * after that is discarded.
   */
  signal: AbortSignal;
}

/**
 * Thrown by a handler to end a try with a reason. `retryable: true` asks for
 * another try later (a provider that was briefly down); the run then fails as
 * `attempts_exhausted` once its tries are used. Any other error a handler
 * throws is treated as retryable.
 *
 * The message goes to the API log and, for an unexpected error, to Sentry. It
 * must never carry a prompt, an answer, or anything a member wrote (ADR-28
 * decision 8): name ids and counts only.
 */
export class AiRunFailure extends Error {
  constructor(
    readonly reason: AiRunFailureReason,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'AiRunFailure';
  }
}

/**
 * One kind of background AI job. A feature registers one of these with
 * {@link AiRunRegistry} and enqueues runs of its kind through
 * `AiRunService.enqueue`; the queue does the rest (#4310).
 *
 * A handler does its work through the AI gateway (#4306), which checks the
 * chapter's switches and the member's consent (#4308) and reserves spend
 * (#714) on every call. That is what makes those checks happen when the run
 * runs, not only when it was queued: a member can say no in between.
 */
export interface AiRunHandler {
  /** The run kind, `snake_case` (`minutes_draft`). Unique across the API. */
  kind: string;
  /**
   * What a person reads while it runs, as a present participle with no
   * trailing dots: "Drafting minutes". Clients show it beside the status.
   */
  label: string;
  /**
   * Whether every run of this kind reads chapter content as a member, and so
   * must name one (`spec/behavior/ai.md` § Whose access an AI run uses). The
   * queue refuses to enqueue such a run without an acting member, and fails
   * it as `not_permitted` if that member is no longer in the chapter when it
   * runs. The handler still reads only what that member can open at that
   * moment; the queue checks membership, not each source.
   */
  actsForMember: boolean;
  /**
   * Permissions the acting member must still hold, any one of them, when the
   * run runs (a minutes draft names the permission that lets a member edit
   * minutes). Checked on every try, so a member who lost the role since
   * asking gets `not_permitted` and nothing is read. Leave it out when
   * membership is enough.
   */
  runPermissions?: readonly string[];
  /**
   * Whether a member other than the one who started the run, or the one it
   * acts for, may read it. Those two always may. Leave it out to keep runs
   * private to them. A run shows only status and ids, but who may see that a
   * run about something exists follows who may open that something
   * (`spec/behavior/ai.md` § Whose access an AI run uses), so this is the
   * kind's own check against the run's sources, made when it is read.
   */
  canView?(run: AiRunHandlerRun, userId: string): Promise<boolean>;
  /**
   * The run is the chapter's own upkeep (indexing its sources for Ask, #720),
   * not something the member it acts for asked for: that member is only whose
   * access it reads with. Such a run is not listed for, or readable by, that
   * member as theirs (#4504); the one who started it, if anyone did, and
   * `canView` still apply.
   */
  chapterUpkeep?: true;
  /** Tries before the run fails. Default 3, at most 10. */
  maxAttempts?: number;
  /**
   * How long one try may run before it is stopped. Default 10 minutes; 1
   * second to 1 hour. A try is stopped at this limit even if its lease would
   * still hold.
   */
  timeoutMs?: number;
  /**
   * Does the work. Return a result reference (`{ draft_id: '<uuid>' }`) or
   * nothing. Must be safe to run again for the same run: a try whose worker
   * died is tried again, so write results idempotently (an upsert keyed on
   * the run id, for example).
   */
  run(context: AiRunContext): Promise<AiRunRef | void>;
}

/**
 * Every run kind this API process can run, by name.
 *
 * A feature registers its handler from its own module's `onModuleInit`:
 *
 * ```ts
 * @Injectable()
 * export class MinutesDraftHandler implements AiRunHandler, OnModuleInit {
 *   kind = 'minutes_draft';
 *   label = 'Drafting minutes';
 *   actsForMember = true;
 *   constructor(private readonly registry: AiRunRegistry) {}
 *   onModuleInit() { this.registry.register(this); }
 *   async run({ run, input, signal }: AiRunContext) { ... }
 * }
 * ```
 */
@Injectable()
export class AiRunRegistry {
  private readonly handlers = new Map<string, AiRunHandler>();

  register(handler: AiRunHandler): void {
    if (!AI_RUN_KIND.test(handler.kind)) {
      throw new Error(
        `AI run kind "${handler.kind}" must be snake_case, at most 48 characters`,
      );
    }
    if (this.handlers.has(handler.kind)) {
      throw new Error(`AI run kind "${handler.kind}" is registered twice`);
    }
    const max = handler.maxAttempts;
    if (
      max !== undefined &&
      (!Number.isInteger(max) || max < 1 || max > AI_RUN_MAX_ATTEMPTS_CEILING)
    ) {
      throw new Error(
        `AI run kind "${handler.kind}" asks for ${max} tries; 1 to ${AI_RUN_MAX_ATTEMPTS_CEILING} are allowed`,
      );
    }
    const timeout = handler.timeoutMs;
    if (
      timeout !== undefined &&
      (!Number.isInteger(timeout) ||
        timeout < 1000 ||
        timeout > AI_RUN_MAX_TIMEOUT_MS)
    ) {
      throw new Error(
        `AI run kind "${handler.kind}" asks for a ${timeout} ms time limit; 1000 to ${AI_RUN_MAX_TIMEOUT_MS} ms are allowed`,
      );
    }
    this.handlers.set(handler.kind, handler);
  }

  get(kind: string): AiRunHandler | undefined {
    return this.handlers.get(kind);
  }

  kinds(): string[] {
    return [...this.handlers.keys()].sort();
  }

  /** The kinds that are the chapter's upkeep (`chapterUpkeep`). */
  upkeepKinds(): string[] {
    return this.kinds().filter(
      (kind) => this.handlers.get(kind)?.chapterUpkeep,
    );
  }
}
