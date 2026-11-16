import { parseInstant } from "@repo/formatting";
import { SIGNUP_CLOSES_AT_MAX_AHEAD_DAYS } from "@repo/validation";
import { canActOnMessage, isOwnMessage } from "./message-actions";
import type { ChatMessage } from "./types";

/**
 * The end time and early close every chat card with one shares: a poll, a
 * sign-up card and a form card. The client mirror of the API's
 * `apps/api/src/domain/utils/card-closing.ts` (`isCardClosed`) and of its
 * poll rule (`isPollClosed` in `poll-vote-rules.ts`), so a card never offers a
 * tap the server refuses.
 */

/** The part of a card payload that says whether it is closed. */
export interface ClosableCard {
  /** The card's end time (ISO), absent or `null` when it has none. */
  closes_at?: string | null;
  /** When it was closed early, absent or `null` while it is open. */
  closed_at?: string | null;
}

/**
 * Whether the card takes no more answers: closed early (`closed_at`), or its
 * end time has come. The boundary is inclusive, as on the server: a card
 * ending exactly now is closed. A card with no end time, or one that doesn't
 * parse, never closes on its own.
 */
export function isCardClosed(card: ClosableCard, now: number): boolean {
  if (card.closed_at) return true;
  const deadline = parseInstant(card.closes_at);
  return deadline ? deadline.getTime() <= now : false;
}

/**
 * Whether the viewer is offered Close on this card: it is on the server and
 * not deleted (`canActOnMessage`), still open, and the viewer posted it or
 * holds `channels:manage`. The API enforces it (`ChatService.closeCard`,
 * `PollService.close`); this only keeps the card honest. A poll also needs
 * its module on (`canClosePoll` in `./polls`).
 */
export function canCloseCard(
  message: Pick<ChatMessage, "sender_id" | "_status" | "is_deleted">,
  card: ClosableCard,
  viewerId: string | null,
  now: number,
  canManageChannels: boolean,
): boolean {
  return (
    (isOwnMessage(message, viewerId) || (canManageChannels && !!viewerId)) &&
    canActOnMessage(message) &&
    !isCardClosed(card, now)
  );
}

/** What a draft with an end time already behind it is told, on any card. */
export const CARD_END_PASSED_PROBLEM =
  "That end time has passed. Pick a later one, or none.";

/** The API's furthest end time (`normalizeClosesAt`), less a day of slack. */
const CARD_END_MAX_AHEAD_MS =
  (SIGNUP_CLOSES_AT_MAX_AHEAD_DAYS - 1) * 24 * 60 * 60 * 1000;

/**
 * What is wrong with a draft's end time, or `null` when it is fine (or there
 * is none). `tooFarProblem` is the card's own words for an end time too far
 * ahead ("Sign-ups can end…", "A form can close…").
 */
export function checkCardEnd(
  closesAt: Date | null | undefined,
  now: number,
  tooFarProblem: string,
): string | null {
  if (!closesAt) return null;
  if (Number.isNaN(closesAt.getTime()) || closesAt.getTime() <= now) {
    return CARD_END_PASSED_PROBLEM;
  }
  if (closesAt.getTime() > now + CARD_END_MAX_AHEAD_MS) return tooFarProblem;
  return null;
}

/**
 * An option, slot or choice label as a draft compares it for duplicates:
 * case and runs of whitespace don't make two labels different.
 */
export function foldOptionLabel(label: string): string {
  return label.toLowerCase().replace(/\s+/g, " ");
}
