/**
 * The mobile message-actions sheet's rules: which member-safety actions a
 * message offers, and what the roster can say about a sender (#2257).
 *
 * The block classifier the thread applies (tombstone, held, quotes,
 * reactions) is shared with web and lives in `@repo/chat-core/blocks`
 * (#2313). What stays here is mobile's alone: web offers no Report or Block
 * on a message.
 */

import { isBlockableSender } from "@repo/chat-core/blocks";
import type { ChatMessage } from "@repo/chat-core/types";

export interface MessageActions {
  /** Whether the long-press sheet opens at all. */
  canOpen: boolean;
  canReport: boolean;
  canBlock: boolean;
}

const NO_ACTIONS: MessageActions = {
  canOpen: false,
  canReport: false,
  canBlock: false,
};

/**
 * Whether a `users.id` is a member of the active chapter:
 *
 * - `true` — the loaded roster lists them.
 * - `false` — **positively known departed**: this session the API refused to
 *   block them as not a member (`isMemberNotFound` in `block-actions.ts`), and
 *   no roster read since lists them.
 * - `null` — nothing can be said. Covers a roster that has not loaded or
 *   failed, and a loaded one that does not list them — which is not evidence
 *   they left: the roster is cached, and the sender it is likeliest to miss is
 *   a member who joined after it was read.
 */
export type MemberLookup = (userId: string) => boolean | null;

const NO_ONE: ReadonlySet<string> = new Set();

export function rosterMembership(
  roster: {
    byId: Readonly<Record<string, string>>;
    isPending: boolean;
    isError: boolean;
  },
  departed: ReadonlySet<string> = NO_ONE,
): MemberLookup {
  const loaded = !roster.isPending && !roster.isError;
  return (userId) => {
    if (loaded && Object.prototype.hasOwnProperty.call(roster.byId, userId)) {
      return true;
    }
    return departed.has(userId) ? false : null;
  };
}

/**
 * Whether a message offers the actions sheet at all — the first three rules
 * below, which need no roster. What a row's long-press is gated on.
 */
export function canOpenMessageActions(
  message: Pick<ChatMessage, "sender_id" | "_status" | "is_deleted">,
  viewerId: string | null,
): boolean {
  if (viewerId === null) return false;
  if (message.sender_id === viewerId) return false;
  return message._status === "confirmed" && !message.is_deleted;
}

/**
 * Which member-safety actions a message offers.
 *
 * - **Never on your own message.** There is nothing to report or block.
 * - **Confirmed rows only.** A pending or failed row carries a client id the
 *   API has never seen, so a report against it would 404.
 * - **Not on a deleted row.** Its content already reads `[message deleted]`,
 *   and the report would snapshot exactly that.
 * - **Block needs a blockable sender not known to have left** — not the system
 *   actor, not an imported row, and not someone `isMember` positively knows
 *   departed. A sender the cached roster does not list still gets Block: that
 *   is exactly what a brand-new member looks like, and App Review's block
 *   control must not vanish for them. If they did leave, `POST /v1/chat/blocks`
 *   answers 404 `Member not found` and the confirmation says so. Report stays
 *   in every case: an imported row names its author in `author_name`, which the
 *   API snapshots into the report for exactly that.
 *
 * A tombstoned row never reaches this: the thread renders it without the sheet.
 */
export function messageActionsFor(
  message: Pick<ChatMessage, "sender_id" | "_status" | "is_deleted">,
  viewerId: string | null,
  isMember: MemberLookup,
): MessageActions {
  if (!canOpenMessageActions(message, viewerId)) return NO_ACTIONS;
  return {
    canOpen: true,
    canReport: true,
    canBlock:
      isBlockableSender(message.sender_id) &&
      isMember(message.sender_id) !== false,
  };
}
