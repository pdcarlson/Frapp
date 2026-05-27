"use client";

import { useMemo, useRef } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/shared/async-states";
import { MessageItem } from "./message-item";
import type { ChatMessage } from "@/lib/chat/types";

const GROUPING_GAP_MS = 5 * 60 * 1000;

export interface MessageTimelineProps {
  messages: ChatMessage[];
  viewerId: string | null;
  isLoading: boolean;
  loadError: Error | null;
  onRetryLoad?: () => void;
  onReact: (messageId: string, emoji: string) => void;
  onUnreact: (messageId: string, emoji: string) => void;
  onOpenThread?: (message: ChatMessage) => void;
  onRetry?: (clientMessageId: string) => void;
  onDiscard?: (clientMessageId: string) => void;
  onAct?: (
    messageId: string,
    actionType: string,
    payload: Record<string, unknown>,
  ) => void;
}

/**
 * Virtualized message timeline. Messages within 5 minutes from the same author
 * collapse their header (Slack-style grouping). Empty / loading / error all
 * render explicit states — never a blank pane.
 */
export function MessageTimeline({
  messages,
  viewerId,
  isLoading,
  loadError,
  onRetryLoad,
  onReact,
  onUnreact,
  onOpenThread,
  onRetry,
  onDiscard,
  onAct,
}: MessageTimelineProps) {
  const virtuoso = useRef<VirtuosoHandle | null>(null);

  // Precompute "showHeader" so we don't recompute per render in the renderer.
  const decorated = useMemo(() => {
    return messages.map((message, index) => {
      const prev = messages[index - 1];
      const sameAuthor =
        !!prev && prev.sender_id === message.sender_id && !prev.is_deleted;
      const within =
        !!prev &&
        new Date(message.created_at).getTime() -
          new Date(prev.created_at).getTime() <
          GROUPING_GAP_MS;
      return { message, showHeader: !(sameAuthor && within) };
    });
  }, [messages]);

  if (isLoading) {
    return <LoadingState message="Loading messages…" />;
  }
  if (loadError) {
    return (
      <ErrorState
        title="Couldn't load messages"
        description={loadError.message || "Retry in a moment."}
        onRetry={onRetryLoad}
      />
    );
  }
  if (messages.length === 0) {
    return (
      <EmptyState
        title="Be the first to post"
        description="Send a message to kick off the conversation. It will stream live to everyone in this channel."
      />
    );
  }

  return (
    <div className="h-full">
      <Virtuoso
        ref={virtuoso}
        data={decorated}
        followOutput="smooth"
        initialTopMostItemIndex={Math.max(decorated.length - 1, 0)}
        itemContent={(_, entry) => (
          <MessageItem
            message={entry.message}
            viewerId={viewerId}
            showHeader={entry.showHeader}
            onReact={onReact}
            onUnreact={onUnreact}
            onOpenThread={onOpenThread}
            onRetry={onRetry}
            onDiscard={onDiscard}
            onAct={onAct}
          />
        )}
        computeItemKey={(_, entry) =>
          entry.message.client_message_id ?? entry.message.id
        }
      />
    </div>
  );
}
