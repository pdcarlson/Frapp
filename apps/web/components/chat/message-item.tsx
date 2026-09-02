"use client";

import { useState } from "react";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { CHIP, CHIP_HIT_AREA } from "./chip";
import { PinGlyph, ThreadGlyph } from "./chat-glyphs";
import { ReactionChips, ReactionQuickPick } from "./reaction-bar";
import { MessageAttachments } from "./message-attachments";
import { MessageRenderer, rendersAsBubble } from "./renderers";
import type { ChatMessage } from "@repo/chat-core/types";
import {
  authorInitialsFallback,
  resolveAuthorLabel,
  resolveAuthorName,
} from "@repo/hooks";
import { formatClock } from "@repo/formatting";
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
  viewerId: string | null;
  showHeader: boolean;
  /**
   * Resolves a `users.id` to a display name, or `null` when unresolvable.
   * Required rather than optional so a caller cannot silently regress the row to
   * a truncated uuid by forgetting it.
   */
  nameFor: (userId: string) => string | null;
  onReact: (messageId: string, emoji: string) => void;
  onUnreact: (messageId: string, emoji: string) => void;
  onOpenThread?: (message: ChatMessage) => void;
  onRetry?: (clientMessageId: string) => void;
  onDiscard?: (clientMessageId: string) => void;
  /**
   * Own messages only, and only the plain-text bubble kind — a card
   * (poll, task, event…) has no free-text `content` a member typed, so
   * there's nothing sensible to edit. Rejects on failure; the row stays in
   * edit mode so the draft isn't lost (the rejection itself already raised
   * a toast, from inside the action this callback wraps).
   */
  onEdit?: (messageId: string, content: string) => Promise<void>;
  /** Own message, or any message when the viewer holds `channels:manage`. */
  onDelete?: (messageId: string) => void;
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
 * A single message row, in the two shapes `components.md` §11 draws.
 *
 * **Incoming:** 32px avatar leading, `Name · time` caption *above* the bubble
 * and indented 4px, content capped at 86% of the thread column.
 *
 * **Self:** right-aligned, no avatar, and the caption moves *below* the bubble
 * — where it also carries the delivery state, which is why the pending/failed
 * region is that same line rather than a third row under it ("5:16 PM · read"
 * is the drawn example; §11's TODO-DESIGN names this line as the place the
 * undrawn pending and failed states go).
 *
 * The sided layout applies to **bubbles only**. A rich card (poll, task, event,
 * audit…) is a card in the flow, not a bubble, so it keeps the avatar-and-meta
 * shape whoever sent it — §11 specs bubbles, and panel 4e draws the one card it
 * has in the flow rather than sided.
 *
 * The viewer identity comes from the session (`viewerId`); the row never
 * trusts a literal sender id for "this is mine" comparisons.
 */
