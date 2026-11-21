/**
 * All threads (#4960): every thread the viewer started, replied in or was
 * mentioned in, across the channels they may read, newest activity first.
 * The server decides membership (a follow or a mute; an unfollow drops out)
 * and counts what's new, so nothing here re-derives either.
 *
 * One query backs web's header button's unread mark and its list, and the
 * phone's thread rows under each channel (#5277), so they never disagree. It
 * re-reads once a minute (how a thread read on another device clears here),
 * right after a thread is read in this app (`use-message-thread.ts`
 * invalidates `memberThreadKeys.all`), on the phone's pull to refresh, and
 * when web's popover opens (it calls `refetch`; its observer stays mounted).
 */
import { useQuery } from "@tanstack/react-query";
import type { components } from "@repo/api-sdk";
import { createChapterQueryKeys } from "./chapter-query-keys";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

export type MemberThread = components["schemas"]["MemberThreadDto"];

export const memberThreadKeys = createChapterQueryKeys("member-threads");

/** How often the list re-reads while nothing else does. */
const MEMBER_THREADS_SETTLE_MS = 60_000;

export function useMemberThreads() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: memberThreadKeys.list(chapterId!),
    queryFn: async ({ signal }): Promise<MemberThread[]> => {
      const { data, error } = await client.GET("/v1/threads", { signal });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!chapterId,
    refetchInterval: MEMBER_THREADS_SETTLE_MS,
  });
}

/** How many listed threads have replies new to the viewer. */
export function unreadThreadCount(
  threads: readonly Pick<MemberThread, "unread_count">[] | undefined,
): number {
  return (threads ?? []).filter((thread) => thread.unread_count > 0).length;
}

/** The copy web's All threads popover shows around the list. */
export const ALL_THREADS_TITLE = "Threads";
export const ALL_THREADS_EMPTY =
  "No threads yet. Threads you start, reply in or are mentioned in show up here.";
export const ALL_THREADS_ERROR = "Couldn't load your threads.";
