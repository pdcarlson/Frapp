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
 * (#5242). Their specs run the same cases through it.
 */
export function closesAtHasPassed(closesAt: unknown, now: number): boolean {
  const deadline = parseInstant(closesAt);
  return deadline ? deadline.getTime() <= now : false;
}
