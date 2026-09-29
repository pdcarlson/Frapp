/**
 * The mobile message-actions sheet's rules: which actions a message offers
 * (Reply, Edit and Delete, #2775; Report and Block, #2257), and what the
 * roster can say about a sender.
 *
 * Reply, Edit and Delete decide through `@repo/chat-core/message-actions`,
 * the rules web reads too, so the two clients cannot offer different things.
 * The block classifier the thread applies (tombstone, held, quotes,
 * reactions) is shared with web as well and lives in `@repo/chat-core/blocks`
 * (#2313). What stays here is mobile's alone: web offers no Report or Block on
 * a message yet (#2687).
 */

import { isBlockableSender } from "@repo/chat-core/blocks";
import {
  canActOnMessage,
  canDeleteMessage,
  canEditMessage,
  isOwnMessage,
} from "@repo/chat-core/message-actions";
import type { ChatMessage } from "@repo/chat-core/types";

export interface MessageActions {
  /** Whether the long-press sheet opens at all. */
  canOpen: boolean;
  canReply: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canReport: boolean;
  canBlock: boolean;
}

const NO_ACTIONS: MessageActions = {
  canOpen: false,
  canReply: false,
  canEdit: false,
  canDelete: false,
  canReport: false,
  canBlock: false,
};

/** What the open channel and the viewer's permissions allow, beyond the row. */
export interface MessageActionsContext {
  isMember: MemberLookup;
  /** `channelAllowsReplies` for the open channel. */
  canReply: boolean;
  /** The channel's `can_post`: an edit authorizes as a post. */
  canPost: boolean;
  /** The viewer holds `channels:manage`. */
  canManageChannel: boolean;
}

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
 * Whether a message offers the actions sheet at all, which is what a row's
 * long-press is gated on. It needs no roster or channel: a confirmed,
 * undeleted row always offers something. Your own message offers Delete, and
 * anyone else's offers Report.
 */
export function canOpenMessageActions(
  message: Pick<ChatMessage, "_status" | "is_deleted">,
  viewerId: string | null,
): boolean {
  return viewerId !== null && canActOnMessage(message);
}

/**
 * Which actions a message offers.
 *
 * - **Confirmed, undeleted rows only.** A pending or failed row carries a
 *   client id the API has never seen, so any action on it would 404, and a
 *   deleted row already reads `[message deleted]`.
 * - **Reply** wherever the channel takes replies (`channelAllowsReplies`).
 * - **Edit** on your own plain-text message (`canEditMessage`), where you can
 *   still post.
 * - **Delete** on your own message, or anyone's with `channels:manage`.
 * - **Report and Block never on your own message.** There is nothing to
 *   report or block. On anyone else's, Report always shows: an imported row
 *   names its author in `author_name`, which the API snapshots into the report
 *   for exactly that.
 * - **Block needs a blockable sender not known to have left**: not the system
 *   actor, not an imported row, and not someone `isMember` positively knows
 *   departed. A sender the cached roster does not list still gets Block: that
 *   is exactly what a brand-new member looks like, and App Review's block
 *   control must not vanish for them. If they did leave,
 *   `POST /v1/chat/blocks` answers 404 `Member not found` and the confirmation
 *   says so.
 *
 * A tombstoned row never reaches this: the thread renders it without the sheet.
 */
export function messageActionsFor(
  message: Pick<
    ChatMessage,
    "id" | "sender_id" | "kind" | "_status" | "is_deleted"
  >,
  viewerId: string | null,
  context: MessageActionsContext,
): MessageActions {
  if (!canOpenMessageActions(message, viewerId)) return NO_ACTIONS;
  const own = isOwnMessage(message, viewerId);
  return {
    canOpen: true,
    canReply: context.canReply,
    canEdit: context.canPost && canEditMessage(message, viewerId),
    canDelete: canDeleteMessage(message, viewerId, context.canManageChannel),
    canReport: !own,
    canBlock:
      !own &&
      isBlockableSender(message.sender_id) &&
      context.isMember(message.sender_id) !== false,
  };
}
