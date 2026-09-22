"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { components } from "@repo/api-sdk";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";
import { createChapterQueryKeys } from "./chapter-query-keys";
import { bookmarkKeys } from "./use-chat";

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
 * What the removal answers with: the report, now `actioned`, and
 * `message_already_deleted` — true when the message was already gone and this
 * call removed nothing, which the UI must say rather than claim a removal.
 */
export type ChatReportRemoval = components["schemas"]["ChatReportRemovalDto"];

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
 * Whether a cached query can hold a message's text, and so has to be refetched
 * once a report-scoped removal has blanked that message.
 *
 * The removal answers with the report and never the message (a report about a
 * DM must not open the DM), so there is no row to merge the way an ordinary
 * delete merges one, and the report does not name its channel. Every read that
 * can carry message content is therefore refetched, not only the removed
 * message's own — they are all this chapter's, because the client's cache is
 * cleared on a chapter switch:
 *
 * - **the chat timeline** — `@repo/chat-core`'s `chatMessagesKey(channelId)`,
 *   `["chat", channelId, "messages"]`. `staleTime: Infinity` and kept current
 *   only by the realtime echo of the channel a member has open, so a timeline
 *   cached from earlier would show the removed text again on return. Spelled
 *   here because this package does not depend on chat-core;
 *   `apps/web/lib/chat/reported-message-reads.spec.ts` pins it to the real key.
 * - **pin lists** and **a message's attachment list** (`usePinnedMessages`,
 *   `useMessageAttachments`) — `["channels", channelId, "pins"]` and
 *   `["channels", channelId, "messages", …]`.
 * - **bookmarks** — each row carries its message ({@link bookmarkKeys}).
 * - **search** — message hits carry a snippet (`useSearch`,
 *   `["search", chapterId, …]`).
 */
export function readsMessageContent(
  queryKey: QueryKey,
  chapterId: string,
): boolean {
  const [root, second, third] = queryKey;
  if (root === "chat" && third === "messages") return true;
  if (root === "channels" && (third === "pins" || third === "messages")) {
    return true;
  }
  if (root === bookmarkKeys.all[0] && second === chapterId) return true;
  return root === "search" && second === chapterId;
}

/**
 * Close an open report as `reviewed`, `actioned` or `dismissed`. Resolving
 * never touches the message — only {@link useRemoveReportedMessage} does that.
 * A report that is no longer open answers 409: resolution is one-way.
 */
export function useResolveChatReport() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    // No retry (`docs/hooks/README.md`): this is a compare-and-set on
    // `status = 'open'`, so if the first attempt lands and only its response
    // is lost, the web client's default `retry: 2` is answered with a
    // guaranteed 409 and the officer is told a resolution failed that
    // actually happened. `onSettled` reconciles instead.
    retry: false,
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
 * Remove the message an **open** report names, and mark it — and every other
 * open report on that message — `actioned` (#2311, option 1).
 *
 * Takes the report id and nothing else, matching the route: the report names
 * the message, so there is no message id here to point at a sibling. The API
 * returns the resolved report, never the message — a report about a DM does
 * not open the DM. Idempotent on the message: one that was already deleted
 * still closes the report, with `message_already_deleted: true`.
 *
 * Pessimistic on purpose. The removal is a soft delete the officer cannot undo,
 * so the UI waits for the server rather than rendering a state it could not
 * roll back (`spec/ui/web-dashboard/README.md` § mutation optimism).
 *
 * On success every cached read that can still show the removed text is
 * refetched ({@link readsMessageContent}); on any outcome the queue is.
 */
export function useRemoveReportedMessage() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    // No retry (`docs/hooks/README.md`): a first attempt that lands and loses
    // its response would be retried against a report that is now `actioned`,
    // and the 409 that earns would be reported as a failed removal.
    retry: false,
    mutationFn: async (reportId: string): Promise<ChatReportRemoval> => {
      const { data, error } = await client.POST(
        "/v1/chat/reports/{id}/remove-message",
        { params: { path: { id: reportId } } },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      if (!chapterId) return;
      void queryClient.invalidateQueries({
        predicate: (query) => readsMessageContent(query.queryKey, chapterId),
      });
    },
    onSettled: () => invalidateReportLists(queryClient, chapterId),
  });
}
