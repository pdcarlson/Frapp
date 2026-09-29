import { useMemo, type ReactNode } from "react";
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
  isOwnMessage,
  showsEditedMarker,
} from "@repo/chat-core/message-actions";
import { formatTimeOfDay } from "@repo/formatting";
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
 * One message row in the s05 thread, in the compact layout
 * (`spec/ui/design-system/components.md` §11, owner decision 2026-09-29,
 * #2873). It replaced the §11 chat bubble on mobile.
 *
 * **One shape for every row, the viewer's included.** The first row of a run
 * draws a 32pt avatar and an author line (name, then the time of day); a
 * follow-on row draws only its body. The runs are decided once, for web and
 * mobile alike, by `@repo/chat-core/grouping`; the thread passes the answer in
 * as `startsRun`. The viewer's own name reads "You" in the chapter's accent
 * text, which replaced the self bubble's accent fill as the one place a
 * message row takes the chapter accent.
 *
 * A phone has no hover, so a follow-on row shows no time. Long-press opens the
 * actions sheet, whose header says who sent it and when, and a screen reader
 * hears both on the row's gutter.
 *
 * Everything the bubble carried has a home here: the delivery state is a line
 * under the body (`deliveryChrome` is exhaustive over `MessageStatus`, #1910),
 * `(edited)` and Pinned trail the body's last line on every row, the reply quote
 * sits above the author line, and reactions sit under the body.
 */

export interface MessageItemProps {
  message: ChatMessage;
  /**
   * `users.id` of the viewer — never the Supabase auth uid. Non-nullable on
   * purpose (#2250): an unresolved viewer cannot say whose a row is, so the
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
  /**
   * Whether this row starts a run (`@repo/chat-core/grouping`), and so draws
   * the avatar and author line.
   */
  startsRun: boolean;
  onRetry: (clientMessageId: string) => void;
  onDiscard: (clientMessageId: string) => void;
  onReact: (messageId: string, emoji: string) => void;
  onUnreact: (messageId: string, emoji: string) => void;
  /**
   * The replied-to message when it is in the loaded window, or `null` when
   * `message.reply_to_id` is set and the parent is not. The row decides
   * whether to draw a quote from `reply_to_id`, not from this prop — `null` vs
   * `undefined` is "looked up and absent" vs "not a reply".
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
 * an **accessible `View`** around the row's author line (or its gutter, on a
 * follow-on) and around its text instead, never a bare `<Text>`: custom
 * actions on a `Text` are not reliably surfaced by VoiceOver under the new
 * architecture, and a `View` with `accessible` is the element iOS exposes them
 * on. `longpress` with a label is a named custom action in the iOS actions
 * rotor and the double-tap-and-hold on Android.
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

interface ReactionGroup {
  emoji: string;
  actionType: string;
  count: number;
  mine: boolean;
}

/**
 * Drops non-reaction action types and emptied groups.
 *
 * Counts whatever `message.reactions` holds. The s05 thread hands every row a
 * message whose reactions already went through the viewer's block list
 * (`visibleReactions` in `@repo/chat-core/blocks`, applied in
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

/**
 * The frame every s05 row shares: the reply quote above, the 32pt gutter with
 * the avatar on a run's first row, and the author line. `MessageItem` fills it
 * with a message body; the thread fills it with a `PollCard` for a poll, so a
 * card carries the same author line as any other row (a card always starts a
 * run).
 *
 * Its root is the long-press target, so a press anywhere on the row — gutter,
 * author line, photo — opens the actions. It is `accessible={false}` for the
 * reason `messageActionsA11yProps` gives, and the screen-reader half of the
 * long-press rides the author line, or the gutter on a follow-on row.
 */
export function MessageRowFrame({
  message,
  viewerId,
  nameFor,
  startsRun,
  quote,
  onOpenActions,
  children,
}: {
  message: ChatMessage;
  viewerId: string;
  nameFor: (userId: string) => string | null;
  startsRun: boolean;
  /** The reply quote, when the row is a reply; drawn above the author line. */
  quote?: ReactNode;
  onOpenActions?: () => void;
  children: ReactNode;
}) {
  const { tokens } = useFrappTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  // Resolved once and used for both the author line and the avatar initials —
  // two lookups would be two chances for them to drift apart. Both come from
  // `@repo/hooks`: `sender_id` is nullable, so an imported archive message has
  // no roster entry and names its author in `author_name`.
  const authorName = resolveAuthorName(message, nameFor);
  const authorLabel = resolveAuthorLabel(message, nameFor, viewerId);
  const time = formatTimeOfDay(message.created_at);
  const headerA11y = messageActionsA11yProps(onOpenActions);
  // `isOwnMessage` checks the sender before comparing: an imported archive row
  // has no `sender_id`, and `null === null` would otherwise make it "mine".
  const isMine = isOwnMessage(message, viewerId);

  return (
    <Pressable
      accessible={false}
      onLongPress={onOpenActions}
      disabled={!onOpenActions}
      style={[styles.row, startsRun ? styles.rowStartsRun : styles.rowFollows]}
    >
      {quote ? (
        <View style={styles.quoteLine}>
          {/* From the avatar's centre up and across to the quote, so the quote
              reads as the row below's rather than floating between two rows. */}
          <View style={styles.elbow} />
          <View style={styles.quote}>{quote}</View>
        </View>
      ) : null}
      <View style={styles.main}>
        {startsRun ? (
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {authorName
                ? initialsFor(authorName)
                : authorInitialsFallback(message)}
            </Text>
          </View>
        ) : (
          // A follow-on row draws no author or time, so its gutter is where a
          // screen reader hears them — and where the long-press action rides
          // when the row has no text to carry it (a photo-only follow-on).
          <View
            style={styles.gutter}
            accessible
            accessibilityLabel={`${authorLabel}, ${time}`}
            {...headerA11y}
          />
        )}
        <View style={styles.column}>
          {startsRun ? (
            <View
              style={styles.authorLine}
              accessible={"accessibilityActions" in headerA11y}
              {...headerA11y}
            >
              {isMine ? (
                <SelfName label={authorLabel} style={styles.name} />
              ) : (
                <Text style={styles.name} numberOfLines={1}>
                  {authorLabel}
                </Text>
              )}
              <Text style={styles.time}>{time}</Text>
            </View>
          ) : null}
          {children}
        </View>
      </View>
    </Pressable>
  );
}

/**
 * The viewer's own name in the chapter's accent text (`--signet-accent-text`,
 * step 11, the engine's text role). Split out so `useChapterBranding()` is only
 * called for a row the viewer sent: the hook reaches for `FrappClientProvider`,
 * which a row by anyone else has never needed (#1007).
 */
function SelfName({
  label,
  style,
}: {
  label: string;
  style: ReturnType<typeof createStyles>["name"];
}) {
  const { accent } = useChapterBranding();
  return (
    <Text style={[style, { color: accent }]} numberOfLines={1}>
      {label}
    </Text>
  );
}

/**
 * `· Pinned` in the chapter's accent text, like web's marker. A component of its
 * own for the reason `SelfName` is: only a pinned row pulls in the branding
 * hook.
 */
export function PinnedMarker({
  style,
  lead = true,
}: {
  style: ReturnType<typeof createStyles>["trailing"];
  /** Whether it follows text on its line, and so needs the " · " before it. */
  lead?: boolean;
}) {
  const { accent } = useChapterBranding();
  return (
    <Text style={[style, { color: accent }]}>
      {lead ? " · Pinned" : "Pinned"}
    </Text>
  );
}

/**
 * The trailing markers under a card, where web draws them too: a card has no
 * text line of its own to trail. Nothing on a deleted card, or one never
 * edited or pinned.
 */
export function CardMarkers({ message }: { message: ChatMessage }) {
  const { tokens } = useFrappTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  if (message.is_deleted) return null;
  const edited = showsEditedMarker(message);
  if (!edited && !message.is_pinned) return null;
  return (
    <Text style={[styles.trailing, styles.cardMarkers]}>
      {edited ? EDITED_MARKER : ""}
      {message.is_pinned ? (
        <PinnedMarker style={styles.trailing} lead={edited} />
      ) : null}
    </Text>
  );
}

export function MessageItem({
  message,
  viewerId,
  nameFor,
  startsRun,
  onRetry,
  onDiscard,
  onReact,
  onUnreact,
  replyParent,
  replyParentHidden,
  onOpenActions,
  onJumpToParent,
}: MessageItemProps) {
  const { tokens } = useFrappTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const segments = useMemo(
    () => linkSegments(message.content),
    [message.content],
  );
  // Reactions address a server id, so a message still in flight has nothing to
  // address. Web gates the same affordance on the same condition.
  const isConfirmed = message._status === "confirmed";
  const reactions = groupReactions(message, viewerId);
  const chrome = deliveryChrome(message);
  // A send still in flight or failed reads as not yet posted.
  const muted = chrome.status === "pending" || chrome.status === "failed";

  // Mount the renderer only when the message actually has files. The query hook
  // inside reaches for `FrappClientProvider`, so mounting unconditionally would
  // make every plain-text row — the overwhelming majority — require a client
  // context it has never needed. The count comes off the message row, so this
  // costs no request to decide. A deleted message shows none.
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
        onLongPress={onOpenActions}
      />
    ) : null;

  // An attachment-only message has no text, and draws no text row at all: the
  // bubble it replaced painted an empty box above the photo.
  const hasText = !message.is_deleted && message.content.trim().length > 0;
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
        onPress={onJumpToParent}
        onLongPress={onOpenActions}
      />
    ) : null;

  // `(edited)` and Pinned ride the body's last line on every row, grouped or
  // not (§11 § What rides the row), and never on a deleted message.
  const edited = showsEditedMarker(message);
  const pinned = message.is_pinned && !message.is_deleted;
  const trailing =
    edited || pinned ? (
      <Text style={styles.trailing}>
        {edited ? ` ${EDITED_MARKER}` : ""}
        {pinned ? <PinnedMarker style={styles.trailing} /> : null}
      </Text>
    ) : null;

  const text = message.is_deleted ? (
    <Text style={styles.deleted}>{DELETED_MESSAGE_PLACEHOLDER}</Text>
  ) : hasText ? (
    <MessageText
      segments={segments}
      style={[styles.body, muted ? styles.bodyMuted : null]}
      trailing={trailing}
      onLongPress={onOpenActions}
    />
  ) : trailing ? (
    <Text style={styles.body}>{trailing}</Text>
  ) : null;

  return (
    <MessageRowFrame
      message={message}
      viewerId={viewerId}
      nameFor={nameFor}
      startsRun={startsRun}
      quote={quote}
      onOpenActions={onOpenActions}
    >
      {text ? (
        <View accessible={"accessibilityActions" in bodyA11y} {...bodyA11y}>
          {text}
        </View>
      ) : null}
      {attachments}
      <DeliveryLine
        chrome={chrome}
        styles={styles}
        clientMessageId={message.client_message_id}
        onRetry={onRetry}
        onDiscard={onDiscard}
      />
      {/* A deleted message has nothing left to react to (§11), and reaction
          rows outlive it server-side, so its old chips would stay live. */}
      {message.is_deleted ? null : (
        <ReactionRow
          reactions={reactions}
          messageId={message.id}
          disabled={!isConfirmed}
          onReact={onReact}
          onUnreact={onUnreact}
          onLongPress={onOpenActions}
          styles={styles}
        />
      )}
    </MessageRowFrame>
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
 * The delivery state, on a line under the body. Exhaustive over
 * `DeliveryChrome` so a new `MessageStatus` cannot silently render as a
 * confirmed row. Nothing for a confirmed message.
 *
 * `unconfirmed` / `recorded` are muted notes, never destructive, and never
 * paired with Retry/Discard. Mobile has no slash replay path, so `unconfirmed`
 * is read-only — do not add a Retry here.
 */
function DeliveryLine({
  chrome,
  styles,
  clientMessageId,
  onRetry,
  onDiscard,
}: {
  chrome: DeliveryChrome;
  styles: ReturnType<typeof createStyles>;
  clientMessageId: string;
  onRetry: (clientMessageId: string) => void;
  onDiscard: (clientMessageId: string) => void;
}) {
  switch (chrome.status) {
    case "confirmed":
      return null;
    case "pending":
      return <Text style={styles.metaText}>Sending…</Text>;
    case "failed":
      return (
        <View style={styles.failedRow}>
          <Text style={styles.metaFailed}>{chrome.error}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry sending this message"
            hitSlop={8}
            onPress={() => onRetry(clientMessageId)}
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Discard this message"
            hitSlop={8}
            onPress={() => onDiscard(clientMessageId)}
          >
            <Text style={styles.discardText}>Discard</Text>
          </Pressable>
        </View>
      );
    case "unconfirmed":
    case "recorded":
      return (
        <Text style={styles.metaText} accessibilityLiveRegion="polite">
          {chrome.note}
        </Text>
      );
    default: {
      const _never: never = chrome;
      return _never;
    }
  }
}

/**
 * Exported so a card (e.g. `PollCard`, #528) can carry the same reaction
 * affordance `MessageItem` gives every other kind — `styles` is narrowed to
 * just the keys this component reads so a caller with its own `createStyles`
 * only has to match that slice, not `MessageItem`'s full style sheet.
 */
export function ReactionRow({
  reactions,
  messageId,
  disabled,
  onReact,
  onUnreact,
  onLongPress,
  styles,
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
}) {
  // The add chip is what makes the *first* reaction on a message possible.
  // Without it the row only rendered when reactions already existed, so
  // `onReact` was unreachable and nobody could ever start one — the Canvas
  // draws this chip (s05, `canvas-screens.dc.html:181`) for that reason.
  // Hidden while the message is unconfirmed, since a reaction addresses a
  // server id a pending placeholder does not have yet.
  return (
    <View style={styles.reactionRow}>
      {reactions.map((group) => (
        <Pressable
          key={group.actionType}
          accessibilityRole="button"
          accessibilityState={{ selected: group.mine, disabled }}
          accessibilityLabel={`${group.emoji}, ${group.count}`}
          disabled={disabled}
          // A 26pt chip against the 44pt floor: hitSlop closes the gap without
          // inflating the drawn chip (components.md §11).
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

const AVATAR_SIZE = 32;

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    row: {
      // 16pt from the screen edge, the composer's inset.
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: 2,
    },
    // A run starts 16 below the row above; a follow-on sits 2 below.
    rowStartsRun: { paddingTop: tokens.spacing.lg },
    rowFollows: { paddingTop: 2 },
    quoteLine: {
      flexDirection: "row",
      alignItems: "flex-start",
      marginBottom: 2,
    },
    elbow: {
      marginLeft: AVATAR_SIZE / 2,
      marginTop: 10,
      width: 24,
      height: 10,
      marginRight: 6,
      borderLeftWidth: 2,
      borderTopWidth: 2,
      borderColor: tokens.color.surface.popover,
      borderTopLeftRadius: 6,
    },
    quote: { flex: 1, minWidth: 0 },
    main: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: tokens.spacing.md,
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
    // Held open on every row of a run, so a follow-on's text lines up under
    // the first row's. Stretches to the row's height so a screen reader's
    // focus ring on it covers the row.
    gutter: { width: AVATAR_SIZE, alignSelf: "stretch" },
    column: { flex: 1, minWidth: 0 },
    authorLine: {
      flexDirection: "row",
      alignItems: "baseline",
      gap: tokens.spacing.sm,
      minWidth: 0,
    },
    name: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
      flexShrink: 1,
    },
    time: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    body: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    bodyMuted: { color: tokens.color.text.mutedForeground },
    trailing: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    cardMarkers: { marginTop: tokens.spacing.xs },
    deleted: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
      fontStyle: "italic",
    },
    metaText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      marginTop: 2,
    },
    metaFailed: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
    failedRow: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: tokens.spacing.md,
      marginTop: 2,
    },
    retryText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.gold.askText,
    },
    discardText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
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
