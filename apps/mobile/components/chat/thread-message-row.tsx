import { useMemo, type ReactNode } from "react";
import type { ChatMessage } from "@repo/chat-core/types";
import {
  readAnnouncementBody,
  readEventPayload,
  readHoursPayload,
  readPointsPayload,
  readSystemAuditPayload,
  readTaskPayload,
} from "@repo/chat-core/cards";
import {
  hiddenQuoteText,
  tombstoneCanUnblock,
  visibleReactions,
  type BlockState,
  type MaskedRefreshState,
  type ThreadRow,
} from "@repo/chat-core/blocks";
import { dayDividerLabel } from "@repo/chat-core/grouping";
import { StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { canOpenMessageActions } from "@/lib/chat/blocks";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { AnnouncementCard } from "./announcement-card";
import { BlockedMessageTombstone } from "./blocked-message-tombstone";
import type { ChatCardFrameProps } from "./chat-card";
import { EventCard } from "./event-card";
import { HoursCard } from "./hours-card";
import { MessageItem, MessageRowFrame, OwnLineMarkers } from "./message-item";
import { PointsCard } from "./points-card";
import { PollCard } from "./poll-card";
import { ReplyQuote } from "./reply-quote";
import { SystemAuditCard } from "./system-audit-card";
import { TaskCard } from "./task-card";

/**
 * One s05 row, after the block list has been applied (`applyBlockList` in
 * `@repo/chat-core/blocks`). Held rows never reach here.
 *
 * Split out of `app/(tabs)/chat-thread.tsx` so the choice between tombstone,
 * card and message is testable: everything under `app/` ships as a route
 * module, so a spec cannot sit beside the screen (`routes.spec.ts` fails on
 * one), and the list's `FlatList` stand-in never calls `renderItem` in tests.
 *
 * **Everything the block list hides is decided here**, so a message or card
 * never has to know about it:
 *
 * - **The tombstone comes first**, before any card: a blocked member's poll is
 *   their authored text like any other message, and a votable card would put
 *   it on screen.
 * - **Reactions** go through `visibleReactions` on every message, the viewer's
 *   own included: a reaction is its author's own text, and the server's mask
 *   (#2494) does not reach reaction rows cached before a block.
 * - **A quoted parent** the list hides is never handed down. The row gets
 *   `replyParent: null` and the placeholder to draw instead (#2312 §1).
 */
export interface ThreadMessageRowProps {
  row: ThreadRow;
  /**
   * Where the row sits in its run and its day, from `decorateThread`
   * (`@repo/chat-core/grouping`), the rules web shares: whether it draws the
   * avatar and author line, and whether a day divider goes above it.
   */
  startsRun: boolean;
  startsDay: boolean;
  /**
   * Resolved before any row mounts (#2250): `chat-thread.tsx` withholds the
   * list while `/v1/users/me` is in flight, because a null viewer would paint
   * the member's own messages as incoming ones.
   */
  viewerId: string;
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
  /** Scrolls the thread to a loaded message: a reply quote's tap. */
  onJumpToMessage: (messageId: string) => void;
  onUnblock: (userId: string) => void;
  /** Each member's post-unblock re-read (`useMaskedRefresh`), for stale tombstones. */
  maskedRefresh: ReadonlyMap<string, MaskedRefreshState>;
  /** A stale tombstone's Reload: re-runs that member's re-read. */
  onReload: (userId: string) => void;
}

export function ThreadMessageRow(props: ThreadMessageRowProps) {
  // In an inverted list the item's own content still reads top to bottom, so
  // the divider goes above the row inside the same item.
  return (
    <>
      {props.startsDay ? (
        <DayDivider createdAt={props.row.message.created_at} />
      ) : null}
      <ThreadMessageRowBody {...props} />
    </>
  );
}

function ThreadMessageRowBody({
  row,
  startsRun,
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
  onJumpToMessage,
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
        startsRun={startsRun}
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

  const onJumpToParent = quotedParent
    ? () => onJumpToMessage(quotedParent.id)
    : undefined;

  // A card is not a message body, so it goes into the row frame directly:
  // the same quote, avatar and author line as any other row, with the card
  // where the text would be. Web draws every card kind this way; `cardFor`
  // says which kinds mobile draws as a card, and every other kind is text.
  // A deleted card keeps its kind and payload server-side, so it would still
  // draw a live card with live buttons; like web, a deleted message of any
  // kind is the placeholder instead (MessageItem: no actions, no reactions).
  const card = message.is_deleted
    ? null
    : cardFor(
        {
          message,
          viewerId,
          isConfirmed: message._status === "confirmed",
          onRetry,
          onDiscard,
          onReact,
          onUnreact,
          onOpenActions: openActions,
          onJumpToParent: message.reply_to_id ? onJumpToParent : undefined,
        },
        { onVote, nameFor },
      );
  if (card) {
    const quote =
      message.reply_to_id ? (
        <ReplyQuote
          message={message}
          replyParent={quotedParent}
          hiddenText={replyParentHidden}
          nameFor={nameFor}
          viewerId={viewerId}
          onPress={onJumpToParent}
          onLongPress={openActions}
        />
      ) : null;
    return (
      <MessageRowFrame
        message={message}
        viewerId={viewerId}
        nameFor={nameFor}
        startsRun={startsRun}
        quote={quote}
        onOpenActions={openActions}
      >
        {card}
        <OwnLineMarkers message={message} />
      </MessageRowFrame>
    );
  }

  return (
    <MessageItem
      message={message}
      viewerId={viewerId}
      nameFor={nameFor}
      startsRun={startsRun}
      replyParent={quotedParent}
      replyParentHidden={replyParentHidden}
      onRetry={onRetry}
      onDiscard={onDiscard}
      onReact={onReact}
      onUnreact={onUnreact}
      onOpenActions={openActions}
      onJumpToParent={onJumpToParent}
    />
  );
}

/**
 * The card a message draws, or `null` to draw it as text.
 *
 * A card whose payload doesn't read is text, its `content` string, as web's
 * renderers fall back: the server writes that string for exactly this. That
 * includes the server's own `system_audit` notices, which carry no payload
 * and whose `content` is the whole notice ("This poll has closed."). A poll
 * keeps its own malformed state, which names the poll.
 *
 * Not yet cards on mobile: `rush` (#3383), `dues`, which web draws as a
 * "coming soon" card, and `loading`, web's placeholder for a slash command
 * in flight, which mobile never sends.
 */
function cardFor(
  frame: ChatCardFrameProps,
  row: {
    onVote: ThreadMessageRowProps["onVote"];
    nameFor: ThreadMessageRowProps["nameFor"];
  },
): ReactNode | null {
  const { message } = frame;
  switch (message.kind) {
    case "poll":
      return <PollCard {...frame} onVote={row.onVote} />;
    case "event": {
      const payload = readEventPayload(message);
      return payload ? <EventCard {...frame} payload={payload} /> : null;
    }
    case "task": {
      const payload = readTaskPayload(message);
      return payload ? <TaskCard {...frame} payload={payload} /> : null;
    }
    case "points": {
      const payload = readPointsPayload(message);
      return payload ? <PointsCard {...frame} payload={payload} /> : null;
    }
    case "hours": {
      const payload = readHoursPayload(message);
      return payload ? <HoursCard {...frame} payload={payload} /> : null;
    }
    case "announcement": {
      const body = readAnnouncementBody(message);
      return body ? <AnnouncementCard {...frame} body={body} /> : null;
    }
    case "system_audit": {
      const payload = readSystemAuditPayload(message);
      return payload ? (
        <SystemAuditCard {...frame} payload={payload} nameFor={row.nameFor} />
      ) : null;
    }
    default:
      return null;
  }
}

/**
 * The day divider above the first row of each local calendar day
 * (`components.md` §11 § Grouping): a hairline either side of a centred
 * caption, 12.5 / 600. The only place a date appears in the thread; the label
 * is `dayDividerLabel`, the one web uses.
 */
export function DayDivider({ createdAt }: { createdAt: string }) {
  const { tokens } = useFrappTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  return (
    <View style={styles.divider} accessibilityRole="header">
      <View style={styles.rule} />
      <Text style={styles.dividerLabel}>{dayDividerLabel(createdAt)}</Text>
      <View style={styles.rule} />
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    divider: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      paddingHorizontal: tokens.spacing.lg,
      paddingTop: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xs,
    },
    rule: {
      flex: 1,
      height: StyleSheet.hairlineWidth,
      backgroundColor: tokens.color.border.hairline,
    },
    dividerLabel: {
      ...typeRole({
        ...tokens.typography.role.caption,
        weight: tokens.typography.weight.semibold,
      }),
      color: tokens.color.text.mutedForeground,
    },
  });
}
