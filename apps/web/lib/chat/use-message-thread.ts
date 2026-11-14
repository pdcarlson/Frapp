"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFrappClient } from "@repo/hooks";
import {
  chatRealtime,
  NO_TYPING_USERS,
  POLL_INTERVAL_MS,
  type ConnectionStatus,
} from "@repo/chat-core/realtime-manager";
import {
  applyThreadRealtimeRow,
  backfillThreadReplies,
  chatFollowedThreadsKey,
  chatThreadKey,
  chatThreadRepliesKey,
  discardThreadReply,
  fetchThread,
  loadThreadReplies,
  markThreadRead,
  outgoingGifOf,
  sendThreadReply,
  setThreadFollow,
  type ThreadFollowChoice,
  type ThreadMeta,
} from "@repo/chat-core/threads";
import {
  normalizeRow,
  type ChannelCache,
  type ChatMessage,
  type OutgoingGif,
} from "@repo/chat-core/types";
import { cacheFromPage, emptyCache } from "@repo/chat-core/cache";
import { getRealtimeClient } from "@/lib/realtime/supabase-realtime";

/**
 * One open message thread (#3785): its parent, its replies, the viewer's
 * follow, who is typing in it, and the writes.
 *
 * The replies live in their own cache, fed by this hook's read and by the
 * realtime manager's `onThreadReply` (the timeline drops thread rows). The
 * listener is removed on unmount, and the channel topic itself stays the open
 * channel's: this never subscribes or re-keys it (`realtime-resilience`
 * rules 1 and 2). After a gap (reconnect, polling) the newest page is read
 * again and merged, the timeline's backfill rule for this cache.
 */
