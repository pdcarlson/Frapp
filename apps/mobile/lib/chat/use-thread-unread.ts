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
 * open channel, by root id, for the thread card's "2 new" (#4297). Web's twin
 * is `apps/web/lib/chat/use-thread-unread.ts`; the rule for when to read is
 * chat-core's `threadVersion`, so the two read alike. The rest is a twin, as
 * `use-message-thread.ts` is, because `@repo/hooks` doesn't depend on
 * chat-core and chat-core holds no React; hoisting the twins into shared
 * hooks is #4053. Change both together until then. On the phone the open
 * thread is its own screen over the channel, which passes no `openThreadId`:
 * a reply there re-reads once for the parent's echo and once when the thread
 * screen marks it read (`use-message-thread.ts`).
 *
 * When it reads:
 * - only while the loaded timeline holds a parent with replies;
 * - again when one of those parents gains a reply: its summary's Realtime
 *   echo moves `last_reply_at`, which is part of the query key. Web leaves
 *   the open thread's parent out of that; the phone can't tell which thread
 *   is open over the channel, so a reply there costs two reads, this one and
 *   the one after the thread screen marks it read (`use-message-thread.ts`);
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
