"use client";

import { useMemo } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MessageItem } from "./message-item";
import type { ChatMessage } from "@/lib/chat/types";

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

  if (!parent) return null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Thread
          </p>
          <p className="text-xs text-muted-foreground">
            Replies stay in this thread; they still appear in the channel.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Close thread"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <ul className="divide-y divide-border/70">
          <MessageItem
            nameFor={nameFor}
            message={parent}
            viewerId={viewerId}
            showHeader
            onReact={onReact}
            onUnreact={onUnreact}
          />
          {replies.length === 0 ? (
            <li className="px-4 py-4 text-xs text-muted-foreground">
              No replies yet. Start the thread.
            </li>
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
              />
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
