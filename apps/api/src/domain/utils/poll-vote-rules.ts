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
