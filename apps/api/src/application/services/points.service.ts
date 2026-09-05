import {
  Inject,
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import {
  POINT_TRANSACTION_REPOSITORY,
  PointTransactionDuplicateError,
} from '../../domain/repositories/point-transaction.repository.interface';
import type { IPointTransactionRepository } from '../../domain/repositories/point-transaction.repository.interface';
import { SEMESTER_ARCHIVE_REPOSITORY } from '../../domain/repositories/semester-archive.repository.interface';
import type { ISemesterArchiveRepository } from '../../domain/repositories/semester-archive.repository.interface';
import { USER_REPOSITORY } from '../../domain/repositories/user.repository.interface';
import type { IUserRepository } from '../../domain/repositories/user.repository.interface';
import type {
  PointTransaction,
  PointCategory,
} from '../../domain/entities/point-transaction.entity';
import { NotificationService } from './notification.service';
import { ChatService } from './chat.service';
import { ChapterPointsConfigService } from './chapter-points-config.service';
import { clampListLimit } from '../../domain/constants/list-query-limits';
import {
  resolveWindowSince,
  type PointsWindow,
} from '../../domain/utils/points-window';
import { resolveSemesterArchiveRangeOrThrow } from './resolve-semester-archive-range';

// Re-exported so existing importers (points.controller, etc.) keep their path;
// the canonical definition now lives in domain/utils/points-window.
export type { PointsWindow };

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
    const txns = await this.pointTxnRepo.findByChapter(chapterId);

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

    const totals = new Map<string, number>();
    for (const txn of filtered) {
      const prev = totals.get(txn.user_id) ?? 0;
      totals.set(txn.user_id, prev + txn.amount);
    }

    return Array.from(totals.entries())
      .map(([user_id, total]) => ({ user_id, total }))
      .sort((a, b) => b.total - a.total);
  }

  private static readonly RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

  async adjustPoints(input: AdjustPointsInput): Promise<PointTransaction> {
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
    // Checked HERE, before the rate-limit read below, deliberately: a replay is
    // the same adjustment, so it must not consume a second slot of the
    // adjustments/hour budget. Racing replays that both miss this read are
    // still caught by `idx_point_transactions_dedupe` at the insert.
    if (input.clientMessageId) {
      const existing = await this.pointTxnRepo.findByClientMessageId(
        input.chapterId,
        input.clientMessageId,
      );
      if (existing) return existing;
    }

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
        const existing = await this.pointTxnRepo.findByClientMessageId(
          error.chapter_id,
          error.client_message_id,
        );
        // A duplicate with no readable original would mean the index fired on a
        // row this chapter cannot see. Nothing sane to return, so surface it.
        if (!existing) throw error;
        return existing;
      }
      throw error;
    }

    // Everything below is a side effect of a NEW grant — the member's push
    // notification and the chat card. A replay returns above without reaching
    // any of it, which is the point: idempotency that re-notified the member on
    // every retry would just move the duplicate from the ledger to their phone.
    const isFine = input.category === 'FINE' || input.amount < 0;

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

    // The `/points` slash command asks us to surface an append-only card in
    // chat. The card is server-originated (a client cannot forge `kind:"points"`
    // — see ChatService.SERVER_ONLY_KINDS) and best-effort: the ledger row is the
    // source of truth, so a failed post is logged and never rolls the txn back.
    if (input.channelId && input.clientMessageId) {
      try {
        await this.postPointsCard(input, txn, isFine);
      } catch (error) {
        this.logger.warn('Failed to post points card to chat', {
          transactionId: txn.id,
          channelId: input.channelId,
          chapterId: input.chapterId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return txn;
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
