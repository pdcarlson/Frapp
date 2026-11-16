import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { isModuleEnabled, moduleDisabledMessage } from '@repo/validation';
import type {
  PredictionAnswer,
  PredictionMarket,
  PredictionMarketStatus,
  PredictionStake,
} from '#domain/entities/prediction.entity';
import {
  PREDICTION_REPOSITORY,
  PredictionRefusal,
  type IPredictionRepository,
} from '#domain/repositories/prediction.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import type { EnabledModules } from './module-gate';
import { ChannelAccessService } from './channel-access.service';
import { ChapterPointsConfigService } from './chapter-points-config.service';
import { PointsService } from './points.service';
import { RbacService } from './rbac.service';
import { reportCaughtFailure } from '../../infrastructure/observability/report-caught-failure';

export const PREDICTIONS_MODULE = 'predictions';
export const PREDICTION_ANSWERS_MIN = 2;
export const PREDICTION_ANSWERS_MAX = 10;
/** How long stakers have to question a result before it pays. */
export const QUESTION_WINDOW_MS = 24 * 60 * 60 * 1000;
const LIST_LIMIT = 100;
const PAY_SWEEP_BATCH = 50;

/** Who is asking, as the guards resolved them. */
export interface PredictionActor {
  chapterId: string;
  userId: string;
  enabledModules: EnabledModules;
}

export interface CreatePredictionInput {
  channelId: string;
  question: string;
  settleRule: string;
  answers: string[];
  closesAt: string;
  settlerId?: string | null;
  namedMemberId?: string | null;
  clientMessageId?: string | null;
}

export interface PredictionAnswerView {
  id: string;
  label: string;
  /** Points staked on this answer. */
  pool: number;
  /** Share of all staked points, whole percent; `null` before anyone stakes. */
  chance: number | null;
}

export interface PredictionStakerView {
  user_id: string;
  answer_id: string;
  amount: number;
}

export interface PredictionMarketView {
  market: PredictionMarket;
  answers: PredictionAnswerView[];
  total_staked: number;
  /** Every member's total stake per answer, named (spec § Where it lives). */
  stakers: PredictionStakerView[];
  /** The viewer's own total per answer. */
  my_stakes: PredictionStakerView[];
  /** Why the viewer can't stake right now, or `null` when they can. */
  stake_blocked_reason: string | null;
  /** Unresolved questions about the result, for whoever decides them. */
  open_questions: PredictionQuestionView[];
}

export interface PredictionQuestionView {
  user_id: string;
  note: string;
  created_at: string;
}

/**
 * Predictions (#5133, `spec/behavior/predictions.md`). The pool math and
 * every point movement live in the database functions the repository
 * calls; this service decides who may do what, and when.
 */
@Injectable()
export class PredictionService {
  private readonly logger = new Logger(PredictionService.name);

  constructor(
    @Inject(PREDICTION_REPOSITORY)
    private readonly repo: IPredictionRepository,
    @Inject(MEMBER_REPOSITORY)
    private readonly memberRepo: IMemberRepository,
    private readonly channelAccess: ChannelAccessService,
    private readonly pointsConfig: ChapterPointsConfigService,
    private readonly points: PointsService,
    private readonly rbac: RbacService,
  ) {}

  /**
   * Predictions are off unless a chapter turned them on: unlike the other
   * modules, an absent key means off (spec § Module and permissions). They
   * also need Points, since the stake is points.
   *
   * Only what puts points in (asking, staking, opening one) checks this.
   * Reading, settling, questioning, confirming and voiding stay open with the
   * module off, so turning it off never strands a stake.
   */
  assertEnabled(enabledModules: EnabledModules): void {
    for (const key of [PREDICTIONS_MODULE, 'points']) {
      const on =
        key === PREDICTIONS_MODULE
          ? enabledModules?.[key] === true
          : isModuleEnabled(enabledModules, key);
      if (!on) {
        throw new ForbiddenException({
          code: 'chapter.module.disabled',
          message: moduleDisabledMessage(key),
        });
      }
    }
  }

