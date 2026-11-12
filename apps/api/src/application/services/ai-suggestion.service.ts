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
import { isModuleEnabled } from '@repo/validation';
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
  }[];
  /** Who hears about the batch. Defaults to `requestedFor`. */
  notify?: readonly string[];
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
 * - **No text once decided.** Accepting, dismissing and expiring empty the
 *   proposal and its quote in the same write; the record of who decided,
 *   when, and what it became stays.
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
      if (!handler || !payload) {
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
        required_permission: handler.requiredPermission,
        expires_at: new Date(
          now.getTime() + handler.expiresAfterDays * DAY_MS,
        ).toISOString(),
      });
    });

    const created = await this.repo.insertBatch(input.chapterId, rows);

    if (created.length > 0) {
      await this.notifyBatch(input, created);
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
   * One push for the whole batch, to each member it names who could accept
   * at least one of its suggestions. Best-effort: the suggestions are saved
   * whatever happens here, and the Suggested list shows them.
   */
  private async notifyBatch(
    input: ProposeAiSuggestionsInput,
    created: readonly AiSuggestion[],
  ): Promise<void> {
    const candidates = [
      ...new Set(
        input.notify ?? (input.requestedFor ? [input.requestedFor] : []),
      ),
    ];
    if (candidates.length === 0) return;
    try {
      const recipients: string[] = [];
      for (const userId of candidates) {
        const visible = await this.visibleTo(
          input.chapterId,
          userId,
          created,
          null,
        );
        if (visible.length > 0) recipients.push(userId);
      }
      if (recipients.length === 0) return;

      const kinds = [...new Set(created.map((row) => row.kind))];
      const only = kinds.length === 1 ? this.kinds.get(kinds[0]) : undefined;
      await this.notifications.notifyMembers(input.chapterId, recipients, {
        title: input.source.title,
        body: only
          ? only.describeBatch(created.length)
          : `${created.length} suggestions to review`,
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
    } catch (error) {
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site: 'ai-suggestions-notify',
        message: `batch push failed for ${created.length} suggestions in chapter ${input.chapterId}`,
        error,
      });
    }
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
    const rows = await this.repo.listPending(chapterId, {
      permissions: held.has(WILDCARD)
        ? null
        : [...this.kinds.values()]
            .map((handler) => handler.requiredPermission)
            .filter((permission) => held.has(permission)),
      source: options.source,
      now: this.now().toISOString(),
      limit: AI_SUGGESTION_LIST_LIMIT + 1,
    });
    const page = rows.slice(0, AI_SUGGESTION_LIST_LIMIT);
    const items = await this.visibleTo(
      chapterId,
      userId,
      page,
      options.enabledModules,
      held,
    );
    return { items, has_more: rows.length > AI_SUGGESTION_LIST_LIMIT };
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
   * A second accept by the same member returns the first one's outcome.
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
      status: 'accepted',
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
      await this.release(chapterId, row);
      throw error;
    }

    try {
      await this.repo.setResult(chapterId, id, resultId);
    } catch (error) {
      // The change is made and the suggestion is decided; only the link from
      // one to the other is missing. Failing the request would invite a retry
      // that finds it decided anyway.
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site: 'ai-suggestion-result',
        message: `result link not saved for suggestion ${id}`,
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
      suggestion: { ...claimed, result_id: resultId },
      result: { kind: row.kind, id: resultId },
    };
  }

  /** Dismisses a suggestion. Dismissing one already dismissed changes nothing. */
  async dismiss(
    chapterId: string,
    userId: string,
    id: string,
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
        properties: { kind: row.kind },
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

  private async release(chapterId: string, row: AiSuggestion): Promise<void> {
    try {
      await this.repo.release(chapterId, row.id, {
        payload: row.payload,
        quote: row.quote,
        quote_author_id: row.quote_author_id,
      });
    } catch (error) {
      // The suggestion stays accepted with no result, and the change was not
      // made. Reported; the officer makes the change by hand.
      reportCaughtFailure(this.logger, {
        level: 'error',
        site: 'ai-suggestion-release',
        message: `could not put back suggestion ${row.id} after its commit failed`,
        error,
      });
    }
  }

  // ----------------------------------------------------------------- expire

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
