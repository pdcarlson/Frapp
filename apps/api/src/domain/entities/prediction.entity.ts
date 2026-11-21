/**
 * Predictions (#5133, `spec/behavior/predictions.md`): members stake house
 * points on a chapter question. Rows of `prediction_markets`,
 * `prediction_answers`, `prediction_stakes` and `prediction_questions`
 * (migration `20261116135639_predictions.sql`).
 */

export type PredictionMarketStatus =
  'awaiting_consent' | 'open' | 'settled' | 'questioned' | 'paid' | 'voided';

export interface PredictionMarket {
  id: string;
  chapter_id: string;
  channel_id: string;
  /** The chat card that shows it, once clients post one. */
  message_id: string | null;
  created_by: string;
  /** Who settles it: the creator unless they named someone else. */
  settler_id: string;
  /** A member the question names; it waits for their consent to open. */
  named_member_id: string | null;
  question: string;
  settle_rule: string;
  closes_at: string;
  status: PredictionMarketStatus;
  winning_answer_id: string | null;
  /** When the answer became known; stakes after it are refunded. */
  known_at: string | null;
  settle_note: string | null;
  settled_by: string | null;
  settled_at: string | null;
  question_window_ends_at: string | null;
  payout_round: number;
  paid_at: string | null;
  voided_by: string | null;
  voided_at: string | null;
  client_message_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PredictionAnswer {
  id: string;
  market_id: string;
  chapter_id: string;
  label: string;
  position: number;
}

export interface PredictionStake {
  id: string;
  chapter_id: string;
  market_id: string;
  answer_id: string;
  user_id: string;
  amount: number;
  point_transaction_id: string;
  client_message_id: string;
  created_at: string;
}

export interface PredictionQuestion {
  id: string;
  chapter_id: string;
  market_id: string;
  user_id: string;
  note: string;
  resolved_at: string | null;
  created_at: string;
}
