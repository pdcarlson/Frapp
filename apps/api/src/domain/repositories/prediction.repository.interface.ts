import type {
  PredictionAnswer,
  PredictionMarket,
  PredictionMarketStatus,
  PredictionQuestion,
  PredictionStake,
} from '../entities/prediction.entity';

export const PREDICTION_REPOSITORY = 'PREDICTION_REPOSITORY';

export interface CreatePredictionMarketInput {
  chapter_id: string;
  channel_id: string;
  created_by: string;
  settler_id: string;
  named_member_id: string | null;
  question: string;
  settle_rule: string;
  closes_at: string;
  status: Extract<PredictionMarketStatus, 'open' | 'awaiting_consent'>;
  client_message_id: string | null;
}

export interface PlaceStakeInput {
  chapterId: string;
  marketId: string;
  answerId: string;
  userId: string;
  amount: number;
  clientMessageId: string;
  /** Exclusive lower bound of the spendable window; `null` is all-time. */
  since: string | null;
  maxStake: number;
}

/**
 * Reads and writes for predictions. Every method is chapter-scoped. The
 * money moves (`placeStake`, `pay`, `void`) are single database functions
 * that lock what they read; a refusal surfaces as a
 * {@link PredictionRefusal} carrying the function's stable code.
 */
export interface IPredictionRepository {
  findMarket(
    chapterId: string,
    marketId: string,
  ): Promise<PredictionMarket | null>;
  findMarketByClientMessageId(
    chapterId: string,
    clientMessageId: string,
  ): Promise<PredictionMarket | null>;
  listMarkets(
    chapterId: string,
    options: { statuses?: PredictionMarketStatus[]; limit: number },
  ): Promise<PredictionMarket[]>;
  /** Answers of these markets, ordered by position. */
  listAnswers(
    chapterId: string,
    marketIds: string[],
  ): Promise<PredictionAnswer[]>;
  /** Stakes of these markets, oldest first. */
  listStakes(
    chapterId: string,
    marketIds: string[],
  ): Promise<PredictionStake[]>;
  /** Market ids this member has staked on. */
  listMarketIdsStakedBy(chapterId: string, userId: string): Promise<string[]>;
  listOpenQuestions(
    chapterId: string,
    marketId: string,
  ): Promise<PredictionQuestion[]>;

  /** Inserts the market and its answers; answers in the order given. */
  createMarket(
    input: CreatePredictionMarketInput,
    answers: string[],
  ): Promise<PredictionMarket>;
  /**
   * Compare-and-set on status: updates only while the market is in one of
   * `fromStatuses`, and returns `null` when it is not (someone got there
   * first).
   */
  updateMarketStatus(
    chapterId: string,
    marketId: string,
    fromStatuses: PredictionMarketStatus[],
    patch: Partial<PredictionMarket>,
  ): Promise<PredictionMarket | null>;
  addQuestion(
    chapterId: string,
    marketId: string,
    userId: string,
    note: string,
  ): Promise<PredictionQuestion>;
  /** Settled markets whose question window has ended, across chapters. */
  listPayable(now: string, limit: number): Promise<PredictionMarket[]>;

  placeStake(input: PlaceStakeInput): Promise<PredictionStake>;
  /**
   * Pays a settled market, or re-settles a paid one on a new answer.
   * `unquestionedOnly` (the sweep) refuses a questioned market.
   */
  pay(
    chapterId: string,
    marketId: string,
    answerId: string | null,
    options?: { unquestionedOnly?: boolean },
  ): Promise<PredictionMarket>;
  void(
    chapterId: string,
    marketId: string,
    by: string,
  ): Promise<PredictionMarket>;
}

/** The stable codes the database functions raise. */
export const PREDICTION_REFUSAL_CODES = [
  'prediction.stake.key_reused',
  'prediction.market.not_found',
  'prediction.market.not_open',
  'prediction.answer.not_found',
  'prediction.stake.over_cap',
  'prediction.stake.insufficient_points',
  'prediction.market.not_settled',
  'prediction.market.questioned',
  'prediction.market.voided',
] as const;

export type PredictionRefusalCode = (typeof PREDICTION_REFUSAL_CODES)[number];

/** A database function refused the write; `code` says why. */
export class PredictionRefusal extends Error {
  constructor(readonly code: PredictionRefusalCode) {
    super(code);
    this.name = 'PredictionRefusal';
  }
}
