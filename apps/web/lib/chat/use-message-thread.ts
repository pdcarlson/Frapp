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
  chatThreadKey,
  chatThreadRepliesKey,
  discardThreadReply,
  fetchThread,
  loadThreadReplies,
  markThreadRead,
  sendThreadReply,
  setThreadFollow,
  type ThreadFollowChoice,
  type ThreadMeta,
} from "@repo/chat-core/threads";
import {
  normalizeRow,
  type ChannelCache,
  type ChatMessage,
} from "@repo/chat-core/types";
import { emptyCache } from "@repo/chat-core/cache";

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
    queryFn: () => fetchThread(api, channelId, rootId),
  });

  const replies = useQuery({
    queryKey: repliesKey,
    queryFn: async () => {
      const page = await loadThreadReplies(queryClient, api, channelId, rootId);
      setHasOlder(page.hasMore);
      return queryClient.getQueryData<ChannelCache>(repliesKey) ?? emptyCache();
    },
    // Polling fallback (rule 5): while the manager polls the channel, this
    // re-reads the thread's newest page on the same beat.
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

  // A gap ended: read the newest page again so nothing sent during it is lost.
  const previousConnection = useRef(connection);
  useEffect(() => {
    const before = previousConnection.current;
    previousConnection.current = connection;
    if (connection === "live" && before !== "live") {
      void queryClient.invalidateQueries({ queryKey: repliesKey, exact: true });
    }
  }, [connection, queryClient, repliesKey]);

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

  // Read through the newest reply the panel shows. Best-effort: a failure
  // leaves the thread unread, which the next open fixes.
  const newestId = messages.at(-1)?.id;
  useEffect(() => {
    if (!meta.data) return;
    void markThreadRead(api, channelId, rootId).catch(() => undefined);
  }, [api, channelId, rootId, meta.data, newestId]);

  const root = useMemo<ChatMessage | null>(
    () => (meta.data ? normalizeRow(meta.data.root) : null),
    [meta.data],
  );

  const loadOlder = useCallback(async () => {
    const oldest = messages.find((message) => message._status === "confirmed");
    if (!oldest || isLoadingOlder) return;
    setIsLoadingOlder(true);
    try {
      const page = await loadThreadReplies(
        queryClient,
        api,
        channelId,
        rootId,
        oldest.created_at,
      );
      setHasOlder(page.hasMore);
    } finally {
      setIsLoadingOlder(false);
    }
  }, [messages, isLoadingOlder, queryClient, api, channelId, rootId]);

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
    async (content: string, clientMessageId?: string) => {
      if (!viewerId) return { error: "You're signed out." };
      const result = await sendThreadReply(queryClient, api, {
        channelId,
        rootId,
        senderId: viewerId,
        content,
        clientMessageId,
      });
      // Replying follows the thread (the server's rule); show it now.
      if (!result.error && !meta.data?.follow_state) patchFollow("following");
      return result;
    },
    [viewerId, queryClient, api, channelId, rootId, meta.data, patchFollow],
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
    messages,
    hasOlder,
    isLoadingOlder,
    loadOlder,
    typingUsers,
    setFollow,
    send,
    discard,
    emitTyping,
  };
}
