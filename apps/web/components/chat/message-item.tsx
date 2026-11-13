"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Ban,
  Check,
  CircleAlert,
  Flag,
  MoreHorizontal,
  Pencil,
  Tag,
  Trash2,
} from "lucide-react";
import { SYSTEM_SENDER_ID, type ChatMessageFlag } from "@repo/validation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useMentionChips } from "@repo/hooks/mention-chips";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ACTION_BAR_BUTTON,
  ACTION_BAR_BUTTON_ON,
  CHIP,
  CHIP_HIT_AREA,
} from "./chip";
import {
  AuditGlyph,
  BookmarkGlyph,
  PinGlyph,
  StartThreadGlyph,
  ThreadGlyph,
} from "./chat-glyphs";
import { isAuditLine } from "@repo/chat-core/cards";
import { ImportedReactionChips } from "./imported-reaction-chips";
import { selectImportedReactions } from "./imported-reactions";
import { ReactionChips, ReactionQuickPick } from "./reaction-bar";
import { ThreadChip } from "./thread-chip";
import {
  MESSAGE_FLAG_OPTIONS,
  canFlagMessage,
  messageFlagCaption,
  messageFlagView,
  type MessageFlagView,
} from "@repo/chat-core/flags";
import { MessageAttachments } from "./message-attachments";
import { MessageGifImage } from "./message-gif";
import { QuotedMessage, replyPreviewText } from "./reply-quote";
import {
  canActOnMessage,
  canBlockSender,
  canDeleteMessage,
  canReportMessage,
  canEditMessage,
  isOwnMessage,
  EDITED_MARKER,
  isCardMessage,
  messageCanStartThread,
  showsEditedMarker,
  type MemberLookup,
} from "@repo/chat-core/message-actions";
import { MessageRenderer } from "./renderers";
import {
  InlineMessageEditor,
  type InlineMessageEditorHandle,
} from "./inline-message-editor";
import { MentionOpenerContext } from "./renderers/message-markdown";
import {
  authorProfileUserId,
  mentionedUserId,
} from "@repo/chat-core/profile-targets";
import { FOCUS_RING_OFFSET } from "@/components/ui/focus";
import {
  hiddenQuoteText,
  threadPreviewVisible,
  visibleReactions,
  type BlockState,
} from "@repo/chat-core/blocks";
import { blockActionLabel } from "@repo/chat-core/block-copy";
import type { ChatMessage, ReplayRequest } from "@repo/chat-core/types";
import type { ClosableCardKind } from "@repo/chat-core/chat-client";
import {
  authorInitialsFallback,
  memberAvatarHue,
  memberAvatarTint,
  resolveAuthorLabel,
  resolveAuthorName,
} from "@repo/hooks";
import { formatTimeOfDay, formatTimeOfDayShort } from "@repo/formatting";
import { cn, initials } from "@/lib/utils";
import { useChatDensity } from "@/lib/chat/chat-density";

/**
 * The crest at 180², synced from `@repo/brand-assets` by `SYNCED` in
 * `scripts/lib/brand-pixels.mjs` (gated by `check:brand-assets`): a 32px tile
 * needs no more, and the 1024² master would be a 27 KB download per client.
 */
const SYSTEM_AVATAR_SRC = "/brand/system-avatar.png";
/** The crest raster's field colour ("Mark field", brand-identity.md §2). */
const CREST_FIELD = "#1A1A1A";

export interface MessageItemProps {
  message: ChatMessage;
  /**
   * Signed URL for the author's photo: the member's own (#732) or an imported
   * author's `author_avatar_path` (#1231). `undefined` when there is none, it
   * hasn't resolved yet, or resolving it failed — every case degrades to the
   * initials fallback identically, so callers don't need to distinguish
   * "loading" from "no avatar".
   */
  avatarUrl?: string;
  /**
   * The palette color of the author's highest-ranked colored role (#3485),
   * from `useMemberDisplayNames().roleColorFor`. Paints the author's name on every
   * row, the viewer's own included: a name is never drawn in the chapter
   * accent (`foundations.md` §6). `undefined` or `null` keeps the plain
   * foreground.
   */
  authorColor?: string | null;
  /**
   * The signed-in member's `users.id`, and it is **known** — never `null`.
   *
   * Non-nullable deliberately: the nullable version of this prop was the
   * own-message mis-ID bug (#2243), not a loose type around it. `isMine` read
   * `!!viewerId && sender_id === viewerId`, so an identity that had not arrived
   * yet collapsed to a confident `false` and every row took the incoming shape —
   * the viewer's own included, with `resolveAuthorLabel` skipping its "You"
   * branch. Where the roster had not landed either, which is the same moment on
   * a cold load, that fell through to `Member bf1a2c` for the viewer's own name
   * and `authorInitialsFallback` drew `BF` beside it: both halves of that are
   * the member's own uuid, read back to them as somebody else.
   *
   * `null` is not a third answer to fall back to: this id decides whether the
   * author line says "You" (`components.md` §11) and
   * whether Edit and Delete are offered. So a row cannot be drawn before it is
   * in hand — `MessageTimeline` holds its skeleton until then, and this type is
   * what stops a later caller from quietly reopening the hole.
   */
  viewerId: string;
  /**
   * The viewer's block list as the thread classified it (`useThreadBlockList`).
   *
   * A row that reaches `MessageItem` is one the list lets through — the
   * timeline draws a blocked sender's row as `BlockedMessageTombstone` and holds
   * unmaskable rows back entirely — but two things inside a visible row can
   * still carry a blocked member's words: the **quote** of the message it
   * replies to, and the **reactions** on it. Both are filtered here
   * (`hiddenQuoteText`, `visibleReactions`; #2313). Required, so a caller
   * cannot render a row with the list forgotten, which would fail open.
   */
  blockState: BlockState;
  /**
   * Whether this row starts a run (`@repo/chat-core/grouping`), and so draws the
   * avatar and author line. A follow-on row draws neither.
   */
  showHeader: boolean;
  /**
   * Whether this row is the last of its run. Only Bubbles reads it: the
   * avatar sits under the stack, and the bottom corner on the speaker's side
   * tucks on every row but the last (§11 § Bubbles). Defaults to `true`.
   */
  endsRun?: boolean;
  /**
   * `created_at` of the run's first message, whose author line a follow-on's
   * gutter time is read against: the gutter drops AM/PM only when that line
   * already says it (`formatTimeOfDayShort`). Optional; without it the gutter
   * takes the short form.
   */
  runStartedAt?: string;
  /**
   * Resolves a `users.id` to a display name, or `null` when unresolvable.
   * Required rather than optional so a caller cannot silently regress the row to
   * a truncated uuid by forgetting it.
   */
  nameFor: (userId: string) => string | null;
  onReact: (messageId: string, emoji: string) => void;
  onUnreact: (messageId: string, emoji: string) => void;
  /**
   * Stages an inline reply to this message in the composer — the Discord-style
   * reply-with-quote `spec/behavior/chat/README.md` § Reply threads specifies.
   *
   * This is what the row's **Reply** control does now. It used to open a
   * Slack-style side panel with no composer in it, so "Reply" led to a
   * read-only dead end and no web surface could author a reply at all (#489).
   */
  onReply?: (message: ChatMessage) => void;
  /**
   * Scrolls the timeline to the message this one replies to, which is what the
   * **quote** above a reply now does.
   *
   * It used to open `ThreadPanel` in the Details rail. #2142 deleted both: the
   * panel was a read-only collector of replies that were already in the channel
   * below it, and the rail it lived in was the third column the board removes.
   * The quote keeps a destination — a better one, since the conversation it
   * jumps into is the real one with a composer under it, not a copy.
   */
  onJumpToParent?: (message: ChatMessage) => void;
  /**
   * Opens this message's thread (#3785): the row's **Start thread** control,
   * and the chip under a parent that has replies. Absent where threads aren't
   * offered (inside a thread, a 1:1 DM).
   */
  onOpenThread?: (message: ChatMessage) => void;
  /**
   * The thread card's faces (#4297): a replier's photo, and their top role
   * color for their initials' tint. Optional; without them the card draws
   * initials in each member's hashed hue.
   */
  avatarFor?: (userId: string) => string | null;
  roleColorFor?: (userId: string) => string | null;
  /** Replies in this message's thread new to the viewer (#4297). */
  threadUnread?: number;
  /**
   * The message this one replies to, when `message.reply_to_id` is set and that
   * parent is inside the loaded window; `null` or absent when it is not.
   *
   * **Whether a quote renders is decided by `message.reply_to_id`, not by this
   * prop** — deliberately, so a caller that forgets to wire it cannot silently
   * downgrade a reply to an ordinary message. It degrades the other way instead,
   * to a visible "not loaded" line, which is how the thread panel's missing
   * wiring was caught rather than shipped. (`null` and `undefined` are therefore
   * equivalent here; callers may pass whichever they hold.)
   */
  replyParent?: ChatMessage | null;
  onRetry?: (clientMessageId: string) => void;
  onDiscard?: (clientMessageId: string) => void;
  /**
   * Replay an `unconfirmed` heavy-command row under its ORIGINAL idempotency
   * key (#1733). Separate from `onRetry`, which resends an outbox row that is
   * known to have failed — this one resends a request that may already have
   * committed, and only the server's dedupe index makes that safe.
   *
   * There is deliberately no discard counterpart: the row may be the only trace
   * of a committed ledger write, so throwing it away is never the safe action.
   */
  onRetryUnconfirmed?: (replay: ReplayRequest) => void | Promise<void>;
  /**
   * Own messages only, and only a plain-text message — a card
   * (poll, task, event…) has no free-text `content` a member typed, so
   * there's nothing sensible to edit. Rejects on failure; the row stays in
   * edit mode so the draft isn't lost (the rejection itself already raised
   * a toast, from inside the action this callback wraps).
   */
  onEdit?: (messageId: string, content: string) => Promise<void>;
  /** Own message, or any message when the viewer holds `channels:manage`. */
  onDelete?: (messageId: string) => void;
  /** A poll card's Close poll, on the viewer's own open poll (#3794). */
  onClosePoll?: (messageId: string) => void;
  /**
   * A sign-up card's Close sign-ups or a form card's Close form (#3926), its
   * creator's or a moderator's.
   */
  onCloseCard?: (messageId: string, kind: ClosableCardKind) => void;
  /**
   * Flag, re-flag or (`null`) unflag this message (#3921). Optional so a
   * surface that doesn't wire it offers no Flag control; whether the viewer
   * may is `canFlagMessage`.
   */
  onFlag?: (messageId: string, flag: ChatMessageFlag | null) => void;
  /**
   * Whether the viewer has bookmarked this message (#462).
   *
   * The viewer's own state and nobody else's: there is no count and no "who
   * bookmarked this", because `spec/behavior/chat/README.md` is explicit that
   * not even a channel admin may see who bookmarked what. Pin, in the same
   * cluster, is the opposite — chapter-public and visible to everyone.
   */
  isBookmarked?: boolean;
  /**
   * Toggles the viewer's bookmark. Optional so a surface that does not wire
   * bookmarks hides the affordance rather than rendering a control that does
   * nothing — both surfaces that render messages today (the timeline and the
   * thread panel) do wire it, since a threaded reply is just as much a message
   * the viewer can see.
   */
  onToggleBookmark?: (messageId: string, next: boolean) => void;
  /** Gates the Delete affordance on messages that aren't the viewer's own. */
  canManageChannel?: boolean;
  /**
   * Opens the report form for this message (#2687). Offered on anyone else's
   * confirmed message (`canReportMessage`), never the viewer's own.
   */
  onReport?: (message: ChatMessage) => void;
  /**
   * Asks to block this message's sender (#2687). Offered where
   * `canBlockSender` allows, which needs `isMember` too.
   */
  onBlock?: (message: ChatMessage) => void;
  /**
   * Whether a sender is a chapter member (`rosterMembership`). Only a sender
   * positively known to have left loses Block; one the roster does not list yet
   * keeps it.
   */
  isMember?: MemberLookup;
  /** Card action invoker (Vote, RSVP, …). Required for kinds like `poll`. */
  onAct?: (
    messageId: string,
    actionType: string,
    payload: Record<string, unknown>,
  ) => void;
  /**
   * Whether *this* row's action cluster is the one a tap revealed. Required,
   * not owned locally: a coarse pointer has no `:hover`, so the reveal has to
   * be tap-to-toggle (#1193), and "tapping one row dismisses any other" needs
   * one id the parent list holds — a `useState` per row could not enforce
   * that a second tap elsewhere closes the first.
   */
  isTapRevealed: boolean;
  /** Toggles `isTapRevealed` for this row, and dismisses every other row's. */
  onToggleTapReveal: () => void;
  /**
   * Opens a member's profile by `users.id` (#3726): the author's from their
   * name or photo, or a mentioned member's from an `@` chip, as on mobile.
   * Optional, so a surface with no profile sheet draws plain names.
   */
  onOpenProfile?: (userId: string) => void;
}

