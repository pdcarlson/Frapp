import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isModuleEnabled } from '@repo/validation';
import { isUniqueViolation } from '#domain/constants/postgres-error-codes';
import type {
  AiSuggestion,
  AiSuggestionKind,
  AiSuggestionSourceType,
} from '#domain/entities/ai-suggestion.entity';
import {
  AI_SUGGESTION_REPOSITORY,
  type IAiSuggestionRepository,
  type NewAiSuggestion,
} from '#domain/repositories/ai-suggestion.repository.interface';
import {
  AI_SUGGESTION_KIND_HANDLERS,
  type AiSuggestionKindHandler,
} from './ai-suggestion-kinds';
import {
  AI_SUGGESTION_SOURCE_ACCESS,
  type AiSuggestionSourceAccess,
} from './ai-suggestion-sources';
import {
  CHAPTER_REPOSITORY,
  type IChapterRepository,
} from '#domain/repositories/chapter.repository.interface';
import { RbacService } from './rbac.service';
import { NotificationService } from './notification.service';
import { AnalyticsService } from './analytics.service';
import { assertModuleEnabled, type EnabledModules } from './module-gate';
import { reportCaughtFailure } from '../../infrastructure/observability/report-caught-failure';
import { logThrowable } from '../../infrastructure/observability/log-throwable';

/** Proposals one batch may carry (`ai_suggestions.ordinal` is 0 to 199). */
export const AI_SUGGESTION_BATCH_MAX = 200;
/** Rows the Suggested list returns. Waiting rows expire, so it stays small. */
export const AI_SUGGESTION_LIST_LIMIT = 200;
/** Decisions one batch request may carry (the review screen's Confirm). */
export const AI_SUGGESTION_DECIDE_MAX = 50;
/** The longest quote kept, in characters (`ai_suggestions.quote`). */
export const AI_SUGGESTION_QUOTE_MAX_LENGTH = 1000;
/**
 * The largest proposal kept, in bytes of JSON. Under the table's 16000-byte
 * check, which measures Postgres's own rendering (a little longer), so a
 * proposal that passes here never fails the insert and takes the batch with it.
 */
export const AI_SUGGESTION_PAYLOAD_MAX_BYTES = 15000;
/** Pages of waiting rows the list reads looking for ones the caller may see. */
const LIST_MAX_PAGES = 5;
/** An accept still `accepting` after this long died mid-way and is put back. */
export const AI_SUGGESTION_STALE_ACCEPT_MS = 10 * 60 * 1000;

const WILDCARD = '*';
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ProposeAiSuggestionsInput {
  chapterId: string;
  /** One batch is one push. Reuse it on a retry: a written row is not written again. */
  batchId: string;
  runId?: string | null;
  /** The member the run acted for. Notified by default. */
  requestedFor: string | null;
  source: {
    type: AiSuggestionSourceType;
    id: string;
    /** What the push is named for: the meeting or event, as the chapter titled it. */
    title: string;
    /**
     * The source text the run read, for the word-for-word quote check. Used
     * and dropped: never stored.
     */
    text?: string | null;
  };
  proposals: readonly {
    kind: AiSuggestionKind;
    payload: unknown;
    quote?: string | null;
    /** Whose words the quote is, when they are a member's. */
    quoteAuthorId?: string | null;
    /** What in the source it was made from; see `AiSuggestion.dedupe_key`. */
    dedupeKey?: string | null;
  }[];
  /** Who hears about the batch. Defaults to `requestedFor`. */
  notify?: readonly string[];
}

export interface ReconcileAiSuggestionsInput {
  chapterId: string;
  requestedFor: string | null;
  source: ProposeAiSuggestionsInput['source'];
  kind: AiSuggestionKind;
  /** Everything the source holds now that should be proposed, each keyed. */
  proposals: readonly {
    dedupeKey: string;
    payload: unknown;
    quote?: string | null;
  }[];
  /** Who hears about what is new. Defaults to `requestedFor`. */
  notify?: readonly string[];
}

export interface ReconcileAiSuggestionsResult {
  created: AiSuggestion[];
  /** Waiting suggestions taken back: their thing left the source or changed. */
  withdrawn: number;
}

export interface ProposeAiSuggestionsResult {
  created: AiSuggestion[];
  /** Proposals not stored: unusable, an unknown kind, or past the batch cap. */
  dropped: number;
}

