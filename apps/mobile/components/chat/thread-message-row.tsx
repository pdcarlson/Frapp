import type { ChatMessage } from "@repo/chat-core/types";
import {
  messageActionsFor,
  tombstoneCanUnblock,
  type BlockState,
  type ThreadRow,
} from "@/lib/chat/blocks";
import { BlockedMessageTombstone } from "./blocked-message-tombstone";
import { MessageBubble } from "./message-bubble";
import { PollCard } from "./poll-card";

/**
 * One s05 row, after the block list has been applied (`applyBlockList` in
 * `lib/chat/blocks.ts`). Held rows never reach here.
 *
 * Split out of `app/(tabs)/chat-thread.tsx` so the choice between tombstone,
 * poll card and bubble is testable: everything under `app/` ships as a route
 * module, so a spec cannot sit beside the screen (`routes.spec.ts` fails on
 * one), and the list's `FlatList` stand-in never calls `renderItem` in tests.
 *
 * **The tombstone check comes first**, before the `kind === "poll"` branch: a
 * blocked member's poll is their authored text like any other message, and a
 * votable card would put it on screen.
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
}: ThreadMessageRowProps) {
  const { message, visibility } = row;

  if (visibility === "tombstone") {
    const senderId = message.sender_id;
    return (
      <BlockedMessageTombstone
        senderName={senderId ? nameFor(senderId) : null}
        canUnblock={tombstoneCanUnblock(message, blockState)}
        onUnblock={() => {
          if (senderId) onUnblock(senderId);
        }}
      />
    );
  }

  const openActions = messageActionsFor(message, viewerId).canOpen
    ? () => onOpenActions(message)
    : undefined;

  // Cards render unsided, full-width — not wrapped in `MessageBubble` —
  // matching web's `rendersAsBubble` exclusion for every card kind.
  if (message.kind === "poll") {
    return (
      <PollCard
        message={message}
        viewerId={viewerId}
        nameFor={nameFor}
        replyParent={replyParent}
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
      replyParent={replyParent}
      onRetry={onRetry}
      onDiscard={onDiscard}
      onReact={onReact}
      onUnreact={onUnreact}
      onOpenActions={openActions}
    />
  );
}
