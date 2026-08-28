import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ChatMessage } from "@repo/chat-core/types";
import { emojiFromActionType } from "@repo/chat-core/types";
import { SignetTokens } from "@repo/theme/signet";
import { avatarRadius, typeRole, useFrappTheme } from "@/lib/theme";
import {
  authorInitialsFallback,
  resolveAuthorLabel,
  resolveAuthorName,
} from "@repo/hooks";
import { initialsFor } from "@/lib/chat/display-name";

/**
 * One message row in the s05 thread.
 *
 * Geometry from `canvas-screens.dc.html:170-185`, which supersedes prose:
 * incoming rows carry a 32pt avatar and put their meta line *above* the bubble;
 * the self bubble is right-aligned with its meta *below*, right-aligned. Both
 * cap at 86% width. Corner radii are asymmetric and come straight from the
 * token map — `radius.bubble` (18) on three corners and `radius.bubbleTail` (6)
 * on the one nearest the sender.
 *
 * **The self bubble is the only place a message takes the chapter accent**
 * (`components.md:210`); incoming bubbles stay neutral in every chapter.
 *
 * Three TODO-DESIGN gaps are officially open in `components.md:216-218`, and
 * this follows the fallback each one names rather than inventing a treatment:
 * consecutive-message grouping renders full chrome per message; the pending and
 * failed send states ride the self-bubble meta line, failed in
 * `semantic.destructive` with a retry path; and an in-bubble mention highlight
 * falls back to the list-level badge, which is also all the client can do today
 * — `chat_messages.mentions` is resolved server-side but `normalizeRow` does not
 * carry it onto `ChatMessage`, so the thread has no per-message mention signal
 * to render even if the design existed.
 */

export interface MessageBubbleProps {
  message: ChatMessage;
  /** `users.id` of the viewer — never the Supabase auth uid. */
  viewerId: string | null;
  /**
   * Resolves a `users.id` to a display name, or `null` when it cannot be
   * resolved. Required rather than optional: an optional resolver would let a
   * screen forget it and silently regress every row to a truncated uuid, which
   * is the state this replaced.
   */
  nameFor: (userId: string) => string | null;
  onRetry: (clientMessageId: string) => void;
  onDiscard: (clientMessageId: string) => void;
  onReact: (messageId: string, emoji: string) => void;
  onUnreact: (messageId: string, emoji: string) => void;
}

/** The drawn quick reaction. A fuller picker is not in this slice. */
export const QUICK_REACTION = "👍";

