"use client";

import { useCallback, useEffect, useRef } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useFrappClient } from "./use-frapp-client";
import {
  CHANNEL_LATEST_MESSAGES_KEY,
  CHANNEL_UNREAD_COUNTS_KEY,
} from "./use-chat";

/**
 * What the chat realtime manager reports about traffic outside the open
 * thread. Structurally `MessageActivity` in
 * `@repo/chat-core/realtime-manager`, which is the source; restated here only
 * because `@repo/hooks` does not depend on chat-core.
 */
export type ChatActivity =
  | {
      type: "message";
      channelId: string;
      senderId: string | null;
      open: boolean;
    }
  | { type: "resync" };

/**
 * How long activity is gathered before it is acted on. A burst (three quick
 * messages, a rejoin plus the rows behind it) becomes one round of reads,
 * and a single message still lands well inside the ~1s the member expects
 * (#3698).
 */
export const CHAT_ACTIVITY_COALESCE_MS = 250;

export interface ChatActivityHandlerOptions {
  queryClient: QueryClient;
  /** `users.id` of the signed-in member, read at the time of each message. */
  viewerId: () => string | null;
  /**
   * Is the member looking at the app right now? A message in an open thread
   * only counts as read while they are.
   */
  isForeground: () => boolean;
  /** `POST /v1/channels/{id}/read`; its result is not read. */
  markRead: (channelId: string) => Promise<unknown>;
  delayMs?: number;
}

export interface ChatActivityHandler {
  handle: (activity: ChatActivity) => void;
  /** Drops anything pending; nothing is read or written after it. */
  dispose: () => void;
}

/**
 * Keeps the per-channel summaries live (#3698): `GET /v1/channels/unread`,
 * which drives every unread badge, the app badge and the rail's bold rows, and
 * `GET /v1/channels/latest`, which orders and previews the Messages screen.
 *
 * - A message from someone else in a thread this client has open, while the
 *   member is looking, re-stamps that channel's read cursor before the
 *   summaries are read again. The thread is on screen, so the message has been
 *   seen; without the stamp the next count would light up the very channel the
 *   member is reading (the cursor was stamped when it opened, before this
 *   message). One stamp per channel per burst, not one per message.
 * - Anything else, and every `resync`, reads both summaries again.
 *
 * Invalidates those two keys exactly, never the `["channels"]` prefix, which
 * would also re-read the channel list, its categories and every open channel's
 * detail on every message in the chapter.
 */
export function createChatActivityHandler(
  options: ChatActivityHandlerOptions,
): ChatActivityHandler {
  const delayMs = options.delayMs ?? CHAT_ACTIVITY_COALESCE_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let refresh = false;
  const stamps = new Set<string>();
  let disposed = false;

  const flush = async () => {
    timer = null;
    const toStamp = [...stamps];
    stamps.clear();
    const shouldRefresh = refresh || toStamp.length > 0;
    refresh = false;
    // A failed stamp still re-reads: the count is then the server's honest
    // answer, which is better than a badge left stale.
    await Promise.allSettled(toStamp.map((id) => options.markRead(id)));
    if (disposed || !shouldRefresh) return;
    void options.queryClient.invalidateQueries({
      queryKey: CHANNEL_UNREAD_COUNTS_KEY,
      exact: true,
    });
    void options.queryClient.invalidateQueries({
      queryKey: CHANNEL_LATEST_MESSAGES_KEY,
      exact: true,
    });
  };

  const handle = (activity: ChatActivity) => {
    if (disposed) return;
    if (activity.type === "resync") {
      refresh = true;
    } else {
      const viewerId = options.viewerId();
      const fromSomeoneElse =
        activity.senderId !== null && activity.senderId !== viewerId;
      if (activity.open && fromSomeoneElse && options.isForeground()) {
        stamps.add(activity.channelId);
      } else {
        refresh = true;
      }
    }
    timer ??= setTimeout(() => void flush(), delayMs);
  };

  const dispose = () => {
    disposed = true;
    if (timer) clearTimeout(timer);
    timer = null;
    stamps.clear();
    refresh = false;
  };

  return { handle, dispose };
}

/**
 * {@link createChatActivityHandler} bound to the app's query and API clients,
 * as the `onMessageActivity` both clients configure the realtime manager with.
 *
 * The returned function keeps its identity for the life of the component, so
 * a `configure` effect keyed on it doesn't re-run per render; the viewer and
 * the foreground check are read through refs at the time of each message.
 */
export function useChatActivityHandler(
  viewerId: string | null,
  isForeground: () => boolean,
): (activity: ChatActivity) => void {
  const queryClient = useQueryClient();
  const client = useFrappClient();
  const viewerRef = useRef(viewerId);
  const foregroundRef = useRef(isForeground);
  useEffect(() => {
    viewerRef.current = viewerId;
    foregroundRef.current = isForeground;
  }, [viewerId, isForeground]);

  const handlerRef = useRef<ChatActivityHandler | null>(null);
  useEffect(() => {
    const handler = createChatActivityHandler({
      queryClient,
      viewerId: () => viewerRef.current,
      isForeground: () => foregroundRef.current(),
      markRead: async (id) => {
        const { error } = await client.POST("/v1/channels/{id}/read", {
          params: { path: { id } },
        });
        if (error) throw error;
      },
    });
    handlerRef.current = handler;
    return () => {
      handler.dispose();
      if (handlerRef.current === handler) handlerRef.current = null;
    };
  }, [queryClient, client]);
  // Activity reported before the effect above has run is dropped: the
  // summaries it would refresh are being read for the first time anyway.
  return useCallback(
    (activity: ChatActivity) => handlerRef.current?.handle(activity),
    [],
  );
}
