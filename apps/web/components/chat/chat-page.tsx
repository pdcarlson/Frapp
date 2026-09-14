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
  /*
    This boundary's fallback must never be what the server sends.

    `1s` puts "composer shell" in the 0ms set as "static markup in the RSC
    payload", and `ComposerShell` (#2176) is only focusable before hydration
    because it really is in that payload. A Suspense boundary around a
    `useSearchParams()` consumer is exactly the thing Next.js resolves to its
    fallback on a *static* prerender — which would ship `LoadingState` instead
    of the shell, and the budget would go quietly back to being hydration-gated
    with every test still green.

    It does not, because `app/(dashboard)/layout.tsx` awaits `cookies()` for the
    nav-collapse preference, which opts this whole segment into dynamic
    rendering. That is a real dependency between two files that never mention
    each other, and nothing enforces it: if that `cookies()` read ever moves or
    is memoized away, check the `/chat` SSR payload still contains the
    composer's `<textarea>` before assuming this still holds.
  */
  return (
    <Suspense fallback={<LoadingState message="Loading chat..." />}>
      <ChatPageContent />
    </Suspense>
  );
}