export function useMessageThread(
  channelId: string,
  rootId: string,
  viewerId: string | null,
) {
  const queryClient = useQueryClient();
  const api = useFrappClient();
  // Reactions and votes are read under the member's own session, as the
  // timeline reads them (#4034).
  const supabase = useMemo(() => getRealtimeClient(), []);
  const repliesKey = useMemo(
    () => chatThreadRepliesKey(channelId, rootId),
    [channelId, rootId],
  );
  const metaKey = useMemo(
    () => chatThreadKey(channelId, rootId),
    [channelId, rootId],
  );
  const [hasOlder, setHasOlder] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);

  const [connection, setConnection] = useState<ConnectionStatus>("live");
  useEffect(() => chatRealtime.subscribeStatus(setConnection), []);

  const meta = useQuery({
    queryKey: metaKey,
    queryFn: () => fetchThread(api, channelId, rootId, supabase),
    // Every open reads afresh: nothing feeds a closed thread's cache.
    staleTime: 0,
  });

  // The first read of this mount sets "Load earlier replies"; every later one
  // (a poll, a reconnect, a refocus) only fills the gap since the newest held
  // reply, and never turns that control back on.
  const readOnce = useRef(false);
  const replies = useQuery({
    queryKey: repliesKey,
    queryFn: async () => {
      const held = queryClient.getQueryData<ChannelCache>(repliesKey);
      const first = !readOnce.current;
      readOnce.current = true;
      if (first && !held?.order.length) {
        const page = await loadThreadReplies(
          queryClient,
          api,
          channelId,
          rootId,
          undefined,
          supabase,
        );
        setHasOlder(page.hasMore);
      } else {
        await backfillThreadReplies(
          queryClient,
          api,
          channelId,
          rootId,
          supabase,
        );
        // Reopened over a cache this mount didn't page: older replies may
        // remain. One read of them settles it now, rather than leaving the
        // timeline to page them in, which it does only once the list has
        // scrolled, and a short thread never scrolls (#4034).
        if (first) {
          const cache = queryClient.getQueryData<ChannelCache>(repliesKey);
          const oldest = cache?.order
            .map((key) => cache.byId[key])
            .find((message) => message?._status === "confirmed");
          if (oldest) {
            try {
              const page = await loadThreadReplies(
                queryClient,
                api,
                channelId,
                rootId,
                oldest.created_at,
                supabase,
              );
              setHasOlder(page.hasMore);
            } catch {
              // The held replies still show; the timeline offers the rest
              // once the member scrolls to the top.
              setHasOlder(true);
            }
          }
        }
      }
      return queryClient.getQueryData<ChannelCache>(repliesKey) ?? emptyCache();
    },
    // A closed thread's cache missed whatever was posted meanwhile.
    staleTime: 0,
    // Polling fallback (rule 5): while the manager polls the channel, this
    // reads the thread's gap on the same beat.
    refetchInterval: connection === "polling" ? POLL_INTERVAL_MS : false,
  });

  // Live rows, for as long as the panel is open.
  useEffect(
    () =>
      chatRealtime.onThreadReply(channelId, (row, event) =>
        applyThreadRealtimeRow(queryClient, channelId, rootId, row, event),
      ),
    [channelId, rootId, queryClient],
  );

  // A gap ended: read everything after the newest held reply.
  const previousConnection = useRef(connection);
  useEffect(() => {
    const before = previousConnection.current;
    previousConnection.current = connection;
    if (connection === "live" && before !== "live") {
      void queryClient.invalidateQueries({ queryKey: repliesKey, exact: true });
      // And the parent, whose read the panel draws while the timeline
      // doesn't hold it: its edits and reactions in the gap missed it.
      void queryClient.invalidateQueries({ queryKey: metaKey, exact: true });
    }
  }, [connection, queryClient, repliesKey, metaKey]);

  // Who is typing in this thread, re-read on each status ping like the
  // channel's line; the manager hands back the same array while unchanged.
  const [typingUsers, setTypingUsers] =
    useState<readonly string[]>(NO_TYPING_USERS);
  useEffect(() => {
    const refresh = () =>
      setTypingUsers(chatRealtime.getTypingUsers(channelId, rootId));
    refresh();
    return chatRealtime.subscribeStatus(refresh);
  }, [channelId, rootId]);

  const cache = replies.data;
  const messages = useMemo<ChatMessage[]>(() => {
    if (!cache) return [];
    return cache.order
      .map((key) => cache.byId[key])
      .filter((message): message is ChatMessage => !!message);
  }, [cache]);

  // Read through the newest confirmed reply the panel shows, once per new
  // reply. Best-effort: a failure leaves the thread unread, which the next
  // open fixes.
  const newestId = [...messages]
    .reverse()
    .find((m) => m._status === "confirmed")?.id;
  const metaLoaded = !!meta.data;
  useEffect(() => {
    if (!metaLoaded) return;
    void markThreadRead(api, channelId, rootId)
      // The thread card's "2 new" re-reads once the server has the cursor.
      .then(() =>
        queryClient.invalidateQueries({
          queryKey: chatFollowedThreadsKey(channelId),
        }),
      )
      .catch(() => undefined);
  }, [api, queryClient, channelId, rootId, metaLoaded, newestId]);

  // The parent with its reactions and votes folded in, as a cache row is.
  const root = useMemo<ChatMessage | null>(() => {
    if (!meta.data) return null;
    const { root: raw, root_actions: actions } = meta.data;
    if (!actions?.length) return normalizeRow(raw);
    const folded = cacheFromPage([raw], actions);
    return folded.byId[raw.id] ?? normalizeRow(raw);
  }, [meta.data]);

  const loadOlder = useCallback(async () => {
    const oldest = messages.find((message) => message._status === "confirmed");
    if (!oldest || isLoadingOlder) return { error: null };
    setIsLoadingOlder(true);
    // Resolves with the failure rather than rejecting, so a click handler
    // can say so (`void` on a rejection would be an unhandled one).
    try {
      const page = await loadThreadReplies(
        queryClient,
        api,
        channelId,
        rootId,
        oldest.created_at,
        supabase,
      );
      setHasOlder(page.hasMore);
      return { error: null as string | null };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Couldn't load replies",
      };
    } finally {
      setIsLoadingOlder(false);
    }
  }, [messages, isLoadingOlder, queryClient, api, channelId, rootId, supabase]);

  const patchFollow = useCallback(
    (state: ThreadMeta["follow_state"]) =>
      queryClient.setQueryData<ThreadMeta>(metaKey, (prev) =>
        prev ? { ...prev, follow_state: state } : prev,
      ),
    [queryClient, metaKey],
  );

  const setFollow = useCallback(
    async (choice: ThreadFollowChoice) => {
      const state = await setThreadFollow(api, channelId, rootId, choice);
      patchFollow(state);
    },
    [api, channelId, rootId, patchFollow],
  );

  const send = useCallback(
    async (
      content: string,
      clientMessageId?: string,
      gif?: OutgoingGif | null,
    ) => {
      if (!viewerId) return { error: "You're signed out." };
      const result = await sendThreadReply(queryClient, api, {
        channelId,
        rootId,
        senderId: viewerId,
        content,
        clientMessageId,
        gif,
      });
      // Replying follows the thread (the server's rule); show it now.
      if (!result.error && !meta.data?.follow_state) patchFollow("following");
      return result;
    },
    [viewerId, queryClient, api, channelId, rootId, meta.data, patchFollow],
  );

  /** A GIF from the picker as its own reply (#4657); the draft stays. */
  const sendGif = useCallback(
    (gif: OutgoingGif) => send("", undefined, gif),
    [send],
  );

  // A failed reply's Retry, by the row's client id: the same content (or
  // GIF, whose optimistic row kept the picker's token) under the same id, so
  // the server dedupes a send that did land.
  const retry = useCallback(
    (clientMessageId: string) => {
      const row = messages.find(
        (message) => message.client_message_id === clientMessageId,
      );
      if (!row) return Promise.resolve({ error: null as string | null });
      return send(row.content, clientMessageId, outgoingGifOf(row.gif));
    },
    [messages, send],
  );

  const discard = useCallback(
    (clientMessageId: string) =>
      discardThreadReply(queryClient, channelId, rootId, clientMessageId),
    [queryClient, channelId, rootId],
  );

  const emitTyping = useCallback(() => {
    if (!viewerId) return;
    chatRealtime.emitTyping(channelId, viewerId, undefined, rootId);
  }, [channelId, rootId, viewerId]);

  return {
    root,
    followState: meta.data?.follow_state ?? null,
    metaError: meta.error,
    isLoading: meta.isLoading || replies.isLoading,
    repliesError: replies.error,
    retryLoad: () => {
      void meta.refetch();
      void replies.refetch();
    },
    /**
     * Re-reads the parent after a write to it. The parent is a channel
     * message, so the write patched the timeline's cache, which holds it only
     * while it is in the loaded window; the panel calls this, once the write
     * has settled, only when it doesn't.
     */
    refreshRoot: () => {
      void meta.refetch();
    },
    messages,
    hasOlder,
    isLoadingOlder,
    loadOlder,
    typingUsers,
    setFollow,
    send,
    sendGif,
    retry,
    discard,
    emitTyping,
  };
}