export type AiSuggestionEdits = {
  kind: AiSuggestionKind;
  fields: Record<string, unknown>;
};

export interface AiSuggestionDecisionResult {
  suggestion: AiSuggestion;
  /** What accepting made, when it was accepted. */
  result: { kind: AiSuggestionKind; id: string } | null;
}

export type AiSuggestionDecideItem =
  | { id: string; action: 'accept'; edits?: AiSuggestionEdits }
  | { id: string; action: 'dismiss' };

export type AiSuggestionDecideOutcome =
  | ({ id: string; ok: true } & AiSuggestionDecisionResult)
  | { id: string; ok: false; status: number; code: string; message: string };

/**
 * The quote a suggestion may show: only words that appear exactly as written
 * in the source the run read (ADR-28 decision 4, the eval grader's rule in
 * `apps/api/test/ai-evals/harness/grader.ts`). Anything else is dropped and
 * the suggestion shows its source without a quote.
 */
export function verifiedQuote(
  quote: string | null | undefined,
  sourceText: string | null | undefined,
): string | null {
  if (typeof quote !== 'string' || typeof sourceText !== 'string') return null;
  if (quote.length === 0 || quote.length > AI_SUGGESTION_QUOTE_MAX_LENGTH) {
    return null;
  }
  return sourceText.includes(quote) ? quote : null;
}

/**
 * AI suggestions (#4309, ADR-28 decision 11, spec/behavior/ai.md § Suggestions).
 *
 * - **A suggestion never acts by itself.** Accepting re-checks the accepter's
 *   permission and their access to the source at that moment, then commits
 *   through the ordinary service for its kind, as the accepter. A permission
 *   held when the suggestion was made counts for nothing.
 * - **Never a chat message.** Nothing here posts to a channel.
 * - **One push per batch**, to the member the run acted for, and only when
 *   they could accept something in it.
 * - **Shown only to people who could accept it**: the kind's permission, the
 *   kind's module on, and the source open to them.
 * - **No text once decided.** Dismissing and expiring empty the proposal and
 *   its quote in the same write, and accepting empties them in the write that
 *   records what it made; the record of who decided, when, and what it became
 *   stays. Between Accept and that write the row is `accepting` and keeps its
 *   text, so a change that fails puts it back intact.
 */
@Injectable()
export class AiSuggestionService {
  private readonly logger = new Logger(AiSuggestionService.name);
  private readonly kinds: ReadonlyMap<
    AiSuggestionKind,
    AiSuggestionKindHandler
  >;
  private readonly sources: ReadonlyMap<
    AiSuggestionSourceType,
    AiSuggestionSourceAccess
  >;

  /** The clock, replaceable in tests. */
  now: () => Date = () => new Date();

  constructor(
    @Inject(AI_SUGGESTION_REPOSITORY)
    private readonly repo: IAiSuggestionRepository,
    @Inject(AI_SUGGESTION_KIND_HANDLERS)
    kindHandlers: readonly AiSuggestionKindHandler[],
    @Inject(AI_SUGGESTION_SOURCE_ACCESS)
    sourceAccess: readonly AiSuggestionSourceAccess[],
    private readonly rbac: RbacService,
    private readonly notifications: NotificationService,
    private readonly analytics: AnalyticsService,
    @Inject(CHAPTER_REPOSITORY)
    private readonly chapters: IChapterRepository,
  ) {
    this.kinds = new Map(kindHandlers.map((h) => [h.kind, h]));
    this.sources = new Map(sourceAccess.map((s) => [s.sourceType, s]));
  }

  /** Analytics are best-effort and never hold up or fail a decision. */
  private emit(send: Promise<void>): void {
    send.catch((error: unknown) =>
      logThrowable(this.logger, 'warn', 'AI suggestion event not sent', error),
    );
  }

  // ---------------------------------------------------------------- propose

