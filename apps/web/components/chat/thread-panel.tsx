"use client";

import { useEffect, useMemo, useRef } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MessageItem } from "./message-item";
import { useTapRevealedMessage } from "@/hooks/use-tap-revealed-message";
import type { ChatMessage } from "@repo/chat-core/types";
import { useAuthorAvatars } from "@repo/hooks";

interface ThreadPanelProps {
  channelId: string;
  parent: ChatMessage | null;
  /** All messages in the channel — the panel filters by `reply_to_id`. */
  allMessages: ChatMessage[];
  viewerId: string | null;
  /** Resolves `users.id` → display name; `null` when unresolvable. */
  nameFor: (userId: string) => string | null;
  onClose: () => void;
  onReact: (messageId: string, emoji: string) => void;
  onUnreact: (messageId: string, emoji: string) => void;
}

/**
 * Right-pane thread / details view. Renders the parent message and its
 * replies (rows whose `reply_to_id` matches the parent id). When no thread
 * is open, the parent shell renders a details placeholder instead — see
 * `chat-shell.tsx`.
 */
export function ThreadPanel({
  channelId,
  parent,
  allMessages,
  viewerId,
  nameFor,
  onClose,
  onReact,
  onUnreact,
}: ThreadPanelProps) {
  const replies = useMemo(() => {
    if (!parent) return [];
    return allMessages.filter((message) => message.reply_to_id === parent.id);
  }, [allMessages, parent]);

  // One batched request for the parent's avatar plus every distinct reply
  // author's, rather than one per row (#1231) — same pattern as the centre
  // timeline, a separate list here.
  const avatars = useAuthorAvatars(
    channelId,
    parent ? [parent, ...replies] : [],
  );

  // Own reveal state, separate from the centre timeline's: this panel is a
  // different list, and "tapping elsewhere dismisses this" only needs to
  // hold within one list (#1193).
  const tapRevealed = useTapRevealedMessage();

  // Focus moves into the panel whenever a (new) thread opens — this is a
  // persistent aside, not a dialog, so nothing does that for free the way
  // Radix does for the slash palette. `chat-shell.tsx` restores focus to
  // whatever triggered the open (the row's Reply control, most often) once
  // `onClose` fires, whether that's this button or Escape below.
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (parent) closeButtonRef.current?.focus();
    // Keyed on the parent's identity, not the object: an edit or a reaction
    // lands a new `parent` reference on every render of an already-open
    // thread, and re-stealing focus back to the close button on each of
    // those would fight whatever the member is doing inside the panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parent?.id]);

  if (!parent) return null;

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      onKeyDown={(event) => {
        // `event.defaultPrevented` is the guard: Radix's `DismissableLayer`
        // (the emoji-reaction popover a row renders via `ReactionQuickPick`)
        // closes itself on Escape through a document-level listener that
        // calls `preventDefault()` but not `stopPropagation()`, so the same
        // keydown still reaches here afterward. Without this check, Escape
        // meant only to dismiss that popover also closed the whole thread.
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="flex items-start justify-between gap-2 border-b border-border px-3 py-3">
        <div className="min-w-0">
          <p className="text-[12.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Thread
          </p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Replies stay in this thread; they still appear in the channel.
          </p>
        </div>
        <Button
          ref={closeButtonRef}
          variant="ghost"
          size="icon"
          aria-label="Close thread"
          onClick={onClose}
        >
          <X className="h-5 w-5" />
        </Button>
      </div>
      {/*
        `bg-background`, not the rail's `--surface-1`. `MessageItem` renders the
        §11 incoming bubble at `--card` with a hairline, and `--card` on
        `--surface-1` is 1.08:1 — the bubble would be invisible here even though
        the centre pane was fixed for exactly this reason. Wherever a message
        renders, the surface under it is the app floor.
      */}
      <div className="min-h-0 flex-1 overflow-y-auto bg-background py-1">
        {/*
          `divide-border/70` was an alpha on an alpha: `--border` is already
          `rgba(255,255,255,.08)`, so the modifier composited it to ~.056 —
          below the hairline foundations §3 fixes, and invisible on
          `--surface-1`.
        */}
        <div role="list" className="divide-y divide-border">
          <MessageItem
            nameFor={nameFor}
            message={parent}
            avatarUrl={
              parent.author_avatar_path
                ? avatars.data?.[parent.author_avatar_path]
                : undefined
            }
            viewerId={viewerId}
            showHeader
            onReact={onReact}
            onUnreact={onUnreact}
            isTapRevealed={tapRevealed.isRevealed(parent)}
            onToggleTapReveal={() => tapRevealed.toggle(parent)}
          />
          {replies.length === 0 ? (
            <p className="px-5 py-4 text-[12.5px] text-muted-foreground">
              No replies yet. Start the thread.
            </p>
          ) : (
            replies.map((message) => (
              <MessageItem
                nameFor={nameFor}
                key={message.client_message_id}
                message={message}
                avatarUrl={
                  message.author_avatar_path
                    ? avatars.data?.[message.author_avatar_path]
                    : undefined
                }
                viewerId={viewerId}
                showHeader
                onReact={onReact}
                onUnreact={onUnreact}
                isTapRevealed={tapRevealed.isRevealed(message)}
                onToggleTapReveal={() => tapRevealed.toggle(message)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
