"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import type { components } from "@repo/api-sdk";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";
import { createChapterQueryKeys } from "./chapter-query-keys";

// ── The officer report queue (#2257, #2311) ─────────────────────────────────
//
// Contract: `spec/behavior/chat/README.md` § Report and block. These hooks are
// the officer half only: reading the queue, resolving a report, and removing
// the one message an open report names. Every route here needs `members:view`
// and `channels:manage` (`ChatReportController`), so a caller mounts them
// behind that gate — the hooks do not re-check it.

export type ChatReport = components["schemas"]["ChatReportDto"];
export type ChatReportStatus = ChatReport["status"];
export type ChatReportReason = ChatReport["reason"];
/** What `PATCH /v1/chat/reports/{id}` accepts — never `open`. */
export type ChatReportResolution =
  components["schemas"]["ResolveChatReportDto"]["status"];

/**
 * Chapter-scoped, like every moderation read: an unscoped `["chat-reports"]`
 * would serve the outgoing chapter's queue for a render after a switch, and a
 * report is exactly the data that must not cross chapters.
 */
export const chatReportKeys = createChapterQueryKeys("chat-reports");

/**
 * One slice of the queue, newest first. `open` is the queue itself; the other
 * three statuses are history, and the API serves one status per request.
 */
export function useChatReports(status: ChatReportStatus = "open") {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    // `chapterId!` is safe under `enabled`: the factory refuses a null chapter
    // by design, and the query never runs without one.
    queryKey: chatReportKeys.list(chapterId!, { status }),
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/chat/reports", {
        params: { query: { status } },
      });
      if (error) throw error;
      return data;
    },
    enabled: !!chapterId,
  });
}

/**
 * Every slice, not just the one the report left. A resolved report moves from
 * `open` into another status's list, so both ends are stale; and a mutation
 * that fails with 404/409 means the cached row no longer matches the server
 * (another officer got there first), which is why callers invalidate on
 * *settled* rather than only on success.
 */
function invalidateReportLists(
  queryClient: QueryClient,
  chapterId: string | null,
) {
  if (!chapterId) return Promise.resolve();
  return queryClient.invalidateQueries({
    queryKey: chatReportKeys.lists(chapterId),
  });
}

/**
 * Close a report as `reviewed`, `actioned` or `dismissed`. Resolving never
 * touches the message — only {@link useRemoveReportedMessage} does that.
 */
export function useResolveChatReport() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string;
      status: ChatReportResolution;
    }) => {
      const { data, error } = await client.PATCH("/v1/chat/reports/{id}", {
        params: { path: { id } },
        body: { status },
      });
      if (error) throw error;
      return data;
    },
    onSettled: () => invalidateReportLists(queryClient, chapterId),
  });
}

/**
 * Remove the message an **open** report names, and mark the report `actioned`
 * (#2311, option 1).
 *
 * Takes the report id and nothing else, matching the route: the report names
 * the message, so there is no message id here to point at a sibling. The API
 * returns the resolved report, never the message — a report about a DM does
 * not open the DM.
 *
 * Pessimistic on purpose. The removal is a soft delete the officer cannot undo,
 * so the UI waits for the server rather than rendering a state it could not
 * roll back (`spec/ui/web-dashboard/README.md` § mutation optimism).
 *
 * No chat message cache is invalidated here because this package holds none:
 * the timeline's cache lives in `@repo/chat-core` and is kept current by the
 * realtime echo of the soft delete's UPDATE. The one message-shaped read this
 * package does cache is a channel's pin list, and a removed message that was
 * pinned would otherwise keep its old text there until the next refetch.
 */
export function useRemoveReportedMessage() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationFn: async (reportId: string) => {
      const { data, error } = await client.POST(
        "/v1/chat/reports/{id}/remove-message",
        { params: { path: { id: reportId } } },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      // `["channels", channelId, "pins"]` — `usePinnedMessages`. The report
      // does not say which channel, so every cached pin list is refreshed.
      void queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === "channels" && query.queryKey[2] === "pins",
      });
    },
    onSettled: () => invalidateReportLists(queryClient, chapterId),
  });
}
