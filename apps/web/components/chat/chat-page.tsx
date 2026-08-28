"use client";

import { ChatProvider } from "@/lib/chat/chat-provider";
import { ChatShell } from "./chat-shell";

/**
 * Entry component for the `/chat` route. Mounts the chat hot-path provider
 * (realtime manager + chapter theme + outbox flush) and renders the 3-pane
 * shell. The provider lives inside the dashboard tree so it sees the existing
 * QueryClient, api-sdk client, and active chapter id.
 */
export function ChatPage() {
  return (
    <ChatProvider>
      <ChatShell />
    </ChatProvider>
  );
}
