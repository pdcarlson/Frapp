"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useFrappClient } from "@repo/hooks";
import {
  chatFollowedThreadsKey,
  fetchThreadUnread,
} from "@repo/chat-core/threads";
import type { ChatMessage } from "@repo/chat-core/types";

const NONE: Readonly<Record<string, number>> = Object.freeze({});

/**
 * How many replies are new to the viewer in each thread they follow in the
 * open channel, by root id, for the thread card's "2 new" (#4297).
 *
 * Read only while the loaded timeline holds a parent with replies, and read
 * again whenever one of those parents' last reply moves: a thread reply's
 * Realtime echo updates its parent's summary, so the version below changes
 * with no subscription of its own. Opening a thread marks it read and
 * invalidates this (`useMessageThread`). A failed read keeps the last answer,
 * or shows nothing new, never a wrong count.
 */
export function useThreadUnread(
  channelId: string | null,
  messages: readonly ChatMessage[],
): Readonly<Record<string, number>> {
  const api = useFrappClient();
  const version = threadVersion(messages);
  const query = useQuery({
    queryKey: [...chatFollowedThreadsKey(channelId ?? ""), version],
    queryFn: () => fetchThreadUnread(api, channelId!),
    enabled: !!channelId && version !== "",
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  return query.data ?? NONE;
}

/**
 * One string that changes when any loaded parent's thread gains a reply:
 * how many parents have one, and the latest reply among them. Empty when no
 * loaded message has a thread.
 */
export function threadVersion(messages: readonly ChatMessage[]): string {
  let count = 0;
  let latest = "";
  for (const message of messages) {
    const at = message.thread?.last_reply_at;
    if (!message.thread) continue;
    count++;
    if (at && at > latest) latest = at;
  }
  return count === 0 ? "" : `${count}|${latest}`;
}
