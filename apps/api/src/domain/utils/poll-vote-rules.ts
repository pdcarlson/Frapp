/**
 * Poll vote rules, shared by the two paths that accept a vote, which are NOT
 * the same code path and cannot be merged into one: `PollService.vote` writes
 * `poll_votes` keyed by a numeric `option_index`, while
 * `ChatReactionService.recordMessageAction` writes `chat_message_actions` with a
 * string `payload.option_id`. Two storage shapes, two encodings, one set of
 * rules.
 *
 * Only the chat-card path was unguarded (#871): it checked channel access and
 * then inserted whatever it was handed, so a member could vote on a closed
 * poll, submit an option that does not exist, or send several selections to a
 * single-choice poll — all rejected by the polls surface for the same poll.
 *
 * Pure: no I/O, no framework imports. Callers do their own trusted lookups and
 * feed the results in, exactly like the channel-access predicate
 * (`./channel-access.ts`). Moved out of `@repo/validation` (#3268): only the
 * API accepts votes.
 */

/**
 * The `action_type` of a vote on a chat poll card (ADR-07: it upserts rather
 * than duplicates). `POLL_VOTE_ACTION_TYPE` in `@repo/chat-core`, which the
 * API doesn't import.
 */
export const CARD_VOTE_ACTION_TYPE = 'vote';

/**
 * A chat poll card's payload as the composer writes it
 * (`@repo/chat-core/dispatch`), plus the `choice_mode` the vote rules honour,
 * which no composer sets yet. Nothing validates it on send, so read it through
 * the helpers below, which guard each field.
 */
export interface CardPollPayload {
  options?: { id?: unknown }[];
  closes_at?: string | null;
  choice_mode?: 'single' | 'multi';
  /**
   * When the creator closed the card early (#3794). Written only by
   * `PollService.close`; `ChatService.sendMessage` strips it from a card a
   * client posts, so a card can't arrive already "closed by" anyone.
   */
  closed_at?: string | null;
  /** `users.id` of the creator who closed it; set with `closed_at`. */
  closed_by?: string | null;
}

/**
 * The card's effective deadline for the vote rules: the early close once
 * there is one, else `closes_at`. `closed_at` is stamped with the time of the
 * close, so it is always already past, and `isPollClosed` reads it as closed
 * with the same single check — the trick `PollService.vote` uses for the REST
 * shape's `metadata.closed_at`.
 */
export function cardPollDeadline(card: CardPollPayload): string | null {
  if (typeof card.closed_at === 'string' && card.closed_at !== '') {
    return card.closed_at;
  }
  return card.closes_at ?? null;
}

/**
 * The card's option ids. A card with no `options` has none. `null` means
 * `options` is there but isn't a list, so the card can't be read at all.
 */
export function cardPollOptionIds(card: CardPollPayload): string[] | null {
  if (card.options == null) return [];
  if (!Array.isArray(card.options)) return null;
  return card.options
    .map((option) => option?.id)
    .filter((id): id is string => typeof id === 'string');
}

/**
 * The card's choice mode as the vote rules hold it: absent is single-choice,
 * matching the composer, which offers no multi-select. Any other value is held
 * to no cardinality, so it votes as multi.
 */
export function cardPollChoiceMode(card: CardPollPayload): 'single' | 'multi' {
  return card.choice_mode == null || card.choice_mode === 'single'
    ? 'single'
    : 'multi';
}

/**
 * The option ids a card vote selects: its `payload.option_id` is one id or
 * several, and anything that isn't a string is ignored.
 */
export function cardVoteSelection(
  actionPayload: Record<string, unknown> | undefined,
): string[] {
  const raw = actionPayload?.['option_id'];
  return (Array.isArray(raw) ? raw : [raw]).filter(
    (id): id is string => typeof id === 'string',
  );
}

/** Why a vote was rejected. `null` from the validators below means "accept". */
export type PollVoteRejection =
  | { reason: 'closed' }
  | { reason: 'unknown_option'; option: string | number }
  | { reason: 'cardinality'; selected: number };

/**
 * A poll is closed once its deadline has passed. An absent deadline means it
 * never closes. The boundary is inclusive — a poll closing exactly now is
 * closed — matching the polls surface, where a vote landing on the deadline
 * has missed it.
 */
export function isPollClosed(
  closesAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!closesAt) return false;
  const deadline = new Date(closesAt);
  // An unparseable deadline is not treated as closed: refusing every vote on a
  // poll whose metadata is malformed would turn a data bug into an outage.
  if (Number.isNaN(deadline.getTime())) return false;
  return deadline <= now;
}

function evaluatePollVote(input: {
  closed: boolean;
  unknownOption: string | number | null;
  selectedCount: number;
  choiceMode: 'single' | 'multi' | undefined;
}): PollVoteRejection | null {
  if (input.closed) return { reason: 'closed' };
  if (input.unknownOption !== null) {
    return { reason: 'unknown_option', option: input.unknownOption };
  }
  // Multi-choice accepts zero selections — that is how the polls surface clears
  // an existing vote. Single-choice requires exactly one.
  if (input.choiceMode === 'single' && input.selectedCount !== 1) {
    return { reason: 'cardinality', selected: input.selectedCount };
  }
  return null;
}

/** Validates a vote addressed by option INDEX (`poll_votes`, the polls surface). */
export function validateIndexedPollVote(input: {
  expiresAt: string | null | undefined;
  optionCount: number;
  optionIndexes: readonly number[];
  choiceMode: 'single' | 'multi' | undefined;
  now?: Date;
}): PollVoteRejection | null {
  const unknown = input.optionIndexes.find(
    (index) =>
      !Number.isInteger(index) || index < 0 || index >= input.optionCount,
  );

  return evaluatePollVote({
    closed: isPollClosed(input.expiresAt, input.now),
    unknownOption: unknown === undefined ? null : unknown,
    selectedCount: input.optionIndexes.length,
    choiceMode: input.choiceMode,
  });
}

/** Validates a vote addressed by option ID (`chat_message_actions`, the chat card). */
export function validateCardPollVote(input: {
  closesAt: string | null | undefined;
  optionIds: readonly string[];
  selected: readonly string[];
  choiceMode: 'single' | 'multi' | undefined;
  now?: Date;
}): PollVoteRejection | null {
  const unknown = input.selected.find((id) => !input.optionIds.includes(id));

  return evaluatePollVote({
    closed: isPollClosed(input.closesAt, input.now),
    unknownOption: unknown === undefined ? null : unknown,
    selectedCount: input.selected.length,
    choiceMode: input.choiceMode,
  });
}
