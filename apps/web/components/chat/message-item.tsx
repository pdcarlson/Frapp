"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import {
  ACTION_BAR_BUTTON,
  ACTION_BAR_BUTTON_ON,
  CHIP,
  CHIP_HIT_AREA,
} from "./chip";
import { BookmarkGlyph, PinGlyph, ThreadGlyph } from "./chat-glyphs";
import { ImportedReactionChips } from "./imported-reaction-chips";
import { selectImportedReactions } from "./imported-reactions";
import { ReactionChips, ReactionQuickPick } from "./reaction-bar";
import { MessageAttachments } from "./message-attachments";
import { QuotedMessage, replyPreviewText } from "./reply-quote";
import {
  canActOnMessage,
  canDeleteMessage,
  canEditMessage,
  EDITED_MARKER,
  isCardMessage,
  isOwnMessage,
  showsEditedMarker,
} from "@repo/chat-core/message-actions";
import { MessageRenderer } from "./renderers";
import {
  hiddenQuoteText,
  visibleReactions,
  type BlockState,
} from "@repo/chat-core/blocks";
import type { ChatMessage, ReplayRequest } from "@repo/chat-core/types";
import {
  authorInitialsFallback,
  resolveAuthorLabel,
  resolveAuthorName,
} from "@repo/hooks";
import { formatTimeOfDay, formatTimeOfDayShort } from "@repo/formatting";
import { cn, initials } from "@/lib/utils";

export interface MessageItemProps {
  message: ChatMessage;
  /**
   * Signed URL for `message.author_avatar_path`, or `undefined` when there is
   * none, it hasn't resolved yet, or resolving it failed (#1231) — every case
   * degrades to the initials fallback identically, so callers don't need to
   * distinguish "loading" from "no avatar".
   */
  avatarUrl?: string;
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
   * author line says "You" in the chapter accent (`components.md` §11) and
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
}