  async create(
    actor: PredictionActor,
    input: CreatePredictionInput,
  ): Promise<PredictionMarketView> {
    this.assertEnabled(actor.enabledModules);
    if (input.clientMessageId) {
      const existing = await this.repo.findMarketByClientMessageId(
        actor.chapterId,
        input.clientMessageId,
      );
      if (existing) {
        if (existing.created_by !== actor.userId) {
          throw new ConflictException('That key was already used.');
        }
        return this.view(actor, existing);
      }
    }

    await this.channelAccess.assertChannelAccess(
      input.channelId,
      actor.chapterId,
      actor.userId,
      'post',
    );

    const answers = input.answers.map((a) => a.trim());
    if (
      answers.length < PREDICTION_ANSWERS_MIN ||
      answers.length > PREDICTION_ANSWERS_MAX
    ) {
      throw new BadRequestException(
        `A prediction needs between ${PREDICTION_ANSWERS_MIN} and ${PREDICTION_ANSWERS_MAX} answers.`,
      );
    }
    if (answers.some((a) => a.length === 0)) {
      throw new BadRequestException('Every answer needs a label.');
    }
    const lowered = answers.map((a) => a.toLowerCase());
    if (new Set(lowered).size !== lowered.length) {
      throw new BadRequestException('Two answers have the same label.');
    }
    const question = input.question.trim();
    const settleRule = input.settleRule.trim();
    if (!question || !settleRule) {
      throw new BadRequestException(
        'A prediction needs a question and a rule.',
      );
    }
    if (new Date(input.closesAt).getTime() <= Date.now()) {
      throw new BadRequestException('The close time has to be in the future.');
    }

    const settlerId = input.settlerId ?? actor.userId;
    const namedMemberId = input.namedMemberId ?? null;
    for (const id of [settlerId, namedMemberId]) {
      if (id && id !== actor.userId)
        await this.assertMember(actor.chapterId, id);
    }
    if (namedMemberId && namedMemberId === settlerId) {
      throw new BadRequestException(
        "The member a question names can't also settle it.",
      );
    }

    const market = await this.repo.createMarket(
      {
        chapter_id: actor.chapterId,
        channel_id: input.channelId,
        created_by: actor.userId,
        settler_id: settlerId,
        named_member_id: namedMemberId,
        question,
        settle_rule: settleRule,
        closes_at: input.closesAt,
        // A question naming someone else waits for their OK. Naming yourself
        // is your OK.
        status:
          namedMemberId && namedMemberId !== actor.userId
            ? 'awaiting_consent'
            : 'open',
        client_message_id: input.clientMessageId ?? null,
      },
      answers,
    );
    return this.view(actor, market);
  }

  async get(
    actor: PredictionActor,
    marketId: string,
  ): Promise<PredictionMarketView> {
    const market = await this.readable(actor, marketId);
    return this.view(actor, market);
  }

