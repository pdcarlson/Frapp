import { useMemo } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type AccessibilityActionEvent,
  type AccessibilityActionInfo,
} from "react-native";
import type { ChatMessage } from "@repo/chat-core/types";
import { emojiFromActionType } from "@repo/chat-core/types";
import { DELETED_MESSAGE_PLACEHOLDER } from "@repo/chat-core/reply-preview";
import { linkSegments, type LinkSegment } from "@repo/chat-core/links";
import {
  EDITED_MARKER,
  showsEditedMarker,
} from "@repo/chat-core/message-actions";
import { parseInstant } from "@repo/formatting";
import { SignetTokens } from "@repo/theme/signet";
import { useChapterBranding } from "@/lib/chapter-branding";
import {
  deliveryChrome,
  type DeliveryChrome,
} from "@/lib/chat/delivery-status";
import { avatarRadius, typeRole, useFrappTheme } from "@/lib/theme";
import {
  authorInitialsFallback,
  resolveAuthorLabel,
  resolveAuthorName,
} from "@repo/hooks";
import { initialsFor } from "@/lib/chat/display-name";
import { MessageAttachments } from "./message-attachments";
import {
  linkA11yActions,
  MessageText,
  runLinkA11yAction,
} from "./message-text";
import { ReplyQuote } from "./reply-quote";

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
 * consecutive-message grouping renders full chrome per message; the pending,
 * failed, unconfirmed, and recorded send states ride the self-bubble meta
 * line (`deliveryChrome` is exhaustive over `MessageStatus` — #1910), failed
 * in `semantic.destructive` with a retry path, unconfirmed/recorded as a
 * muted note with no discard; and an in-bubble mention highlight falls back
 * to the list-level badge, which is also all the client can do today —
 * `chat_messages.mentions` is resolved server-side but `normalizeRow` does not
 * carry it onto `ChatMessage`, so the thread has no per-message mention signal
 * to render even if the design existed.
 */

export interface MessageBubbleProps {
  message: ChatMessage;
  /**
   * `users.id` of the viewer — never the Supabase auth uid. Non-nullable on
   * purpose (#2250): an unresolved viewer has no bubble shape to draw, so the
   * thread withholds its rows until identity lands rather than handing a row
   * `null` to read as "not mine".
   */
  viewerId: string;
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
  /**
   * The replied-to message when it is in the loaded window, or `null` when
   * `message.reply_to_id` is set and the parent is not. `MessageBubble`
   * decides whether to draw a quote from `reply_to_id`, not from this prop
   * — `null` vs `undefined` is "looked up and absent" vs "not a reply".
   */
  replyParent?: ChatMessage | null;
  /**
   * What the quote says instead of the parent when the viewer's block list
   * hides that parent — tombstoned or held (#2312 §1). The thread passes
   * `replyParent: null` alongside it, so the parent's words never reach this
   * component in the first place; this only picks the honest placeholder over
   * "Original message not loaded". Decided in `thread-message-row.tsx`.
   */
  replyParentHidden?: string;
  /**
   * Opens the message actions sheet (reply, edit, delete, report, block —
   * #2257, #2775). Passed only for a row that offers them
   * (`canOpenMessageActions` in `lib/chat/blocks.ts`): a confirmed, undeleted
   * message, the viewer's own included.
   */
  onOpenActions?: () => void;
  /**
   * Scrolls the thread to the quoted parent. Passed only when the parent is
   * loaded and shown, so a quote reading "Original message not loaded" or a
   * block-list placeholder is not a control.
   */
  onJumpToParent?: () => void;
}

/** The drawn quick reaction. A fuller picker is not in this slice. */
export const QUICK_REACTION = "👍";

/** Long-press is the gesture; this is its screen-reader twin. */
export const MESSAGE_ACTIONS_A11Y_LABEL = "Message actions";

const MESSAGE_ACTIONS: AccessibilityActionInfo[] = [
  { name: "longpress", label: MESSAGE_ACTIONS_A11Y_LABEL },
];

/** A reply quote's tap, for a screen reader that cannot reach the quote itself. */
export const JUMP_TO_PARENT_A11Y_LABEL = "Go to the original message";
const JUMP_TO_PARENT_ACTION: AccessibilityActionInfo = {
  name: "jumpToParent",
  label: JUMP_TO_PARENT_A11Y_LABEL,
};

type MessageActionsA11yProps =
  | {
      accessibilityActions: AccessibilityActionInfo[];
      onAccessibilityAction: (event: AccessibilityActionEvent) => void;
    }
  | Record<string, never>;

/**
 * The accessibility half of a message's long-press, and of its links, for the
 * containers a screen reader lands on.
 *
 * The gesture lives on a wrapping `Pressable` marked `accessible={false}` —
 * an accessible wrapper would fold the reaction chips and attachment buttons
 * inside it into one element and hide them from VoiceOver. So the action rides
 * an **accessible `View`** around the message's own header and text instead,
 * never a bare `<Text>`: custom actions on a `Text` are not reliably surfaced
 * by VoiceOver under the new architecture, and a `View` with `accessible` is the
 * element iOS exposes them on. `longpress` with a label is a named custom action
 * in the iOS actions rotor and the double-tap-and-hold on Android.
 *
 * That same accessible container makes the body's link `Text`s unreachable on
 * their own, so each link rides it too, as "Open <link>" (`linkA11yActions`).
 * Returns nothing when there is nothing to offer.
 */
export function messageActionsA11yProps(
  onOpenActions: (() => void) | undefined,
  body: { links?: LinkSegment[]; onJumpToParent?: () => void } = {},
): MessageActionsA11yProps {
  const links = body.links ?? [];
  const actions = [
    ...(onOpenActions ? MESSAGE_ACTIONS : []),
    ...(body.onJumpToParent ? [JUMP_TO_PARENT_ACTION] : []),
    ...linkA11yActions(links),
  ];
  if (actions.length === 0) return {};
  return {
    accessibilityActions: actions,
    onAccessibilityAction: (event) => {
      const { actionName } = event.nativeEvent;
      if (actionName === "longpress") onOpenActions?.();
      else if (actionName === JUMP_TO_PARENT_ACTION.name) {
        body.onJumpToParent?.();
      } else runLinkA11yAction(links, actionName);
    },
  };
}

export function formatMessageTime(createdAt: string): string {
  const at = parseInstant(createdAt);
  if (!at) return "";
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

/**
 * Drops non-reaction action types and emptied groups.
 *
 * Counts whatever `message.reactions` holds. The s05 thread hands every bubble
 * and card a message whose reactions already went through the viewer's block
 * list (`visibleReactions` in `@repo/chat-core/blocks`, applied in
 * `thread-message-row.tsx`), so a blocked member's reaction never reaches here.
 */
export function groupReactions(
  message: ChatMessage,
  viewerId: string,
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
        mine: userIds.includes(viewerId),
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
  replyParent,
  replyParentHidden,
  onOpenActions,
  onJumpToParent,
}: MessageBubbleProps) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const segments = useMemo(
    () => linkSegments(message.content),
    [message.content],
  );
  const isMine = message.sender_id === viewerId;
  // Reactions address a server id, so a message still in flight has nothing to
  // address. Web gates the same affordance on the same condition.
  const isConfirmed = message._status === "confirmed";
  const reactions = groupReactions(message, viewerId);
  const time = formatMessageTime(message.created_at);

  // Split by branch, rather than one component reading useChapterBranding()
  // unconditionally, so only self bubbles pull it in. That hook reaches for
  // `FrappClientProvider`; before #1007 an incoming-message row never needed
  // one, and incoming rows are the overwhelming majority. Same reasoning as
  // `MessageAttachments` below, mounted only when a message has files.
  // `isMine` is derived from the message's fixed `sender_id` and the thread's
  // `viewerId`, neither of which changes for a given row, so a message never
  // switches which of these two components renders it.
  if (isMine) {
    return (
      <MineMessageBubble
        message={message}
        replyParent={replyParent}
        replyParentHidden={replyParentHidden}
        viewerId={viewerId}
        nameFor={nameFor}
        time={time}
        isConfirmed={isConfirmed}
        reactions={reactions}
        segments={segments}
        onRetry={onRetry}
        onDiscard={onDiscard}
        onReact={onReact}
        onUnreact={onUnreact}
        onOpenActions={onOpenActions}
        onJumpToParent={onJumpToParent}
        styles={styles}
      />
    );
  }

  // Resolved once and used for both the meta line and the avatar initials — two
  // lookups would be two chances for them to drift apart.
  //
  // Both come from `@repo/hooks` rather than `nameFor` directly: `sender_id` is
  // nullable, so an imported archive message has no roster entry and names its
  // author in `author_name`. The label rule is shared with web so the two
  // surfaces cannot drift, which is why the local `senderLabel` is gone.
  const authorName = resolveAuthorName(message, nameFor);
  const authorLabel = resolveAuthorLabel(message, nameFor, viewerId);

  // Mount the renderer only when the message actually has files. The query hook
  // inside reaches for `FrappClientProvider`, so mounting unconditionally would
  // make every plain-text row — the overwhelming majority — require a client
  // context it has never needed. The count comes off the message row, so this
  // costs no request to decide.
  //
  // A deleted message shows none: the API 404s the attachment list anyway, but
  // the client must not offer the affordance in the first place.
  //
  // `onLongPress` is forwarded to each file: an attachment is its own
  // `Pressable`, and an inner Pressable claims the touch, so without it a long
  // press on a photo — the whole of a photo-only message since #2464 — would
  // open the file instead of the actions the rest of the row opens.
  const attachments =
    !message.is_deleted && message.attachment_count > 0 ? (
      <MessageAttachments
        channelId={message.channel_id}
        messageId={message.id}
        count={message.attachment_count}
        isMine={false}
        onLongPress={onOpenActions}
      />
    ) : null;

  const hasText = !message.is_deleted && message.content.length > 0;
  const headerA11y = messageActionsA11yProps(onOpenActions);
  const bodyA11y = messageActionsA11yProps(onOpenActions, {
    links: hasText ? segments : [],
    onJumpToParent: quoteJump(message, onJumpToParent),
  });

  const quote =
    message.reply_to_id && !message.is_deleted ? (
      <ReplyQuote
        message={message}
        replyParent={replyParent}
        hiddenText={replyParentHidden}
        nameFor={nameFor}
        viewerId={viewerId}
        borderColor={tokens.color.border.hairline}
        textColor={tokens.color.text.muted}
        onPress={onJumpToParent}
        onLongPress={onOpenActions}
      />
    ) : null;

  const text = message.is_deleted ? (
    <Text style={styles.deleted}>{DELETED_MESSAGE_PLACEHOLDER}</Text>
  ) : hasText ? (
    <MessageText
      segments={segments}
      style={styles.bodyTheirs}
      onLongPress={onOpenActions}
    />
  ) : null;
  const meta = showsEditedMarker(message)
    ? `${authorLabel} · ${time} ${EDITED_MARKER}`
    : `${authorLabel} · ${time}`;

  return (
    // The long-press target is the whole row, so a file-only message has one
    // too. `accessible={false}` keeps the chips and attachments inside it
    // individually reachable — see `messageActionsA11yProps`, which is why the
    // screen-reader action sits on the two accessible containers below (the
    // header, which every row has, and the quote-and-text) rather than here.
    <Pressable
      accessible={false}
      onLongPress={onOpenActions}
      disabled={!onOpenActions}
      style={styles.rowTheirs}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>
          {authorName
            ? initialsFor(authorName)
            : authorInitialsFallback(message)}
        </Text>
      </View>

      <View style={styles.theirsColumn}>
        <View accessible={"accessibilityActions" in headerA11y} {...headerA11y}>
          <Text style={styles.metaText}>{meta}</Text>
        </View>
        <View style={styles.bubbleTheirs}>
          {quote || text ? (
            <View accessible={"accessibilityActions" in bodyA11y} {...bodyA11y}>
              {quote}
              {text}
            </View>
          ) : null}
          {attachments}
        </View>

        <ReactionRow
          reactions={reactions}
          messageId={message.id}
          disabled={!isConfirmed}
          onReact={onReact}
          onUnreact={onUnreact}
          onLongPress={onOpenActions}
          styles={styles}
          align="flex-start"
        />
      </View>
    </Pressable>
  );
}

