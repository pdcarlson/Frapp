"use client";

import { useEffect, useRef, useState } from "react";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useFrappClient } from "@repo/hooks";
import {
  chatRealtime,
  POLL_INTERVAL_MS,
  type ConnectionStatus,
} from "@repo/chat-core/realtime-manager";
import {
  chatFollowedThreadsKey,
  fetchThreadUnread,
  threadVersion,
} from "@repo/chat-core/threads";
import type { ChatMessage } from "@repo/chat-core/types";

const NONE: Readonly<Record<string, number>> = Object.freeze({});

/**
 * A thread read on another device or tab tells this one nothing, so the
 * counts are re-read this often while the channel has threads.
 */
const SETTLE_INTERVAL_MS = 60_000;

/**
 * How many replies are new to the viewer in each thread they follow in the
 * open channel, by root id, for the thread card's "2 new" (#4297).
 *
 * When it reads:
 * - only while the loaded timeline holds a parent with replies;
 * - again when one of those parents gains a reply: its summary's Realtime
 *   echo moves `last_reply_at`, which is part of the query key. The open
 *   thread's own parent is left out of that, since reading it marks it read
 *   and re-reads this (`useMessageThread`), so a busy open thread costs one
 *   read per reply, not two;
 * - every 5s while Realtime is down to polling, which never re-reads an old
 *   parent's summary, and once more when it comes back live (as
 *   `useMessageThread` does for the open thread);
 * - once a minute otherwise, for a thread read on another device or tab.
 *
 * A failed read keeps the last answer, so a count can lag (a thread just
 * read still showing "2 new") until the next read succeeds.
 */
export function useThreadUnread(
  channelId: string | null,
  messages: readonly ChatMessage[],
  openThreadId: string | null = null,
): Readonly<Record<string, number>> {
  const api = useFrappClient();
  const queryClient = useQueryClient();
  const version = threadVersion(messages, openThreadId);
  const [connection, setConnection] = useState<ConnectionStatus>("live");
  useEffect(() => chatRealtime.subscribeStatus(setConnection), []);

  // Back from a gap: what was posted meanwhile never moved a summary here.
  const wasLive = useRef(true);
  useEffect(() => {
    const live = connection === "live";
    if (live && !wasLive.current && channelId) {
      void queryClient.invalidateQueries({
        queryKey: chatFollowedThreadsKey(channelId),
      });
    }
    wasLive.current = live;
  }, [connection, channelId, queryClient]);

  const query = useQuery({
    queryKey: [...chatFollowedThreadsKey(channelId ?? ""), version],
    queryFn: () => fetchThreadUnread(api, channelId!),
    enabled: !!channelId && version !== "",
    placeholderData: keepPreviousData,
    refetchInterval:
      connection === "polling" ? POLL_INTERVAL_MS : SETTLE_INTERVAL_MS,
  });
  return query.data ?? NONE;
}