  async list(
    actor: PredictionActor,
    filter: 'open' | 'mine' | 'settled' | 'all',
  ): Promise<PredictionMarketView[]> {
    let markets: PredictionMarket[];
    if (filter === 'mine') {
      // Read by id, not by recency: a member never loses track of points
      // they staked, however many questions came after (spec § Where it lives).
      const ids = await this.repo.listMarketIdsStakedBy(
        actor.chapterId,
        actor.userId,
      );
      const [staked, asked] = await Promise.all([
        this.repo.listMarkets(actor.chapterId, { ids, limit: LIST_LIMIT }),
        this.repo.listMarkets(actor.chapterId, {
          createdBy: actor.userId,
          limit: LIST_LIMIT,
        }),
      ]);
      const byId = new Map([...staked, ...asked].map((m) => [m.id, m]));
      markets = [...byId.values()].sort(
        (a, b) =>
          b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
      );
    } else {
      const statuses: PredictionMarketStatus[] | undefined =
        filter === 'open'
          ? ['open', 'awaiting_consent']
          : filter === 'settled'
            ? ['settled', 'questioned', 'paid', 'voided']
            : undefined;
      markets = await this.repo.listMarkets(actor.chapterId, {
        statuses,
        limit: LIST_LIMIT,
      });
    }

    // Filtered after the limit, as the poll list is: a page may hold fewer
    // rows than the limit, and is never widened to backfill hidden ones.
    const visible = await this.channelAccess.filterAccessibleChannelIds(
      actor.chapterId,
      actor.userId,
      [...new Set(markets.map((m) => m.channel_id))],
      // An archived channel's questions still hold points; they stay listed.
      { includeArchived: true },
    );
    // A question waiting on a named member is theirs and the creator's only.
    const shown = markets.filter(
      (m) =>
        visible.has(m.channel_id) &&
        (m.status !== 'awaiting_consent' ||
          m.created_by === actor.userId ||
          m.named_member_id === actor.userId),
    );
    return this.views(actor, shown);
  }

  async stake(
    actor: PredictionActor,
    marketId: string,
    input: { answerId: string; amount: number; clientMessageId: string },
  ): Promise<PredictionMarketView> {
    // A replay returns what the first request did, even once the question
    // has closed since; the key is checked again under the lock below.
    const replayed = await this.repo.findStakeByClientMessageId(
      actor.chapterId,
      input.clientMessageId,
    );
    if (replayed) {
      const same =
        replayed.user_id === actor.userId &&
        replayed.market_id === marketId &&
        replayed.answer_id === input.answerId &&
        replayed.amount === input.amount;
      if (!same)
        throw this.httpRefusal(
          new PredictionRefusal('prediction.stake.key_reused'),
        );
      return this.get(actor, marketId);
    }

    this.assertEnabled(actor.enabledModules);
    const market = await this.readable(actor, marketId, 'vote');
    const blocked = this.stakeBlockedReason(
      actor,
      market,
      await this.rbac.isAlumni(actor.chapterId, actor.userId),
    );
    if (blocked) throw new ForbiddenException(blocked);

    const [config, since] = await Promise.all([
      this.pointsConfig.getConfig(actor.chapterId),
      this.points.getActiveSemesterSince(actor.chapterId),
    ]);
    try {
      await this.repo.placeStake({
        chapterId: actor.chapterId,
        marketId,
        answerId: input.answerId,
        userId: actor.userId,
        amount: input.amount,
        clientMessageId: input.clientMessageId,
        since: since ? since.toISOString() : null,
        maxStake: config.prediction_max_stake,
      });
    } catch (err) {
      throw this.httpRefusal(err, config.prediction_max_stake);
    }
    return this.get(actor, marketId);
  }

  /**
   * The named member's answer. Agreeing opens the question; declining
   * removes it (spec § Lifecycle step 2), so nobody else ever sees it.
   * Returns `null` once removed.
   */
  async consent(
    actor: PredictionActor,
    marketId: string,
    agree: boolean,
  ): Promise<PredictionMarketView | null> {
    if (agree) this.assertEnabled(actor.enabledModules);
    const market = await this.readable(actor, marketId);
    if (market.named_member_id !== actor.userId) {
      throw new ForbiddenException(
        'Only the member this question names can answer it.',
      );
    }
    const stale = () =>
      new ConflictException('This question is no longer waiting on you.');
    if (!agree) {
      const removed = await this.repo.deleteAwaitingConsent(
        actor.chapterId,
        marketId,
      );
      if (!removed) throw stale();
      return null;
    }
    const updated = await this.repo.updateMarketStatus(
      actor.chapterId,
      marketId,
      ['awaiting_consent'],
      { status: 'open' },
    );
    if (!updated) throw stale();
    return this.view(actor, updated);
  }