/**
 * A single message row in the compact layout (`components.md` §11, owner
 * decision 2026-09-29, #2873).
 *
 * **One shape for every row, the viewer's included.** The first row of a run
 * draws a 32px avatar and an author line (name, then the time of day); a
 * follow-on row draws only its body, with its own time held in the avatar
 * gutter until the row is hovered, focused or tapped. The viewer's own name
 * reads "You" in `--accent-text`, which replaced the self bubble's accent fill
 * as the way a member spots their own run. (The Pinned marker and the viewer's
 * reacted chip take the accent too, on anyone's row.)
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
  viewerId,
  blockState,
  showHeader,
  runStartedAt,
  nameFor,
  onReact,
  onUnreact,
  onReply,
  onJumpToParent,
  replyParent,
  onRetry,
  onDiscard,
  onRetryUnconfirmed,
  onAct,
  onEdit,
  onDelete,
  isBookmarked,
  onToggleBookmark,
  canManageChannel,
  isTapRevealed,
  onToggleTapReveal,
}: MessageItemProps) {
  // `isOwnMessage` checks the sender before comparing: an imported archive row
  // has no `sender_id`, and `null === null` would otherwise offer Edit and
  // Delete on every imported message.
  const isMine = isOwnMessage(message, viewerId);
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

  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(message.content);
  const [editDirty, setEditDirty] = useState(false);
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
   * The keyboard gate is not fussiness. The cluster is revealed by
   * `group-focus-within/message`, so focusing Edit *pins it open* — and a
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
  const editTriggerRef = useRef<HTMLButtonElement | null>(null);
  const editFieldRef = useRef<HTMLTextAreaElement | null>(null);
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
   * Tap-to-reveal, for the pointer the hover/focus-within reveal below cannot
   * reach (#1193). `onClick`, not `onTouchStart` or a press handler: a native
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
    if (
      event.target instanceof Element &&
      event.target.closest("button, a, input, textarea, select, [role='button']")
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
      <div className="mb-0.5 flex min-w-0 items-start gap-1.5">
        {/*
          The elbow: from the avatar's centre (16px into the 32px gutter) up
          and across to the quote, so the quote reads as belonging to the row
          below it rather than floating between two rows.
        */}
        <span
          aria-hidden="true"
          data-slot="reply-elbow"
          className="ml-4 mt-2.5 h-2.5 w-6 shrink-0 rounded-tl-[6px] border-l-2 border-t-2 border-popover"
        />
        <QuotedMessage
          className="border-l-0 pl-0"
          author={
            replyParent ? resolveAuthorLabel(replyParent, nameFor, viewerId) : null
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
  const attachments =
    message.is_deleted || message.attachment_count === 0 ? null : (
      <MessageAttachments
        channelId={message.channel_id}
        messageId={message.id}
        count={message.attachment_count}
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
        className="ml-1.5 inline-flex items-center gap-1.5 whitespace-nowrap align-baseline text-[12.5px] text-muted-foreground"
      >
        {edited ? <span>{EDITED_MARKER}</span> : null}
        {pinned ? (
          <span className="inline-flex items-center gap-1 text-accent-text">
            <PinGlyph className="h-3.5 w-3.5" />
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

  const body = (
    <MessageRenderer
      message={message}
      viewerId={viewerId}
      isConfirmed={isConfirmed}
      onAct={onAct ?? (() => {})}
      trailing={trailingOnOwnLine ? undefined : trailing}
      muted={isPending || isFailed}
    />
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
   * The action bar: icons over the row's top-right corner (`components.md` §11
   * § Per-message actions).
   *
   * It stays mounted and fades, rather than mounting on a JS `hovered` flag: a
   * keyboard user reaches it through `focus-within` (a mounted-on-hover version
   * was mouse-only), and the row stops re-rendering on every mouse crossing in
   * a virtualized list.
   *
   * - **`opacity-0` is not hidden.** It removes neither hit-testing nor layout,
   *   so without `pointer-events-none` a tap over the corner posts a reaction
   *   the member never saw a control for — and on touch, where `:hover` never
   *   fires, that corner is *all* they can hit. The pointer gate is lifted by
   *   the same variants that lift the opacity.
   * - **It reserves no height.** It is `absolute`, centred on the row's top
   *   edge, so it floats over the gap above the row and the top of the text.
   *   Its fill is opaque so the text under it does not show through.
   *
   * A full-width row has a fixed corner to pin to, which is why this is one
   * `absolute` box. The bubble it replaced had a variable edge, and the cluster
   * needed a zero-height `rtl` flex track to follow it.
   *
   * `:hover`/`:focus-within` reach nothing on a coarse pointer (#1193), so
   * `isTapRevealed` is the third way in, driven by `handleRowTap`.
   */
  const actions = showActions && !isEditing ? (
    <div
      // A labelled group rather than a bare `div`: these controls all act on
      // one message, and without the grouping a screen reader announces
      // "Reply, Save, Edit, Delete" with nothing saying what they belong to —
      // on a virtualized list of them. Not `role="toolbar"`, which would
      // promise arrow-key roving this does not implement.
      role="group"
      aria-label="Message actions"
      className={cn(
        "absolute right-4 top-0 z-10 flex -translate-y-1/2 items-center gap-0.5",
        // Wraps rather than spilling past the row's left edge: on a coarse
        // pointer every icon is 44px, and nine of them (your own message) are
        // wider than a 375px thread, where the scroller would clip the first.
        "max-w-[calc(100%-2rem)] flex-wrap justify-end",
        "rounded-[10px] border border-border bg-card p-0.5",
        "transition-opacity",
        "group-hover/message:pointer-events-auto group-hover/message:opacity-100",
        "group-focus-within/message:pointer-events-auto group-focus-within/message:opacity-100",
        // Coarse-pointer path: a tap on the row sets `isTapRevealed`, since
        // `:hover`/`:focus-within` never fire there. Kept as a JS-driven
        // class rather than a `pointer-coarse:` variant so the same row also
        // works from a stylus or a mouse click, and so "tapping elsewhere
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
      {onToggleBookmark ? (
        <button
          type="button"
          className={cn(ACTION_BAR_BUTTON, isBookmarked && ACTION_BAR_BUTTON_ON)}
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
    </div>
  ) : null;

  /**
   * The inline editor that takes the body's place in the row.
   *
   * In place, not a dialog or popover: it renders where the body was, between
   * the same reply quote and attachment list (`components.md` §11 § Editing (web)).
   * It is the §4 text input at the full width of the body column. The bubble
   * editor this replaced had to fight a circular width, because a `<textarea>`
   * inside a shrink-wrapped bubble sizes itself from its own ~20-character
   * default; the body column has a definite width, so the field just fills it.
   */
  const editForm = (
    <div className="mt-0.5 flex w-full flex-col gap-1.5">
      <Textarea
        autoFocus
        ref={editFieldRef}
        aria-label="Edit message"
        value={editValue}
        onChange={(event) => {
          setEditValue(event.target.value);
          setEditDirty(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            cancelEdit(true);
          }
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void saveEdit(true);
          }
        }}
        disabled={isSavingEdit}
        /*
          Width comes from the column; height comes from the draft.

          `leading-[25px]` matches the body's 16 / 25 type, so the draft wraps
          close to where the message wrapped rather than re-flowing on the way
          in (the field's own padding moves it by a few pixels).

          `field-sizing-content` grows the field with what is typed, so a
          message that rendered as six lines is edited as six lines rather than
          through a porthole. It is a progressive enhancement: an engine
          without `field-sizing` keeps the fixed 60px floor.

          `max-h-40` is the composer's own cap for a growing chat field
          (`COMPOSER_INPUT_CLASS`), and it is an absolute length deliberately:
          this field lives inside the timeline's scroller, which is always
          shorter than the viewport, so a `vh` cap would let a long draft push
          Save and Cancel below the fold on a short window.
        */
        className="field-sizing-content max-h-40 min-h-[60px] resize-none leading-[25px]"
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
          {isSavingEdit ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : null}
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
      <div className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
        {onRetryUnconfirmed ? (
          <button
            type="button"
            disabled={isRetrying}
            className={cn(
              CHIP.base,
              CHIP.neutral,
              CHIP_HIT_AREA,
              "gap-1 disabled:opacity-60",
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
            {isRetrying ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                Retrying…
              </>
            ) : (
              "Retry"
            )}
          </button>
        ) : null}
      </div>
    ) : null;

  return (
    <div
      role="listitem"
      className={cn(
        "group/message relative px-5 pb-0.5",
        showHeader ? "pt-4" : "pt-0.5",
        // Delineation without a bubble (§11): the whole row lifts one surface
        // step under a pointer, with keyboard focus inside it, or once tapped.
        // Pointer feedback, not information, so the ~1.1:1 step is enough.
        "hover:bg-surface-1 focus-within:bg-surface-1",
        isTapRevealed && "bg-surface-1",
      )}
      data-status={message._status}
      data-run={showHeader ? "start" : "follow"}
      onClick={handleRowTap}
    >
      {replyQuote}
      <div className="flex gap-3">
        {/* The 32px gutter, held open on every row of a run. */}
        <div className="w-8 shrink-0">
          {showHeader ? (
            <Avatar className="h-8 w-8" aria-hidden="true">
              {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
              <AvatarFallback>
                {authorName
                  ? initials(authorName)
                  : authorInitialsFallback(message)}
              </AvatarFallback>
            </Avatar>
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
                "flex justify-end whitespace-nowrap text-[12.5px] leading-[25px] text-muted-foreground",
                "opacity-0 group-hover/message:opacity-100 group-focus-within/message:opacity-100",
                isTapRevealed && "opacity-100",
              )}
            >
              {formatTimeOfDayShort(message.created_at, runStartedAt)}
            </time>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          {showHeader ? (
            <div
              data-slot="author-line"
              className="flex min-w-0 items-baseline gap-2 leading-5"
            >
              <span
                className={cn(
                  "truncate text-sm font-semibold",
                  isMine ? "text-accent-text" : "text-foreground",
                )}
              >
                {authorLabel}
              </span>
              <time
                dateTime={message.created_at}
                className="shrink-0 text-[12.5px] text-muted-foreground"
              >
                {formatTimeOfDay(message.created_at)}
              </time>
            </div>
          ) : null}
          {isEditing ? editForm : body}
          {attachments}
          {trailingOnOwnLine && trailing && !isEditing ? (
            <div className="mt-1 leading-5 [&>span]:ml-0">{trailing}</div>
          ) : null}
          {reactions}
          {/*
            The delivery state, under the body. Only this line is a live region,
            and it is mounted empty until it has something to say: a region
            mounted populated would read every row's status aloud on each
            virtualized scroll.
          */}
          <div role="status" aria-live="polite" aria-atomic="true">
            {isPending ? (
              <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                Sending…
              </p>
            ) : null}
            {isUnconfirmed ? (
              <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                {message._error ?? "Not confirmed"}
              </p>
            ) : null}
            {isRecorded ? (
              <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                {message._error ??
                  "Recorded, but the chat card didn't post. Don't run this command again."}
              </p>
            ) : null}
            {isFailed ? (
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[12.5px] text-destructive-text">
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
          {unconfirmedFooter}
        </div>
      </div>
      {actions}
    </div>
  );
}
