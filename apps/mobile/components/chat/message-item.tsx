import { useMemo, type ComponentProps, type ReactNode } from "react";
import {
  Image,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  View,
  type AccessibilityActionEvent,
  type AccessibilityActionInfo,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import type { ChatMessage, ThreadLastReply } from "@repo/chat-core/types";
import {
  messageFlagCaption,
  type MessageFlagView,
} from "@repo/chat-core/flags";
import { emojiFromActionType } from "@repo/chat-core/types";
import { DELETED_MESSAGE_PLACEHOLDER } from "@repo/chat-core/reply-preview";
import {
  EDITED_MARKER,
  isOwnMessage,
  showsEditedMarker,
} from "@repo/chat-core/message-actions";
import { formatTimeOfDay } from "@repo/formatting";
import { SYSTEM_SENDER_ID } from "@repo/validation";
import {
  authorProfileUserId,
  mentionedUserId,
} from "@repo/chat-core/profile-targets";
import { SignetTokens } from "@repo/theme/signet";
import { useChapterBranding } from "@/lib/chapter-branding";
import {
  deliveryChrome,
  type DeliveryChrome,
} from "@/lib/chat/delivery-status";
import {
  avatarRadius,
  fontFamilyFor,
  italicFontFamilyFor,
  tint,
  typeRole,
  useFrappTheme,
} from "@/lib/theme";
import {
  authorInitialsFallback,
  memberAvatarHue,
  memberAvatarTint,
  resolveAuthorLabel,
  resolveAuthorName,
} from "@repo/hooks";
import { useMentionChips } from "@repo/hooks/mention-chips";
import { MemberAvatar } from "@/components/member-avatar";
import { AlertGlyph } from "@/components/control-glyphs";
import { PinGlyph } from "@/components/documents/document-glyphs";
import { ThreadChip, threadCardMiddle } from "./thread-chip";
import { initialsFor } from "@/lib/chat/display-name";
import { useChatDensity } from "@/lib/chat/chat-density";
import { MessageAttachments } from "./message-attachments";
import { MessageGifImage } from "./message-gif";
import {
  linkA11yActions,
  MessageMarkdown,
  parseMessageMarkdown,
  runLinkA11yAction,
  type MessageLink,
} from "./message-markdown";
import { ReplyQuote } from "./reply-quote";

/**
 * One message row in the s05 thread, in the compact layout
 * (`spec/ui/design-system/components.md` §11, owner decision 2026-09-29,
 * #2873). It replaced the §11 chat bubble on mobile. That layout is the cozy
 * density; `MessageRowFrame` says what compact changes (§11 § Density).
 *
 * **One shape for every row, the viewer's included.** The first row of a run
 * draws a 32pt avatar and an author line (name, then the time of day); a
 * follow-on row draws only its body. The runs are decided once, for web and
 * mobile alike, by `@repo/chat-core/grouping`; the thread passes the answer in
 * as `startsRun`. The viewer's own name reads "You", which replaced the self
 * bubble's accent fill as the way a member spots their own run, and is colored
 * like anyone else's: their role color, or the foreground text. Neither it nor
 * the Pinned marker takes the chapter accent: names and labels are neutral
 * (foundations.md §6, "Where the accent goes").
 *
 * A phone has no hover, so a follow-on row shows no time. Long-press opens the
 * actions sheet, whose header says who sent it and when, and a screen reader
 * hears both on the row's gutter.
 *
 * Everything the bubble carried has a home here: the delivery state is a line
 * under the body (`deliveryChrome` is exhaustive over `MessageStatus`, #1910),
 * `(edited)` and Pinned trail the body's last line on every row, the reply quote
 * sits above the author line, and reactions sit under the body. A row nobody
 * has reacted to draws no reaction row at all: the first reaction starts from
 * the long-press sheet's quick picks (`message-actions-sheet.tsx`).
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
   * Resolves a `users.id` to the palette color of the member's top colored
   * role (#3485), which paints their name on the author line. Optional: a
   * surface without a roster draws plain names, which is a fine degradation.
   */
  roleColorFor?: (userId: string) => string | null;
  /**
   * Resolves a row to its author's photo URL (`resolveAuthorAvatar`: the
   * member's profile photo, or an imported author's Discord avatar), drawn in
   * the run's avatar with initials under it. Optional: without it, initials.
   */
  avatarFor?: (message: ChatMessage) => string | null;
  /**
   * Whether this row starts a run (`@repo/chat-core/grouping`), and so draws
   * the avatar and author line.
   */
  startsRun: boolean;
  /**
   * Whether this row is the last of its run. Only Bubbles reads it: the
   * avatar sits under the stack, and the speaker's bottom corner tucks on
   * every row but the last (§11 § Bubbles). Defaults to `true`.
   */
  endsRun?: boolean;
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
   * Opens the message actions sheet (react, reply, edit, copy, mention,
   * report, delete; Block is on its report form — #2257, #2775). Passed only for a row that offers them
   * (`canOpenMessageActions` in `@repo/chat-core/message-actions`): a confirmed, undeleted
   * message, the viewer's own included.
   */
  onOpenActions?: () => void;
  /**
   * Scrolls the thread to the quoted parent. Passed only when the parent is
   * loaded and shown, so a quote reading "Original message not loaded" or a
   * block-list placeholder is not a control.
   */
  onJumpToParent?: () => void;
  /**
   * Opens a member's profile by `users.id`: the author's from their name or
   * photo, or a mentioned member's from an `@` chip. Optional, so a surface
   * with no profile sheet draws plain names.
   */
  onOpenProfile?: (userId: string) => void;
  /**
   * Opens this message's thread (#3785) from the chip under a parent with
   * replies. Absent where threads aren't offered (a 1:1 DM), which draws the
   * chip as a plain label.
   */
  onOpenThread?: () => void;
  /** Replies in this message's thread new to the viewer (#4297). */
  threadUnread?: number;
  /**
   * The thread's latest reply to preview on the card (#4297), already cleared
   * against the viewer's block list by the row (`threadPreviewVisible`);
   * `null` or absent draws none.
   */
  threadPreview?: ThreadLastReply | null;
  /** A member's photo by id, for the thread card's faces (#4297). */
  memberAvatarFor?: (userId: string) => string | null;
  /**
   * The flag a member put on the message (#3921), as the thread resolved it
   * against the viewer's block list (`messageFlagView` in
   * `@repo/chat-core/flags`), or `null`/absent for none.
   */
  flag?: MessageFlagView | null;
}

/** The author's profile, as a named action beside the message actions. */
const OPEN_PROFILE_A11Y_LABEL = "Open profile";
const OPEN_PROFILE_ACTION: AccessibilityActionInfo = {
  name: "openProfile",
  label: OPEN_PROFILE_A11Y_LABEL,
};

/**
 * The tap that opens a row's author's profile, or nothing for a row with no
 * member behind it (`authorProfileUserId` in `@repo/chat-core`, which web's
 * row reads too).
 */
export function authorProfileOpener(
  message: ChatMessage,
  onOpenProfile: ((userId: string) => void) | undefined,
  nameFor: (userId: string) => string | null,
): (() => void) | undefined {
  const senderId = onOpenProfile ? authorProfileUserId(message, nameFor) : null;
  if (!onOpenProfile || !senderId) return undefined;
  return () => onOpenProfile(senderId);
}

/** The add chip's accessible name: it opens the sheet that holds the picks. */
export const ADD_REACTION_A11Y_LABEL = "Add reaction";

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
  body: {
    links?: MessageLink[];
    onJumpToParent?: () => void;
    onOpenProfile?: () => void;
  } = {},
): MessageActionsA11yProps {
  const links = body.links ?? [];
  const actions = [
    ...(onOpenActions ? MESSAGE_ACTIONS : []),
    ...(body.onOpenProfile ? [OPEN_PROFILE_ACTION] : []),
    ...(body.onJumpToParent ? [JUMP_TO_PARENT_ACTION] : []),
    ...linkA11yActions(links),
  ];
  if (actions.length === 0) return {};
  return {
    accessibilityActions: actions,
    onAccessibilityAction: (event) => {
      const { actionName } = event.nativeEvent;
      if (actionName === "longpress") onOpenActions?.();
      else if (actionName === OPEN_PROFILE_ACTION.name) body.onOpenProfile?.();
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
 * with a message body; the thread fills it with a card (`cardFor` in
 * `thread-message-row.tsx`), so a card carries the same author line as any
 * other row (a card always starts a run).
 *
 * Its root is the long-press target, so a press anywhere on the row — gutter,
 * author line, photo — opens the actions. It is `accessible={false}` for the
 * reason `messageActionsA11yProps` gives, and the screen-reader half of the
 * long-press rides the author line, or the gutter on a follow-on row.
 *
 * **Compact** (`components.md` §11 § Density) draws no avatar and no gutter.
 * A text row leads its body with the time and the name (`CompactLead`, passed
 * in as `authorInline`); anything else, a card or a photo, gets them on a line
 * of their own. A follow-on's screen-reader handle moves into the row's left
 * inset, since there is no gutter to hold it.
 *
 * A plain tap on the row puts the keyboard away. On a card row that holds
 * only for the gutter, avatar and author line: a tap on the card's body
 * doesn't (#3461), because the card wraps its body in a long-press
 * `Pressable` of its own (`ChatCardShell`), which takes the tap before this
 * one sees it.
 */
export function MessageRowFrame({
  message,
  viewerId,
  nameFor,
  roleColorFor,
  avatarFor,
  startsRun,
  endsRun = true,
  quote,
  onOpenActions,
  onJumpToParent,
  authorInline = false,
  onOpenProfile,
  flag,
  threadSpine = null,
  children,
}: {
  message: ChatMessage;
  viewerId: string;
  nameFor: (userId: string) => string | null;
  /** `users.id` → role color for the author line (#3485); see `MessageItemProps`. */
  roleColorFor?: (userId: string) => string | null;
  /** The author's photo for the run's avatar; see `MessageItemProps`. */
  avatarFor?: (message: ChatMessage) => string | null;
  startsRun: boolean;
  /** The run's last row; Bubbles draws the avatar beside it. Defaults to `true`. */
  endsRun?: boolean;
  /**
   * Compact only: the body leads with the time and name itself
   * (`CompactLead`), so the frame draws no author line.
   */
  authorInline?: boolean;
  /** The reply quote, when the row is a reply; drawn above the author line. */
  quote?: ReactNode;
  onOpenActions?: () => void;
  /**
   * The quote's jump as a named action on the author line, for a row whose
   * body has no container to carry it (a photo-only reply). A reply always
   * starts a run, so the author line is always there.
   */
  onJumpToParent?: () => void;
  /** `users.id` → opens their profile; see `MessageItemProps`. */
  onOpenProfile?: (userId: string) => void;
  /** The row's flag (#3921); see `MessageItemProps`. */
  flag?: MessageFlagView | null;
  /**
   * The row ends in a thread card (#4297): in cozy a connector runs down the
   * gutter from the author's photo and curves into the card's edge, as web's
   * does. Compact and Bubbles draw the card alone.
   */
  threadSpine?: { hasPreview: boolean } | null;
  children: ReactNode;
}) {
  const { tokens } = useFrappTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  // A row that @-mentions the viewer wears the chapter accent the way Discord
  // marks one (components.md §11, see `MentionHighlight`). The list is the
  // server's (`chat_messages.mentions`), the same set the notifier used. A
  // viewer's own message lights up too when it reaches them (their own
  // `@here`, a role they hold), as on Discord (Paul, 2026-11-13).
  const mentionsViewer =
    !!viewerId &&
    // A deleted message no longer counts as a mention anywhere else (the
    // unread badge skips it, the push is gone), so its tombstone stays plain.
    !message.is_deleted &&
    message.mentions.includes(viewerId);
  // The channel's display on this phone: its pin, else the default (#3787).
  const density = useChatDensity(message.channel_id);
  const compact = density === "compact";
  // Resolved once and used for both the author line and the avatar initials —
  // two lookups would be two chances for them to drift apart. Both come from
  // `@repo/hooks`: `sender_id` is nullable, so an imported archive message has
  // no roster entry and names its author in `author_name`.
  const { authorName, authorLabel, roleColor } = rowAuthor(
    message,
    nameFor,
    viewerId,
    roleColorFor,
  );
  const time = formatTimeOfDay(message.created_at);
  // The name and photo open the author's profile, as Discord's do. Each is a
  // nested touchable that would otherwise swallow the row's long-press, so it
  // forwards it.
  const openAuthor = authorProfileOpener(message, onOpenProfile, nameFor);
  const headerA11y = messageActionsA11yProps(onOpenActions, {
    onJumpToParent: quote ? onJumpToParent : undefined,
    onOpenProfile: openAuthor,
  });

  // A card row reaches the frame directly, not through `MessageItem`, so
  // Bubbles sides it here: the viewer's own card on the right, unbubbled.
  if (density === "bubbles") {
    return (
      <BubbleRowFrame
        message={message}
        viewerId={viewerId}
        nameFor={nameFor}
        roleColorFor={roleColorFor}
        avatarFor={avatarFor}
        startsRun={startsRun}
        endsRun={endsRun}
        mine={isOwnMessage(message, viewerId)}
        quote={quote}
        onOpenActions={onOpenActions}
        onJumpToParent={onJumpToParent}
        onOpenProfile={onOpenProfile}
        flag={flag}
        styles={styles}
      >
        {children}
      </BubbleRowFrame>
    );
  }

  return (
    <Pressable
      accessible={false}
      onLongPress={onOpenActions}
      // The thread's list lets a tap reach a control with the keyboard up
      // (`keyboardShouldPersistTaps="handled"`), and this Pressable claims a
      // tap anywhere on the row, so without this a tap on a message no longer
      // put the keyboard away. The row has no tap action of its own; its
      // controls (chips, links, photos, Retry) claim their own taps first,
      // and so does a card's own Pressable, so a tap on a card's body leaves
      // the keyboard up (#3461, see above).
      onPress={Keyboard.dismiss}
      disabled={!onOpenActions}
      style={[
        styles.row,
        startsRun
          ? compact
            ? styles.rowStartsRunCompact
            : styles.rowStartsRun
          : styles.rowFollows,
      ]}
    >
      {flag?.important ? (
        <ImportantHighlight style={styles.mentionHighlight} />
      ) : mentionsViewer ? (
        <MentionHighlight style={styles.mentionHighlight} />
      ) : null}
      {quote ? (
        <View style={styles.quoteLine}>
          {/* Compact has no avatar to point at, so the elbow drops onto the
              name from the row's own edge. */}
          <View style={[styles.elbow, compact ? styles.elbowCompact : null]} />
          <View style={styles.quote}>{quote}</View>
        </View>
      ) : null}
      {compact ? (
        <>
          {startsRun ? null : (
            // The follow-on's handle, in the row's left inset: who sent it
            // and when, and the long-press as an action.
            <View
              style={styles.gutterInset}
              accessible
              accessibilityLabel={`${authorLabel}, ${time}`}
              {...headerA11y}
            />
          )}
          {startsRun && !authorInline ? (
            <View
              style={styles.authorLine}
              accessible={"accessibilityActions" in headerA11y}
              testID="author-line"
              {...headerA11y}
            >
              <Text style={styles.compactTime}>{time}</Text>
              <Text
                style={
                  roleColor
                    ? [styles.compactName, { color: roleColor }]
                    : styles.compactName
                }
                numberOfLines={1}
                onPress={openAuthor}
                onLongPress={openAuthor ? onOpenActions : undefined}
                suppressHighlighting
              >
                {authorLabel}
              </Text>
              {flag ? <FlagCaption view={flag} styles={styles} inline /> : null}
            </View>
          ) : null}
          {/* No author line of its own to carry it (#4288). */}
          {flag && !(startsRun && !authorInline) ? (
            <FlagCaption view={flag} styles={styles} />
          ) : null}
          {children}
        </>
      ) : (
        <View style={styles.main}>
          {threadSpine ? (
            <View
              pointerEvents="none"
              testID="thread-spine"
              style={[
                styles.threadSpine,
                {
                  top: startsRun ? MESSAGE_AVATAR_SIZE + 4 : 4,
                  bottom: threadCardMiddle(threadSpine.hasPreview),
                },
              ]}
            />
          ) : null}
          {startsRun ? (
            <RowAvatar
              message={message}
              avatarFor={avatarFor}
              authorName={authorName}
              roleColor={roleColor}
              openAuthor={openAuthor}
              onOpenActions={onOpenActions}
              styles={styles}
            />
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
                testID="author-line"
                {...headerA11y}
              >
                <Text
                  style={
                    roleColor
                      ? [styles.name, { color: roleColor }]
                      : styles.name
                  }
                  numberOfLines={1}
                  onPress={openAuthor}
                  onLongPress={openAuthor ? onOpenActions : undefined}
                  suppressHighlighting
                >
                  {authorLabel}
                </Text>
                <Text style={styles.time}>{time}</Text>
                {flag ? (
                  <FlagCaption view={flag} styles={styles} inline />
                ) : null}
              </View>
            ) : null}
            {flag && !startsRun ? (
              <FlagCaption view={flag} styles={styles} />
            ) : null}
            {children}
          </View>
        </View>
      )}
    </Pressable>
  );
}

/**
 * Who a row is by, resolved one way for the frame's author line, its avatar
 * initials and compact's lead (`CompactLead`), so the three can't drift.
 * `@repo/hooks` resolves the name: `sender_id` is nullable, so an imported
 * archive message has no roster entry and names its author in `author_name`.
 * Every name, the viewer's own "You" included, takes the author's role color
 * (a contrast-checked palette value) or else the foreground text, and never
 * the chapter accent (foundations.md §6, "Where the accent goes").
 */
function rowAuthor(
  message: ChatMessage,
  nameFor: (userId: string) => string | null,
  viewerId: string,
  roleColorFor: ((userId: string) => string | null) | undefined,
) {
  return {
    authorName: resolveAuthorName(message, nameFor),
    authorLabel: resolveAuthorLabel(message, nameFor, viewerId),
    roleColor: message.sender_id
      ? (roleColorFor?.(message.sender_id) ?? null)
      : null,
  };
}

/**
 * Compact's lead for a text row that starts a run: the time, then the name,
 * nested at the front of the body's own `Text` so the message wraps back under
 * them like one sentence (§11 § Density). A screen reader hears it with the
 * body, so the row needs no separate author handle.
 */
function CompactLead({
  message,
  viewerId,
  nameFor,
  roleColorFor,
  onOpenProfile,
  onOpenActions,
  styles,
}: {
  message: ChatMessage;
  viewerId: string;
  nameFor: (userId: string) => string | null;
  roleColorFor?: (userId: string) => string | null;
  onOpenProfile?: (userId: string) => void;
  onOpenActions?: () => void;
  styles: ReturnType<typeof createStyles>;
}) {
  const openAuthor = authorProfileOpener(message, onOpenProfile, nameFor);
  const { authorLabel, roleColor } = rowAuthor(
    message,
    nameFor,
    viewerId,
    roleColorFor,
  );
  return (
    <Text>
      <Text style={styles.compactTime}>
        {formatTimeOfDay(message.created_at)}{" "}
      </Text>
      <Text
        style={
          roleColor
            ? [styles.compactName, { color: roleColor }]
            : styles.compactName
        }
        onPress={openAuthor}
        onLongPress={openAuthor ? onOpenActions : undefined}
        suppressHighlighting
      >
        {authorLabel}
      </Text>{" "}
    </Text>
  );
}

/**
 * The pin glyph and `Pinned` in the muted trailing text, like `(edited)`
 * beside it, as web draws it (#4136: the phone drew `· Pinned` with no glyph).
 * A marker is metadata, so it never takes the chapter accent (foundations.md
 * §6, "Where the accent goes"). The glyph rides the line inline, at the
 * caption's size, in the text's own colour.
 */
function PinnedMarker({
  style,
  lead = true,
}: {
  style: StyleProp<TextStyle>;
  /** Whether it follows text on its line, and so needs space before it. */
  lead?: boolean;
}) {
  const color = StyleSheet.flatten(style)?.color;
  return (
    <Text style={style}>
      {lead ? " " : ""}
      <PinGlyph
        color={typeof color === "string" ? color : "currentColor"}
        size={PIN_MARKER_SIZE}
        on
      />
      {" Pinned"}
    </Text>
  );
}

/** {@link PinnedMarker} in the viewer's bubble, in its contrast colour. */
function SelfPinnedMarker({
  style,
  lead,
}: {
  style: StyleProp<TextStyle>;
  lead: boolean;
}) {
  const { accentOnPrimary } = useChapterBranding();
  return (
    <PinnedMarker style={[style, { color: accentOnPrimary }]} lead={lead} />
  );
}

/** The caption role's size, so the glyph sits at the marker's height. */
const PIN_MARKER_SIZE = 13;

/**
 * The trailing markers on a line of their own, under whatever the row draws
 * when it has no text line to trail (§11 § What rides the row): a card, an
 * attachment-only message's photos, or nothing at all for a body whose
 * markdown draws nothing (`---`, a lone image). Web draws the first two the
 * same way; for the last it keeps the markers in its body, which is empty, so
 * they read the same. Nothing on a deleted message, or one never edited or
 * pinned.
 */
export function OwnLineMarkers({ message }: { message: ChatMessage }) {
  const { tokens } = useFrappTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  if (message.is_deleted) return null;
  const edited = showsEditedMarker(message);
  if (!edited && !message.is_pinned) return null;
  return (
    <Text style={[styles.trailing, styles.ownLineMarkers]}>
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
  roleColorFor,
  avatarFor,
  startsRun,
  endsRun = true,
  onRetry,
  onDiscard,
  onReact,
  onUnreact,
  replyParent,
  replyParentHidden,
  onOpenActions,
  onJumpToParent,
  onOpenProfile,
  onOpenThread,
  threadUnread = 0,
  threadPreview = null,
  memberAvatarFor,
  flag,
}: MessageItemProps) {
  const { tokens } = useFrappTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  // A channel pinned to a display on this phone draws in that one (#3787).
  const density = useChatDensity(message.channel_id);
  const compact = density === "compact";
  const bubbles = density === "bubbles";
  // Reactions address a server id, so a message still in flight has nothing to
  // address. Web gates the same affordance on the same condition.
  const isConfirmed = message._status === "confirmed";
  const reactions = groupReactions(message, viewerId);
  // The thread card (#3785, #4297): under the reactions, on the speaker's
  // side in Bubbles. A deleted parent keeps it, so its replies stay reachable.
  const threadChip = (align: "start" | "end") =>
    message.thread ? (
      <ThreadChip
        summary={message.thread}
        nameFor={nameFor}
        roleColorFor={roleColorFor}
        avatarFor={memberAvatarFor}
        unread={threadUnread}
        preview={threadPreview}
        viewerId={viewerId}
        onPress={onOpenThread}
        align={align}
        onImportantRow={flag?.important === true}
      />
    ) : null;
  const chrome = deliveryChrome(message);
  // A send still in flight or failed reads as not yet posted.
  const pending = chrome.status === "pending";
  const muted = pending || chrome.status === "failed";

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
  const attachments = message.is_deleted ? null : message.gif ? (
    // A GIF message (#4631) is the GIF: no text, no files.
    <MessageGifImage gif={message.gif} onLongPress={onOpenActions} />
  ) : message.attachment_count > 0 ? (
    <MessageAttachments
      channelId={message.channel_id}
      messageId={message.id}
      count={message.attachment_count}
      clientMessageId={message.client_message_id}
      confirmed={isConfirmed}
      photos={message.attachment_photos}
      onLongPress={onOpenActions}
    />
  ) : null;

  // Parsed once per content, for the body and for its links' accessibility
  // actions, so the actions name exactly the links drawn.
  const hasContent = !message.is_deleted && message.content.trim().length > 0;
  const chips = useMentionChips(message);
  const parsed = useMemo(
    () => (hasContent ? parseMessageMarkdown(message.content, chips) : null),
    [hasContent, message.content, chips],
  );
  // A message that draws no text draws no text row at all: an attachment-only
  // one (the bubble it replaced painted an empty box above the photo), and one
  // whose markdown renders nothing, such as `---` or a lone image.
  const hasText = parsed !== null && !parsed.empty;
  // Compact draws the name inside the body on a run's first row, so the body
  // carries the profile action there (`leadsWithAuthor`, below).
  // A flagged message keeps its name on a line of its own, the flag beside
  // it, rather than leading the sentence (#4288).
  const leadsInline =
    compact && startsRun && !flag && (message.is_deleted || hasText);
  const bodyA11y = messageActionsA11yProps(onOpenActions, {
    links: hasText ? parsed.links : [],
    onJumpToParent: quoteJump(message, onJumpToParent),
    onOpenProfile: leadsInline
      ? authorProfileOpener(message, onOpenProfile, nameFor)
      : undefined,
  });
  const openMention = onOpenProfile
    ? (handle: string) => {
        const userId = mentionedUserId(message, handle, nameFor);
        if (userId) onOpenProfile(userId);
      }
    : undefined;

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
  // not (§11 § What rides the row), and never on a deleted message. Without a
  // text line they go on their own line under the photos (`OwnLineMarkers`).
  const edited = showsEditedMarker(message);
  const pinned = message.is_pinned && !message.is_deleted;
  // Under a list, quote or code block the markers start a line of their own,
  // so they lead with no space (`parsed.trailingOnOwnLine`).
  const ownLine = parsed?.trailingOnOwnLine ?? false;
  const trailing =
    hasText && (edited || pinned) ? (
      <Text style={styles.trailing}>
        {edited ? `${ownLine ? "" : " "}${EDITED_MARKER}` : ""}
        {pinned ? (
          <PinnedMarker style={styles.trailing} lead={edited || !ownLine} />
        ) : null}
      </Text>
    ) : null;

  // Compact leads the first row of a run with the time and name (§11 §
  // Density), the deleted placeholder included, so its run still says whose.
  const leadsWithAuthor = leadsInline;
  const lead = leadsWithAuthor ? (
    <CompactLead
      message={message}
      viewerId={viewerId}
      nameFor={nameFor}
      roleColorFor={roleColorFor}
      onOpenProfile={onOpenProfile}
      onOpenActions={onOpenActions}
      styles={styles}
    />
  ) : null;
  const text = message.is_deleted ? (
    <Text style={styles.deleted}>
      {lead}
      {DELETED_MESSAGE_PLACEHOLDER}
    </Text>
  ) : hasText ? (
    <MessageMarkdown
      parsed={parsed}
      style={[styles.body, muted ? styles.bodyMuted : null]}
      lead={leadsWithAuthor ? lead : undefined}
      trailing={trailing}
      onLongPress={onOpenActions}
      onMentionPress={openMention}
    />
  ) : null;

  if (bubbles) {
    const mine = isOwnMessage(message, viewerId);
    return (
      <BubbleRowFrame
        message={message}
        viewerId={viewerId}
        nameFor={nameFor}
        roleColorFor={roleColorFor}
        avatarFor={avatarFor}
        startsRun={startsRun}
        endsRun={endsRun}
        mine={mine}
        quote={quote}
        onOpenActions={onOpenActions}
        onJumpToParent={text ? undefined : quoteJump(message, onJumpToParent)}
        onOpenProfile={onOpenProfile}
        flag={flag}
        styles={styles}
      >
        {text ? (
          <View
            accessible={"accessibilityActions" in bodyA11y || pending}
            accessibilityHint={pending ? "Sending" : undefined}
            {...bodyA11y}
          >
            <Bubble
              mine={mine}
              startsRun={startsRun}
              endsRun={endsRun}
              dimmed={mine && muted}
              styles={styles}
            >
              {mine && message.is_deleted ? (
                <SelfText style={styles.deleted}>
                  {DELETED_MESSAGE_PLACEHOLDER}
                </SelfText>
              ) : mine && hasText ? (
                <SelfMarkdown
                  parsed={parsed}
                  style={styles.body}
                  trailing={
                    edited || pinned ? (
                      <SelfText style={styles.trailing}>
                        {edited ? `${ownLine ? "" : " "}${EDITED_MARKER}` : ""}
                        {pinned ? (
                          <SelfPinnedMarker
                            style={styles.trailing}
                            lead={edited || !ownLine}
                          />
                        ) : null}
                      </SelfText>
                    ) : undefined
                  }
                  onLongPress={onOpenActions}
                  onMentionPress={openMention}
                />
              ) : (
                text
              )}
            </Bubble>
          </View>
        ) : null}
        {attachments && pending ? (
          <View style={styles.pendingFiles}>{attachments}</View>
        ) : (
          attachments
        )}
        {text ? null : <OwnLineMarkers message={message} />}
        {/* Reactions ride the bubble's lower corner on the speaker's side. */}
        {message.is_deleted || reactions.length === 0 ? null : (
          <View
            testID="bubble-reactions"
            style={[
              styles.bubbleReactions,
              text ? styles.bubbleReactionsOverlap : null,
            ]}
          >
            <ReactionRow
              reactions={reactions}
              messageId={message.id}
              disabled={!isConfirmed}
              onReact={onReact}
              onUnreact={onUnreact}
              onLongPress={onOpenActions}
              styles={styles}
            />
          </View>
        )}
        {threadChip(mine ? "end" : "start")}
        <DeliveryLine
          chrome={chrome}
          styles={styles}
          clientMessageId={message.client_message_id}
          onRetry={onRetry}
          onDiscard={onDiscard}
        />
      </BubbleRowFrame>
    );
  }

  return (
    <MessageRowFrame
      message={message}
      viewerId={viewerId}
      nameFor={nameFor}
      roleColorFor={roleColorFor}
      avatarFor={avatarFor}
      startsRun={startsRun}
      quote={quote}
      flag={flag}
      authorInline={leadsWithAuthor}
      threadSpine={message.thread ? { hasPreview: !!threadPreview } : null}
      onOpenActions={onOpenActions}
      onOpenProfile={onOpenProfile}
      // The body's container carries the jump when there is text; a photo-only
      // reply has none, so its author line does.
      onJumpToParent={text ? undefined : quoteJump(message, onJumpToParent)}
    >
      {text ? (
        <View
          // Accessible while pending too, so the hint below is heard: a
          // pending row has no actions, and a hint on a view that is not an
          // accessibility element is ignored.
          accessible={"accessibilityActions" in bodyA11y || pending}
          // The gray body is the whole pending state on screen (§11 § What
          // rides the row); a screen reader hears it here instead.
          accessibilityHint={pending ? "Sending" : undefined}
          {...bodyA11y}
        >
          {text}
        </View>
      ) : null}
      {attachments && pending ? (
        <View style={styles.pendingFiles}>{attachments}</View>
      ) : (
        attachments
      )}
      {text ? null : <OwnLineMarkers message={message} />}
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
      {threadChip("start")}
    </MessageRowFrame>
  );
}

/**
 * The run's 32pt avatar, shared by every layout that draws one: Frapp's own
 * posts wear the crest (#3347), a member their photo over tinted initials
 * (#3860), and a press opens their profile while a long-press still opens
 * the row's actions.
 */
function RowAvatar({
  message,
  avatarFor,
  authorName,
  roleColor,
  openAuthor,
  onOpenActions,
  styles,
}: {
  message: ChatMessage;
  avatarFor?: (message: ChatMessage) => string | null;
  authorName: string | null;
  roleColor: string | null;
  openAuthor: (() => void) | undefined;
  onOpenActions?: () => void;
  styles: ReturnType<typeof createStyles>;
}) {
  if (message.sender_id === SYSTEM_SENDER_ID) {
    return (
      <View style={[styles.avatar, styles.systemAvatar]} testID="system-avatar">
        <Image
          // Metro asset id; a static import fails `tsc` (no `*.png`
          // module declaration), as in `(auth)/sign-in.tsx`.
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          source={require("../../assets/images/system-avatar.png")}
          style={styles.systemAvatarImage}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      </View>
    );
  }
  return (
    <Pressable
      onPress={openAuthor}
      onLongPress={openAuthor ? onOpenActions : undefined}
      disabled={!openAuthor}
      // The author line carries the same tap as a named action.
      accessible={false}
    >
      <MemberAvatar
        uri={avatarFor?.(message) ?? null}
        initials={
          authorName ? initialsFor(authorName) : authorInitialsFallback(message)
        }
        size={MESSAGE_AVATAR_SIZE}
        tint={
          message.sender_id
            ? memberAvatarTint(memberAvatarHue(message.sender_id, roleColor))
            : null
        }
        style={styles.avatar}
        textStyle={styles.avatarText}
        testID="message-avatar"
      />
    </Pressable>
  );
}

/**
 * Bubbles' row (§11 § Bubbles; owner OK 2026-11-10 on #3787, an opt-in beside
 * cozy and compact). Others on the left with the name and time once above the
 * stack and the avatar once below it; the viewer's own on the right, time
 * only. The root is the long-press target, as `MessageRowFrame`'s is.
 */
function BubbleRowFrame({
  message,
  viewerId,
  nameFor,
  roleColorFor,
  avatarFor,
  startsRun,
  endsRun,
  mine,
  quote,
  onOpenActions,
  onJumpToParent,
  onOpenProfile,
  flag,
  styles,
  children,
}: {
  message: ChatMessage;
  viewerId: string;
  nameFor: (userId: string) => string | null;
  roleColorFor?: (userId: string) => string | null;
  avatarFor?: (message: ChatMessage) => string | null;
  startsRun: boolean;
  endsRun: boolean;
  mine: boolean;
  quote?: ReactNode;
  onOpenActions?: () => void;
  /** As `MessageRowFrame`'s: the quote's jump, for a row with no text to carry it. */
  onJumpToParent?: () => void;
  onOpenProfile?: (userId: string) => void;
  /**
   * The row's flag (#3921), on the author line above the stack (#4288),
   * never on the bubble's fill.
   */
  flag?: MessageFlagView | null;
  styles: ReturnType<typeof createStyles>;
  children: ReactNode;
}) {
  const mentionsViewer =
    !!viewerId && !message.is_deleted && message.mentions.includes(viewerId);
  const { authorName, authorLabel, roleColor } = rowAuthor(
    message,
    nameFor,
    viewerId,
    roleColorFor,
  );
  const time = formatTimeOfDay(message.created_at);
  const openAuthor = authorProfileOpener(message, onOpenProfile, nameFor);
  const headerA11y = messageActionsA11yProps(onOpenActions, {
    onJumpToParent: quote ? onJumpToParent : undefined,
    onOpenProfile: openAuthor,
  });
  return (
    <Pressable
      accessible={false}
      onLongPress={onOpenActions}
      onPress={Keyboard.dismiss}
      disabled={!onOpenActions}
      testID={mine ? "bubble-row-self" : "bubble-row-other"}
      style={[
        styles.row,
        startsRun ? styles.bubbleRowStartsRun : styles.rowFollows,
      ]}
    >
      {flag?.important ? (
        <ImportantHighlight style={styles.mentionHighlight} />
      ) : mentionsViewer ? (
        <MentionHighlight style={styles.mentionHighlight} />
      ) : null}
      {startsRun ? null : (
        // A follow-on's handle, as cozy's gutter is: who sent it and when,
        // and the long-press as an action, for a row with no text to carry
        // it (a photo-only follow-on).
        <View
          style={styles.gutterInset}
          accessible
          accessibilityLabel={`${authorLabel}, ${time}`}
          testID="bubble-follow-on-handle"
          {...headerA11y}
        />
      )}
      <View style={[styles.bubbleMain, mine ? styles.bubbleMainSelf : null]}>
        {mine ? null : (
          <View style={styles.bubbleGutter}>
            {endsRun ? (
              <RowAvatar
                message={message}
                avatarFor={avatarFor}
                authorName={authorName}
                roleColor={roleColor}
                openAuthor={openAuthor}
                onOpenActions={onOpenActions}
                styles={styles}
              />
            ) : null}
          </View>
        )}
        <View
          style={[
            styles.bubbleColumn,
            mine ? styles.bubbleColumnSelf : styles.bubbleColumnOther,
          ]}
        >
          {startsRun ? (
            <View
              style={styles.bubbleAuthorLine}
              testID="author-line"
              accessible
              accessibilityLabel={
                flag
                  ? `${authorLabel}, ${time}, ${messageFlagCaption(flag)}`
                  : `${authorLabel}, ${time}`
              }
              {...headerA11y}
            >
              {mine ? null : (
                <Text
                  style={
                    roleColor
                      ? [styles.name, { color: roleColor }]
                      : styles.name
                  }
                  numberOfLines={1}
                  onPress={openAuthor}
                  onLongPress={openAuthor ? onOpenActions : undefined}
                  suppressHighlighting
                >
                  {authorLabel}
                </Text>
              )}
              <Text style={styles.time}>{time}</Text>
              {flag ? (
                <FlagCaption
                  view={flag}
                  styles={styles}
                  inline
                  labelledByParent
                />
              ) : null}
            </View>
          ) : null}
          {quote ? <View style={styles.bubbleQuote}>{quote}</View> : null}
          {flag && !startsRun ? (
            <FlagCaption view={flag} styles={styles} />
          ) : null}
          {children}
        </View>
      </View>
    </Pressable>
  );
}

/** Radius 18, the speaker-side corners tucked to 6 inside a stack. */
const BUBBLE_RADIUS = 18;
const BUBBLE_TUCK = 6;

/**
 * One bubble. Theirs is `--card` with its load-bearing hairline; yours is the
 * chapter's `accent-primary` under `accent-on-primary` text, the engine's
 * AA-by-construction pair (`accent-engine.md` §8). Only the viewer's own calls
 * `useChapterBranding()` (see `AccentText`).
 */
function Bubble({
  mine,
  startsRun,
  endsRun,
  dimmed,
  styles,
  children,
}: {
  mine: boolean;
  startsRun: boolean;
  endsRun: boolean;
  dimmed: boolean;
  styles: ReturnType<typeof createStyles>;
  children: ReactNode;
}) {
  const corners = mine
    ? {
        borderTopRightRadius: startsRun ? BUBBLE_RADIUS : BUBBLE_TUCK,
        borderBottomRightRadius: endsRun ? BUBBLE_RADIUS : BUBBLE_TUCK,
      }
    : {
        borderTopLeftRadius: startsRun ? BUBBLE_RADIUS : BUBBLE_TUCK,
        borderBottomLeftRadius: endsRun ? BUBBLE_RADIUS : BUBBLE_TUCK,
      };
  if (!mine) {
    return (
      <View
        testID="message-bubble"
        style={[styles.bubble, styles.bubbleOther, corners]}
      >
        {children}
      </View>
    );
  }
  return (
    <SelfBubble
      style={[styles.bubble, corners, dimmed ? styles.bubbleDimmed : null]}
    >
      {children}
    </SelfBubble>
  );
}

function SelfBubble({
  style,
  children,
}: {
  style: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const { accentPrimary } = useChapterBranding();
  return (
    <View
      testID="message-bubble"
      style={[style, { backgroundColor: accentPrimary }]}
    >
      {children}
    </View>
  );
}

/**
 * The viewer's own text on the accent fill, in `accent-on-primary`. Links
 * inherit it and keep their underline; a mention chip and inline code paint
 * their own opaque pairs (`message-markdown.tsx`), so they need nothing here.
 */
function SelfMarkdown({
  style,
  ...props
}: ComponentProps<typeof MessageMarkdown>) {
  const { accentOnPrimary } = useChapterBranding();
  return (
    <MessageMarkdown
      {...props}
      opaqueCode
      style={[style, { color: accentOnPrimary }]}
    />
  );
}

/**
 * Text on the accent fill in `accent-on-primary`, set on the Text itself: a
 * nested Text keeps its own color over the one it would inherit, so a
 * wrapper can't recolor `styles.trailing` or `styles.deleted`.
 */
function SelfText({
  style,
  children,
}: {
  style: StyleProp<TextStyle>;
  children: ReactNode;
}) {
  const { accentOnPrimary } = useChapterBranding();
  return <Text style={[style, { color: accentOnPrimary }]}>{children}</Text>;
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
      // Nothing under the row: the body draws gray until the server confirms
      // it, so a send never pushes the thread up a line and back
      // (components.md §11 § What rides the row, owner decision 2026-11-06).
      return null;
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
            <AccentText style={styles.retryText}>Retry</AccentText>
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
 * The fill behind a row that @-mentions the viewer: the chapter's
 * accent-subtle (step 3) with a 2pt accent bar on its leading edge, as
 * Discord marks a ping. Its own component for the reason `AccentText` gives:
 * only a row that mentions the viewer calls `useChapterBranding()`.
 */
function MentionHighlight({ style }: { style: StyleProp<ViewStyle> }) {
  const { accentSubtle, accentPrimary } = useChapterBranding();
  return (
    <View
      testID="message-mentions-viewer"
      pointerEvents="none"
      style={[
        style,
        { backgroundColor: accentSubtle, borderLeftColor: accentPrimary },
      ]}
    />
  );
}

/**
 * An Important row (#3921): the danger tint behind the whole row with a 2px
 * danger bar on its leading edge, the shape `MentionHighlight` takes in the
 * chapter accent (components.md §11 § A flagged row). It outranks the
 * mention highlight on a row that is both.
 */
function ImportantHighlight({ style }: { style: StyleProp<ViewStyle> }) {
  const { tokens } = useFrappTheme();
  const danger = tokens.color.semantic.destructive;
  return (
    <View
      testID="message-flag-important"
      pointerEvents="none"
      style={[
        style,
        { backgroundColor: tint(danger), borderLeftColor: danger },
      ]}
    />
  );
}

/**
 * The flag: "Important" in the danger text tone with its alert glyph, or a
 * lighter flag muted with none, then "· flagged by Name" when the flagger
 * isn't the sender. One phrase to a screen reader.
 *
 * `inline` draws it on the author line, right of the time (#4288), as two
 * of the line's own children: the glyph and label, which never shrink, then
 * "· flagged by", which truncates, sharing a narrow row's shortfall with the
 * name. Without it, the caption is a line of its own above the body, for a
 * row with no author line.
 */
function FlagCaption({
  view,
  styles,
  inline = false,
  labelledByParent = false,
}: {
  view: MessageFlagView;
  styles: ReturnType<typeof createStyles>;
  inline?: boolean;
  /**
   * The author line already names the flag in its own label (Bubbles), so
   * the flag is not a second stop for a screen reader: Android's TalkBack
   * visits an accessible child of an accessible parent on its own.
   */
  labelledByParent?: boolean;
}) {
  const caption = messageFlagCaption(view);
  if (inline) {
    return (
      <>
        <View
          style={[styles.flagCaption, styles.flagInline]}
          accessible={!labelledByParent}
          accessibilityLabel={labelledByParent ? undefined : caption}
          importantForAccessibility={
            labelledByParent ? "no-hide-descendants" : "auto"
          }
          accessibilityElementsHidden={labelledByParent}
          testID="message-flag"
        >
          <FlagLabel view={view} styles={styles} />
        </View>
        {view.flaggedBy ? (
          // Heard in the label's caption above, so hidden here.
          <Text
            style={[styles.flagLabel, styles.flagBy, styles.flagByInline]}
            numberOfLines={1}
            accessible={false}
            importantForAccessibility="no"
            accessibilityElementsHidden
            testID="message-flag-by"
          >
            {`· flagged by ${view.flaggedBy}`}
          </Text>
        ) : null}
      </>
    );
  }
  return (
    <View
      style={styles.flagCaption}
      accessible
      accessibilityLabel={caption}
      testID="message-flag"
    >
      <FlagLabel view={view} styles={styles}>
        {view.flaggedBy ? (
          <Text style={styles.flagBy}>{` · flagged by ${view.flaggedBy}`}</Text>
        ) : null}
      </FlagLabel>
    </View>
  );
}

/** The glyph and label both forms of `FlagCaption` draw. */
function FlagLabel({
  view,
  styles,
  children,
}: {
  view: MessageFlagView;
  styles: ReturnType<typeof createStyles>;
  children?: ReactNode;
}) {
  const { tokens } = useFrappTheme();
  const danger = tokens.color.semantic.destructiveText;
  return (
    <>
      {view.important ? <AlertGlyph size={14} color={danger} /> : null}
      <Text
        style={[styles.flagLabel, view.important ? { color: danger } : null]}
      >
        {view.label}
        {children}
      </Text>
    </>
  );
}

/**
 * Text in the chapter's accent (step 11). Its own component so that only a
 * row that draws the accent calls `useChapterBranding()`: the hook reaches for
 * `FrappClientProvider` (#1007), so a row that never fails never needs it.
 */
function AccentText({
  style,
  children,
}: {
  style: StyleProp<TextStyle>;
  children: ReactNode;
}) {
  const { accent } = useChapterBranding();
  return <Text style={[style, { color: accent }]}>{children}</Text>;
}

/** A reaction chip's reach: up to the 44pt floor above and below its 26pt. */
const CHIP_HIT_SLOP = { top: 9, bottom: 9 } as const;

type ReactionChipStyles = Pick<
  ReturnType<typeof createStyles>,
  "reactionChip" | "reactionChipMine" | "reactionText" | "reactionTextMine"
>;

/**
 * One reaction chip. The viewer's own reaction wears the chapter accent.
 *
 * One component whether or not the reaction is the viewer's: a chip that
 * flips between the two keeps its native view, so a screen reader stays on
 * the chip it just toggled and hears its new state. That means every chip
 * calls `useChapterBranding()`, which only a row with reactions renders; a
 * row without any (most of them) still never reaches for the client
 * provider (see `AccentText`).
 */
function ReactionChip({
  group,
  disabled,
  styles,
  onPress,
  onLongPress,
}: {
  group: ReactionGroup;
  disabled: boolean;
  styles: ReactionChipStyles;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const { accent, accentSubtle, accentBorder } = useChapterBranding();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: group.mine, disabled }}
      accessibilityLabel={`${group.emoji}, ${group.count}`}
      disabled={disabled}
      // A 26pt chip against the 44pt floor: hitSlop closes the gap without
      // inflating the drawn chip, vertically only (components.md §11). Chips
      // sit 6pt apart, so 9pt to the side would let each chip's later
      // neighbour, the `+` included, take the taps on its right edge.
      hitSlop={CHIP_HIT_SLOP}
      onPress={onPress}
      onLongPress={onLongPress}
      style={[
        styles.reactionChip,
        group.mine
          ? [
              styles.reactionChipMine,
              { backgroundColor: accentSubtle, borderColor: accentBorder },
            ]
          : null,
      ]}
    >
      <Text
        style={
          group.mine
            ? [styles.reactionTextMine, { color: accent }]
            : styles.reactionText
        }
      >
        {`${group.emoji} ${group.count}`}
      </Text>
    </Pressable>
  );
}

/**
 * Exported so a card (e.g. `PollCard`, #528) can carry the same reaction
 * affordance `MessageItem` gives every other kind — `styles` is narrowed to
 * just the keys this component reads so a caller with its own `createStyles`
 * only has to match that slice, not `MessageItem`'s full style sheet.
 *
 * **Nothing at all until someone reacts.** The row used to draw a `👍 +` chip
 * under every message the viewer hadn't reacted to, which was nearly every
 * row: a 26pt pill plus its margin, repeated down the whole thread, and the
 * main reason it read loose and busy next to s05's board. No messenger puts a
 * reaction control on every line; they start the first reaction from a long
 * press. So the first one starts in the message actions sheet, whose top row
 * is the quick picks (`message-actions-sheet.tsx`), and a message without
 * reactions costs no height here.
 *
 * Once a message has reactions, a `+` chip follows them, as the board draws it
 * (s05: the `5` chip, then `+`). It opens that same sheet, where the picks
 * live; it is not a one-tap reaction of its own. It needs the sheet, so it is
 * drawn only when the row offers its actions (`onLongPress`), and not while
 * the message is unconfirmed, since a reaction addresses a server id a pending
 * placeholder does not have yet.
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
   * actions the rest of the message opens. It is also the `+` chip's tap.
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
  if (reactions.length === 0) return null;
  return (
    <View style={styles.reactionRow}>
      {reactions.map((group) => {
        const chip = {
          group,
          disabled,
          styles,
          onLongPress,
          onPress: () =>
            group.mine
              ? onUnreact(messageId, group.emoji)
              : onReact(messageId, group.emoji),
        };
        return <ReactionChip key={group.actionType} {...chip} />;
      })}

      {!disabled && onLongPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={ADD_REACTION_A11Y_LABEL}
          hitSlop={CHIP_HIT_SLOP}
          onPress={onLongPress}
          onLongPress={onLongPress}
          style={styles.reactionChip}
        >
          <Text style={styles.reactionText}>+</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * The 32pt avatar, and the gutter it sets (components.md §11). Exported for
 * the thread's loading shapes (`thread-skeleton.tsx`), which mirror the row.
 */
export const MESSAGE_AVATAR_SIZE = 32;
/** The crest raster's field colour (`spec/ui/brand-identity.md` §2, "Mark field"). */
const CREST_FIELD = "#1A1A1A";

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    row: {
      // 16pt from the screen edge, the composer's inset.
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: 2,
    },
    // A run starts 16 below the row above; a follow-on sits 2 below.
    rowStartsRun: { paddingTop: tokens.spacing.lg },
    // Compact starts a run 4 below (§11 § Density).
    rowStartsRunCompact: { paddingTop: tokens.spacing.xs },
    rowFollows: { paddingTop: 2 },
    // Behind the whole row, edge to edge, so the gutter and text stay where
    // every other row has them; the 2pt bar sits inside the 16pt inset.
    flagCaption: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      marginBottom: 2,
    },
    flagLabel: {
      ...typeRole(tokens.typography.role.caption),
      // Weight comes from the Figtree family, never `fontWeight` (`typeRole`).
      fontFamily: fontFamilyFor(600),
      color: tokens.color.text.mutedForeground,
    },
    flagBy: {
      fontFamily: fontFamilyFor(400),
      color: tokens.color.text.mutedForeground,
    },
    // On the author line (#4288): centred on the line rather than on its
    // baseline, since the glyph has none, and never shrunk, so the label
    // always shows whole.
    flagInline: { alignSelf: "center", flexShrink: 0, marginBottom: 0 },
    // "· flagged by" after it, 6 from the label (the line's gap is 8): the
    // one part of the flag that truncates, sharing the shortfall with the
    // name.
    flagByInline: { flexShrink: 1, minWidth: 0, marginLeft: -2 },
    mentionHighlight: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      borderLeftWidth: 2,
    },
    quoteLine: {
      flexDirection: "row",
      alignItems: "flex-start",
      marginBottom: 2,
    },
    // Meets the quote block's first line and runs into the block, and
    // stretches to the quote's height so a two-line quote's elbow still
    // reaches down to the row (#4001).
    elbow: {
      alignSelf: "stretch",
      marginLeft: MESSAGE_AVATAR_SIZE / 2,
      marginTop: 12,
      width: 30,
      borderLeftWidth: 2,
      borderTopWidth: 2,
      borderColor: tokens.color.surface.popover,
      borderTopLeftRadius: 6,
    },
    elbowCompact: { marginLeft: 0, width: tokens.spacing.md + 6 },
    quote: { flex: 1, minWidth: 0 },
    main: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: tokens.spacing.md,
    },
    avatar: {
      width: MESSAGE_AVATAR_SIZE,
      height: MESSAGE_AVATAR_SIZE,
      borderRadius: avatarRadius(MESSAGE_AVATAR_SIZE),
      backgroundColor: tokens.color.surface.popover,
      alignItems: "center",
      justifyContent: "center",
    },
    // The crest's own field, so its corners match the raster's while it loads.
    // The mark never takes the chapter accent (brand-identity.md §2).
    systemAvatar: {
      backgroundColor: CREST_FIELD,
      overflow: "hidden",
    },
    systemAvatarImage: {
      width: MESSAGE_AVATAR_SIZE,
      height: MESSAGE_AVATAR_SIZE,
    },
    // Initials at caption / 700 (§11 Row anatomy), as web's avatar draws them.
    // Weight comes from the Figtree family, never `fontWeight` (see `typeRole`).
    avatarText: {
      ...typeRole(tokens.typography.role.caption),
      fontFamily: fontFamilyFor(700),
      color: tokens.color.text.mutedForeground,
    },
    // Held open on every row of a run, so a follow-on's text lines up under
    // the first row's. Stretches to the row's height so a screen reader's
    // focus ring on it covers the row.
    gutter: { width: MESSAGE_AVATAR_SIZE, alignSelf: "stretch" },
    // The thread card's connector (#4297): from under the photo, down the
    // gutter's middle, curving into the card's left edge (the column starts
    // one gap past the gutter).
    threadSpine: {
      position: "absolute",
      left: MESSAGE_AVATAR_SIZE / 2 - 1,
      width: MESSAGE_AVATAR_SIZE / 2 + 1 + tokens.spacing.md,
      borderLeftWidth: 2,
      borderBottomWidth: 2,
      borderBottomLeftRadius: 10,
      borderColor: tokens.color.border.hairline,
    },
    // Compact's follow-on handle: the row's 16pt left inset, its full height.
    gutterInset: {
      position: "absolute",
      left: 0,
      top: 0,
      bottom: 0,
      width: tokens.spacing.lg,
    },
    // Compact's time and name, ahead of the body or on a line of their own.
    // The name is body size at 600 so it shares the text's baseline.
    compactTime: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    compactName: {
      ...typeRole(tokens.typography.role.body),
      fontFamily: fontFamilyFor(600),
      color: tokens.color.text.foreground,
      flexShrink: 1,
    },
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
    // A photo still uploading dims like the gray text beside it.
    pendingFiles: { opacity: 0.5 },
    trailing: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    ownLineMarkers: { marginTop: tokens.spacing.xs },
    deleted: {
      ...typeRole(tokens.typography.role.body),
      fontFamily: italicFontFamilyFor(400),
      color: tokens.color.text.mutedForeground,
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
    // Colored with the chapter accent at render (`AccentText`).
    retryText: {
      ...typeRole(tokens.typography.role.caption),
    },
    discardText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    // Bubbles (§11 § Bubbles). A new speaker sits 12 below the row above.
    bubbleRowStartsRun: { paddingTop: tokens.spacing.md },
    bubbleMain: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: tokens.spacing.sm,
    },
    bubbleMainSelf: { justifyContent: "flex-end" },
    bubbleGutter: { width: MESSAGE_AVATAR_SIZE },
    // A bubble never runs the row's width: 80% of it, the messenger habit.
    bubbleColumn: { maxWidth: "80%", minWidth: 0 },
    bubbleColumnOther: { alignItems: "flex-start" },
    bubbleColumnSelf: { alignItems: "flex-end" },
    bubbleAuthorLine: {
      flexDirection: "row",
      alignItems: "baseline",
      gap: tokens.spacing.sm,
      paddingHorizontal: tokens.spacing.md,
      paddingBottom: 2,
      minWidth: 0,
    },
    bubbleQuote: { alignSelf: "stretch", marginBottom: 2 },
    bubble: {
      borderRadius: BUBBLE_RADIUS,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: 6,
      maxWidth: "100%",
    },
    bubbleOther: {
      backgroundColor: tokens.color.surface.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: tokens.color.border.hairline,
    },
    // In flight, the whole accent bubble dims rather than graying its text.
    bubbleDimmed: { opacity: 0.6 },
    bubbleReactions: { paddingHorizontal: tokens.spacing.sm, zIndex: 1 },
    // Up over the bubble's lower corner, 8 deep.
    bubbleReactionsOverlap: { marginTop: -14 },
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
    // Colors come from the chapter accent at render (`ReactionChip`).
    reactionChipMine: {
      borderWidth: 1,
    },
    // The reacted chip is the Accent badge recipe (components.md §5), so both
    // states carry its 12.5 / 600, as web's CHIP.base does.
    reactionText: {
      ...typeRole({
        ...tokens.typography.role.caption,
        weight: tokens.typography.weight.semibold,
      }),
      color: tokens.color.text.mutedForeground,
    },
    reactionTextMine: {
      ...typeRole({
        ...tokens.typography.role.caption,
        weight: tokens.typography.weight.semibold,
      }),
    },
  });
}