  /**
   * Saves a run's proposals as one batch and sends one push for it. For the
   * features that propose (tasks from minutes first); there is no HTTP route.
   */
  async proposeBatch(
    input: ProposeAiSuggestionsInput,
  ): Promise<ProposeAiSuggestionsResult> {
    const now = this.now();
    const rows: NewAiSuggestion[] = [];
    let dropped = 0;

    input.proposals.forEach((proposal, ordinal) => {
      const handler = this.kinds.get(proposal.kind);
      const payload =
        ordinal < AI_SUGGESTION_BATCH_MAX && handler
          ? handler.normalizeProposal(proposal.payload)
          : null;
      if (
        !handler ||
        !payload ||
        Buffer.byteLength(JSON.stringify(payload)) >
          AI_SUGGESTION_PAYLOAD_MAX_BYTES
      ) {
        dropped += 1;
        return;
      }
      const quote = verifiedQuote(proposal.quote, input.source.text);
      rows.push({
        batch_id: input.batchId,
        ordinal,
        run_id: input.runId ?? null,
        requested_for: input.requestedFor,
        kind: handler.kind,
        source_type: input.source.type,
        source_id: input.source.id,
        payload,
        quote,
        quote_author_id: quote ? (proposal.quoteAuthorId ?? null) : null,
        dedupe_key: proposal.dedupeKey ?? null,
        required_permission: handler.requiredPermission,
        expires_at: new Date(
          now.getTime() + handler.expiresAfterDays * DAY_MS,
        ).toISOString(),
      });
    });

    const created = await this.repo.insertBatch(input.chapterId, rows);
    // A retry of a batch whose rows were written but whose push never went
    // out writes nothing new and still sends the push.
    await this.notifyBatch(input);

    if (created.length > 0) {
      for (const [kind, count] of countBy(created, (row) => row.kind)) {
        this.emit(
          this.analytics.trackForChapter(
            'ai-suggestions-proposed',
            input.chapterId,
            { kind, count },
          ),
        );
      }
    }
    return { created, dropped };
  }

  /**
   * Brings a source's waiting suggestions of one kind in line with what the
   * source holds now, for a feature that proposes from something people keep
   * editing (posted minutes, #4313). Safe to run on every save:
   *
   * - a thing already proposed is not proposed again, whatever became of the
   *   first proposal (accepted, dismissed, expired, or still waiting);
   * - a waiting suggestion whose thing left the source is taken back, and one
   *   whose thing changed (a new owner, a new day) is replaced;
   * - only what is new is written, as one batch with one push.
   *
   * A suggestion being accepted at that moment is left alone.
   */
  async reconcileSource(
    input: ReconcileAiSuggestionsInput,
  ): Promise<ReconcileAiSuggestionsResult> {
    const handler = this.kinds.get(input.kind);
    if (!handler) return { created: [], withdrawn: 0 };
    const wanted = new Map<
      string,
      { payload: AiSuggestion['payload']; raw: unknown; quote: string | null }
    >();
    for (const proposal of input.proposals) {
      const payload = handler.normalizeProposal(proposal.payload);
      if (!payload || wanted.has(proposal.dedupeKey)) continue;
      wanted.set(proposal.dedupeKey, {
        payload,
        raw: proposal.payload,
        quote: proposal.quote ?? null,
      });
    }

    let withdrawn = 0;
    // Twice at most: a save a moment earlier may be writing the same rows,
    // which the table refuses; the second pass reads what it wrote.
    for (let attempt = 0; ; attempt += 1) {
      const existing = await this.repo.listKeyedForSource(
        input.chapterId,
        { type: input.source.type, id: input.source.id },
        input.kind,
      );
      const stale = existing.filter((row) => {
        if (row.status !== 'pending') return false;
        const now = row.dedupe_key ? wanted.get(row.dedupe_key) : undefined;
        return !now || !samePayload(now.payload, row.payload);
      });
      const gone = new Set(stale.map((row) => row.id));
      const takenBack = await this.repo.deletePending(
        input.chapterId,
        stale.map((row) => row.id),
      );
      withdrawn += takenBack;
      if (takenBack > 0) {
        // So proposed still adds up to accepted, dismissed, expired,
        // withdrawn and waiting: a replaced suggestion is proposed twice.
        this.emit(
          this.analytics.trackForChapter(
            'ai-suggestions-withdrawn',
            input.chapterId,
            { kind: input.kind, count: takenBack },
          ),
        );
      }
      const taken = new Set(
        existing
          .filter((row) => !gone.has(row.id))
          .map((row) => row.dedupe_key),
      );
      const fresh = [...wanted].filter(([key]) => !taken.has(key));
      if (fresh.length === 0) return { created: [], withdrawn };
      try {
        const { created } = await this.proposeBatch({
          chapterId: input.chapterId,
          batchId: randomUUID(),
          requestedFor: input.requestedFor,
          source: input.source,
          proposals: fresh.map(([dedupeKey, proposal]) => ({
            kind: input.kind,
            payload: proposal.raw,
            quote: proposal.quote,
            dedupeKey,
          })),
          notify: input.notify,
        });
        return { created, withdrawn };
      } catch (error) {
        if (attempt > 0 || !isUniqueViolation(error)) throw error;
      }
    }
  }