  async settle(
    actor: PredictionActor,
    marketId: string,
    input: { answerId: string; note?: string | null; knownAt?: string | null },
    { manages }: { manages: boolean },
  ): Promise<PredictionMarketView> {
    const market = await this.readable(actor, marketId);
    // The settler, or an officer who has nothing staked on it: with the
    // module off, or a settler gone quiet, the points can't be stranded.
    if (market.settler_id !== actor.userId) {
      if (!manages || (await this.hasStaked(actor, marketId))) {
        throw new ForbiddenException(
          'Only the member settling this, or an officer with nothing staked on it, can.',
        );
      }
    }
    const answers = await this.repo.listAnswers(actor.chapterId, [marketId]);
    if (!answers.some((a) => a.id === input.answerId)) {
      throw new BadRequestException('That answer is not on this question.');
    }
    const now = new Date();
    if (input.knownAt && new Date(input.knownAt).getTime() > now.getTime()) {
      throw new BadRequestException(
        "The time the answer became known can't be in the future.",
      );
    }
    const updated = await this.repo.updateMarketStatus(
      actor.chapterId,
      marketId,
      ['open'],
      {
        status: 'settled',
        winning_answer_id: input.answerId,
        settle_note: input.note?.trim() || null,
        known_at: input.knownAt ?? null,
        settled_by: actor.userId,
        settled_at: now.toISOString(),
        question_window_ends_at: new Date(
          now.getTime() + QUESTION_WINDOW_MS,
        ).toISOString(),
      },
    );
    if (!updated) {
      throw new ConflictException('This question is not open to settle.');
    }
    return this.view(actor, updated);
  }

  async question(
    actor: PredictionActor,
    marketId: string,
    note: string,
  ): Promise<PredictionMarketView> {
    const market = await this.readable(actor, marketId);
    const inWindow =
      (market.status === 'settled' || market.status === 'questioned') &&
      market.question_window_ends_at !== null &&
      new Date(market.question_window_ends_at).getTime() > Date.now();
    if (!inWindow) {
      throw new ConflictException(
        'The window to question this result has closed.',
      );
    }
    if (!(await this.hasStaked(actor, marketId))) {
      throw new ForbiddenException(
        'Only members who staked on this can question it.',
      );
    }
    // Status first: once it reads questioned, the sweep can't pay it, so the
    // note below is never left on a market that paid in between.
    const updated = await this.repo.updateMarketStatus(
      actor.chapterId,
      marketId,
      ['settled', 'questioned'],
      { status: 'questioned' },
    );
    if (!updated) {
      throw new ConflictException(
        'The window to question this result has closed.',
      );
    }
    await this.repo.addQuestion(actor.chapterId, marketId, actor.userId, note);
    return this.view(actor, updated);
  }

  /**
   * `predictions:manage`: confirm a questioned result, or settle it again.
   * A paid market whose winner changes is reversed and paid again. A settled
   * one nobody questioned waits out its window: an officer can't cut it short.
   * An officer who staked on it can't decide it.
   */
  async confirm(
    actor: PredictionActor,
    marketId: string,
    answerId: string | null,
  ): Promise<PredictionMarketView> {
    const market = await this.readable(actor, marketId);
    if (
      market.status === 'settled' &&
      market.question_window_ends_at !== null &&
      new Date(market.question_window_ends_at).getTime() > Date.now()
    ) {
      throw new ConflictException(
        'Stakers can still question this result; it pays when the window ends.',
      );
    }
    if (await this.hasStaked(actor, marketId)) {
      throw new ForbiddenException(
        'You staked on this question, so another officer has to decide it.',
      );
    }
    try {
      const paid = await this.repo.pay(actor.chapterId, marketId, answerId);
      return this.view(actor, paid);
    } catch (err) {
      throw this.httpRefusal(err);
    }
  }

