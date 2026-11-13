"use client";

import { useCallback, useEffect, useRef } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useFrappClient } from "./use-frapp-client";
import { isChannelHeldUnread, trackActivityStamping } from "./read-cursor";
import { invalidateChannelSummaries } from "./use-chat";

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
    }
  | { type: "resync" };

/**
 * How long activity is gathered before it is acted on. A burst (three quick
 * messages, a rejoin plus the rows behind it) becomes one round of reads,
 * and a single message still lands well inside the ~1s the member expects
 * (#3698).
 */
export const CHAT_ACTIVITY_COALESCE_MS = 250;

/*
  The channel a thread screen is showing right now, process-wide.

  Not "subscribed": a mobile thread stays mounted and subscribed under a screen
  pushed over it (another thread, an event), and a message there is not on
  screen. Each thread claims this on focus (mobile's `useFocusEffect`) or while
  it is the active channel (web), and releases it on blur. A newer claim wins,
  and a stale release can't clear it.
*/
let viewedChannel: { channelId: string; token: symbol } | null = null;

/**
 * Says `channelId` is the thread on screen until the returned release runs.
 * Call it where the thread stamps its read cursor on focus, and release where
 * it stamps again on blur.
 */
export function claimViewedChannel(channelId: string): () => void {
  const token = Symbol(channelId);
  viewedChannel = { channelId, token };
  return () => {
    if (viewedChannel?.token === token) viewedChannel = null;
  };
}

/** The channel a thread screen has claimed, or `null`. */
export function viewedChannelId(): string | null {
  return viewedChannel?.channelId ?? null;
}

export interface ChatActivityHandlerOptions {
  queryClient: QueryClient;
  /** `users.id` of the signed-in member, read at the time of each message. */
  viewerId: () => string | null;
  /**
   * The channel the member is looking at right now (its thread on screen, and
   * the app or tab in front of them), or `null`. Only there does a message
   * count as read.
   */
  viewing: () => string | null;
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
 * - A message from someone else in the thread the member is looking at
 *   re-stamps that channel's read cursor before the summaries are read again.
 *   Without the stamp the next count would light up the very channel the
 *   member is reading (the cursor was stamped when it opened, before this
 *   message). One stamp per channel per burst, not one per message.
 * - Anything else reads both summaries again.
 * - A `resync` reads both again, and first re-stamps the channel being looked
 *   at: whatever arrived in it while the app was away, the member is now
 *   looking at, and nothing else would stamp it until they leave.
 *
 * A round's stamps wait for every earlier round's, so a slow stamp can't be
 * overtaken by a later round's re-read that would count the message as unread.
 * The re-reads themselves aren't waited on: a slow or retrying summary read
 * must not hold back the next message's update.
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
  /** The stamps in flight, which the next round's stamps wait on. */
  let stamping: Promise<void> = Promise.resolve();

  const round = async () => {
    // A channel Mark unread is holding sends nothing, even a stamp queued
    // before the hold (#3723).
    const toStamp = [...stamps].filter((id) => !isChannelHeldUnread(id));
    stamps.clear();
    const shouldRefresh = refresh || toStamp.length > 0;
    refresh = false;
    // A failed stamp still re-reads: the count is then the server's honest
    // answer, which is better than a badge left stale.
    await Promise.allSettled(toStamp.map((id) => options.markRead(id)));
    if (disposed || !shouldRefresh) return;
    invalidateChannelSummaries(options.queryClient);
  };

  const flush = () => {
    timer = null;
    // Taken now, at the end of the coalescing window; what arrives while the
    // previous round is still running joins this round.
    stamping = stamping.then(round, round);
    trackActivityStamping(stamping);
  };

  const handle = (activity: ChatActivity) => {
    if (disposed) return;
    if (activity.type === "resync") {
      refresh = true;
      const viewed = options.viewing();
      if (viewed) stamps.add(viewed);
    } else {
      const viewerId = options.viewerId();
      const fromSomeoneElse =
        activity.senderId !== null && activity.senderId !== viewerId;
      if (fromSomeoneElse && options.viewing() === activity.channelId) {
        stamps.add(activity.channelId);
      } else {
        refresh = true;
      }
    }
    timer ??= setTimeout(flush, delayMs);
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
 * The member is viewing a channel when its thread has claimed it
 * ({@link claimViewedChannel}) and `isForeground()` says the app or tab is in
 * front of them.
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
      viewing: () => (foregroundRef.current() ? viewedChannelId() : null),
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
