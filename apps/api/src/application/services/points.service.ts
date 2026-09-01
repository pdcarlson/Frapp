import {
  Inject,
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { POINT_TRANSACTION_REPOSITORY } from '../../domain/repositories/point-transaction.repository.interface';
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
import {
  LIST_QUERY_LIMIT_DEFAULT,
  LIST_QUERY_LIMIT_MAX,
  LIST_QUERY_LIMIT_MIN,
} from '../../domain/constants/list-query-limits';
import {
  resolveWindowSince,
  resolveArchiveRange,
  type PointsWindow,
} from '../../domain/utils/points-window';

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
   * Resolve a specific archived period by id, chapter-scoped so an id from
   * another chapter 404s exactly like an unknown one — never distinguishing
   * "wrong chapter" from "doesn't exist" for a caller probing ids.
   */
  private async resolveArchive(
    chapterId: string,
    semesterArchiveId: string,
  ): Promise<{ since: Date; until: Date }> {
    const archive = await this.semesterArchiveRepo.findById(
      semesterArchiveId,
      chapterId,
    );
    if (!archive) {
      throw new NotFoundException('Semester archive not found');
    }
    const range = resolveArchiveRange(archive);
    if (!range) {
      throw new NotFoundException('Semester archive not found');
    }
    return range;
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
      const range = await this.resolveArchive(chapterId, semesterArchiveId);
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
    const limit = Math.max(
      LIST_QUERY_LIMIT_MIN,
      Math.min(options.limit ?? LIST_QUERY_LIMIT_DEFAULT, LIST_QUERY_LIMIT_MAX),
    );

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
      const range = await this.resolveArchive(chapterId, semesterArchiveId);
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
  private static readonly RATE_LIMIT_MAX = 50;

  async adjustPoints(input: AdjustPointsInput): Promise<PointTransaction> {
    if (!input.reason || input.reason.trim().length === 0) {
      throw new BadRequestException('Reason is required for point adjustments');
    }

    if (input.adminUserId === input.targetUserId) {
      throw new ForbiddenException('Admins cannot adjust their own points');
    }

    const since = new Date(Date.now() - PointsService.RATE_LIMIT_WINDOW_MS);
    const recentCount = await this.pointTxnRepo.countRecentAdjustments(
      input.adminUserId,
      input.chapterId,
      since,
    );
    if (recentCount >= PointsService.RATE_LIMIT_MAX) {
      throw new HttpException(
        'Rate limit exceeded: maximum 50 point adjustments per hour',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const metadata: Record<string, unknown> = {
      adjusted_by: input.adminUserId,
      reason: input.reason,
    };

    const anomalyThreshold = 100;
    if (Math.abs(input.amount) >= anomalyThreshold) {
      metadata.flagged = true;
    }

    const txn = await this.pointTxnRepo.create({
      chapter_id: input.chapterId,
      user_id: input.targetUserId,
      amount: input.amount,
      category: input.category,
      description: input.reason,
      metadata,
    });

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
