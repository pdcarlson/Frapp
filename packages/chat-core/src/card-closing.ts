import { closesAtHasPassed } from "@repo/formatting";
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
 * parse, never closes on its own. The deadline half is `closesAtHasPassed`
 * in `@repo/formatting`, shared with Activity's rows (#5242).
 */
export function isCardClosed(card: ClosableCard, now: number): boolean {
  if (card.closed_at) return true;
  return closesAtHasPassed(card.closes_at, now);
}

/**
 * Whether the viewer organizes this card: they posted it or hold
 * `channels:manage`, on a card the server has and that isn't deleted
 * (`canActOnMessage`). Close is offered to them while the card is open
 * ({@link canCloseCard}), and a sign-up's Export always (`canExportSignup`).
 */
export function isCardOrganizer(
  message: Pick<ChatMessage, "sender_id" | "_status" | "is_deleted">,
  viewerId: string | null,
  canManageChannels: boolean,
): boolean {
  return (
    (isOwnMessage(message, viewerId) || (canManageChannels && !!viewerId)) &&
    canActOnMessage(message)
  );
}

/**
 * Whether the viewer is offered Close on this card: it is on the server and
 * not deleted (`canActOnMessage`), still open, and the viewer posted it or
 * holds `channels:manage` ({@link isCardOrganizer}). The API enforces it (`ChatService.closeCard`,
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
    isCardOrganizer(message, viewerId, canManageChannels) &&
    !isCardClosed(card, now)
  );
}

/**
 * An option, slot or choice label as a draft compares it for duplicates:
 * case and runs of whitespace don't make two labels different.
 */
export function foldOptionLabel(label: string): string {
  return label.toLowerCase().replace(/\s+/g, " ");
}
