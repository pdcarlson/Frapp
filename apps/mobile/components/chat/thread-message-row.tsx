import type { ChatMessage } from "@repo/chat-core/types";
import type { MaskedRefreshState } from "@/lib/chat/masked-refresh";
import {
  canOpenMessageActions,
  classifyMessage,
  tombstoneCanUnblock,
  visibleReactions,
  type BlockState,
  type ThreadRow,
} from "@/lib/chat/blocks";
import {
  BlockedMessageTombstone,
  TOMBSTONE_STALE_TEXT,
  TOMBSTONE_TEXT,
} from "./blocked-message-tombstone";
import { MessageBubble } from "./message-bubble";
import { PollCard } from "./poll-card";
import { HELD_QUOTE_TEXT } from "./reply-quote";

/**
 * One s05 row, after the block list has been applied (`applyBlockList` in
 * `lib/chat/blocks.ts`). Held rows never reach here.
 *
 * Split out of `app/(tabs)/chat-thread.tsx` so the choice between tombstone,
 * poll card and bubble is testable: everything under `app/` ships as a route
 * module, so a spec cannot sit beside the screen (`routes.spec.ts` fails on
 * one), and the list's `FlatList` stand-in never calls `renderItem` in tests.
 *
 * **Everything the block list hides is decided here**, so a bubble or card
 * never has to know about it:
 *
 * - **The tombstone comes first**, before the `kind === "poll"` branch: a
 *   blocked member's poll is their authored text like any other message, and a
 *   votable card would put it on screen.
 * - **Reactions** go through `visibleReactions` on every message, the viewer's
 *   own included: a reaction is its author's own text, and the server's mask
 *   (#2494) does not reach reaction rows cached before a block.
 * - **A quoted parent** the list hides is never handed down. The bubble gets
 *   `replyParent: null` and the placeholder to draw instead (#2312 §1).
 */
export interface ThreadMessageRowProps {
  row: ThreadRow;
  viewerId: string | null;
  nameFor: (userId: string) => string | null;
  replyParent: ChatMessage | null | undefined;
  blockState: BlockState;
  onVote: (
    messageId: string,
    actionType: string,
    payload: Record<string, unknown>,
  ) => void;
  onRetry: (clientMessageId: string) => void;
  onDiscard: (clientMessageId: string) => void;
  onReact: (messageId: string, emoji: string) => void;
  onUnreact: (messageId: string, emoji: string) => void;
  onOpenActions: (message: ChatMessage) => void;
  onUnblock: (userId: string) => void;
  /** Each member's post-unblock re-read (`useMaskedRefresh`), for stale tombstones. */
  maskedRefresh: ReadonlyMap<string, MaskedRefreshState>;
  /** A stale tombstone's Reload: re-runs that member's re-read. */
  onReload: (userId: string) => void;
}

/**
 * The placeholder a quote draws for a parent the list hides, or `null` when
 * the parent may be quoted. Consistent with what the parent's own row shows:
 * the tombstone's words (stale when this client unblocked them since), or
 * "Message hidden" for a parent held while the list is unreadable.
 */
export function hiddenQuoteText(
  parent: ChatMessage,
  blockState: BlockState,
  viewerId: string | null,
): string | null {
  switch (classifyMessage(parent, blockState, viewerId)) {
    case "visible":
      return null;
    case "held":
      return HELD_QUOTE_TEXT;
    case "tombstone":
      return tombstoneCanUnblock(parent, blockState)
        ? TOMBSTONE_TEXT
        : TOMBSTONE_STALE_TEXT;
  }
}

export function ThreadMessageRow({
  row,
  viewerId,
  nameFor,
  replyParent,
  blockState,
  onVote,
  onRetry,
  onDiscard,
  onReact,
  onUnreact,
  onOpenActions,
  onUnblock,
  maskedRefresh,
  onReload,
}: ThreadMessageRowProps) {
  const { message: cached, visibility } = row;

  if (visibility === "tombstone") {
    const senderId = cached.sender_id;
    return (
      <BlockedMessageTombstone
        senderName={senderId ? nameFor(senderId) : null}
        canUnblock={tombstoneCanUnblock(cached, blockState)}
        onUnblock={() => {
          if (senderId) onUnblock(senderId);
        }}
        reload={senderId ? (maskedRefresh.get(senderId) ?? null) : null}
        onReload={() => {
          if (senderId) onReload(senderId);
        }}
      />
    );
  }

  const reactions = visibleReactions(cached.reactions, blockState, viewerId);
  const message: ChatMessage =
    reactions === cached.reactions ? cached : { ...cached, reactions };

  const hiddenParent = replyParent
    ? hiddenQuoteText(replyParent, blockState, viewerId)
    : null;
  const quotedParent = hiddenParent === null ? replyParent : null;
  const replyParentHidden = hiddenParent ?? undefined;

  const openActions = canOpenMessageActions(cached, viewerId)
    ? () => onOpenActions(cached)
    : undefined;

  // Cards render unsided, full-width — not wrapped in `MessageBubble` —
  // matching web's `rendersAsBubble` exclusion for every card kind.
  if (message.kind === "poll") {
    return (
      <PollCard
        message={message}
        viewerId={viewerId}
        nameFor={nameFor}
        replyParent={quotedParent}
        replyParentHidden={replyParentHidden}
        isConfirmed={message._status === "confirmed"}
        onVote={onVote}
        onRetry={onRetry}
        onDiscard={onDiscard}
        onReact={onReact}
        onUnreact={onUnreact}
        onOpenActions={openActions}
      />
    );
  }

  return (
    <MessageBubble
      message={message}
      viewerId={viewerId}
      nameFor={nameFor}
      replyParent={quotedParent}
      replyParentHidden={replyParentHidden}
      onRetry={onRetry}
      onDiscard={onDiscard}
      onReact={onReact}
      onUnreact={onUnreact}
      onOpenActions={openActions}
    />
  );
}