  /**
   * One push for the whole batch, to each member it names who could accept
   * at least one of its suggestions now (the kind's module on in the chapter,
   * its permission held, its source open to them). Sent for the batch's rows
   * still owed one, then marked, so a retried run sends it once it gets this
   * far. Best-effort: the suggestions are saved whatever happens here, and
   * the Suggested list shows them.
   */
  private async notifyBatch(input: ProposeAiSuggestionsInput): Promise<void> {
    try {
      const owed = await this.repo.listUnnotified(
        input.chapterId,
        input.batchId,
      );
      if (owed.length === 0) return;

      const candidates = [
        ...new Set(
          input.notify ?? (input.requestedFor ? [input.requestedFor] : []),
        ),
      ];
      const chapter =
        candidates.length > 0
          ? await this.chapters.findById(input.chapterId)
          : null;
      const enabledModules = chapter?.enabled_modules ?? null;
      const recipients: string[] = [];
      for (const userId of candidates) {
        const visible = await this.visibleTo(
          input.chapterId,
          userId,
          owed,
          enabledModules,
        );
        if (visible.length > 0) recipients.push(userId);
      }

      if (recipients.length > 0) {
        const kinds = [...new Set(owed.map((row) => row.kind))];
        const only = kinds.length === 1 ? this.kinds.get(kinds[0]) : undefined;
        await this.sendBatchPush(input, recipients, owed.length, only);
      }
      // Marked whether or not anyone could be told: nobody is owed it then.
      await this.repo.markNotified(
        input.chapterId,
        owed.map((row) => row.id),
        this.now().toISOString(),
      );
    } catch (error) {
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site: 'ai-suggestions-notify',
        message: `batch push failed in chapter ${input.chapterId}`,
        error,
      });
    }
  }

  private async sendBatchPush(
    input: ProposeAiSuggestionsInput,
    recipients: readonly string[],
    count: number,
    only: AiSuggestionKindHandler | undefined,
  ): Promise<void> {
    await this.notifications.notifyMembers(input.chapterId, [...recipients], {
      title: input.source.title,
      body: only ? only.describeBatch(count) : `${count} suggestions to review`,
      priority: 'NORMAL',
      category: only?.pushCategory ?? 'default',
      data: {
        target: {
          screen: 'ai_suggestions',
          batchId: input.batchId,
          sourceType: input.source.type,
          sourceId: input.source.id,
        },
      },
    });
  }

  // ------------------------------------------------------------------- list

  /**
   * The Suggested list: waiting suggestions `userId` could accept now, newest
   * first, optionally for one source (a meeting's review screen).
   */
  async listForUser(
    chapterId: string,
    userId: string,
    options: {
      source?: { type: AiSuggestionSourceType; id: string };
      enabledModules: EnabledModules;
    },
  ): Promise<{ items: AiSuggestion[]; has_more: boolean }> {
    const permissions = await this.rbac.getEffectivePermissions(
      chapterId,
      userId,
    );
    const held = new Set(permissions);
    const filter = {
      permissions: held.has(WILDCARD)
        ? null
        : [...this.kinds.values()]
            .map((handler) => handler.requiredPermission)
            .filter((permission) => held.has(permission)),
      source: options.source,
      now: this.now().toISOString(),
    };
    // Rows the caller can't open (another member's DM, an Exec meeting) are
    // filtered after the read, so read on past them, a page at a time, until
    // the list is full or the pages run out.
    const items: AiSuggestion[] = [];
    for (let page = 0; page < LIST_MAX_PAGES; page += 1) {
      const rows = await this.repo.listPending(chapterId, {
        ...filter,
        offset: page * AI_SUGGESTION_LIST_LIMIT,
        limit: AI_SUGGESTION_LIST_LIMIT,
      });
      const visible = await this.visibleTo(
        chapterId,
        userId,
        rows,
        options.enabledModules,
        held,
      );
      for (const row of visible) {
        if (items.length === AI_SUGGESTION_LIST_LIMIT) {
          return { items, has_more: true };
        }
        items.push(row);
      }
      if (rows.length < AI_SUGGESTION_LIST_LIMIT) {
        return { items, has_more: false };
      }
    }
    // Pages left unread may hold more the caller could see.
    return { items, has_more: true };
  }

  /**
   * Of `rows`, the ones `userId` could accept now: a known kind whose module
   * is on (when `enabledModules` is given), its permission held, and its
   * source open to them.
   */
  private async visibleTo(
    chapterId: string,
    userId: string,
    rows: readonly AiSuggestion[],
    enabledModules: EnabledModules | null,
    heldPermissions?: ReadonlySet<string>,
  ): Promise<AiSuggestion[]> {
    if (rows.length === 0) return [];
    const held =
      heldPermissions ??
      new Set(await this.rbac.getEffectivePermissions(chapterId, userId));
    const allowed = rows.filter((row) => {
      const handler = this.kinds.get(row.kind);
      if (!handler) return false;
      if (
        enabledModules !== null &&
        handler.module &&
        !isModuleEnabled(enabledModules, handler.module)
      ) {
        return false;
      }
      return held.has(WILDCARD) || held.has(row.required_permission);
    });
    const openable = await this.openableSources(chapterId, userId, allowed);
    return allowed.filter((row) =>
      openable.has(sourceKey(row.source_type, row.source_id)),
    );
  }

  private async openableSources(
    chapterId: string,
    userId: string,
    rows: readonly Pick<AiSuggestion, 'source_type' | 'source_id'>[],
  ): Promise<Set<string>> {
    const byType = new Map<AiSuggestionSourceType, Set<string>>();
    for (const row of rows) {
      const ids = byType.get(row.source_type) ?? new Set<string>();
      ids.add(row.source_id);
      byType.set(row.source_type, ids);
    }
    const openable = new Set<string>();
    await Promise.all(
      [...byType].map(async ([type, ids]) => {
        const access = this.sources.get(type);
        if (!access) return; // no checker: nobody can open it
        const ok = await access.filterOpenable(chapterId, userId, [...ids]);
        for (const id of ok) openable.add(sourceKey(type, id));
      }),
    );
    return openable;
  }

  // ----------------------------------------------------------------- decide

  /**
   * Accepts a suggestion as `userId`, with their edits when they made any.
   * Re-checks their permission and source access now, commits through the
   * kind's ordinary service, and puts the suggestion back if that fails.
   * The suggestion is held as `accepting`, text and all, until the change is
   * made. A second accept by the same member after it finished returns the
   * first one's outcome; one while it is still being made answers 409.
   */
  async accept(
    chapterId: string,
    userId: string,
    id: string,
    options: { edits?: AiSuggestionEdits; enabledModules: EnabledModules },
  ): Promise<AiSuggestionDecisionResult> {
    const { row, handler } = await this.loadForDecision(chapterId, userId, id);
    if (!this.isWaiting(row)) {
      return this.alreadyDecided(row, userId, 'accepted');
    }
    if (handler.module) {
      assertModuleEnabled(options.enabledModules, handler.module);
    }
    if (options.edits && options.edits.kind !== row.kind) {
      throw new BadRequestException({
        code: 'ai.suggestion.edits_kind',
        message: 'These changes are for a different kind of suggestion.',
      });
    }
    const payload = options.edits
      ? handler.applyEdits(row.payload, options.edits.fields)
      : row.payload;
    handler.assertAcceptable(payload);
    const edited = !samePayload(payload, row.payload);

    const claimed = await this.repo.claim(chapterId, id, {
      status: 'accepting',
      decidedBy: userId,
      edited,
      now: this.now().toISOString(),
    });
    if (!claimed) {
      return this.alreadyDecided(
        await this.reread(chapterId, id),
        userId,
        'accepted',
      );
    }

    let resultId: string;
    try {
      ({ resultId } = await handler.commit({
        chapterId,
        userId,
        payload,
        source: { type: row.source_type, id: row.source_id },
      }));
    } catch (error) {
      await this.release(chapterId, id);
      throw error;
    }

    // What the officer sees if the last write doesn't land: the change was
    // made, so the answer is success either way.
    let finished: AiSuggestion | null = null;
    try {
      finished = await this.repo.finishAccept(chapterId, id, resultId);
    } catch (error) {
      // The change is made but the suggestion still reads `accepting`. The
      // sweep puts it back to waiting after ten minutes, where an officer
      // could accept it again; reported so that is noticed.
      reportCaughtFailure(this.logger, {
        level: 'error',
        site: 'ai-suggestion-finish',
        message: `accepted suggestion ${id} not marked accepted`,
        error,
      });
    }

    this.emit(
      this.analytics.track('ai-suggestion-accepted', userId, {
        chapterId,
        properties: { kind: row.kind, edited },
      }),
    );
    return {
      // Null when its source was deleted while the change was made: the
      // suggestion went with it.
      suggestion: finished ?? {
        ...claimed,
        status: 'accepted',
        payload: {},
        quote: null,
        quote_author_id: null,
        result_id: resultId,
      },
      result: { kind: row.kind, id: resultId },
    };
  }

  /**
   * Dismisses a suggestion. Dismissing one already dismissed changes nothing.
   * `reason` says why when the member said (`already_doing`: the chapter is
   * already on it, #3930); it goes to the analytics event and is not stored.
   */
  async dismiss(
    chapterId: string,
    userId: string,
    id: string,
    reason?: 'already_doing',
  ): Promise<AiSuggestionDecisionResult> {
    const { row } = await this.loadForDecision(chapterId, userId, id);
    if (!this.isWaiting(row)) {
      return this.alreadyDecided(row, userId, 'dismissed');
    }
    const claimed = await this.repo.claim(chapterId, id, {
      status: 'dismissed',
      decidedBy: userId,
      edited: false,
      now: this.now().toISOString(),
    });
    if (!claimed) {
      return this.alreadyDecided(
        await this.reread(chapterId, id),
        userId,
        'dismissed',
      );
    }
    this.emit(
      this.analytics.track('ai-suggestion-dismissed', userId, {
        chapterId,
        properties: { kind: row.kind, ...(reason ? { reason } : {}) },
      }),
    );
    return { suggestion: claimed, result: null };
  }

  /**
   * Several decisions in one request, in order, for the review screen's
   * Confirm. Each is decided on its own: one refused doesn't stop the rest,
   * and each outcome says what happened.
   */
  async decideMany(
    chapterId: string,
    userId: string,
    items: readonly AiSuggestionDecideItem[],
    enabledModules: EnabledModules,
  ): Promise<AiSuggestionDecideOutcome[]> {
    if (items.length > AI_SUGGESTION_DECIDE_MAX) {
      throw new BadRequestException(
        `At most ${AI_SUGGESTION_DECIDE_MAX} suggestions at a time.`,
      );
    }
    const outcomes: AiSuggestionDecideOutcome[] = [];
    for (const item of items) {
      try {
        const decided =
          item.action === 'accept'
            ? await this.accept(chapterId, userId, item.id, {
                edits: item.edits,
                enabledModules,
              })
            : await this.dismiss(chapterId, userId, item.id);
        outcomes.push({ id: item.id, ok: true, ...decided });
      } catch (error) {
        if (!(error instanceof HttpException)) throw error;
        outcomes.push({ id: item.id, ok: false, ...describeRefusal(error) });
      }
    }
    return outcomes;
  }

  private async loadForDecision(
    chapterId: string,
    userId: string,
    id: string,
  ): Promise<{ row: AiSuggestion; handler: AiSuggestionKindHandler }> {
    const row = await this.repo.findById(chapterId, id);
    const handler = row ? this.kinds.get(row.kind) : undefined;
    // A suggestion whose source the caller can't open reads as missing, so
    // no response confirms an Exec meeting's suggestion exists.
    if (
      !row ||
      !handler ||
      !(await this.openableSources(chapterId, userId, [row])).has(
        sourceKey(row.source_type, row.source_id),
      )
    ) {
      throw new NotFoundException({
        code: 'ai.suggestion.not_found',
        message: 'Suggestion not found',
      });
    }
    // Checked now, whatever the member held when it was made.
    if (
      !(await this.rbac.memberHasAnyPermission(chapterId, userId, [
        row.required_permission,
      ]))
    ) {
      throw new ForbiddenException({
        code: 'ai.suggestion.forbidden',
        message: 'You do not have permission to act on this suggestion.',
      });
    }
    return { row, handler };
  }

  private isWaiting(row: AiSuggestion): boolean {
    return (
      row.status === 'pending' &&
      Date.parse(row.expires_at) > this.now().getTime()
    );
  }

  /**
   * The answer for a suggestion that is no longer waiting: the same outcome
   * again for a repeat of the same decision by the same member (a double
   * tap), otherwise a 409 saying what happened to it.
   */
  private alreadyDecided(
    row: AiSuggestion,
    userId: string,
    wanted: 'accepted' | 'dismissed',
  ): AiSuggestionDecisionResult {
    const repeat =
      row.status === wanted &&
      (wanted === 'dismissed' || row.decided_by === userId);
    if (repeat) {
      return {
        suggestion: row,
        result:
          row.status === 'accepted' && row.result_id
            ? { kind: row.kind, id: row.result_id }
            : null,
      };
    }
    // Mid-accept, or (re-read after a lost claim) put back by an accept that
    // failed: either way it may be waiting again in a moment.
    if (row.status === 'accepting' || this.isWaiting(row)) {
      throw new ConflictException({
        code: 'ai.suggestion.accepting',
        message:
          'Someone is already accepting this suggestion. Try again in a moment.',
      });
    }
    if (row.status === 'pending' || row.status === 'expired') {
      throw new ConflictException({
        code: 'ai.suggestion.expired',
        message: 'This suggestion has expired.',
      });
    }
    throw new ConflictException({
      code: 'ai.suggestion.decided',
      message:
        row.status === 'accepted'
          ? 'This suggestion was already accepted.'
          : 'This suggestion was already dismissed.',
    });
  }

  private async reread(chapterId: string, id: string): Promise<AiSuggestion> {
    const row = await this.repo.findById(chapterId, id);
    if (!row) {
      // Its source was deleted between the read and the claim.
      throw new NotFoundException({
        code: 'ai.suggestion.not_found',
        message: 'Suggestion not found',
      });
    }
    return row;
  }

  private async release(chapterId: string, id: string): Promise<void> {
    try {
      await this.repo.release(chapterId, id);
    } catch (error) {
      // It stays `accepting`, text intact, and the sweep puts it back.
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site: 'ai-suggestion-release',
        message: `could not put back suggestion ${id} after its commit failed`,
        error,
      });
    }
  }

  // ----------------------------------------------------------------- expire

  /**
   * Puts back to waiting every accept left `accepting` for ten minutes: the
   * API stopped between Accept and the change. Called by the hourly sweep,
   * before `expireDue`. Returns how many.
   */
  async releaseStaleAccepts(): Promise<number> {
    return this.repo.releaseStale(
      new Date(
        this.now().getTime() - AI_SUGGESTION_STALE_ACCEPT_MS,
      ).toISOString(),
    );
  }

  /**
   * Expires every waiting suggestion whose time is up, in every chapter, and
   * empties its text. Called by the hourly sweep. Returns how many expired.
   */
  async expireDue(): Promise<number> {
    const expired = await this.repo.expireDue(this.now().toISOString());
    const byChapterKind = countBy(
      expired,
      (row) => `${row.chapter_id}|${row.kind}`,
    );
    for (const [key, count] of byChapterKind) {
      const [chapterId, kind] = key.split('|');
      this.emit(
        this.analytics.trackForChapter('ai-suggestions-expired', chapterId, {
          kind,
          count,
        }),
      );
    }
    return expired.length;
  }
}

function sourceKey(type: AiSuggestionSourceType, id: string): string {
  return `${type}:${id}`;
}

function countBy<T>(
  rows: readonly T[],
  key: (row: T) => string,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const k = key(row);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

/** Order-insensitive for keys, order-sensitive for arrays (subtasks). */
function samePayload(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

function describeRefusal(error: HttpException): {
  status: number;
  code: string;
  message: string;
} {
  const response = error.getResponse();
  const body =
    typeof response === 'object' && response !== null
      ? (response as { code?: unknown; message?: unknown })
      : {};
  return {
    status: error.getStatus(),
    code: typeof body.code === 'string' ? body.code : 'ai.suggestion.refused',
    message:
      typeof body.message === 'string'
        ? body.message
        : typeof response === 'string'
          ? response
          : error.message,
  };
}