  async void(
    actor: PredictionActor,
    marketId: string,
    { manages }: { manages: boolean },
  ): Promise<PredictionMarketView> {
    const market = await this.readable(actor, marketId);
    const settlerBeforePayout =
      market.settler_id === actor.userId &&
      market.status !== 'paid' &&
      market.status !== 'voided';
    if (!manages && !settlerBeforePayout) {
      throw new ForbiddenException(
        'Only the member settling this can void it before it pays, and an officer after.',
      );
    }
    try {
      // The read above can be stale by the time the lock is taken: the
      // function itself refuses a settler's void once the sweep has paid.
      const voided = await this.repo.void(
        actor.chapterId,
        marketId,
        actor.userId,
        { beforePayoutOnly: !manages },
      );
      return this.view(actor, voided);
    } catch (err) {
      throw this.httpRefusal(err);
    }
  }

  /**
   * The payout sweep: pays every settled market whose question window has
   * ended unquestioned. A failure on one market is reported and the rest go
   * on; the next run retries it.
   */
  async payDueMarkets(now = new Date()): Promise<number> {
    const due = await this.repo.listPayable(now.toISOString(), PAY_SWEEP_BATCH);
    let paid = 0;
    for (const market of due) {
      try {
        await this.repo.pay(market.chapter_id, market.id, null, {
          unquestionedOnly: true,
        });
        paid += 1;
      } catch (err) {
        // Questioned or voided between the read and the pay: the function's
        // own check under its lock refused it, and an officer decides.
        if (
          err instanceof PredictionRefusal &&
          (err.code === 'prediction.market.questioned' ||
            err.code === 'prediction.market.not_settled')
        ) {
          continue;
        }
        reportCaughtFailure(this.logger, {
          level: 'error',
          site: 'prediction-payout-sweep',
          message: `Paying prediction ${market.id} failed; the next sweep retries it`,
          error: err,
        });
      }
    }
    return paid;
  }

  // ── helpers ────────────────────────────────────────────────────────────

  private async hasStaked(
    actor: PredictionActor,
    marketId: string,
  ): Promise<boolean> {
    const stakes = await this.repo.listStakes(actor.chapterId, [marketId]);
    return stakes.some((s) => s.user_id === actor.userId);
  }

  private async assertMember(chapterId: string, userId: string): Promise<void> {
    const member = await this.memberRepo.findByUserAndChapter(
      userId,
      chapterId,
    );
    if (!member) throw new NotFoundException('Member not found');
  }

  /** The market, if the viewer can read its channel; 404 otherwise. */
  private async readable(
    actor: PredictionActor,
    marketId: string,
    operation: 'read' | 'vote' = 'read',
  ): Promise<PredictionMarket> {
    const market = await this.repo.findMarket(actor.chapterId, marketId);
    if (!market) throw new NotFoundException('Prediction not found');
    await this.channelAccess.assertChannelAccess(
      market.channel_id,
      actor.chapterId,
      actor.userId,
      operation,
    );
    if (
      market.status === 'awaiting_consent' &&
      market.created_by !== actor.userId &&
      market.named_member_id !== actor.userId
    ) {
      throw new NotFoundException('Prediction not found');
    }
    return market;
  }

  private stakeBlockedReason(
    actor: PredictionActor,
    market: PredictionMarket,
    isAlumni: boolean,
  ): string | null {
    if (market.status === 'awaiting_consent') {
      return 'This question is waiting for the member it names to agree.';
    }
    if (
      market.status !== 'open' ||
      new Date(market.closes_at).getTime() <= Date.now()
    ) {
      return 'This question is closed.';
    }
    if (market.created_by === actor.userId) {
      return "You made this question, so you can't stake on it.";
    }
    if (market.settler_id === actor.userId) {
      return "You settle this question, so you can't stake on it.";
    }
    if (market.named_member_id === actor.userId) {
      return "This question is about you, so you can't stake on it.";
    }
    if (isAlumni) {
      return "Alumni can't stake points.";
    }
    return null;
  }

