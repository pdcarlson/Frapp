"use client";

import { useState } from "react";
import {
  AlertCircle,
  CornerUpRight,
  Loader2,
  Pin as PinIcon,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ReactionChips, ReactionQuickPick } from "./reaction-bar";
import { MessageRenderer } from "./renderers";
import type { ChatMessage } from "@repo/chat-core/types";
import { formatClock } from "@repo/formatting";
import { initials } from "@/lib/utils";

export interface MessageItemProps {
  message: ChatMessage;
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
  /** Card action invoker (Vote, RSVP, …). Required for kinds like `poll`. */
  onAct?: (
    messageId: string,
    actionType: string,
    payload: Record<string, unknown>,
  ) => void;
}

/**
 * A single message row. Renders with semantic interactives only — every
 * action is a `<button>`; reaction chips report `aria-pressed`; failed-send
 * recovery (Retry / Discard) is explicit.
 *
 * The viewer identity comes from the session (`viewerId`); the row never
 * trusts a literal sender id for "this is mine" comparisons.
 */
export function MessageItem({
  message,
  viewerId,
  showHeader,
  nameFor,
  onReact,
  onUnreact,
  onOpenThread,
  onRetry,
  onDiscard,
  onAct,
}: MessageItemProps) {
  const [hovered, setHovered] = useState(false);
  const isMine = !!viewerId && message.sender_id === viewerId;
  // Resolved for every sender including the viewer: the label says "You" for your
  // own row, but the avatar still needs your initials — falling through to a uuid
  // slice there would draw `11` next to "You" beside `AC` next to "Alice Chen".
  const authorName = nameFor(message.sender_id);
  const isPending = message._status === "pending";
  const isFailed = message._status === "failed";
  // Reactions and threads operate on the *server* id (the chat actions
  // endpoint requires a real chat_messages.id, threads need a stable
  // parent id) — gate the hover affordances on a confirmed status so we
  // never act on a placeholder id.
  const isConfirmed = message._status === "confirmed";

  return (
    <li
      className="group/message relative flex gap-3 px-4 py-1 hover:bg-accent/30"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      data-status={message._status}
    >
      <div className="w-9 shrink-0">
        {showHeader ? (
          <div
            className="mt-1 flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary"
            aria-hidden="true"
          >
            {authorName
              ? initials(authorName)
              : message.sender_id.slice(0, 2).toUpperCase()}
          </div>
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        {showHeader ? (
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold">
              {isMine
                ? "You"
                : // Truthy, not `??`: the resolver's contract is that an unset
                  // name comes back null, but a stray "" must degrade to the id
                  // rather than render a blank label next to uuid initials.
                  authorName || `Member ${message.sender_id.slice(0, 6)}`}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {formatClock(message.created_at)}
            </span>
            {message.edited_at ? (
              <span className="text-[11px] text-muted-foreground">
                (edited)
              </span>
            ) : null}
            {message.is_pinned ? (
              <Badge variant="outline" className="gap-1 text-[10px]">
                <PinIcon className="h-3 w-3" /> Pinned
              </Badge>
            ) : null}
          </div>
        ) : null}
        <MessageRenderer
          message={message}
          viewerId={viewerId}
          isSelf={isMine}
          isConfirmed={isConfirmed}
          onAct={onAct ?? (() => {})}
        />

        <ReactionChips
          reactions={message.reactions}
          viewerId={viewerId}
          onReact={(emoji) => onReact(message.id, emoji)}
          onUnreact={(emoji) => onUnreact(message.id, emoji)}
        />
        {hovered && !message.is_deleted && isConfirmed ? (
          <div className="mt-1 flex items-center gap-1">
            <ReactionQuickPick
              reactions={message.reactions}
              viewerId={viewerId}
              onReact={(emoji) => onReact(message.id, emoji)}
              onUnreact={(emoji) => onUnreact(message.id, emoji)}
            />
            {onOpenThread ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => onOpenThread(message)}
              >
                <CornerUpRight className="h-3 w-3" /> Reply
              </Button>
            ) : null}
          </div>
        ) : null}
        <div role="status" aria-live="polite" aria-atomic="true">
          {isPending ? (
            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />{" "}
              Sending…
            </p>
          ) : null}
          {isFailed ? (
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-destructive">
              <AlertCircle className="h-3 w-3" aria-hidden="true" />
              <span>{message._error ?? "Send failed"}</span>
              {onRetry ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => onRetry(message.client_message_id)}
                >
                  <RefreshCw className="h-3 w-3" /> Retry
                </Button>
              ) : null}
              {onDiscard ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => onDiscard(message.client_message_id)}
                >
                  <Trash2 className="h-3 w-3" /> Discard
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}
