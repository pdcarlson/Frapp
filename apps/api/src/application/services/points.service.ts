import {
  Inject,
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import {
  POINT_TRANSACTION_REPOSITORY,
  PointTransactionDuplicateError,
} from '#domain/repositories/point-transaction.repository.interface';
import type {
  IPointTransactionRepository,
  PointsLeaderboardWindow,
} from '#domain/repositories/point-transaction.repository.interface';
import { SEMESTER_ARCHIVE_REPOSITORY } from '#domain/repositories/semester-archive.repository.interface';
import type { ISemesterArchiveRepository } from '#domain/repositories/semester-archive.repository.interface';
import { USER_REPOSITORY } from '#domain/repositories/user.repository.interface';
import type { IUserRepository } from '#domain/repositories/user.repository.interface';
import type {
  PointTransaction,
  PointCategory,
} from '#domain/entities/point-transaction.entity';
import { NotificationService } from './notification.service';
import { ChatService } from './chat.service';
import { ChapterPointsConfigService } from './chapter-points-config.service';
import { clampListLimit } from '#domain/constants/list-query-limits';
import {
  resolveWindowSince,
  type PointsWindow,
} from '#domain/utils/points-window';
import { resolveSemesterArchiveRangeOrThrow } from './resolve-semester-archive-range';

// Re-exported so existing importers (points.controller, etc.) keep their path;
// the canonical definition now lives in domain/utils/points-window.
export type { PointsWindow };

/**
 * The ledger row, plus whether the chat card that accompanies it was posted.
 *
 * `card_posted` is present ONLY when this request actually attempted a card —
 * chat context supplied (`channelId` + `clientMessageId`) **and** not a replay,
 * which fires no side effect at all (see {@link PointsService.completeReplay}).
 * A dashboard adjustment's response shape is therefore unchanged. The card stays
 * best-effort — a failed post never rolls the ledger back — but the caller now
 * learns it failed instead of inferring success from the 2xx and leaving its
 * optimistic placeholder up forever (#544).
 */
export type AdjustPointsResult = PointTransaction & {
  card_posted?: boolean;
};

interface AdjustPointsInput {
  chapterId: string;
  targetUserId: string;
  adminUserId: string;
  amount: number;
  category: Extract<PointCategory, 'MANUAL' | 'FINE'>;
  reason: string;
  /**
   * When set together with `clientMessageId`, an append-only points card is
   * posted to this chat channel after the ledger write (the `/points` slash
   * command). Omitted for dashboard adjustments.
   */
  channelId?: string;
  /**
   * Client-minted idempotency key (UUIDv4). It is the dedupe key for **both**
   * the ledger row and the chat card: a replay carrying the same key returns
   * the original transaction rather than granting again (#1719). Absent for
   * dashboard adjustments, which are not deduplicated.
   */
  clientMessageId?: string;
}

@Injectable()
export class PointsService {
  private readonly logger = new Logger(PointsService.name);

  constructor(
    @Inject(POINT_TRANSACTION_REPOSITORY)
    private readonly pointTxnRepo: IPointTransactionRepository,
    @Inject(SEMESTER_ARCHIVE_REPOSITORY)
    private readonly semesterArchiveRepo: ISemesterArchiveRepository,
    @Inject(USER_REPOSITORY)
    private readonly userRepo: IUserRepository,
    private readonly notificationService: NotificationService,
    private readonly chatService: ChatService,
    private readonly chapterPointsConfig: ChapterPointsConfigService,
  ) {}

  private filterByWindow(
    transactions: PointTransaction[],
    window: PointsWindow = 'all',
    semesterRange?: { after: Date },
  ): PointTransaction[] {
    if (window === 'all') return transactions;

    const now = new Date();

    // Exclusive lower bound for the active window, matching the
    // get_points_report RPC (created_at > p_since) so the leaderboard and the
    // points report agree for the same window. Month: now − 1 calendar month.
    // Semester: end of the latest archive's end_date day (a transaction recorded
    // on the end_date day belongs to the archived period, hence exclusive); no
    // archive → all-time.
    const since =
      window === 'month'
        ? resolveWindowSince('month', { now })
        : (semesterRange?.after ?? null);
    if (!since) return transactions;

    return transactions.filter((txn) => {
      const createdAt = new Date(txn.created_at);
      return (
        !Number.isNaN(createdAt.getTime()) &&
        createdAt > since &&
        createdAt <= now
      );
    });
  }

  /**
   * Lower bound (exclusive) for the active "this semester" window. The archived
   * period covers whole calendar days `[start_date, end_date]` (both are SQL
   * `date` values, e.g. '2026-06-15'), so the active period begins after the
   * END of the latest archive's end_date day. A transaction recorded anytime on
   * the end_date day belongs to the archived period (see
   * spec/behavior/semester-rollover.md). Uses the most-recently-created archive
   * (`findLatestByChapter`), which assumes `end_date` increases with
   * `created_at` — true for the normal sequential rollover flow. Returns
   * undefined when no — or an unparseable — archive exists, so the caller falls
   * back to all-time.
   */
  private async getSemesterRange(
    chapterId: string,
  ): Promise<{ after: Date } | undefined> {
    const archive =
      await this.semesterArchiveRepo.findLatestByChapter(chapterId);
    if (!archive) return undefined;
    // Boundary math is centralized in resolveWindowSince so the leaderboard and
    // the points report (report.service.ts) share one definition of "semester".
    const after = resolveWindowSince('semester', {
      now: new Date(),
      latestArchiveEndDate: archive.end_date,
    });
    return after ? { after } : undefined;
  }

  /**
   * Filter to one archived period's exact `[since, until]` range — distinct
   * from {@link filterByWindow}'s `all | semester | month` enum, which always
   * measures relative to *now* or the *latest* archive. Selecting an archive
   * by id overrides `window` entirely: an explicit historical period is more
   * specific than the enum, never a refinement of it.
   */
  private filterByArchiveRange(
    transactions: PointTransaction[],
    range: { since: Date; until: Date },
  ): PointTransaction[] {
    return transactions.filter((txn) => {
      const createdAt = new Date(txn.created_at);
      return (
        !Number.isNaN(createdAt.getTime()) &&
        createdAt > range.since &&
        createdAt <= range.until
      );
    });
  }

  async getUserSummary(
    chapterId: string,
    userId: string,
    window: PointsWindow = 'all',
    semesterArchiveId?: string,
  ): Promise<{ balance: number; transactions: PointTransaction[] }> {
    const txns = await this.pointTxnRepo.findByUser(chapterId, userId);

    let filtered: PointTransaction[];
    if (semesterArchiveId) {
      const range = await resolveSemesterArchiveRangeOrThrow(
        this.semesterArchiveRepo,
        semesterArchiveId,
        chapterId,
      );
      filtered = this.filterByArchiveRange(txns, range);
    } else {
      const semesterRange =
        window === 'semester'
          ? await this.getSemesterRange(chapterId)
          : undefined;
      filtered = this.filterByWindow(txns, window, semesterRange);
    }
    const balance = filtered.reduce((sum, txn) => sum + txn.amount, 0);

    return { balance, transactions: filtered };
  }

  /**
   * Chapter-wide transaction list for the points admin Audit tab.
   *
   * Filters (user, category, flagged, `before` cursor), sort (newest first),
   * and limit are applied in Postgres via `findByChapterFiltered`, so work and
   * memory scale with the page size rather than full chapter history.
   */
  async listTransactions(
    chapterId: string,
    options: {
      userId?: string;
      category?: PointCategory;
      flagged?: boolean;
      before?: string;
      limit?: number;
    } = {},
  ): Promise<PointTransaction[]> {
    const limit = clampListLimit(options.limit);

    let beforeIso: string | undefined;
    if (options.before) {
      const parsed = new Date(options.before);
      if (!Number.isNaN(parsed.getTime())) {
        beforeIso = parsed.toISOString();
      }
    }

    return this.pointTxnRepo.findByChapterFiltered(chapterId, {
      userId: options.userId,
      category: options.category,
      flagged: options.flagged,
      before: beforeIso,
      limit,
    });
  }

  /**
   * Translate the requested window into the `(since, until]` bounds the
   * leaderboard aggregation applies in Postgres.
   *
   * Mirrors {@link filterByWindow} and {@link filterByArchiveRange} exactly,
   * because those still serve `getUserSummary` and the two must agree on what a
   * window means. Three cases produce *no* bounds at all, and conflating them
   * with "bounded by now" would silently drop future-dated rows a chapter can
   * see today: `all`, and `semester` on a chapter with no archive yet (where
   * `filterByWindow` returns the list untouched because `since` is null).
   *
   * `now` is read once and used for both the month lower bound and the upper
   * bound, so a leaderboard cannot be computed against two different instants.
   */
  private async resolveLeaderboardWindow(
    chapterId: string,
    window: PointsWindow,
    semesterArchiveId?: string,
  ): Promise<PointsLeaderboardWindow> {
    if (semesterArchiveId) {
      const range = await resolveSemesterArchiveRangeOrThrow(
        this.semesterArchiveRepo,
        semesterArchiveId,
        chapterId,
      );
      return {
        since: range.since.toISOString(),
        until: range.until.toISOString(),
      };
    }

    if (window === 'all') return {};

    const now = new Date();
    // Branch on each window by name rather than treating "not month" as
    // semester. `filterByWindow` guards its archive lookup with an explicit
    // `window === 'semester'`, and collapsing that into an else would hand
    // semester bounds to any window added later — silently, since only
    // `resolveWindowSince` has the `never` exhaustiveness check that would
    // force the author to notice. The leaderboard would then disagree with the
    // same member's own balance for that new window.
    let since: Date | null;
    if (window === 'month') {
      since = resolveWindowSince('month', { now });
    } else if (window === 'semester') {
      since = (await this.getSemesterRange(chapterId))?.after ?? null;
    } else {
      const exhaustive: never = window;
      throw new BadRequestException(
        `Unsupported points window: ${String(exhaustive)}`,
      );
    }

    // No resolvable lower bound — a 'semester' window on a chapter that has not
    // rolled over yet. That means all-time, which is NO bound on either side:
    // `filterByWindow` expresses it by returning the list untouched, so a
    // future-dated row counts. Returning `{ until: now }` here would look
    // equivalent and quietly drop those rows.
    if (!since) return {};

    return { since: since.toISOString(), until: now.toISOString() };
  }

  /**
   * Per-member point totals for the chapter, ranked.
   *
   * The sum happens in Postgres (`get_points_leaderboard`), so this returns one
   * row per member rather than loading the chapter's full transaction history
   * into the API process (#522). Only the window boundaries are resolved here —
   * see {@link resolveLeaderboardWindow} for why they are not re-derived in SQL.
   */
  async getLeaderboard(
    chapterId: string,
    window: PointsWindow = 'all',
    semesterArchiveId?: string,
  ): Promise<
    {
      user_id: string;
      total: number;
    }[]
  > {
    const bounds = await this.resolveLeaderboardWindow(
      chapterId,
      window,
      semesterArchiveId,
    );

    return this.pointTxnRepo.leaderboard(chapterId, bounds);
  }

  private static readonly RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

  async adjustPoints(input: AdjustPointsInput): Promise<AdjustPointsResult> {
    if (!input.reason || input.reason.trim().length === 0) {
      throw new BadRequestException('Reason is required for point adjustments');
    }

    if (input.adminUserId === input.targetUserId) {
      throw new ForbiddenException('Admins cannot adjust their own points');
    }

    // Idempotency (#1719). A `/points` dispatch whose response was lost — a
    // gateway 502/504 arriving after the row committed is the commonest case —
    // cannot tell the officer whether the grant landed, so a retry must be a
    // no-op rather than a second grant into an append-only ledger.
    //
    // Checked HERE, before the rate-limit read below, deliberately — but NOT
    // to protect the adjustments/hour budget, which is derived from committed
    // rows and so is unaffected either way (a replay writes none). The reason
    // is that an officer at the ceiling whose grant already landed must not be
    // told it was refused: reaching the limit check first would answer 429 for
    // an adjustment that committed. See the re-check on that refusal path.
    //
    // Racing replays that both miss this read are still caught by
    // `idx_point_transactions_dedupe` at the insert.
    const replay = await this.resolveReplay(input);
    if (replay) return this.completeReplay(replay);

    // Both anti-fraud limits are chapter-configurable (spec/behavior/points.md
    // § Anti-Fraud). A chapter with no `chapter_points_config` row gets the
    // defaults, which are the values this service used to hardcode — 50/hr and
    // ±100 — so an unconfigured chapter behaves exactly as it always did.
    // Read once, before the rate check, so the same snapshot decides both the
    // refusal below and the flag further down.
    const { adjustment_rate_limit_per_hour: rateLimit, anomaly_threshold } =
      await this.chapterPointsConfig.getConfig(input.chapterId);

    const since = new Date(Date.now() - PointsService.RATE_LIMIT_WINDOW_MS);
    const recentCount = await this.pointTxnRepo.countRecentAdjustments(
      input.adminUserId,
      input.chapterId,
      since,
    );
    if (recentCount >= rateLimit) {
      // A racing replay whose twin committed between the pre-check above and
      // this count would otherwise be refused 429 for an adjustment that DID
      // land — telling the officer it was rate-limited when it succeeded. One
      // extra read, only on the refusal path, buys the honest answer.
      const raced = await this.resolveReplay(input);
      if (raced) return this.completeReplay(raced);

      throw new HttpException(
        `Rate limit exceeded: maximum ${rateLimit} point adjustments per hour`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const metadata: Record<string, unknown> = {
      adjusted_by: input.adminUserId,
      reason: input.reason,
    };

    if (Math.abs(input.amount) >= anomaly_threshold) {
      metadata.flagged = true;
    }

    let txn: PointTransaction;
    try {
      txn = await this.pointTxnRepo.create({
        chapter_id: input.chapterId,
        user_id: input.targetUserId,
        amount: input.amount,
        category: input.category,
        description: input.reason,
        metadata,
        client_message_id: input.clientMessageId ?? null,
      });
    } catch (error) {
      // Two requests carrying one key raced past the pre-check above and the
      // unique index arbitrated. The loser returns the winner's row: the caller
      // asked for one adjustment and got exactly one.
      if (error instanceof PointTransactionDuplicateError) {
        const raced = await this.resolveReplay(input);
        // A duplicate with no readable original would mean the index fired on a
        // row this chapter cannot see. Nothing sane to return, so surface it.
        if (!raced) throw error;
        return this.completeReplay(raced);
      }
      throw error;
    }

    // The member's push notification fires only for a NEW grant. It is the one
    // side effect that is NOT idempotent — re-sending it on every replay would
    // just move the duplicate from the ledger to their phone.
    const isFine = PointsService.isFine(input);

    try {
      await this.notificationService.notifyUser(
        input.targetUserId,
        input.chapterId,
        {
          title: isFine ? 'Points Deducted' : 'Points Awarded',
          body: isFine
            ? `You were fined ${Math.abs(input.amount)} points: ${input.reason}`
            : `You received ${input.amount} points: ${input.reason}`,
          priority: 'NORMAL',
          category: 'points',
          data: { target: { screen: 'points' } },
        },
      );
    } catch {}

    // The card is best-effort and the ledger row is the source of truth, so a
    // failed post is never rolled back — but the outcome is now REPORTED rather
    // than swallowed. The client renders an optimistic `loading` placeholder
    // keyed on `clientMessageId` and waits for the Realtime echo of this card to
    // reconcile it; when the post fails that echo never arrives, so without an
    // explicit signal the placeholder is permanent and the officer cannot tell a
    // committed grant from a lost one (#544).
    //
    // `undefined` means no card was attempted (a dashboard adjustment), which is
    // reported as an ABSENT field rather than a `false` that would claim a card
    // failed when none was ever due.
    const cardPosted = await this.tryPostPointsCard(input, txn);

    return cardPosted === undefined ? txn : { ...txn, card_posted: cardPosted };
  }

  private static isFine(input: AdjustPointsInput): boolean {
    return input.category === 'FINE' || input.amount < 0;
  }

  /**
   * Resolve a request carrying an idempotency key against the ledger.
   *
   * Returns the original transaction when this key already committed **the
   * same adjustment**, `null` when the key is unused (or absent), and throws
   * 409 when the key was used for a *different* adjustment.
   *
   * That last case is the one worth being strict about. The key is
   * client-supplied and validated only as a UUID, and the index is scoped
   * `(chapter_id, client_message_id)` — so a colliding or reused key names a
   * row that may belong to another member entirely. Returning it would answer
   * "granted" while writing nothing and silently discarding the adjustment the
   * caller actually asked for. A loud 409 is recoverable; a 200 carrying
   * someone else's row is not.
   */
  private async resolveReplay(
    input: AdjustPointsInput,
  ): Promise<PointTransaction | null> {
    if (!input.clientMessageId) return null;

    const existing = await this.pointTxnRepo.findByClientMessageId(
      input.chapterId,
      input.clientMessageId,
    );
    if (!existing) return null;

    const metadata = (existing.metadata ?? {}) as { adjusted_by?: unknown };
    const sameAdjustment =
      existing.user_id === input.targetUserId &&
      existing.amount === input.amount &&
      existing.category === input.category &&
      existing.description === input.reason &&
      metadata.adjusted_by === input.adminUserId;

    if (!sameAdjustment) {
      throw new ConflictException(
        'This idempotency key was already used for a different point adjustment. Retry with the original request, or a new client_message_id for a new adjustment.',
      );
    }

    return existing;
  }

  /**
   * Finish a replay: return the original row, firing no side effect at all.
   *
   * An earlier revision of this re-attempted the chat card here, reasoning that
   * the first attempt's post is best-effort and a card lost there could
   * otherwise never be healed. **That was unsafe, and the reason is worth
   * keeping:** `idx_chat_messages_dedupe` is scoped
   * `(channel_id, sender_id, client_message_id)` — not by key alone — while the
   * ledger row carries no channel at all. So a replay cannot prove it names the
   * channel the original card went to, and re-posting would not deduplicate
   * against it. A caller could send a byte-identical body with a different
   * `channel_id` and get a *second* audit card for one ledger row, which for a
   * FINE means re-broadcasting a member's penalty to a wider audience.
   *
   * Healing a lost card needs the origin channel recorded on the transaction;
   * until then the ledger row is the durable record and the card is not. See
   * #1734.
   *
   * `card_posted` is therefore **absent** on this path, never `false`: no card
   * was attempted, and the row records nothing about whether the original
   * attempt landed. Under the field's contract (#544) an absent value means the
   * server reported no outcome, which is exactly the truth here — so the caller
   * leaves its placeholder for the original card's echo rather than tearing
   * down one that may still reconcile.
   */
  private completeReplay(existing: PointTransaction): PointTransaction {
    return existing;
  }

  /**
   * The `/points` slash command asks us to surface an append-only card in chat.
   * The card is server-originated (a client cannot forge `kind:"points"` — see
   * ChatService.SERVER_ONLY_KINDS) and best-effort: the ledger row is the
   * source of truth, so a failed post is logged and never rolls the txn back.
   *
   * Returns whether the card posted, or `undefined` when no card was due
   * (no chat context) — the three-way distinction `card_posted` publishes.
   */
  private async tryPostPointsCard(
    input: AdjustPointsInput,
    txn: PointTransaction,
  ): Promise<boolean | undefined> {
    if (!input.channelId || !input.clientMessageId) return undefined;

    try {
      await this.postPointsCard(input, txn, PointsService.isFine(input));
      return true;
    } catch (error) {
      this.logger.warn('Failed to post points card to chat', {
        transactionId: txn.id,
        channelId: input.channelId,
        chapterId: input.chapterId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Post the `kind:"points"` card for a committed adjustment. Names are resolved
   * here and embedded in the payload so the card stays a correct immutable audit
   * record even if a member later leaves the chapter. Posts as the admin (the
   * actor) into the channel they ran the command from; channel access is
   * re-checked by `ChatService.sendMessage`.
   */
  private async postPointsCard(
    input: AdjustPointsInput,
    txn: PointTransaction,
    isFine: boolean,
  ): Promise<void> {
    const users = await this.userRepo.findByIds([
      input.adminUserId,
      input.targetUserId,
    ]);
    const nameOf = (id: string): string =>
      users.find((u) => u.id === id)?.display_name ?? 'Unknown member';
    const actorName = nameOf(input.adminUserId);
    const recipientName = nameOf(input.targetUserId);

    const payload = {
      actor_user_id: input.adminUserId,
      actor_name: actorName,
      recipient_user_id: input.targetUserId,
      recipient_name: recipientName,
      amount: txn.amount,
      category: input.category,
      reason: input.reason,
      transaction_id: txn.id,
      created_at: txn.created_at,
    };

    const verb = isFine ? 'Deducted' : 'Granted';
    const preposition = isFine ? 'from' : 'to';
    const content = `${verb} ${Math.abs(txn.amount)} points ${preposition} ${recipientName}: ${input.reason}`;

    await this.chatService.sendMessage({
      chapter_id: input.chapterId,
      channel_id: input.channelId!,
      sender_id: input.adminUserId,
      content,
      kind: 'points',
      payload,
      client_message_id: input.clientMessageId,
      system_originated: true,
    });
  }
}
