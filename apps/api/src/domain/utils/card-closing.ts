import { SIGNUP_CLOSES_AT_MAX_AHEAD_DAYS } from '@repo/validation';

/**
 * The end time and early close a chat card shares across kinds: a sign-up
 * card (#3926 step 2) and a form card (#3926 step 3). `closes_at` is set by
 * the card's creator when they post it; `closed_at` / `closed_by` only by
 * `ChatService.closeCard`.
 */

/** The furthest ahead an end time may be set. */
const CLOSES_AT_MAX_AHEAD_MS =
  SIGNUP_CLOSES_AT_MAX_AHEAD_DAYS * 24 * 60 * 60 * 1000;

/**
 * A card's end time as it is stored (ISO), absent when none was set, or the
 * reason it can't be. `noun` names the card in the refusal ("A sign-up card").
 */
export function normalizeClosesAt(
  raw: unknown,
  noun: string,
  now: number = Date.now(),
): { closesAt?: string } | { error: string } {
  if (raw == null || raw === '') return {};
  const at = typeof raw === 'string' ? Date.parse(raw) : NaN;
  if (Number.isNaN(at)) {
    return { error: `${noun}’s end time must be a date and time` };
  }
  // A past end time is kept, not refused: a card queued offline can reach
  // the server after the time its creator picked, and it then posts closed.
  if (at > now + CLOSES_AT_MAX_AHEAD_MS) {
    return { error: `${noun} can end at most a year from now` };
  }
  return { closesAt: new Date(at).toISOString() };
}

/**
 * Whether the card takes no more answers: closed early, or past its end time.
 * The sign-up claim RPC and the form-answer RPC (`save_chat_form_response`)
 * decide this again under the card's lock; this lets the API
 * refuse without a round trip and the close route refuse a second close.
 */
export function isCardClosed(
  payload: unknown,
  now: number = Date.now(),
): boolean {
  const card = payload as { closed_at?: unknown; closes_at?: unknown } | null;
  if (typeof card?.closed_at === 'string' && card.closed_at !== '') return true;
  if (typeof card?.closes_at !== 'string') return false;
  const at = Date.parse(card.closes_at);
  return !Number.isNaN(at) && at <= now;
}
