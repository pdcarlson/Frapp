"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ChatProvider } from "@/lib/chat/chat-provider";
import { ChatShell } from "./chat-shell";
import { LoadingState } from "@/components/shared/async-states";
import { CHAT_CHANNEL_PARAM, CHAT_MESSAGE_PARAM } from "@/lib/chat/chat-links";

/**
 * Reads `?channel=<id>&message=<id>` so a caller (the member directory's
 * Message action, a notification, a command-palette search hit) can
 * navigate here with a channel — and optionally a specific message —
 * pre-selected. `useSearchParams` requires a Suspense boundary (matches
 * `directory-page.tsx`'s `?tab=` pattern).
 */
function ChatPageContent() {
  const searchParams = useSearchParams();
  const channelParam = searchParams.get(CHAT_CHANNEL_PARAM);
  const messageParam = searchParams.get(CHAT_MESSAGE_PARAM);

  return (
    <ChatProvider>
      <ChatShell
        initialChannelId={channelParam}
        initialMessageId={messageParam}
      />
    </ChatProvider>
  );
}

/**
 * Entry component for the `/chat` route. Mounts the chat hot-path provider
 * (realtime manager + chapter theme + outbox flush) and renders the 3-pane
 * shell. The provider lives inside the dashboard tree so it sees the existing
 * QueryClient, api-sdk client, and active chapter id.
 */
export function ChatPage() {
  return (
    <Suspense fallback={<LoadingState message="Loading chat..." />}>
      <ChatPageContent />
    </Suspense>
  );
}
