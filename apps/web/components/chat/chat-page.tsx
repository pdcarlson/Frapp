"use client";

import { Suspense, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { isChatRoute } from "@/components/layout/shell-layout";
import { ChatProvider } from "@/lib/chat/chat-provider";
import { ChatShell } from "./chat-shell";
import { ChatRouteSkeleton } from "@/components/chat/chat-route-skeleton";
import { CHAT_CHANNEL_PARAM, CHAT_MESSAGE_PARAM } from "@/lib/chat/chat-links";
import type { ChatView } from "@/components/layout/shell-prefs";

/**
 * Reads `?channel=<id>&message=<id>` so a caller (the member directory's
 * Message action, a notification, a command-palette search hit) can
 * navigate here with a channel — and optionally a specific message —
 * pre-selected. `useSearchParams` requires a Suspense boundary (matches
 * `directory-page.tsx`'s `?tab=` pattern).
 *
 * Only a chat URL names chat's target (#3779). The panel stays mounted beside
 * every tool page, and a page's own `?channel=` (`/settings?tab=chat&channel=`
 * is the channel editor's) must not steer it. Off a chat URL the panel keeps the
 * target it last had, so going from a linked message to a tool page does not
 * read as the link being cleared.
 */
function ChatPageContent({
  defaultMembersHidden,
  toolBeside,
  onClose,
  view,
  onViewChange,
}: {
  defaultMembersHidden: boolean;
  toolBeside: boolean;
  onClose?: () => void;
  view: ChatView;
  onViewChange?: (view: ChatView) => void;
}) {
  const searchParams = useSearchParams();
  const onChatUrl = isChatRoute(usePathname());
  const liveChannel = searchParams.get(CHAT_CHANNEL_PARAM);
  const liveMessage = searchParams.get(CHAT_MESSAGE_PARAM);
  const [target, setTarget] = useState({
    channel: onChatUrl ? liveChannel : null,
    message: onChatUrl ? liveMessage : null,
  });
  if (
    onChatUrl &&
    (target.channel !== liveChannel || target.message !== liveMessage)
  ) {
    setTarget({ channel: liveChannel, message: liveMessage });
  }
  const channelParam = target.channel;
  const messageParam = target.message;

  return (
    <ChatProvider>
      <ChatShell
        initialChannelId={channelParam}
        initialMessageId={messageParam}
        defaultMembersHidden={defaultMembersHidden}
        toolBeside={toolBeside}
        onClose={onClose}
        view={view}
        onViewChange={onViewChange}
      />
    </ChatProvider>
  );
}

/**
 * The chat panel's contents, which the dashboard shell hosts beside the open
 * tool page or alone on `/chat` (`dashboard-shell.tsx`, #3779). Mounts the chat hot-path provider
 * (outbox flush + persisted first chunk; the realtime manager is the
 * dashboard shell's, `use-chat-realtime-binding.ts`) and renders the chat
 * shell. The provider lives inside the dashboard tree so it sees the existing
 * QueryClient, api-sdk client, and active chapter id.
 */
export function ChatPage({
  defaultMembersHidden = false,
  toolBeside = false,
  onClose,
  view = "channels",
  onViewChange,
}: {
  /** The member list's remembered state, read by the layout on the server. */
  defaultMembersHidden?: boolean;
  /** Open beside a tool page (`ChatShell`'s prop of the same name). */
  toolBeside?: boolean;
  /** Closes the chat panel (`ChatShell`'s prop of the same name). */
  onClose?: () => void;
  /** Channels or direct messages (`ChatShell`'s prop of the same name). */
  view?: ChatView;
  /** The panel moving to the other list (`ChatShell`'s prop). */
  onViewChange?: (view: ChatView) => void;
} = {}) {
  /*
    This boundary's fallback must never be what the server sends.

    `1s` puts "composer shell" in the 0ms set as "static markup in the RSC
    payload", and `ComposerShell` (#2176) is only focusable before hydration
    because it really is in that payload. A Suspense boundary around a
    `useSearchParams()` consumer is exactly the thing Next.js resolves to its
    fallback on a *static* prerender — which would ship the skeleton instead
    of the shell, and the budget would go quietly back to being hydration-gated
    with every test still green.

    It does not, because `app/(dashboard)/layout.tsx` awaits `cookies()` for the
    nav-collapse and chat preferences, which opts this whole segment into dynamic
    rendering. That is a real dependency between two files that never mention
    each other, and nothing enforces it: if that `cookies()` read ever moves or
    is memoized away, check the `/chat` SSR payload still contains the
    composer's `<textarea>` before assuming this still holds.
  */
  return (
    <Suspense fallback={<ChatRouteSkeleton />}>
      <ChatPageContent
        defaultMembersHidden={defaultMembersHidden}
        toolBeside={toolBeside}
        onClose={onClose}
        view={view}
        onViewChange={onViewChange}
      />
    </Suspense>
  );
}