/**
 * The author's name, as a button that opens their profile when the row has
 * one to open (`authorProfileUserId`), else plain text. A button, not a
 * clickable span, so it is reached by Tab and pressed by Enter or Space.
 * `FOCUS_RING_OFFSET`: the name carries no border for `FOCUS_RING` to swap.
 */
function AuthorName({
  openProfile,
  slot,
  className,
  style,
  children,
}: {
  openProfile: (() => void) | null;
  /** `author-line` where the name is the line itself (compact density). */
  slot?: string;
  className: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  if (!openProfile) {
    return (
      <span data-slot={slot} className={className} style={style}>
        {children}
      </span>
    );
  }
  return (
    <button
      type="button"
      data-slot={slot}
      aria-haspopup="dialog"
      onClick={openProfile}
      className={cn(
        className,
        "rounded-sm text-left hover:underline",
        FOCUS_RING_OFFSET,
      )}
      style={style}
    >
      {children}
    </button>
  );
}

/**
 * A single message row in the compact layout (`components.md` §11, owner
 * decision 2026-09-29, #2873). "Compact layout" there means bubble-free; the
 * member's density (§11 § Density, 2026-11-06) then draws it cozy, as below,
 * or compact, with a time gutter and the name leading the body.
 *
 * **One shape for every row, the viewer's included.** The first row of a run
 * draws a 32px avatar and an author line (name, then the time of day); a
 * follow-on row draws only its body, with its own time held in the avatar
 * gutter until the row is hovered, focused or tapped. The viewer's own name
 * reads "You", which replaced the self bubble's accent fill as the way a member
 * spots their own run. It wears the same role color or foreground as anyone's
 * name: since 2026-11-05 no name and no Pinned marker takes the chapter accent
 * (`foundations.md` §6). The viewer's own reacted chip keeps it, because that
 * chip is a control they switched on.
 *
 * It replaced two §11 bubble shapes, self (right, accent fill, caption below)
 * and incoming (left, card fill, caption above). Everything those carried has a
 * home here: the delivery state is a line under the body, `(edited)` and
 * Pinned trail the body's last line on every row, the reply quote sits above
 * the author line, and reactions sit under the body.
 *
 * The viewer identity comes from the session (`viewerId`); the row never
 * trusts a literal sender id for "this is mine" comparisons. It is also always
 * *resolved* by the time a row renders — see `viewerId` on the props.
 */
export function MessageItem({
  message,
  avatarUrl,
  authorColor,
  viewerId,
  blockState,
  showHeader,
  endsRun = true,
  runStartedAt,
  nameFor,
  onReact,
  onUnreact,
  onReply,
  onJumpToParent,
  onOpenThread,
  avatarFor,
  roleColorFor,
  threadUnread = 0,
  replyParent,
  onRetry,
  onDiscard,
  onRetryUnconfirmed,
  onAct,
  onEdit,
  onDelete,
  onClosePoll,
  onCloseCard,
  onFlag,
  isBookmarked,
  onToggleBookmark,
  canManageChannel,
  onReport,
  onBlock,
  isMember,
  isTapRevealed,
  onToggleTapReveal,
  onOpenProfile,
}: MessageItemProps) {
  // Resolved for every sender including the viewer: the label says "You" for its
  // own row, but the avatar still needs the initials — falling through to a uuid
  // slice there would draw `11` next to "You" beside `AC` next to "Alice Chen".
  //
  // Both go through `@repo/hooks` rather than `nameFor` directly, because
  // `sender_id` is nullable now: an imported archive message names its author in
  // `author_name` and has no roster entry at all, and the old
  // `message.sender_id.slice(...)` fallbacks below threw on it.
  const authorName = resolveAuthorName(message, nameFor);
  const authorLabel = resolveAuthorLabel(message, nameFor, viewerId);
  // The name and photo open the author's profile, as Discord's and mobile's
  // do; Frapp's own posts, an imported author and a member who left open
  // nothing (`authorProfileUserId`).
  const authorUserId = onOpenProfile
    ? authorProfileUserId(message, nameFor)
    : null;
  const openAuthor =
    onOpenProfile && authorUserId ? () => onOpenProfile(authorUserId) : null;
  // An `@` chip in the body opens the member it names, resolved only against
  // the members the server resolved for this message, so a role mention
  // (`@Brothers`) opens nothing (`mentionedUserId`).
  const openMention = useCallback(
    (token: string): (() => void) | null => {
      if (!onOpenProfile) return null;
      const userId = mentionedUserId(message, token, nameFor);
      return userId ? () => onOpenProfile(userId) : null;
    },
    [onOpenProfile, message, nameFor],
  );
  // The server resolved who this message pings (`chat_messages.mentions`),
  // so the row trusts that list rather than re-reading the body: it is the
  // same set the notifier used. A viewer's own message never lights up.
  const mentionsViewer =
    !!viewerId &&
    message.sender_id !== viewerId &&
    // A deleted message no longer counts as a mention anywhere else (the
    // unread badge skips it, the push is gone), so its tombstone stays plain.
    !message.is_deleted &&
    message.mentions.includes(viewerId);
  // A flag a member put on the message after it was sent (#3921): Important
  // tints the row in danger red, a lighter flag is only a caption. The view
  // drops a blocked flagger's name, since a Realtime echo carries it raw.
  const flagView = messageFlagView(message, viewerId, blockState, nameFor);
  // The thread card's latest-reply preview (#4297), only where the viewer's
  // block list clears its replier: the parent's echo carries it raw.
  const lastReply = message.thread?.last_reply ?? null;
  const threadPreview =
    lastReply &&
    threadPreviewVisible(lastReply, message, blockState, viewerId)
      ? lastReply
      : null;
  const importantRow = flagView?.important === true;
  const canFlag =
    !!onFlag && canFlagMessage(message, viewerId, !!canManageChannel);
  // Frapp's own posts (the welcome, the audit bridge, a poll's closing notice,
  // an invite-accept DM) wear the crest, not initials: the sender is the
  // product, not a member (#3347).
  const isSystemPost = message.sender_id === SYSTEM_SENDER_ID;
  // A `#chapter-audit` entry draws as one quiet line: the shield in the
  // gutter, no author line (§11 § Audit lines). Its renderer draws the words.
  const auditLine = !message.is_deleted && isAuditLine(message);
  // Its author line is never drawn, whatever the run says.
  const drawsHeader = showHeader && !auditLine;
  // The member's density on this browser (§11 § Density). Compact drops the
  // avatar and the author line: the time takes a fixed gutter and the name
  // leads the body's first line.
  // A channel the member pinned to a display on this browser draws in that
  // one (#3787); every other channel follows the default.
  const density = useChatDensity(message.channel_id);
  const compact = density === "compact";
  // Bubbles (§11 § Bubbles, #3787). An audit line keeps its one quiet line.
  const bubbled = density === "bubbles" && !auditLine;
  // The viewer's own message sits on the right in the chapter accent.
  const mine = isOwnMessage(message, viewerId);
  const avatarSrc = isSystemPost ? SYSTEM_AVATAR_SRC : avatarUrl;
  // The initials take the author's own color (#3860): their name's role color
  // when it has one, so the two always match, otherwise their hashed hue. An
  // imported message with no sender keeps the neutral circle.
  const avatarTint =
    !isSystemPost && message.sender_id
      ? memberAvatarTint(memberAvatarHue(message.sender_id, authorColor))
      : null;
  const isPending = message._status === "pending";
  const isFailed = message._status === "failed";
  // An outcome we could not read, NOT a known failure — see `MessageStatus`.
  // Rendered neutrally rather than in destructive red on purpose: the write may
  // well have committed, and red is what makes an officer re-type the command.
  // Only ever set on a heavy-command placeholder, whose `kind` is "loading" —
  // a card, so its body is the loading card rather than muted text.
  const isUnconfirmed = message._status === "unconfirmed";
  // Write committed, card missing — not a failure and not retryable (#1789).
  const isRecorded = message._status === "recorded";
  // Reactions and threads operate on the *server* id (the chat actions
  // endpoint requires a real chat_messages.id, threads need a stable
  // parent id) — gate the hover affordances on a confirmed status so we
  // never act on a placeholder id.
  const isConfirmed = message._status === "confirmed";
  const showActions = canActOnMessage(message);
  // The rules are shared with mobile (`@repo/chat-core/message-actions`, #2775):
  // Edit is own-only with no `channels:manage` override, and only on a
  // plain-text message; Delete is own, or anyone's with `channels:manage`.
  const canEdit = canEditMessage(message, viewerId) && !!onEdit;
  const canDelete =
    canDeleteMessage(message, viewerId, !!canManageChannel) && !!onDelete;
  // Report and Block share mobile's rules too (#2687), and sit behind one
  // More button rather than two more icons on a bar that already wraps.
  const canReport = canReportMessage(message, viewerId) && !!onReport;
  const canBlock =
    !!isMember && canBlockSender(message, viewerId, isMember) && !!onBlock;

  const [isEditing, setIsEditing] = useState(false);
  // The tokens the row paints as chips, which the editor opens as chips.
  const mentionChips = useMentionChips(message);
  const [editValue, setEditValue] = useState(message.content);
  const [editDirty, setEditDirty] = useState(false);
  // Bumped to load `message.content` into the open editor again (below).
  const [editResetKey, setEditResetKey] = useState(0);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  /*
   * Two focus hand-backs, each a ref plus an effect rather than a `.focus()` in
   * the handler, because both have to outlive the commit that causes them. Refs
   * rather than state because nothing renders from them, and setting state from
   * the effect that reads it is the cascading render `react-hooks` forbids.
   *
   * **Closing the editor returns focus to Edit — but only from the keyboard.**
   * `disabled` and unmounting both drop focus to `<body>`, so without this the
   * next Tab restarts at the top of the document rather than at the row the
   * member was just editing, on a list that may be 200 rows long. It cannot be
   * done inline: the action cluster is unmounted for as long as the editor is
   * open (`showActions && !isEditing` below), so at the moment Cancel, Escape
   * or a save fires there is no Edit button to focus; the effect runs once it
   * has remounted.
   *
   * The keyboard gate is not fussiness. The cluster is revealed by a
   * `:focus-visible` in the row, and a programmatic focus right after a
   * keyboard event can match it, so focusing Edit can *pin it open* — and a
   * member who dismissed the editor with the mouse has their pointer somewhere
   * else entirely and would be left with four controls painted over that
   * message until focus happened to move again. `event.detail === 0` is how a
   * click gets told apart from a pointer one: keyboard activation of a button
   * reports no clicks.
   *
   * **A save that fails returns focus to the field**, unconditionally — the
   * editor stays open (so the cluster is still unmounted and there is nothing
   * to pin), the draft survives, and without this the caret does not: the
   * member is told to try again in a form they must first click back into. It
   * cannot be done from the `catch`, where the field is still disabled; it
   * re-enables only on the render `finally` schedules.
   */
  // The pointer that started the latest press on the row, for `handleRowTap`.
  const lastPointerType = useRef<string | null>(null);
  const extentRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);

  /*
   * Puts the action bar beside the message: its left edge 8px past the right
   * edge of what the message draws, or, where that would run past the row,
   * flush with the row's right edge (a long message, a narrow pane), which
   * is the corner it always used to sit in. Beside rather than over, so a
   * short message's own text is never under the bar it is hovered for.
   *
   * Measured, not laid out: no CSS places a box at the lesser of two other
   * boxes' edges. It runs on reveal (hover, focus, a tap), writes one inline
   * margin and re-renders nothing, so a list being scrolled under the
   * pointer pays a measure per row entered and no React work.
   */
  function placeActionBar() {
    const extent = extentRef.current;
    const bar = barRef.current;
    const track = bar?.parentElement;
    if (!extent || !bar || !track) return;
    const flush = track.clientWidth - bar.offsetWidth;
    // The viewer's own bubble hugs the right edge, so its bar goes to its
    // left: 8px short of the bubble's left edge, or flush left.
    if (bubbled && mine) {
      const besideLeft =
        track.clientWidth - extent.offsetWidth - 8 - bar.offsetWidth;
      bar.style.marginLeft = `${Math.max(0, besideLeft)}px`;
      return;
    }
    const beside = extent.offsetWidth + 8;
    bar.style.marginLeft = `${Math.max(0, Math.min(beside, flush))}px`;
  }
  const editTriggerRef = useRef<HTMLButtonElement | null>(null);
  const editFieldRef = useRef<InlineMessageEditorHandle | null>(null);
  const restoreFocusOnExit = useRef(false);
  const restoreFocusOnFailedSave = useRef(false);
  useEffect(() => {
    if (isEditing || !restoreFocusOnExit.current) return;
    restoreFocusOnExit.current = false;
    editTriggerRef.current?.focus();
  }, [isEditing]);
  useEffect(() => {
    if (isSavingEdit || !restoreFocusOnFailedSave.current) return;
    restoreFocusOnFailedSave.current = false;
    editFieldRef.current?.focus();
  }, [isSavingEdit]);

  // A row is not remounted by a content update — it's the same component
  // instance, keyed by id (`message-timeline.tsx`) — so an untouched-but-open
  // editor would otherwise keep showing what `message.content` was *when Edit
  // was clicked*, not what it is now. Only auto-refreshes while nothing has
  // been typed yet (`!editDirty`): the same viewer editing this message from a
  // second tab is the only way `content` can change while it's their own open
  // editor (edit is own-message-only), and once they've actually started
  // typing here, syncing out from under them would be its own kind of data
  // loss.
  if (isEditing && !editDirty && editValue !== message.content) {
    setEditValue(message.content);
    setEditResetKey((key) => key + 1);
  }
  // Someone else with `channels:manage` (or the sender from another tab) can
  // delete this message out from under an editor that's already open — the
  // server correctly rejects a save against a deleted message, but the row
  // should not sit there still showing a stale, now-pointless draft form.
  if (isEditing && message.is_deleted) {
    setIsEditing(false);
  }
  // Edit stopped being allowed while the editor was open: the channel was
  // made read-only, or the member became an alumnus, and the shell withdrew
  // `onEdit` (#2775). Save would do nothing, so the editor closes rather than
  // leave a live button that silently ignores the member.
  if (isEditing && !canEdit) {
    setIsEditing(false);
  }

  function startEdit() {
    setEditValue(message.content);
    setEditDirty(false);
    setIsEditing(true);
  }

  /** `fromKeyboard` decides the focus hand-back — see the refs above. */
  function cancelEdit(fromKeyboard: boolean) {
    restoreFocusOnExit.current = fromKeyboard;
    setIsEditing(false);
  }

  async function saveEdit(fromKeyboard: boolean) {
    const trimmed = editValue.trim();
    if (trimmed.length === 0 || !onEdit) return;
    setIsSavingEdit(true);
    try {
      await onEdit(message.id, trimmed);
      restoreFocusOnExit.current = fromKeyboard;
      setIsEditing(false);
    } catch {
      // The action already toasted; stay in edit mode so the draft survives —
      // and hand the caret back to it, which `disabled` took away.
      restoreFocusOnFailedSave.current = true;
    } finally {
      setIsSavingEdit(false);
    }
  }

  /*
   * Tap-to-reveal, for the pointer the hover/focus reveal below cannot reach
   * (#1193). `onClick`, not `onTouchStart` or a press handler: a native
   * click already fires only on a tap the browser did not treat as a scroll
   * or a drag, which is the "must not fire on an accidental scroll-touch"
   * acceptance criterion for free.
   *
   * Two things a plain row-level `onClick` gets wrong without the guards
   * below, both found by review:
   *
   * - **Every interactive descendant bubbles into it.** Reply, the quick
   *   reaction chips, the emoji-picker trigger (and its Radix `Popover`
   *   content — portalled elsewhere in the DOM, but the *click target* is
   *   still a real descendant of whatever it visually sits over, so
   *   `closest()` still finds it), and a card's own buttons (poll Vote, a
   *   task checkbox, an RSVP) all live inside this row. With no guard, using
   *   any of them also re-toggles the cluster in the same gesture — reacting
   *   collapses the tray that action needed to be reachable through, and a
   *   plain mouse click anywhere in the row (not just these controls) would
   *   pin the tray open indefinitely, since a `click` bubbles from a mouse
   *   too, not only from a tap. Bailing out on `closest("button, a, input,
   *   textarea, select, [role='button']")` covers every control in this file
   *   *and* every renderer under `./renderers/`, present or future, without
   *   each one having to remember `stopPropagation`.
   * - **A selection elsewhere in the thread must not block this row.**
   *   Finishing a text selection inside *this* message with a lift-off (which
   *   does end in a click on most engines) must not also toggle the cluster
   *   right as the member is trying to copy something — but checking
   *   `window.getSelection()` globally would also suppress a legitimate tap
   *   on this row while a stale selection from a *different* message
   *   lingers (observed on iOS Safari, where the Selection API can lag the
   *   visual clear by one tap). Scoping the check to whether the selection
   *   is actually anchored inside this row's own subtree gets both right.
   */
  function handleRowTap(event: React.MouseEvent<HTMLDivElement>) {
    if (!showActions || isEditing) return;
    // A mouse has hover, which already reveals the bar and hides it again on
    // the way out. A mouse click toggling the tap state pinned the bar and
    // the row's lift on screen until another row was clicked (owner report
    // 2026-11-06), so only a touch or a pen toggles it. An engine that reports
    // no pointer type keeps the old behavior.
    if (lastPointerType.current === "mouse") return;
    if (
      event.target instanceof Element &&
      event.target.closest(
        // `menuitem`: the More menu's items are portalled, but a React click
        // still bubbles up to this row, and choosing Report or Block is not
        // a tap on the message (#2687).
        "button, a, input, textarea, select, [role='button'], [role='menuitem']",
      )
    ) {
      return;
    }
    const selection = window.getSelection();
    if (
      selection &&
      selection.toString().length > 0 &&
      event.currentTarget.contains(selection.anchorNode)
    ) {
      return;
    }
    placeActionBar();
    onToggleTapReveal();
  }

  /*
   * The quoted parent, above the author line — `spec/behavior/chat/README.md`:
   * "The UI shows the replied-to message as a quote/preview above the reply."
   * A reply always starts a run (`@repo/chat-core/grouping`), so there is always
   * an author line under the quote saying who is answering.
   *
   * Hidden on a deleted row, for the same reason the reaction chips and the
   * attachment list are: a tombstone is not something anyone said, so hanging
   * "replying to Alice" above "[message deleted]" would keep asserting context
   * for content that is gone. Note `is_deleted` on the *parent* is different and
   * is NOT hidden — that quote renders the tombstone as its preview, because the
   * reply is still real and still needs to say what it answered.
   *
   * `reply_to_id` is checked rather than `replyParent`, so a reply whose parent
   * fell outside the loaded window still renders the unavailable line instead of
   * silently looking like an ordinary message.
   */
  const hiddenParent = replyParent
    ? hiddenQuoteText(replyParent, blockState, viewerId)
    : null;
  const replyQuote =
    message.reply_to_id && !message.is_deleted ? (
      <div className="mb-0.5 flex min-w-0 items-stretch">
        {/*
          The elbow: from the avatar's centre (16px into the 32px gutter) up
          and across to the quote, so the quote reads as belonging to the row
          below it rather than floating between two rows. Compact has no
          avatar, so it drops from the text column's edge onto the name. It
          stretches to the quote's height, so a two-line quote's elbow still
          reaches down to the row, and touches the quote's block (#4001).
        */}
        <span
          aria-hidden="true"
          data-slot="reply-elbow"
          className={cn(
            "mt-3 shrink-0 rounded-tl-[6px] border-l-2 border-t-2 border-popover",
            compact ? "ml-16 w-4.5" : "ml-4 w-7.5",
          )}
        />
        <QuotedMessage
          author={
            replyParent
              ? resolveAuthorLabel(replyParent, nameFor, viewerId)
              : null
          }
          preview={replyParent ? replyPreviewText(replyParent) : null}
          hidden={hiddenParent}
          onOpen={
            replyParent && onJumpToParent
              ? () => onJumpToParent(replyParent)
              : undefined
          }
        />
      </div>
    ) : null;

  /*
    Attachments render under the body for every kind, not inside the text
    renderer: a file is a property of the message, not of how its body is
    drawn, and a deleted message must not offer downloads of what it used to
    carry. The component itself no-ops on a zero count, so this costs nothing
    for the overwhelming majority of messages.
  */
  const attachments = message.is_deleted ? null : message.gif ? (
    // A GIF message (#4631) is the GIF: no text, no files.
    <MessageGifImage gif={message.gif} />
  ) : message.attachment_count === 0 ? null : (
      <MessageAttachments
        channelId={message.channel_id}
        messageId={message.id}
        count={message.attachment_count}
        confirmed={isConfirmed}
        photos={message.attachment_photos}
      />
    );

  /*
   * `(edited)` and Pinned, after the body's last line on every row — grouped or
   * not, which is what #2872 was: the marker used to live on the author line,
   * and a follow-on row draws none. Neither applies to a deleted message.
   */
  const edited = showsEditedMarker(message);
  const pinned = message.is_pinned && !message.is_deleted;
  const trailing =
    edited || pinned ? (
      <span
        data-slot="message-trailing"
        className="ml-1.5 inline-flex items-center gap-1.5 whitespace-nowrap align-baseline text-caption text-muted-foreground"
      >
        {edited ? <span>{EDITED_MARKER}</span> : null}
        {pinned ? (
          <span className="inline-flex items-center gap-1">
            <PinGlyph className="h-3.5 w-3.5" active />
            Pinned
          </span>
        ) : null}
      </span>
    ) : null;
  // A card draws its own frame, and an attachment-only message has no text
  // line (§11 § What rides the row), so their markers go on a line of their
  // own under the card or the attachment rather than into the renderer.
  const trailingOnOwnLine =
    !message.is_deleted &&
    (isCardMessage(message) || message.content.trim().length === 0);
  // The flag rides the author line, right of the time (#4288). Grouping gives
  // every flagged message one (`decorateThread`), so only a row that never
  // draws an author line (an audit line) keeps the caption above its body.
  const flagOnAuthorLine = !!flagView && drawsHeader;
  // Compact leads a text body's first line with the name. A card, an
  // attachment-only message and the open editor have no line to lead, and a
  // flagged message takes its name to a line of its own so the flag sits
  // beside it rather than inside the sentence.
  const inlineName =
    compact &&
    drawsHeader &&
    !isEditing &&
    !trailingOnOwnLine &&
    !flagOnAuthorLine;

  // The run's first row draws the author's 32px photo in the cozy gutter.
  const authorAvatar = (
    <Avatar
      className="h-8 w-8"
      aria-hidden="true"
      data-system-avatar={isSystemPost || undefined}
      style={isSystemPost ? { backgroundColor: CREST_FIELD } : undefined}
    >
      {avatarSrc ? <AvatarImage src={avatarSrc} alt="" /> : null}
      {/*
        Radix draws the fallback until the image loads, and for good if it
        fails. A system post's fallback is the crest's own field with no text,
        never a letter tile: its name resolves to "Frapp" (#3347), so initials
        would draw an "F" where the crest goes.
      */}
      <AvatarFallback
        tint={avatarTint}
        style={isSystemPost ? { backgroundColor: CREST_FIELD } : undefined}
      >
        {isSystemPost
          ? null
          : authorName
            ? initials(authorName)
            : authorInitialsFallback(message)}
      </AvatarFallback>
    </Avatar>
  );
  const renderer = (
    <MentionOpenerContext.Provider value={onOpenProfile ? openMention : null}>
      <MessageRenderer
        message={message}
        viewerId={viewerId}
        nameFor={nameFor}
        isConfirmed={isConfirmed}
        onAct={onAct ?? (() => {})}
        onClosePoll={onClosePoll}
        onCloseCard={onCloseCard}
        trailing={trailingOnOwnLine ? undefined : trailing}
        muted={isPending || isFailed}
      />
    </MentionOpenerContext.Provider>
  );
  // A card in flight has no text to gray, so the whole card dims instead.
  const bodyCore =
    isPending && isCardMessage(message) ? (
      <div className="opacity-50">{renderer}</div>
    ) : (
      renderer
    );
  // Where there is no author line to carry it, the flag's caption sits above
  // the body on a line of its own.
  const flagCaption =
    flagView && !flagOnAuthorLine ? (
      <MessageFlagCaption view={flagView} />
    ) : null;
  const authorLineFlag =
    flagView && flagOnAuthorLine ? (
    <MessageFlagCaption view={flagView} inline />
  ) : null;
  const body = flagCaption ? (
    <>
      {flagCaption}
      {bodyCore}
    </>
  ) : (
    bodyCore
  );

  // Deleted content has nothing left to react to. Reaction rows for a message
  // are never deleted server-side (only the message's own content/metadata
  // are), so without this a deleted row would keep showing its old chips as
  // still-live react/unreact targets — the Delete button added here is the
  // first UI path that can set `is_deleted` on a message a viewer is looking
  // at without a reload, so this case was unreachable before.
  const importedSummary = message.is_deleted
    ? []
    : selectImportedReactions(message.kind, message.payload);

  // The chips a viewer may see: never a blocked member's, since a reaction is
  // its author's own text, and while the list cannot vouch for anyone, only the
  // viewer's own and those of a member this client just unblocked. Same
  // identity as `message.reactions` when nothing is hidden.
  const shownReactions = visibleReactions(
    message.reactions,
    blockState,
    viewerId,
  );

  const reactions = message.is_deleted ? null : (
    <>
      <ImportedReactionChips reactions={importedSummary} />
      <ReactionChips
        reactions={shownReactions}
        viewerId={viewerId}
        onReact={(emoji) => onReact(message.id, emoji)}
        onUnreact={(emoji) => onUnreact(message.id, emoji)}
      />
    </>
  );

  /*
   * The action bar: icons centred on the row's top edge, beside what the
   * message actually draws (`placeActionBar`; `components.md` §11 §
   * Per-message actions).
   *
   * It stays mounted and fades, rather than mounting on a JS `hovered` flag: a
   * keyboard user reaches it through focus (a mounted-on-hover version was
   * mouse-only), and the row stops re-rendering on every mouse crossing in a
   * virtualized list.
   *
   * - **`opacity-0` is not hidden.** It removes neither hit-testing nor layout,
   *   so without `pointer-events-none` a tap over it posts a reaction the
   *   member never saw a control for — and on touch, where `:hover` never
   *   fires, that is *all* they can hit. The pointer gate is lifted by the same
   *   variants that lift the opacity.
   * - **It reserves no height.** It rides a zero-height sticky track (below),
   *   so it floats over the gap above the row and the top of the text. Its fill
   *   is opaque so the text under it does not show through.
   * - **Keyboard focus, not any focus.** It is revealed by a `:focus-visible`
   *   inside the row, not `:focus-within`. A mouse click on a control in the
   *   row (a quick reaction, Save, an image preview, which the viewer hands
   *   focus back to on close) leaves focus there without a ring, and under
   *   `:focus-within` that pinned the bar and the row's lift on screen after
   *   the pointer had left, until something else took focus.
   * - **Open menus hold it.** The More menu and the emoji picker are portalled
   *   out of the row, so neither hover nor focus covers them; an expanded
   *   trigger keeps the bar its menu hangs from on screen.
   *
   * `:hover`/`:focus-visible` reach nothing on a coarse pointer (#1193), so
   * `isTapRevealed` is the third way in, driven by `handleRowTap`.
   */
  const actions =
    showActions && !isEditing ? (
      <div
        // A labelled group rather than a bare `div`: these controls all act on
        // one message, and without the grouping a screen reader announces
        // "Reply, Save, Edit, Delete" with nothing saying what they belong to —
        // on a virtualized list of them. Not `role="toolbar"`, which would
        // promise arrow-key roving this does not implement.
        ref={barRef}
        role="group"
        aria-label="Message actions"
        className={cn(
          // Centred on the row's top edge: up half its own height, and up
          // again by the row's top padding, since the track it rides starts
          // where the content does.
          "flex -translate-y-[calc(50%+var(--row-pt))] items-center gap-0.5",
          // At the row's right edge until `placeActionBar` has measured: the
          // old place, and where a long message's bar ends up anyway.
          "ml-auto",
          // Wraps rather than spilling past the row's left edge: on a coarse
          // pointer every icon is 44px, and nine of them (your own message) are
          // wider than a 375px thread, where the scroller would clip the first.
          "max-w-full flex-wrap justify-end",
          "rounded-[10px] border border-border bg-card p-0.5",
          "transition-opacity",
          "group-hover/message:pointer-events-auto group-hover/message:opacity-100",
          "group-has-[:focus-visible]/message:pointer-events-auto group-has-[:focus-visible]/message:opacity-100",
          "has-[[aria-expanded=true]]:pointer-events-auto has-[[aria-expanded=true]]:opacity-100",
          // Touch path: a tap on the row sets `isTapRevealed`, since `:hover`
          // never fires there. Kept as a JS-driven class rather than a
          // `pointer-coarse:` variant so the same row also works from a
          // stylus (a mouse click does not toggle it: `handleRowTap`), and
          // so "tapping elsewhere
          // dismisses this" (the parent list's single `tapRevealedId`) has
          // something to key off.
          isTapRevealed
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0",
        )}
      >
        <ReactionQuickPick
          reactions={shownReactions}
          viewerId={viewerId}
          onReact={(emoji) => onReact(message.id, emoji)}
          onUnreact={(emoji) => onUnreact(message.id, emoji)}
        />
        {/*
        `iconography.md`'s chat table maps "Reply to a message" to `ThreadGlyph`.
        It stages an inline reply in the composer.
      */}
        {onReply ? (
          <button
            type="button"
            className={ACTION_BAR_BUTTON}
            aria-label="Reply"
            title="Reply"
            onClick={() => onReply(message)}
          >
            <ThreadGlyph className="h-4 w-4" />
          </button>
        ) : null}
        {onOpenThread && messageCanStartThread(message) ? (
          <button
            type="button"
            className={ACTION_BAR_BUTTON}
            aria-label="Start thread"
            title="Start thread"
            onClick={() => onOpenThread(message)}
          >
            <StartThreadGlyph className="h-4 w-4" />
          </button>
        ) : null}
        {onToggleBookmark ? (
          <button
            type="button"
            className={cn(
              ACTION_BAR_BUTTON,
              isBookmarked && ACTION_BAR_BUTTON_ON,
            )}
            // A toggle announces its state, and its name stays put: a screen
            // reader otherwise hears one button swapped for another in the slot.
            aria-pressed={!!isBookmarked}
            aria-label="Save"
            title={isBookmarked ? "Saved" : "Save"}
            onClick={() => onToggleBookmark(message.id, !isBookmarked)}
          >
            <BookmarkGlyph className="h-4 w-4" active={isBookmarked} />
          </button>
        ) : null}
        {canFlag ? (
          <MessageFlagMenu
            current={message.flag ?? null}
            onPick={(flag) => onFlag?.(message.id, flag)}
          />
        ) : null}
        {canEdit ? (
          <button
            type="button"
            className={ACTION_BAR_BUTTON}
            ref={editTriggerRef}
            aria-label="Edit"
            title="Edit"
            onClick={startEdit}
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
        {canDelete ? (
          <button
            type="button"
            className={ACTION_BAR_BUTTON}
            aria-label="Delete"
            title="Delete"
            onClick={() => onDelete?.(message.id)}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
        {canReport || canBlock ? (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={ACTION_BAR_BUTTON}
                aria-label="More actions"
                title="More"
              >
                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canReport ? (
                <DropdownMenuItem onSelect={() => onReport?.(message)}>
                  <Flag aria-hidden="true" />
                  Report message
                </DropdownMenuItem>
              ) : null}
              {canBlock ? (
                <DropdownMenuItem
                  className="text-destructive-text focus:bg-destructive-tint focus:text-destructive-text"
                  onSelect={() => onBlock?.(message)}
                >
                  <Ban aria-hidden="true" />
                  {blockActionLabel(authorName)}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    ) : null;

  /**
   * The inline editor that takes the body's place in the row.
   *
   * In place, not a dialog or popover: it renders where the body was, between
   * the same reply quote and attachment list (`components.md` §11 § Editing (web)).
   * It is the §4 text input at the full width of the body column, and since
   * 2026-11-11 it is the composer's own rich editor (`InlineMessageEditor`,
   * #2236): mentions stay chips and `@` opens the member list, where the
   * textarea before it showed raw `@Name` text and offered nothing.
   */
  const editForm = (
    <div className="mt-0.5 flex w-full flex-col gap-1.5">
      <InlineMessageEditor
        ref={editFieldRef}
        value={editValue}
        chips={mentionChips}
        resetKey={editResetKey}
        disabled={isSavingEdit}
        onChange={(text) => {
          setEditValue(text);
          setEditDirty(true);
        }}
        onSave={() => void saveEdit(true)}
        onCancel={() => cancelEdit(true)}
      />
      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          className={cn(CHIP.base, CHIP.neutral, CHIP_HIT_AREA)}
          onClick={(event) => cancelEdit(event.detail === 0)}
          disabled={isSavingEdit}
        >
          Cancel
        </button>
        <button
          type="button"
          className={cn(CHIP.base, CHIP.neutral, CHIP_HIT_AREA, "gap-1")}
          onClick={(event) => void saveEdit(event.detail === 0)}
          disabled={isSavingEdit || editValue.trim().length === 0}
        >
          Save
        </button>
      </div>
    </div>
  );

  /**
   * Retry control for an `unconfirmed` heavy-command row (#1733).
   *
   * Deliberately NOT a live region and NOT red. The note itself is announced
   * through the row's existing `role="status"` region below — a second region
   * mounted already populated is not reliably announced at all, and in a
   * virtualized list (Virtuoso remounts rows on scroll) the ones that are get
   * re-read on every pass.
   *
   * Two other rules: no Discard, because the row may be the only trace of a
   * committed ledger write; and Retry replays `_replay`, not the cache key, so
   * the request goes back under its original idempotency key.
   */
  const unconfirmedFooter =
    isUnconfirmed && message._replay ? (
      <div className="mt-1 flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
        {onRetryUnconfirmed ? (
          <button
            type="button"
            disabled={isRetrying}
            className={cn(
              CHIP.base,
              CHIP.neutral,
              CHIP_HIT_AREA,
              // Wide enough for "Retrying…", so the label swap never
              // nudges what sits beside it.
              "min-w-[5.5rem] justify-center gap-1 disabled:opacity-60",
            )}
            onClick={() => {
              const replay = message._replay;
              if (!replay || isRetrying) return;
              setIsRetrying(true);
              // Both failure shapes have to reset the button, and they are
              // different: `.catch` covers a rejected promise, while a handler
              // that throws SYNCHRONOUSLY escapes before `Promise.resolve` is
              // ever evaluated — the prop type admits a non-async handler — and
              // would pin the control on "Retrying…" forever with no toast.
              try {
                void Promise.resolve(onRetryUnconfirmed(replay))
                  .catch(() => {})
                  .finally(() => setIsRetrying(false));
              } catch {
                setIsRetrying(false);
              }
            }}
          >
            {isRetrying ? "Retrying…" : "Retry"}
          </button>
        ) : null}
      </div>
    ) : null;

  /*
   * The delivery state, under the body. Only this line is a live region, and
   * it is mounted empty until it has something to say: a region mounted
   * populated would read every row's status aloud on each virtualized scroll.
   * One element for every density, so a fix to the failed-send flow reaches
   * Bubbles too.
   */
  const deliveryStatus = (
    <div role="status" aria-live="polite" aria-atomic="true">
      {/*
        Pending draws nothing here: the body is already gray, which is the
        whole pending state on screen, so a send never adds a line and takes
        it away again (§11 § What rides the row, owner decision 2026-11-06).
        A screen reader still hears it.
      */}
      {isPending ? <span className="sr-only">Sending</span> : null}
      {isUnconfirmed ? (
        <p className="mt-0.5 text-caption text-muted-foreground">
          {message._error ?? "Not confirmed"}
        </p>
      ) : null}
      {isRecorded ? (
        <p className="mt-0.5 text-caption text-muted-foreground">
          {message._error ??
            "Recorded, but the chat card didn't post. Don't run this command again."}
        </p>
      ) : null}
      {isFailed ? (
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-caption text-destructive-text">
          <span>{message._error ?? "Send failed"}</span>
          {onRetry ? (
            <button
              type="button"
              className={cn(CHIP.base, CHIP.neutral, CHIP_HIT_AREA)}
              onClick={() => onRetry(message.client_message_id)}
            >
              Retry
            </button>
          ) : null}
          {onDiscard ? (
            <button
              type="button"
              className={cn(CHIP.base, CHIP.neutral, CHIP_HIT_AREA, "gap-1")}
              onClick={() => onDiscard(message.client_message_id)}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              Discard
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  if (bubbled) {
    /*
     * Bubbles (§11 § Bubbles; owner OK 2026-11-10 on #3787, an opt-in beside
     * cozy and compact). Others' messages on the left in a `--card` bubble with
     * its load-bearing hairline; the viewer's on the right in `--primary` with
     * `--primary-foreground` text, the accent engine's AA-by-construction pair
     * (`accent-engine.md` §8). A run stacks with its corners tucked to 6 on the
     * speaker's side; the name and time sit once above the stack, the avatar
     * once below it. A card or an attachment-only message draws no bubble:
     * the card frames itself, and an empty bubble over a photo was one of the
     * reasons §11 dropped bubbles in 2026-09.
     */
    // The open editor fills the column on its own, as in cozy: a textarea
    // on the accent fill would take its colors.
    const textBubble = !trailingOnOwnLine && !isEditing;
    const hasReactions =
      !message.is_deleted &&
      (Object.values(shownReactions).some(
        (userIds) => Array.isArray(userIds) && userIds.length > 0,
      ) ||
        importedSummary.length > 0);
    const bubble = textBubble ? (
      <div
        data-slot="message-bubble"
        className={cn(
          "min-w-0 max-w-full rounded-[18px] px-3 py-1.5",
          mine
            ? [
                "bg-primary text-primary-foreground",
                // The body and its trailing markers take the contrast color;
                // links inherit it and keep their underline. Mention chips
                // paint their own opaque pair.
                "[&_[data-slot=message-body]]:text-primary-foreground [&_[data-slot=message-trailing]]:text-primary-foreground",
                // Inline code's alpha tint would land on the accent, so it
                // takes the thread's own opaque pair instead.
                "[&_code]:bg-background [&_code]:text-foreground",
                !drawsHeader && "rounded-tr-[6px]",
                !endsRun && "rounded-br-[6px]",
              ]
            : [
                "border border-border bg-card",
                !drawsHeader && "rounded-tl-[6px]",
                !endsRun && "rounded-bl-[6px]",
              ],
          // In flight: the whole bubble dims rather than graying its text,
          // which on the accent fill would drop under AA.
          mine && (isPending || isFailed) && "opacity-60",
        )}
      >
        {bodyCore}
      </div>
    ) : isEditing ? (
      editForm
    ) : (
      // The flag is never drawn in the bubble's fill: it rides the author
      // line above the stack, or, with none, its own caption (#3921, #4288).
      bodyCore
    );
    /*
     * A follow-on bubble's own time, beside it on the side away from the
     * speaker, revealed with the row as cozy's gutter time is. Opacity, not
     * `visibility`, so a screen reader still hears when each was sent.
     */
    const followOnTime = drawsHeader ? null : (
      <time
        dateTime={message.created_at}
        data-slot="gutter-time"
        className={cn(
          "shrink-0 self-center whitespace-nowrap text-caption text-muted-foreground",
          "opacity-0 group-hover/message:opacity-100 group-has-[:focus-visible]/message:opacity-100",
          isTapRevealed && "opacity-100",
        )}
      >
        {formatTimeOfDayShort(message.created_at, runStartedAt)}
      </time>
    );
    return (
      <div
        role="listitem"
        className={cn(
          "group/message relative px-5 pt-(--row-pt) pb-0.5",
          // A new speaker sits 12 below; a stacked bubble 2.
          showHeader ? "[--row-pt:0.75rem]" : "[--row-pt:0.125rem]",
          importantRow
            ? IMPORTANT_ROW
            : mentionsViewer
              ? "bg-accent-subtle shadow-[inset_2px_0_0_var(--primary)] hover:bg-accent-subtle-hover has-[:focus-visible]:bg-accent-subtle-hover"
              : "hover:bg-surface-1 has-[:focus-visible]:bg-surface-1",
          isTapRevealed && rowTapClass(importantRow, mentionsViewer),
        )}
        data-density="bubbles"
        data-side={mine ? "self" : "other"}
        data-flag={flagView?.flag}
        data-mentions-viewer={mentionsViewer || undefined}
        data-status={message._status}
        data-run={showHeader ? "start" : "follow"}
        onPointerDown={(event) => {
          lastPointerType.current = event.pointerType;
        }}
        onPointerEnter={placeActionBar}
        onFocus={placeActionBar}
        onClick={handleRowTap}
      >
        <div className="grid">
          <div
            ref={extentRef}
            data-slot="message-extent"
            className={cn(
              "col-start-1 row-start-1 min-w-0",
              mine ? "justify-self-end" : "justify-self-start",
              // A bubble never runs the full width of a wide pane: 75% of the
              // row (85% on a phone), the messenger convention. Capped here,
              // on the extent, whose parent has a definite width; a
              // percentage inside the fit-content extent would resolve
              // against the text's own width and wrap it.
              isEditing
                ? "w-full max-w-full"
                : "w-fit max-w-[min(36rem,85%)] sm:max-w-[min(36rem,75%)]",
            )}
          >
            <div className="flex min-w-0 items-end gap-2">
              {mine ? followOnTime : null}
              {mine ? null : (
                // The avatar, once, beside the stack's last bubble. The gutter
                // stays open on every row so the stack's left edge holds.
                <div className="w-8 shrink-0">
                  {endsRun ? (
                    openAuthor ? (
                      <button
                        type="button"
                        tabIndex={-1}
                        aria-hidden="true"
                        data-slot="author-avatar"
                        onClick={openAuthor}
                        className="block rounded-full"
                      >
                        {authorAvatar}
                      </button>
                    ) : (
                      authorAvatar
                    )
                  ) : null}
                </div>
              )}
              <div
                className={cn(
                  "flex min-w-0 max-w-full flex-col",
                  mine ? "items-end" : "items-start",
                  isEditing && "w-full",
                )}
              >
                {drawsHeader ? (
                  <div
                    data-slot="author-line"
                    className="flex min-w-0 max-w-full items-baseline gap-2 px-3 pb-0.5 leading-5"
                  >
                    {mine ? null : (
                      <AuthorName
                        openProfile={openAuthor}
                        className="min-w-0 truncate text-sm font-semibold text-foreground"
                        style={authorColor ? { color: authorColor } : undefined}
                      >
                        {authorLabel}
                      </AuthorName>
                    )}
                    <time
                      dateTime={message.created_at}
                      className="shrink-0 text-caption leading-5 text-muted-foreground"
                    >
                      {formatTimeOfDay(message.created_at)}
                    </time>
                    {authorLineFlag}
                  </div>
                ) : null}
                {replyQuote ? (
                  <div className="max-w-full [&_[data-slot=reply-elbow]]:hidden">
                    {replyQuote}
                  </div>
                ) : null}
                {flagCaption && !isEditing ? (
                  <div className="px-3">{flagCaption}</div>
                ) : null}
                {bubble}
                {attachments}
                {trailingOnOwnLine && trailing && !isEditing ? (
                  <div className="mt-1 leading-5 [&>span]:ml-0">{trailing}</div>
                ) : null}
                {/*
                  Reactions ride the bubble's lower corner on the speaker's
                  side, overlapping it by 8. The chips are opaque, so the
                  bubble's edge never shows through them.
                */}
                {hasReactions ? (
                  <div
                    data-slot="bubble-reactions"
                    className={cn(
                      "relative z-[1] flex max-w-full px-2",
                      textBubble && "-mt-3.5",
                      mine ? "justify-end" : "justify-start",
                    )}
                  >
                    {reactions}
                  </div>
                ) : null}
                {/* The thread chip sits under the bubble, on its side (#3785). */}
                {message.thread ? (
                  <div
                    className={cn(
                      "flex max-w-full",
                      mine ? "justify-end" : "justify-start",
                    )}
                  >
                    <ThreadChip
                      summary={message.thread}
                      nameFor={nameFor}
                      avatarFor={avatarFor}
                      roleColorFor={roleColorFor}
                      unread={threadUnread}
                      preview={threadPreview}
                      viewerId={viewerId}
                      onOpen={
                        onOpenThread ? () => onOpenThread(message) : undefined
                      }
                    />
                  </div>
                ) : null}
                {deliveryStatus}
                {unconfirmedFooter}
              </div>
              {mine ? null : followOnTime}
            </div>
          </div>
          {actions ? (
            <div
              data-slot="action-track"
              className="sticky top-[calc(var(--row-pt)+1.5rem)] z-10 col-start-1 row-start-1 flex h-0 min-w-0 items-start self-start pointer-coarse:top-[calc(var(--row-pt)+2rem)]"
            >
              {actions}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div
      role="listitem"
      className={cn(
        "group/message relative px-5 pt-(--row-pt) pb-0.5",
        // An audit stack's first line sits 8 below the row above: a log line
        // is not a new speaker, so it takes less than a run's 16.
        // Compact starts a run 4 below, cozy 16 (§11 § Density).
        // One value for the padding and for the action bar, which is centred
        // on the row's top edge from a track that starts below it.
        auditLine
          ? showHeader
            ? "[--row-pt:0.5rem]"
            : "[--row-pt:0.125rem]"
          : showHeader
            ? compact
              ? "[--row-pt:0.25rem]"
              : "[--row-pt:1rem]"
            : "[--row-pt:0.125rem]",
        // Delineation without a bubble (§11): the whole row lifts one surface
        // step under a pointer, with keyboard focus inside it, or once tapped.
        // Pointer feedback, not information, so the ~1.1:1 step is enough.
        importantRow
          ? IMPORTANT_ROW
          : mentionsViewer
            ? // A row that @-mentions the viewer wears the chapter accent the
              // way Discord marks one (§11): the accent-subtle fill with a 2px
              // accent bar on its leading edge. It is information, so it stays
              // on under a pointer instead of giving way to the surface lift.
              "bg-accent-subtle shadow-[inset_2px_0_0_var(--primary)] hover:bg-accent-subtle-hover has-[:focus-visible]:bg-accent-subtle-hover"
            : // `:focus-visible`, not `:focus-within`: a mouse click on a control
              // in the row leaves focus there, and must not hold the lift on after
              // the pointer has gone (the action bar's note below).
              "hover:bg-surface-1 has-[:focus-visible]:bg-surface-1",
        isTapRevealed && rowTapClass(importantRow, mentionsViewer),
      )}
      data-flag={flagView?.flag}
      data-mentions-viewer={mentionsViewer || undefined}
      data-status={message._status}
      data-run={showHeader ? "start" : "follow"}
      onPointerDown={(event) => {
        lastPointerType.current = event.pointerType;
      }}
      // Every way the bar is revealed: hover, keyboard focus, a tap.
      onPointerEnter={placeActionBar}
      onFocus={placeActionBar}
      onClick={handleRowTap}
    >
      {/*
        One cell holds the message and the action bar's track, so the bar
        rides over the message without adding height.

        The message itself is as wide as what it draws (`w-fit`), which is
        what `placeActionBar` measures to put the bar beside it rather than
        at the far side of a wide pane (owner report 2026-11-06). Full width
        while editing, where the field takes the column's width.
      */}
      <div className="grid">
        <div
          ref={extentRef}
          data-slot="message-extent"
          className={cn(
            "col-start-1 row-start-1 min-w-0 max-w-full justify-self-start",
            isEditing ? "w-full" : "w-fit",
          )}
        >
          {replyQuote}
          <div className={cn("flex", compact ? "gap-2" : "gap-3")}>
            {/*
              The gutter, held open on every row of a run: 32px for the avatar
              in cozy, 56px for the time in compact (§11 § Density).
            */}
            <div
              className={cn("relative shrink-0", compact ? "w-14" : "w-8")}
            >
              {message.thread && !compact && !auditLine ? (
                /*
                  The thread card's connector (#4297, after Discord's): from
                  under the photo (or the follow-on's time) down the gutter's
                  middle, curving into the card's left edge. The card is the
                  column's last item on a confirmed row, so the line ends at
                  its middle: half its height up from the bottom, 36px, or
                  60px with the latest reply's preview line.
                */
                <span
                  aria-hidden="true"
                  data-slot="thread-spine"
                  className={cn(
                    "pointer-events-none absolute left-[15px] w-[29px] rounded-bl-[10px] border-b-2 border-l-2 border-border",
                    threadPreview ? "bottom-[30px]" : "bottom-[18px]",
                    drawsHeader ? "top-10" : "top-7",
                  )}
                />
              ) : null}
              {auditLine ? (
                <div
                  className={cn(
                    "flex h-5 items-center",
                    compact ? "justify-end" : "justify-center",
                  )}
                >
                  <AuditGlyph className="h-3.5 w-3.5 text-muted" />
                </div>
              ) : compact ? (
                /*
                  Compact's gutter is the time: the run's first row always
                  shows it, and a follow-on reveals its own the way cozy's does.
                */
                <time
                  dateTime={message.created_at}
                  data-slot={drawsHeader ? "compact-time" : "gutter-time"}
                  className={cn(
                    "flex justify-end whitespace-nowrap text-caption leading-[25px] text-muted-foreground",
                    !drawsHeader &&
                      "opacity-0 group-hover/message:opacity-100 group-has-[:focus-visible]/message:opacity-100",
                    !drawsHeader && isTapRevealed && "opacity-100",
                  )}
                >
                  {drawsHeader
                    ? formatTimeOfDay(message.created_at)
                    : formatTimeOfDayShort(message.created_at, runStartedAt)}
                </time>
              ) : showHeader ? (
                openAuthor ? (
                  /*
                    The photo opens the profile too, as a pointer target only:
                    out of the Tab order and hidden from assistive tech,
                    because the name beside it is the same control and is
                    reached by keyboard. Two stops for one action would only
                    add noise.
                  */
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-hidden="true"
                    data-slot="author-avatar"
                    onClick={openAuthor}
                    className="block rounded-full"
                  >
                    {authorAvatar}
                  </button>
                ) : (
                  authorAvatar
                )
              ) : (
                /*
              A follow-on's own time, revealed with the row. Opacity rather than
              `visibility`, so a screen reader still hears when each message in
              a run was sent; hours and minutes only while the run's author
              line above already says AM or PM (the gutter is 32px wide), and
              the full time once the run has crossed noon.
            */
                <time
                  dateTime={message.created_at}
                  data-slot="gutter-time"
                  className={cn(
                    // A flex box ending at the gutter's right edge, so a time wider
                    // than 32px ("12:02 PM", once a run crosses noon) overflows to
                    // the left into the row's 20px padding rather than over the
                    // text; `text-right` alone does not, since an overflowing line
                    // is start-aligned.
                    "flex justify-end whitespace-nowrap text-caption leading-[25px] text-muted-foreground",
                    "opacity-0 group-hover/message:opacity-100 group-has-[:focus-visible]/message:opacity-100",
                    isTapRevealed && "opacity-100",
                  )}
                >
                  {formatTimeOfDayShort(message.created_at, runStartedAt)}
                </time>
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              {drawsHeader && !compact ? (
                <div
                  data-slot="author-line"
                  className="flex min-w-0 items-baseline gap-2 leading-5"
                >
                  <AuthorName
                    openProfile={openAuthor}
                    className="min-w-0 truncate text-sm font-semibold text-foreground"
                    // A literal from the role palette, which is contrast-checked
                    // against these surfaces (`@repo/validation` role-colors).
                    style={authorColor ? { color: authorColor } : undefined}
                  >
                    {authorLabel}
                  </AuthorName>
                  <time
                    dateTime={message.created_at}
                    className="shrink-0 text-caption leading-5 text-muted-foreground"
                  >
                    {formatTimeOfDay(message.created_at)}
                  </time>
                  {authorLineFlag}
                </div>
              ) : null}
              {compact && drawsHeader && !inlineName ? (
                // A card, an attachment-only message, the editor, or a flagged
                // message: the name takes a line of its own, the flag beside it.
                <div className="flex min-w-0 items-baseline gap-2">
                  <AuthorName
                    openProfile={openAuthor}
                    slot="author-line"
                    className="min-w-0 truncate text-base font-semibold leading-[25px] text-foreground"
                    style={authorColor ? { color: authorColor } : undefined}
                  >
                    {authorLabel}
                  </AuthorName>
                  {authorLineFlag}
                </div>
              ) : null}
              {inlineName ? (
                <>
                  {/*
                  Compact's name leads the body's first line, floated so the
                  text flows beside it and wraps back under it, the way a
                  sentence would (`flow-root` keeps the float inside the row).
                  Body size at 600, so the name and the text share a baseline.
                */}
                  <div className="flow-root min-w-0">
                    <AuthorName
                      openProfile={openAuthor}
                      slot="author-line"
                      // `max-w-full break-words`: an unbroken imported handle
                      // wraps inside the column rather than spilling past it.
                      className="float-left mr-2 max-w-full break-words text-base font-semibold leading-[25px] text-foreground"
                      style={authorColor ? { color: authorColor } : undefined}
                    >
                      {authorLabel}
                    </AuthorName>
                    {bodyCore}
                  </div>
                </>
              ) : isEditing ? (
                editForm
              ) : (
                body
              )}
              {attachments}
              {trailingOnOwnLine && trailing && !isEditing ? (
                <div className="mt-1 leading-5 [&>span]:ml-0">{trailing}</div>
              ) : null}
              {reactions}
              {message.thread ? (
                <ThreadChip
                  summary={message.thread}
                  nameFor={nameFor}
                  avatarFor={avatarFor}
                  roleColorFor={roleColorFor}
                  unread={threadUnread}
                  preview={threadPreview}
                  viewerId={viewerId}
                  onOpen={
                    onOpenThread ? () => onOpenThread(message) : undefined
                  }
                />
              ) : null}
              {deliveryStatus}
              {unconfirmedFooter}
            </div>
          </div>
        </div>
        {actions ? (
          /*
          The bar's zero-height track, sticky inside the message's cell and as
          wide as the row. At rest it sits on the content's top edge, and the
          bar centres itself on the row's. Once the row's top scrolls under
          the top of the timeline, the track holds the bar on screen while the
          message scrolls under it, so a tall message (an image, a long import) keeps its actions in
          reach rather than clipping them at the pane's edge. It lets go once
          the message's own bottom passes the top of the pane. The offset is
          the bar's half height plus a margin, past `--row-pt`: 34px tall on a
          fine pointer, 50px (44px icons) on a coarse one.
        */
          <div
            data-slot="action-track"
            className="sticky top-[calc(var(--row-pt)+1.5rem)] z-10 col-start-1 row-start-1 flex h-0 min-w-0 items-start self-start pointer-coarse:top-[calc(var(--row-pt)+2rem)]"
          >
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * An Important row (#3921): the danger tint across the whole row with a 2px
 * danger bar on its leading edge, the shape the mention row takes in the
 * chapter accent (§11 § A row that mentions you). It is information, so it
 * stays on under a pointer and deepens rather than giving way to the lift.
 * Chapter-accent text on the row reads in `--foreground` here: the accent
 * misses AA on the red for most chapter seeds. The thread card's count sits
 * on the card's own fill since #4297, but keeps the foreground too, so an
 * Important row reads the same on web and mobile.
 */
const IMPORTANT_ROW =
  "bg-destructive-tint shadow-[inset_2px_0_0_var(--destructive)] hover:bg-destructive-tint-hover has-[:focus-visible]:bg-destructive-tint-hover [&_.text-primary]:text-foreground";

/** The fill a tapped row holds, by which emphasis it wears. */
function rowTapClass(important: boolean, mentionsViewer: boolean): string {
  if (important) return "bg-destructive-tint-hover";
  return mentionsViewer ? "bg-accent-subtle-hover" : "bg-surface-1";
}

/**
 * The flag's caption: "Important", or "Funny · flagged by Marcus". Important
 * is danger red with its alert glyph; a lighter flag is muted, with no glyph,
 * so it reads as a note rather than an alarm.
 *
 * `inline` draws it on the author line, right of the time (#4288): its parts
 * join the line's own flex row, and on a narrow row "· flagged by" drops out
 * first, then the name truncates, while the label and the time hold. Without it, it is
 * a line of its own above the body, for a row with no author line.
 */
function MessageFlagCaption({
  view,
  inline = false,
}: {
  view: MessageFlagView;
  inline?: boolean;
}) {
  const tone = view.important ? "text-destructive-text" : "text-muted-foreground";
  if (inline) {
    return (
      <span data-slot="message-flag" className="contents">
        <span className="sr-only">{messageFlagCaption(view)}</span>
        <span
          aria-hidden="true"
          title={messageFlagCaption(view)}
          className={cn(
            "flex h-5 shrink-0 items-center gap-1.5 self-center text-caption font-semibold leading-5",
            tone,
          )}
        >
          <MessageFlagLabel view={view} />
        </span>
        {view.flaggedBy ? (
          /*
            All or nothing: a one-line wrapping box that clips its second
            line, so where "· flagged by Name" doesn't fit it drops out whole
            rather than leaving a stray "·…". It counts toward the line's width
            (Bubbles sizes its column by it) but shrinks so much faster than
            the name that it is gone before the name loses even a fraction of
            a pixel, which would draw the name's ellipsis. The label's title
            and the screen-reader text keep it.
          */
          <span
            aria-hidden="true"
            className="-ml-1 flex h-5 min-w-0 shrink-[100000] flex-wrap self-center overflow-hidden"
          >
            {/* A line's first item never wraps, so a zero-width one leads. */}
            <span className="h-5 w-0" />
            <span
              data-slot="message-flag-by"
              className="shrink-0 whitespace-nowrap text-caption leading-5 text-muted-foreground"
            >
              · flagged by {view.flaggedBy}
            </span>
          </span>
        ) : null}
      </span>
    );
  }
  return (
    <div
      data-slot="message-flag"
      className={cn(
        "flex items-center gap-1.5 text-caption font-semibold leading-5",
        tone,
      )}
    >
      <span className="sr-only">{messageFlagCaption(view)}</span>
      <MessageFlagLabel view={view} aria-hidden />
      {view.flaggedBy ? (
        <span aria-hidden="true" className="font-normal text-muted-foreground">
          · flagged by {view.flaggedBy}
        </span>
      ) : null}
    </div>
  );
}

/** The glyph and label both forms of `MessageFlagCaption` draw. */
function MessageFlagLabel({
  view,
  "aria-hidden": ariaHidden,
}: {
  view: MessageFlagView;
  "aria-hidden"?: boolean;
}) {
  return (
    <>
      {view.important ? (
        <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      ) : null}
      <span aria-hidden={ariaHidden || undefined}>{view.label}</span>
    </>
  );
}

/**
 * The action bar's Flag control (#3921): Important first, then the lighter
 * flags, and Remove flag when the message has one. Tag, not Flag, for its
 * glyph: the More menu's Report message already draws Lucide's flag.
 */
function MessageFlagMenu({
  current,
  onPick,
}: {
  current: ChatMessageFlag | null;
  onPick: (flag: ChatMessageFlag | null) => void;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(ACTION_BAR_BUTTON, current && ACTION_BAR_BUTTON_ON)}
          aria-label="Flag"
          title="Flag"
        >
          <Tag className="h-4 w-4" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {MESSAGE_FLAG_OPTIONS.map(({ flag, label }) => (
          <DropdownMenuItem
            key={flag}
            className={cn(
              flag === "important" &&
                "text-destructive-text focus:bg-destructive-tint focus:text-destructive-text",
            )}
            onSelect={() => onPick(flag)}
          >
            {flag === "important" ? (
              <CircleAlert aria-hidden="true" />
            ) : (
              <span aria-hidden="true" className="size-4" />
            )}
            <span className="flex-1">{label}</span>
            {current === flag ? (
              <>
                <Check aria-hidden="true" />
                <span className="sr-only">(current flag)</span>
              </>
            ) : null}
          </DropdownMenuItem>
        ))}
        {current ? (
          <DropdownMenuItem onSelect={() => onPick(null)}>
            <span aria-hidden="true" className="size-4" />
            Remove flag
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
