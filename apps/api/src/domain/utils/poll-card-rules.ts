import {
  POLL_OPTION_MAX_LENGTH,
  POLL_OPTIONS_MAX,
  POLL_OPTIONS_MIN,
  POLL_QUESTION_MAX_LENGTH,
} from '@repo/validation';
import { normalizeClosesAt } from './card-closing';

/**
 * Rules for a poll card in chat (`kind: 'poll'`), checked and rebuilt on send
 * as the sign-up, form and role picker cards are (`ChatService.sendMessage`).
 *
 * The card is what the apps build (`buildPollMessage` in `@repo/chat-core`):
 * a question, 2 to {@link POLL_OPTIONS_MAX} options each with an id a vote
 * names and a label, a deadline or `null`, and `choice_mode: 'multi'` on a
 * poll that takes several choices. It was stored as sent, so a card could
 * carry fields nobody reads, options no vote could match, or labels longer
 * than either New poll form allows. The lengths are the forms' and the REST
 * route's (`CreatePollDto`).
 *
 * `closed_at` / `closed_by` are written only by `PollService.close`, so a
 * client's are dropped with every other key the card doesn't define.
 */

/** The longest option id a card may carry. Clients make 8-character ids. */
const OPTION_ID_MAX_LENGTH = 64;

export interface PollCardOption {
  id: string;
  label: string;
}

export interface PollCard {
  question: string;
  options: PollCardOption[];
  /** When the poll closes (ISO), or `null` for a poll with no deadline. */
  closes_at: string | null;
  /** Present only on a poll that takes several choices. */
  choice_mode?: 'multi';
}

/** The card as it is stored, or the reason it can't be. Text is trimmed. */
export function normalizePollCard(
  payload: unknown,
  now: number = Date.now(),
): { card: PollCard } | { error: string } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { error: 'A poll needs a question and at least two options' };
  }
  const raw = payload as Record<string, unknown>;

  const question = typeof raw.question === 'string' ? raw.question.trim() : '';
  if (!question) return { error: 'A poll needs a question' };
  if (question.length > POLL_QUESTION_MAX_LENGTH) {
    return {
      error: `A poll question can be at most ${POLL_QUESTION_MAX_LENGTH} characters`,
    };
  }

  if (
    !Array.isArray(raw.options) ||
    raw.options.length < POLL_OPTIONS_MIN ||
    raw.options.length > POLL_OPTIONS_MAX
  ) {
    return {
      error: `A poll needs ${POLL_OPTIONS_MIN} to ${POLL_OPTIONS_MAX} options`,
    };
  }
  const seen = new Set<string>();
  const options: PollCardOption[] = [];
  for (const entry of raw.options as unknown[]) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { error: 'Each option needs an id and a label' };
    }
    const option = entry as Record<string, unknown>;
    const id = typeof option.id === 'string' ? option.id.trim() : '';
    const label = typeof option.label === 'string' ? option.label.trim() : '';
    if (!id || id.length > OPTION_ID_MAX_LENGTH || !label) {
      return { error: 'Each option needs an id and a label' };
    }
    if (seen.has(id)) return { error: 'Each option needs its own id' };
    seen.add(id);
    if (label.length > POLL_OPTION_MAX_LENGTH) {
      return {
        error: `An option can be at most ${POLL_OPTION_MAX_LENGTH} characters`,
      };
    }
    options.push({ id, label });
  }

  let multi: boolean;
  if (raw.choice_mode == null || raw.choice_mode === 'single') {
    multi = false;
  } else if (raw.choice_mode === 'multi') {
    multi = true;
  } else {
    return { error: 'Unknown poll choice mode' };
  }

  const closing = normalizeClosesAt(raw.closes_at, 'A poll', now);
  if ('error' in closing) return closing;

  return {
    card: {
      question,
      options,
      closes_at: closing.closesAt ?? null,
      // Only on a multi-choice card, as `buildPollMessage` builds it.
      ...(multi ? { choice_mode: 'multi' as const } : {}),
    },
  };
}