/**
 * The self-bubble branch, split out so `useChapterBranding()` is only ever
 * called for a message the viewer sent — see the comment at its call site
 * in {@link MessageBubble}.
 */
function MineMessageBubble({
  message,
  replyParent,
  replyParentHidden,
  viewerId,
  nameFor,
  time,
  isConfirmed,
  reactions,
  segments,
  onRetry,
  onDiscard,
  onReact,
  onUnreact,
  onOpenActions,
  onJumpToParent,
  styles,
}: {
  message: ChatMessage;
  replyParent: ChatMessage | null | undefined;
  replyParentHidden: string | undefined;
  viewerId: string;
  nameFor: (userId: string) => string | null;
  time: string;
  isConfirmed: boolean;
  reactions: ReactionGroup[];
  segments: LinkSegment[];
  onRetry: (clientMessageId: string) => void;
  onDiscard: (clientMessageId: string) => void;
  onReact: (messageId: string, emoji: string) => void;
  onUnreact: (messageId: string, emoji: string) => void;
  onOpenActions: (() => void) | undefined;
  onJumpToParent: (() => void) | undefined;
  styles: ReturnType<typeof createStyles>;
}) {
  // The chapter accent, not Signet's house gold — components.md:210 makes the
  // self bubble the one surface that carries tenant identity in the timeline.
  // `--signet-accent-primary`/`--signet-accent-on-primary` are the
  // contrast-checked solid-fill pair (accent-engine.md §8); a chapter whose
  // palette predates the Signet map falls back to house gold, same as it did
  // before this pair existed (#1007).
  const { accentPrimary, accentOnPrimary } = useChapterBranding();

  // A deleted message shows none: the API 404s the attachment list anyway, but
  // the client must not offer the affordance in the first place. The row's
  // long-press is forwarded for the same reason the incoming branch forwards
  // it: an attachment is its own `Pressable` and claims the touch.
  const attachments =
    !message.is_deleted && message.attachment_count > 0 ? (
      <MessageAttachments
        channelId={message.channel_id}
        messageId={message.id}
        count={message.attachment_count}
        isMine
        accentOnPrimary={accentOnPrimary}
        onLongPress={onOpenActions}
      />
    ) : null;

  const hasText = !message.is_deleted && message.content.length > 0;
  const quote =
    message.reply_to_id && !message.is_deleted ? (
      <ReplyQuote
        message={message}
        replyParent={replyParent}
        hiddenText={replyParentHidden}
        nameFor={nameFor}
        viewerId={viewerId}
        borderColor={accentOnPrimary}
        textColor={accentOnPrimary}
        onPress={onJumpToParent}
        onLongPress={onOpenActions}
      />
    ) : null;

  const text = message.is_deleted ? (
    <Text style={[styles.deleted, { color: accentOnPrimary }]}>
      {DELETED_MESSAGE_PLACEHOLDER}
    </Text>
  ) : hasText ? (
    <MessageText
      segments={segments}
      style={[styles.bodyMine, { color: accentOnPrimary }]}
      onLongPress={onOpenActions}
    />
  ) : null;

  // Same split as the incoming branch: the actions ride an accessible `View`
  // around the quote and text, never the `Pressable` holding the photos, which
  // would fold them into one element (`messageActionsA11yProps`).
  const bodyA11y = messageActionsA11yProps(onOpenActions, {
    links: hasText ? segments : [],
    onJumpToParent: quoteJump(message, onJumpToParent),
  });

  const chrome = deliveryChrome(message);

  return (
    // Your own message has a long-press since #2775 (Reply, Edit, Delete);
    // `accessible={false}` for the reason the incoming row gives.
    <Pressable
      accessible={false}
      onLongPress={onOpenActions}
      disabled={!onOpenActions}
      style={styles.rowMine}
    >
      <View style={[styles.bubbleMine, { backgroundColor: accentPrimary }]}>
        {quote || text ? (
          <View accessible={"accessibilityActions" in bodyA11y} {...bodyA11y}>
            {quote}
            {text}
          </View>
        ) : null}
        {attachments}
      </View>

      <View style={styles.metaMine}>
        <MineDeliveryMeta
          chrome={chrome}
          time={time}
          edited={showsEditedMarker(message)}
          styles={styles}
        />
      </View>

      {chrome.status === "failed" ? (
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
        onLongPress={onOpenActions}
        styles={styles}
        align="flex-end"
      />
    </Pressable>
  );
}

/** The quote's jump, when the row draws a quote at all. */
function quoteJump(
  message: ChatMessage,
  onJumpToParent: (() => void) | undefined,
): (() => void) | undefined {
  return message.reply_to_id && !message.is_deleted
    ? onJumpToParent
    : undefined;
}

/**
 * Self-bubble delivery caption. Exhaustive over `DeliveryChrome` so a new
 * `MessageStatus` cannot silently render as the confirmed time-only line.
 *
 * `unconfirmed` / `recorded` are muted notes, never destructive, and never
 * paired with Retry/Discard in the caller. Mobile has no slash replay path,
 * so `unconfirmed` is read-only — do not add a Retry here.
 */
function MineDeliveryMeta({
  chrome,
  time,
  edited,
  styles,
}: {
  chrome: DeliveryChrome;
  time: string;
  /** Only a confirmed row can have been edited; the other states ignore it. */
  edited: boolean;
  styles: ReturnType<typeof createStyles>;
}) {
  switch (chrome.status) {
    case "pending":
      return <Text style={styles.metaText}>{`${time} · sending`}</Text>;
    case "failed":
      return <Text style={styles.metaFailed}>{chrome.error}</Text>;
    case "unconfirmed":
    case "recorded":
      return (
        <>
          <Text style={styles.metaText}>{time}</Text>
          <Text style={styles.metaText} accessibilityLiveRegion="polite">
            {chrome.note}
          </Text>
        </>
      );
    case "confirmed":
      return (
        <Text style={styles.metaText}>
          {edited ? `${time} ${EDITED_MARKER}` : time}
        </Text>
      );
    default: {
      const _never: never = chrome;
      return _never;
    }
  }
}

/**
 * Exported so a non-bubble card (e.g. `PollCard`, #528) can carry the same
 * reaction affordance `MessageBubble` gives every other kind — `styles` is
 * narrowed to just the keys this component reads so a caller with its own
 * `createStyles` only has to match that slice, not `MessageBubble`'s full
 * (bubble-specific) style sheet.
 */
export function ReactionRow({
  reactions,
  messageId,
  disabled,
  onReact,
  onUnreact,
  onLongPress,
  styles,
  align,
}: {
  reactions: ReactionGroup[];
  messageId: string;
  disabled: boolean;
  onReact: (messageId: string, emoji: string) => void;
  onUnreact: (messageId: string, emoji: string) => void;
  /**
   * The row's long-press (the message actions), forwarded to every chip. A
   * chip is its own `Pressable` and claims the touch, so without this a long
   * press on one ends as a tap — a reaction toggled — instead of opening the
   * actions the rest of the message opens.
   */
  onLongPress?: () => void;
  styles: Pick<
    ReturnType<typeof createStyles>,
    | "reactionRow"
    | "reactionChip"
    | "reactionChipMine"
    | "reactionText"
    | "reactionTextMine"
  >;
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
          onLongPress={onLongPress}
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
          onLongPress={onLongPress}
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
      // No backgroundColor here — the chapter accent (or its house-gold
      // fallback) is applied inline from useChapterBranding() at the render
      // site, since it varies per chapter rather than per theme (#1007).
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
      // No color here — see bubbleMine; applied inline alongside the fill.
      ...typeRole(tokens.typography.role.body),
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