export function MessageItem({
  message,
  avatarUrl,
  viewerId,
  showHeader,
  nameFor,
  onReact,
  onUnreact,
  onOpenThread,
  onRetry,
  onDiscard,
  onAct,
  onEdit,
  onDelete,
  canManageChannel,
  isTapRevealed,
  onToggleTapReveal,
}: MessageItemProps) {
  const isMine = !!viewerId && message.sender_id === viewerId;
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
  // Reactions and threads operate on the *server* id (the chat actions
  // endpoint requires a real chat_messages.id, threads need a stable
  // parent id) — gate the hover affordances on a confirmed status so we
  // never act on a placeholder id.
  const isConfirmed = message._status === "confirmed";
  const selfBubble = isMine && rendersAsBubble(message);
  const showActions = !message.is_deleted && isConfirmed;
  // Edit is server-enforced own-only (no `channels:manage` override, unlike
  // delete) and only makes sense for the plain-text bubble kind — `selfBubble`
  // already encodes both halves of that.
  const canEdit = selfBubble && !!onEdit;
  const canDelete = (isMine || !!canManageChannel) && !!onDelete;

  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(message.content);
  const [editDirty, setEditDirty] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

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

  function startEdit() {
    setEditValue(message.content);
    setEditDirty(false);
    setIsEditing(true);
  }

  function cancelEdit() {
    setIsEditing(false);
  }

  async function saveEdit() {
    const trimmed = editValue.trim();
    if (trimmed.length === 0 || !onEdit) return;
    setIsSavingEdit(true);
    try {
      await onEdit(message.id, trimmed);
      setIsEditing(false);
    } catch {
      // The action already toasted; stay in edit mode so the draft survives.
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
   *   Finishing a text selection inside *this* bubble with a lift-off (which
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
      event.target.closest(
        "button, a, input, textarea, select, [role='button']",
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
    onToggleTapReveal();
  }

  const renderer = (
    <>
      <MessageRenderer
        message={message}
        viewerId={viewerId}
        isSelf={isMine}
        isConfirmed={isConfirmed}
        onAct={onAct ?? (() => {})}
      />
      {/*
        Attachments render under the body for every kind, not inside the text
        renderer: a file is a property of the message, not of how its body is
        drawn, and a deleted message must not offer downloads of what it used to
        carry. The component itself no-ops on a zero count, so this costs nothing
        for the overwhelming majority of messages.
      */}
      {message.is_deleted || message.attachment_count === 0 ? null : (
        <MessageAttachments
          channelId={message.channel_id}
          messageId={message.id}
          count={message.attachment_count}
        />
      )}
    </>
  );

  // Deleted content has nothing left to react to. Reaction rows for a message
  // are never deleted server-side (only the message's own content/metadata
  // are), so without this a deleted row would keep showing its old chips as
  // still-live react/unreact targets — the Delete button added here is the
  // first UI path that can set `is_deleted` on a message a viewer is looking
  // at without a reload, so this case was unreachable before.
  const reactions = message.is_deleted ? null : (
    <ReactionChips
      reactions={message.reactions}
      viewerId={viewerId}
      align={selfBubble ? "end" : "start"}
      onReact={(emoji) => onReact(message.id, emoji)}
      onUnreact={(emoji) => onUnreact(message.id, emoji)}
    />
  );

  /*
   * Hover affordances stay mounted and fade, rather than mounting on a JS
   * `hovered` flag: a keyboard user reaches them through `focus-within` (the
   * mounted version was mouse-only), and the row stops re-rendering on every
   * mouse crossing in a virtualized list.
   *
   * Two things that has to get right, and the first cut got wrong:
   *
   * - **`opacity-0` is not hidden.** It removes neither hit-testing nor layout.
   *   Without `pointer-events-none` a tap on the blank strip under a bubble
   *   posts a reaction the member never saw a control for — and on touch, where
   *   `:hover` never fires, that strip is *all* they can hit. The pointer gate
   *   is lifted by the same two variants that lift the opacity.
   * - **It must not reserve space.** In flow, every confirmed message grew a
   *   permanent ~32px strip, which is most of the compactness the 5-minute
   *   grouping exists to buy. It is absolutely positioned against the row
   *   instead, on the side away from the bubble's tail.
   *
   * `:hover`/`:focus-within` still reach nothing on a coarse pointer, which
   * left the cluster genuinely unreachable there (#1193) — `isTapRevealed`
   * below is the third way in, driven by `handleRowTap`.
   */
  const actions =
    showActions && !isEditing ? (
      <div
        className={cn(
          "absolute top-0 z-10 flex items-center gap-1.5 rounded-sm bg-background p-1",
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
          selfBubble ? "left-5" : "right-5",
        )}
      >
        <ReactionQuickPick
          reactions={message.reactions}
          viewerId={viewerId}
          onReact={(emoji) => onReact(message.id, emoji)}
          onUnreact={(emoji) => onUnreact(message.id, emoji)}
        />
        {onOpenThread ? (
          <button
            type="button"
            className={cn(CHIP.base, CHIP.neutral, CHIP_HIT_AREA, "gap-1")}
            onClick={() => onOpenThread(message)}
          >
            <ThreadGlyph className="h-3.5 w-3.5" />
            Reply
          </button>
        ) : null}
        {canEdit ? (
          <button
            type="button"
            className={cn(CHIP.base, CHIP.neutral, CHIP_HIT_AREA, "gap-1")}
            onClick={startEdit}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            Edit
          </button>
        ) : null}
        {canDelete ? (
          <button
            type="button"
            className={cn(CHIP.base, CHIP.neutral, CHIP_HIT_AREA, "gap-1")}
            onClick={() => onDelete?.(message.id)}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            Delete
          </button>
        ) : null}
      </div>
    ) : null;

  const editForm = (
    <div className="flex w-full flex-col gap-1.5 rounded-lg border border-border bg-card p-2">
      <Textarea
        autoFocus
        value={editValue}
        onChange={(event) => {
          setEditValue(event.target.value);
          setEditDirty(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            cancelEdit();
          }
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void saveEdit();
          }
        }}
        disabled={isSavingEdit}
        className="min-h-[60px] resize-none"
      />
      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          className={cn(CHIP.base, CHIP.neutral, CHIP_HIT_AREA)}
          onClick={cancelEdit}
          disabled={isSavingEdit}
        >
          Cancel
        </button>
        <button
          type="button"
          className={cn(CHIP.base, CHIP.neutral, CHIP_HIT_AREA, "gap-1")}
          onClick={() => void saveEdit()}
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

  if (selfBubble) {
    return (
      <div
        role="listitem"
        className={cn(
          "group/message relative flex flex-col items-end px-5 pb-1",
          showHeader ? "pt-4" : "pt-1",
        )}
        data-status={message._status}
        onClick={handleRowTap}
      >
        <div className="flex max-w-[86%] flex-col items-end">
          {isEditing ? editForm : renderer}
          {reactions}
          {actions}
          {/*
            The self caption and the delivery state are one line, per §11 —
            but only the *state* half is a live region. Wrapping the timestamp
            in one too made every self row mount a populated `aria-live` node,
            and in a virtualized list that reads the clock aloud on every scroll.
            A live region should be mounted and empty until it has something to
            say.
          */}
          <div className="mr-1 mt-1 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
            <span>{formatClock(message.created_at)}</span>
            {message.edited_at ? <span>· edited</span> : null}
            {message.is_pinned ? (
              <span className="inline-flex items-center gap-1 text-accent-text">
                <PinGlyph className="h-3.5 w-3.5" />
                Pinned
              </span>
            ) : null}
            <span role="status" aria-live="polite" aria-atomic="true">
              {isPending ? (
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden="true">·</span>
                  <Loader2
                    className="h-3 w-3 animate-spin"
                    aria-hidden="true"
                  />
                  sending
                </span>
              ) : null}
              {isFailed ? (
                <span className="text-destructive-text">
                  · {message._error ?? "Send failed"}
                </span>
              ) : null}
            </span>
          </div>
          {isFailed ? (
            <div className="mt-1 flex items-center gap-1.5">
              {onRetry ? (
                <button
                  type="button"
                  className={cn(
                    CHIP.base,
                    CHIP.neutral,
                    CHIP_HIT_AREA,
                    "gap-1",
                  )}
                  onClick={() => onRetry(message.client_message_id)}
                >
                  Retry
                </button>
              ) : null}
              {onDiscard ? (
                <button
                  type="button"
                  className={cn(
                    CHIP.base,
                    CHIP.neutral,
                    CHIP_HIT_AREA,
                    "gap-1",
                  )}
                  onClick={() => onDiscard(message.client_message_id)}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Discard
                </button>
              ) : null}
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
        "group/message relative flex gap-2.5 px-5 pb-1",
        showHeader ? "pt-4" : "pt-1",
      )}
      data-status={message._status}
      onClick={handleRowTap}
    >
      {/* 32px avatar + 10px gap, s05. The gutter is held open on grouped rows. */}
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
        ) : null}
      </div>
      <div className="flex min-w-0 max-w-[86%] flex-col items-start">
        {showHeader ? (
          <div className="ml-1 flex items-baseline gap-2 text-[12.5px] text-muted-foreground">
            <span className="font-semibold text-muted-foreground">
              {authorLabel}
            </span>
            <span aria-hidden="true">·</span>
            <span>{formatClock(message.created_at)}</span>
            {message.edited_at ? <span>(edited)</span> : null}
            {message.is_pinned ? (
              <Badge variant="outline" className="h-6 gap-1 px-2">
                <PinGlyph className="h-3.5 w-3.5" /> Pinned
              </Badge>
            ) : null}
          </div>
        ) : null}
        {renderer}
        {reactions}
        {actions}
        <div role="status" aria-live="polite" aria-atomic="true">
          {isPending ? (
            <p className="ml-1 mt-1 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              Sending…
            </p>
          ) : null}
          {isFailed ? (
            <div className="ml-1 mt-1 flex items-center gap-2 text-[12.5px] text-destructive-text">
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
                  className={cn(
                    CHIP.base,
                    CHIP.neutral,
                    CHIP_HIT_AREA,
                    "gap-1",
                  )}
                  onClick={() => onDiscard(message.client_message_id)}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Discard
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
