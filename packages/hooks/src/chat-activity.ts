"use client";

import { useCallback, useEffect, useRef } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useFrappClient } from "./use-frapp-client";
import { isChannelHeldUnread, trackActivityStamping } from "./read-cursor";
import {
  CHANNEL_UNREAD_COUNTS_KEY,
  invalidateChannelSummaries,
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
    }
  | { type: "resync" }
  | { type: "joined" };

/**
 * How long activity is gathered before it is acted on. A burst (three quick
 * messages, a rejoin plus the rows behind it) becomes one round of reads,
 * and a single message still lands well inside the ~1s the member expects
 * (#3698).
 */
export const CHAT_ACTIVITY_COALESCE_MS = 250;

/**
 * How long after the inbox's first join the handler waits for a read of the
 * unread counts to start before it starts one itself (#4961). A read that
 * starts after the join counts every message the join could have missed.
 * Opening a thread stamps it read, and the stamp re-reads the counts, so a
 * cold open onto a thread needs no read of its own. A cold open anywhere else
 * (another web page, the phone's chat home) has no such read, and pays this
 * one, a second read of the counts and previews, to close the gap.
 */
export const CHAT_JOIN_CHECK_MS = 1_000;

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
  /** {@link CHAT_JOIN_CHECK_MS}, overridable for tests. */
  joinCheckMs?: number;
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
 * - A `joined` (the inbox's first join, nothing dropped) is a resync only if
 *   the counts were read, or were being read, before the join and no read of
 *   them starts within {@link CHAT_JOIN_CHECK_MS} after it (#4961). A message
 *   that landed between the counts' read and the join reached no inbox, and
 *   only a read that starts after the join is sure to count it. Counts never
 *   read yet need nothing: their first read starts after the join. A message
 *   in that gap in the channel being looked at may still count as unread
 *   until the member leaves it; it is on screen, and its rail row shows no
 *   badge while it is the active channel.
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
  const joinCheckMs = options.joinCheckMs ?? CHAT_JOIN_CHECK_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Ends the pending `joined` check, if any. */
  let stopJoinCheck = () => {};
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

  /*
    Decides, `joinCheckMs` after the join, whether a read of the unread counts
    started after it. Such a read is seen two ways:
    - a `fetch` action, dispatched when a read starts on an idle query;
    - a promise other than the one in flight at the join. A refetch that
      cancels and replaces a running one dispatches no `fetch` action, but
      each request runs in a fresh retryer, whose promise `query.promise` is
      until it settles, its `success` included.
    A read already in flight at the join is shared, not restarted, and keeps
    its promise: it may have read the server before the join, so it doesn't
    count.

    When no read started after the join, the resync's invalidation must not
    be folded into a read still running from before it: a query with no data
    yet hands an invalidation the running promise and sends nothing new. So
    the resync waits for that read to settle first.
  */
  const checkJoin = () => {
    stopJoinCheck();
    const cache = options.queryClient.getQueryCache();
    const unread = cache.find({
      queryKey: CHANNEL_UNREAD_COUNTS_KEY,
      exact: true,
    });
    const neverRead =
      !unread ||
      (unread.state.dataUpdatedAt === 0 &&
        unread.state.fetchStatus === "idle");
    if (neverRead) return;
    const promiseAtJoin = unread.promise;
    let readSinceJoin = false;
    const sentSinceJoin = () =>
      readSinceJoin ||
      (unread.promise !== undefined && unread.promise !== promiseAtJoin) ||
      cache.find({ queryKey: CHANNEL_UNREAD_COUNTS_KEY, exact: true }) !==
        unread;
    const unsubscribe = cache.subscribe((event) => {
      if (event.type !== "updated" || event.query !== unread) return;
      if (
        event.action.type === "fetch" ||
        (event.action.type === "success" && unread.promise !== promiseAtJoin)
      ) {
        readSinceJoin = true;
        stopJoinCheck();
      }
    });
    let stopped = false;
    const timeout = setTimeout(() => {
      if (sentSinceJoin()) {
        stopJoinCheck();
        return;
      }
      const running =
        unread.state.fetchStatus === "fetching" ? unread.promise : undefined;
      const resync = () => {
        if (stopped || sentSinceJoin()) {
          stopJoinCheck();
          return;
        }
        stopJoinCheck();
        handle({ type: "resync" });
      };
      if (running) running.then(resync, resync);
      else resync();
    }, joinCheckMs);
    stopJoinCheck = () => {
      stopped = true;
      unsubscribe();
      clearTimeout(timeout);
      stopJoinCheck = () => {};
    };
  };

  const handle = (activity: ChatActivity) => {
    if (disposed) return;
    if (activity.type === "joined") {
      checkJoin();
      return;
    }
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
    stopJoinCheck();
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
