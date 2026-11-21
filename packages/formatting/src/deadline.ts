import { parseInstant } from "./instant";

/**
 * Whether an end time has come at `now` (epoch ms): the deadline half of
 * every card close rule on the client. The boundary is inclusive, as on the
 * server (`isCardClosed` in `apps/api/src/domain/utils/card-closing.ts`): an
 * end time of exactly now has passed. A missing end time, or one that doesn't
 * parse ({@link parseInstant}), never passes, so a card with none never closes
 * on its own.
 *
 * Chat cards (`isCardClosed` in `@repo/chat-core`) and Activity's poll and
 * card rows (`activityPollIsOpen`, `activityCardIsOpen` in `@repo/hooks`) all
 * call this, so a poll's chat card and its Activity row close on the same tick
 * (#5242). Their specs run {@link CLOSES_AT_CASES} through it.
 */
export function closesAtHasPassed(closesAt: unknown, now: number): boolean {
  const deadline = parseInstant(closesAt);
  return deadline ? deadline.getTime() <= now : false;
}

const CASES_END = "2026-11-12T12:00:00.000Z";
const CASES_AT = Date.parse(CASES_END);

/**
 * The deadline cases every caller's spec runs through its own rule and through
 * {@link closesAtHasPassed} (#5242), as `[label, closesAt, now, passed]`: one
 * table, so a case added here reaches chat-core's and hooks' specs too.
 */
export const CLOSES_AT_CASES = [
  ["before its end time", CASES_END, CASES_AT - 1, false],
  ["exactly at its end time", CASES_END, CASES_AT, true],
  ["after its end time", CASES_END, CASES_AT + 1, true],
  ["with no end time (undefined)", undefined, CASES_AT, false],
  ["with no end time (null)", null, CASES_AT, false],
  ["with an empty end time", "", CASES_AT, false],
  ["with an unparseable end time", "soon", CASES_AT, false],
] as const;
