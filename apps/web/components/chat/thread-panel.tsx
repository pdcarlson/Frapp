"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MessageItem } from "./message-item";
import type { ChatMessage } from "@repo/chat-core/types";

interface ThreadPanelProps {
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

  // Own reveal state, separate from the centre timeline's: this panel is a
  // different list, and "tapping elsewhere dismisses this" only needs to
  // hold within one list (#1193).
  const [tapRevealedId, setTapRevealedId] = useState<string | null>(null);

  if (!parent) return null;

  return (
    <div className="flex h-full min-h-0 flex-col">
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
            viewerId={viewerId}
            showHeader
            onReact={onReact}
            onUnreact={onUnreact}
            isTapRevealed={
              tapRevealedId === (parent.client_message_id ?? parent.id)
            }
            onToggleTapReveal={() => {
              const id = parent.client_message_id ?? parent.id;
              setTapRevealedId((current) => (current === id ? null : id));
            }}
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
                viewerId={viewerId}
                showHeader
                onReact={onReact}
                onUnreact={onUnreact}
                isTapRevealed={
                  tapRevealedId ===
                  (message.client_message_id ?? message.id)
                }
                onToggleTapReveal={() => {
                  const id = message.client_message_id ?? message.id;
                  setTapRevealedId((current) => (current === id ? null : id));
                }}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