export function formatMessageTime(createdAt: string): string {
  const at = new Date(createdAt);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

interface ReactionGroup {
  emoji: string;
  actionType: string;
  count: number;
  mine: boolean;
}

/** Drops non-reaction action types and emptied groups. */
export function groupReactions(
  message: ChatMessage,
  viewerId: string | null,
): ReactionGroup[] {
  return Object.entries(message.reactions ?? {})
    .map(([actionType, userIds]) => {
      const emoji = emojiFromActionType(actionType);
      if (!emoji || !Array.isArray(userIds) || userIds.length === 0) {
        return null;
      }
      return {
        emoji,
        actionType,
        count: userIds.length,
        mine: !!viewerId && userIds.includes(viewerId),
      };
    })
    .filter((group): group is ReactionGroup => !!group);
}

export function MessageBubble({
  message,
  viewerId,
  nameFor,
  onRetry,
  onDiscard,
  onReact,
  onUnreact,
}: MessageBubbleProps) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  const isMine = !!viewerId && message.sender_id === viewerId;
  // Resolved once and used for both the meta line and the avatar initials — two
  // lookups would be two chances for them to drift apart.
  //
  // Both come from `@repo/hooks` rather than `nameFor` directly: `sender_id` is
  // nullable, so an imported archive message has no roster entry and names its
  // author in `author_name`. The label rule is shared with web so the two
  // surfaces cannot drift, which is why the local `senderLabel` is gone.
  const authorName = resolveAuthorName(message, nameFor);
  const authorLabel = resolveAuthorLabel(message, nameFor, viewerId);
  // Reactions address a server id, so a message still in flight has nothing to
  // address. Web gates the same affordance on the same condition.
  const isConfirmed = message._status === "confirmed";
  const reactions = groupReactions(message, viewerId);
  const time = formatMessageTime(message.created_at);

  // Mobile has no attachment picker and no attachment renderer yet, but it must
  // still say that a message HAS files. Two things made this urgent rather than
  // cosmetic: web can now send a message that is nothing but a file, and the
  // backfill strips the `📎 <name> (<path>)` text out of every historical
  // attachment message — so without this line, messages that read fine on mobile
  // yesterday become empty bubbles indistinguishable from a rendering bug.
  //
  // A count, not a filename: the names live in `chat_message_attachments` and
  // need a signed-URL round trip per message, which is the renderer's job when
  // it lands. Saying "1 attachment" with no way to open it is honest; saying
  // nothing is not.
  const attachmentNote =
    !message.is_deleted && message.attachment_count > 0 ? (
      <Text style={isMine ? styles.attachmentMine : styles.attachmentTheirs}>
        {message.attachment_count === 1
          ? "1 attachment · open on web"
          : `${message.attachment_count} attachments · open on web`}
      </Text>
    ) : null;

  const body = message.is_deleted ? (
    <Text style={styles.deleted}>Message deleted</Text>
  ) : (
    <>
      {message.content.length > 0 ? (
        <Text style={isMine ? styles.bodyMine : styles.bodyTheirs}>
          {message.content}
        </Text>
      ) : null}
      {attachmentNote}
    </>
  );

  if (isMine) {
    return (
      <View style={styles.rowMine}>
        <View style={styles.bubbleMine}>{body}</View>

        <View style={styles.metaMine}>
          {message._status === "pending" ? (
            <Text style={styles.metaText}>{`${time} · sending`}</Text>
          ) : message._status === "failed" ? (
            <Text style={styles.metaFailed}>
              {message._error ?? "Send failed"}
            </Text>
          ) : (
            <Text style={styles.metaText}>{time}</Text>
          )}
        </View>

        {message._status === "failed" ? (
          <View style={styles.failedActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry sending this message"
              hitSlop={8}
              onPress={() => onRetry(message.client_message_id)}
            >
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Discard this message"
              hitSlop={8}
              onPress={() => onDiscard(message.client_message_id)}
            >
              <Text style={styles.discardText}>Discard</Text>
            </Pressable>
          </View>
        ) : null}

        <ReactionRow
          reactions={reactions}
          messageId={message.id}
          disabled={!isConfirmed}
          onReact={onReact}
          onUnreact={onUnreact}
          styles={styles}
          align="flex-end"
        />
      </View>
    );
  }

  return (
    <View style={styles.rowTheirs}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>
          {authorName
            ? initialsFor(authorName)
            : authorInitialsFallback(message)}
        </Text>
      </View>

      <View style={styles.theirsColumn}>
        <Text style={styles.metaText}>
          {`${authorLabel} · ${time}`}
        </Text>
        <View style={styles.bubbleTheirs}>{body}</View>

        <ReactionRow
          reactions={reactions}
          messageId={message.id}
          disabled={!isConfirmed}
          onReact={onReact}
          onUnreact={onUnreact}
          styles={styles}
          align="flex-start"
        />
      </View>
    </View>
  );
}

function ReactionRow({
  reactions,
  messageId,
  disabled,
  onReact,
  onUnreact,
  styles,
  align,
}: {
  reactions: ReactionGroup[];
  messageId: string;
  disabled: boolean;
  onReact: (messageId: string, emoji: string) => void;
  onUnreact: (messageId: string, emoji: string) => void;
  styles: ReturnType<typeof createStyles>;
  align: "flex-start" | "flex-end";
}) {
  // The add chip is what makes the *first* reaction on a message possible.
  // Without it the row only rendered when reactions already existed, so
  // `onReact` was unreachable and nobody could ever start one — the Canvas
  // draws this chip (s05, `canvas-screens.dc.html:181`) for that reason.
  // Hidden while the message is unconfirmed, since a reaction addresses a
  // server id a pending placeholder does not have yet.
  return (
    <View style={[styles.reactionRow, { justifyContent: align }]}>
      {reactions.map((group) => (
        <Pressable
          key={group.actionType}
          accessibilityRole="button"
          accessibilityState={{ selected: group.mine, disabled }}
          accessibilityLabel={`${group.emoji}, ${group.count}`}
          disabled={disabled}
          // A 26pt chip against the 44pt floor: hitSlop closes the gap without
          // inflating the drawn chip (components.md:214).
          hitSlop={9}
          onPress={() =>
            group.mine
              ? onUnreact(messageId, group.emoji)
              : onReact(messageId, group.emoji)
          }
          style={[
            styles.reactionChip,
            group.mine ? styles.reactionChipMine : null,
          ]}
        >
          <Text
            style={group.mine ? styles.reactionTextMine : styles.reactionText}
          >
            {`${group.emoji} ${group.count}`}
          </Text>
        </Pressable>
      ))}

      {!disabled && !reactions.some((group) => group.mine) ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`React with ${QUICK_REACTION}`}
          hitSlop={9}
          onPress={() => onReact(messageId, QUICK_REACTION)}
          style={styles.reactionChip}
        >
          <Text style={styles.reactionText}>{`${QUICK_REACTION} +`}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  const AVATAR_SIZE = 32;

  return StyleSheet.create({
    rowTheirs: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: tokens.spacing.sm + 2,
      maxWidth: "86%",
      alignSelf: "flex-start",
    },
    rowMine: {
      maxWidth: "86%",
      alignSelf: "flex-end",
      alignItems: "flex-end",
    },
    theirsColumn: {
      flexShrink: 1,
    },
    avatar: {
      width: AVATAR_SIZE,
      height: AVATAR_SIZE,
      borderRadius: avatarRadius(AVATAR_SIZE),
      backgroundColor: tokens.color.surface.popover,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    bubbleTheirs: {
      marginTop: tokens.spacing.xs,
      paddingVertical: tokens.spacing.md - 1,
      paddingHorizontal: tokens.spacing.md + 2,
      backgroundColor: tokens.color.surface.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      borderTopLeftRadius: tokens.radius.bubble,
      borderTopRightRadius: tokens.radius.bubble,
      borderBottomRightRadius: tokens.radius.bubble,
      // The tail corner points back at its sender.
      borderBottomLeftRadius: tokens.radius.bubbleTail,
    },
    bubbleMine: {
      paddingVertical: tokens.spacing.md - 1,
      paddingHorizontal: tokens.spacing.md + 2,
      // Signet's house gold, not the chapter accent: the accent engine has not
      // delivered an `on-primary` pair to mobile yet, and `gold.onHouse` is the
      // one on-fill text colour that is specified today. Retinting per chapter
      // without a contrast-checked foreground is how unreadable bubbles ship.
      backgroundColor: tokens.color.gold.house,
      borderTopLeftRadius: tokens.radius.bubble,
      borderTopRightRadius: tokens.radius.bubble,
      borderBottomLeftRadius: tokens.radius.bubble,
      borderBottomRightRadius: tokens.radius.bubbleTail,
    },
    bodyTheirs: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    bodyMine: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.gold.onHouse,
    },
    // Same token pair as the body, one step quieter — the note is metadata about
    // the message, not the message.
    attachmentTheirs: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    attachmentMine: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.gold.onHouse,
    },
    deleted: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.muted,
      fontStyle: "italic",
    },
    metaMine: {
      marginTop: tokens.spacing.xs,
      alignItems: "flex-end",
    },
    metaText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    metaFailed: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
    failedActions: {
      flexDirection: "row",
      gap: tokens.spacing.md,
      marginTop: tokens.spacing.xs,
    },
    retryText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.gold.askText,
    },
    discardText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    reactionRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: tokens.spacing.sm - 2,
      marginTop: tokens.spacing.sm - 2,
    },
    reactionChip: {
      height: 26,
      paddingHorizontal: tokens.spacing.sm + 1,
      borderRadius: tokens.radius.chip + 1,
      backgroundColor: tokens.color.surface.popover,
      alignItems: "center",
      justifyContent: "center",
    },
    reactionChipMine: {
      backgroundColor: tokens.color.gold.askFill,
      borderWidth: 1,
      borderColor: tokens.color.gold.askBorder,
    },
    reactionText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    reactionTextMine: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.gold.askText,
    },
  });
}
