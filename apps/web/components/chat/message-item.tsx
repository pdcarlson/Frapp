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
import type { ChatMessage } from "@/lib/chat/types";

function formatClock(value: string | null | undefined): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  });
}

export interface MessageItemProps {
  message: ChatMessage;
  viewerId: string | null;
  showHeader: boolean;
  onReact: (messageId: string, emoji: string) => void;
  onUnreact: (messageId: string, emoji: string) => void;
  onOpenThread?: (message: ChatMessage) => void;
  onRetry?: (clientMessageId: string) => void;
  onDiscard?: (clientMessageId: string) => void;
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
  onReact,
  onUnreact,
  onOpenThread,
  onRetry,
  onDiscard,
}: MessageItemProps) {
  const [hovered, setHovered] = useState(false);
  const isMine = !!viewerId && message.sender_id === viewerId;
  const isPending = message._status === "pending";
  const isFailed = message._status === "failed";
  const isSelfBubble = isMine;

  return (
    <li
      className="group/message relative flex gap-3 px-4 py-1 hover:bg-muted/30"
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
            {message.sender_id.slice(0, 2).toUpperCase()}
          </div>
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        {showHeader ? (
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold">
              {isMine ? "You" : `Member ${message.sender_id.slice(0, 6)}`}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {formatClock(message.created_at)}
            </span>
            {message.edited_at ? (
              <span className="text-[11px] text-muted-foreground">(edited)</span>
            ) : null}
            {message.is_pinned ? (
              <Badge variant="outline" className="gap-1 text-[10px]">
                <PinIcon className="h-3 w-3" /> Pinned
              </Badge>
            ) : null}
          </div>
        ) : null}
        <div
          className={`mt-0.5 inline-block max-w-full whitespace-pre-wrap break-words text-sm ${
            message.is_deleted ? "italic text-muted-foreground" : ""
          } ${
            isSelfBubble && !message.is_deleted
              ? "rounded-md bg-[color:var(--chat-self-bubble,theme(colors.primary.50))] px-2 py-1"
              : ""
          }`}
        >
          {message.is_deleted ? "[message deleted]" : message.content}
        </div>
        <ReactionChips
          reactions={message.reactions}
          viewerId={viewerId}
          onReact={(emoji) => onReact(message.id, emoji)}
          onUnreact={(emoji) => onUnreact(message.id, emoji)}
        />
        {hovered && !message.is_deleted ? (
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
        {isPending ? (
          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Sending…
          </p>
        ) : null}
        {isFailed ? (
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-destructive">
            <AlertCircle className="h-3 w-3" />
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
    </li>
  );
}