  private httpRefusal(err: unknown, maxStake?: number): unknown {
    if (!(err instanceof PredictionRefusal)) return err;
    switch (err.code) {
      case 'prediction.market.not_found':
      case 'prediction.answer.not_found':
        return new NotFoundException(
          err.code === 'prediction.answer.not_found'
            ? 'That answer is not on this question.'
            : 'Prediction not found',
        );
      case 'prediction.market.not_open':
        return new ConflictException('This question is closed.');
      case 'prediction.stake.over_cap':
        return new BadRequestException(
          `You can stake up to ${maxStake ?? 'the chapter limit of'} points on one question.`,
        );
      case 'prediction.stake.insufficient_points':
        return new BadRequestException(
          "You don't have that many points this semester.",
        );
      case 'prediction.stake.key_reused':
        return new ConflictException(
          'That key was already used for another stake.',
        );
      case 'prediction.market.not_settled':
        return new ConflictException('This question has not been settled yet.');
      case 'prediction.market.paid':
        return new ConflictException(
          'This question has paid; only an officer can void it now.',
        );
      case 'prediction.market.questioned':
        return new ConflictException(
          'This result was questioned; an officer decides it.',
        );
      case 'prediction.market.voided':
        return new ConflictException('This question was already voided.');
    }
  }

  private async view(
    actor: PredictionActor,
    market: PredictionMarket,
  ): Promise<PredictionMarketView> {
    const [one] = await this.views(actor, [market]);
    return one;
  }

  private async views(
    actor: PredictionActor,
    markets: PredictionMarket[],
  ): Promise<PredictionMarketView[]> {
    if (markets.length === 0) return [];
    const ids = markets.map((m) => m.id);
    const [answers, stakes, questions, isAlumni] = await Promise.all([
      this.repo.listAnswers(actor.chapterId, ids),
      this.repo.listStakes(actor.chapterId, ids),
      this.repo.listOpenQuestions(actor.chapterId, ids),
      this.rbac.isAlumni(actor.chapterId, actor.userId),
    ]);
    return markets.map((market) => ({
      market,
      open_questions: questions
        .filter((q) => q.market_id === market.id)
        .map((q) => ({
          user_id: q.user_id,
          note: q.note,
          created_at: q.created_at,
        })),
      ...summarize(
        answers.filter((a) => a.market_id === market.id),
        stakes.filter((s) => s.market_id === market.id),
        actor.userId,
      ),
      stake_blocked_reason: this.stakeBlockedReason(actor, market, isAlumni),
    }));
  }
}

/** Pools, chances and per-member totals for one market. Exported for tests. */
export function summarize(
  answers: PredictionAnswer[],
  stakes: PredictionStake[],
  viewerId: string,
): Omit<
  PredictionMarketView,
  'market' | 'stake_blocked_reason' | 'open_questions'
> {
  const total = stakes.reduce((sum, s) => sum + s.amount, 0);
  const byKey = new Map<string, PredictionStakerView>();
  for (const s of stakes) {
    const key = `${s.user_id}:${s.answer_id}`;
    const row = byKey.get(key) ?? {
      user_id: s.user_id,
      answer_id: s.answer_id,
      amount: 0,
    };
    row.amount += s.amount;
    byKey.set(key, row);
  }
  const stakers = [...byKey.values()];
  return {
    answers: answers.map((a) => {
      const pool = stakes
        .filter((s) => s.answer_id === a.id)
        .reduce((sum, s) => sum + s.amount, 0);
      return {
        id: a.id,
        label: a.label,
        pool,
        chance: total === 0 ? null : Math.round((pool / total) * 100),
      };
    }),
    total_staked: total,
    stakers,
    my_stakes: stakers.filter((s) => s.user_id === viewerId),
  };
}
