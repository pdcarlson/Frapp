"use client";

import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { statusOf } from "@repo/api-sdk";
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
 * What the removal answers with: the report, now `actioned`;
 * `message_already_deleted` — true when the message was already gone and this
 * call removed nothing, which the UI must say rather than claim a removal; and
 * the message's `channel_id`, so the one cached timeline that can still show
 * it is patched rather than every timeline refetched.
 */
export type ChatReportRemoval = components["schemas"]["ChatReportRemovalDto"];
/**
 * The report a removal acts on. Only its `id` is sent — the report names the
 * message server-side, so the request never carries a message id to point at
 * a sibling. `message_id` stays on this side, to find the cached reads to
 * refresh when the outcome is unknown.
 */
export type RemovableReport = Pick<ChatReport, "id" | "message_id">;

/**
 * The screen the API's new-report notification targets
 * (`REPORT_FILED_NOTIFICATION` in `chat-report.service.ts`). Web resolves it
 * to the queue on Chat Admin.
 */
export const CHAT_REPORTS_NOTIFICATION_SCREEN = "chat_reports";

/**
 * Chapter-scoped, like every moderation read: an unscoped `["chat-reports"]`
 * would serve the outgoing chapter's queue for a render after a switch, and a
 * report is exactly the data that must not cross chapters.
 */
export const chatReportKeys = createChapterQueryKeys("chat-reports");

/**
 * One slice of the queue, newest first. `open` is the queue itself; the other
 * three statuses are history, and the API serves one status per request.
 *
 * **Freshness** is the client's defaults plus one push: the web `QueryClient`
 * refetches a stale query (30s) on focus and reconnect, and a new-report
 * notification arriving in the dashboard drawer — or its deep link being
 * followed — marks the queue stale at once ({@link useInvalidateChatReports}),
 * so an officer sent here by a report finds it listed.
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
 * A function that marks this chapter's report queue stale, so a mounted queue
 * refetches and an unmounted one does on its next mount.
 *
 * For the dashboard's notification drawer: the realtime ping it hears carries
 * no row (`useRealtimeTable`), so it cannot tell a report notification from
 * any other until the notification list has refetched — and then it calls
 * this for a new `chat_reports` notification, and again when one is followed.
 */
export function useInvalidateChatReports(): () => Promise<void> {
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useCallback(
    () => invalidateReportLists(queryClient, chapterId),
    [queryClient, chapterId],
  );
}

/**
 * How a removal reaches the chat **timeline**'s cache — `@repo/chat-core`'s
 * normalized per-channel cache (`["chat", channelId, "messages"]`), which this
 * package does not depend on. The app that renders the timeline supplies it:
 * `apps/web/lib/chat/reported-message-reads.ts` for the dashboard.
 *
 * Two operations, because a removal ends in one of two states:
 *
 * - **Removed** — the response names the channel, so the one cached timeline
 *   that can still show the text is patched in place. Not refetched: the
 *   timeline's `queryFn` rebuilds its cache from the server page alone, and
 *   a refetch drops this member's unsent outbox rows from view until the next
 *   hydrate.
 * - **Unknown** — a 5xx or a transport failure, where the removal may have
 *   landed and there is no response to name the channel. Only the cached
 *   timelines that hold the message are refetched, never all of them.
 */
export interface ReportedMessageTimeline {
  markRemoved(
    queryClient: QueryClient,
    channelId: string,
    messageId: string,
  ): void;
  refetchHolding(queryClient: QueryClient, messageId: string): void;
}

/** What a removal's cached reads are keyed on. */
export interface RemovedMessageTarget {
  chapterId: string;
  messageId: string;
  /** Null when the outcome is unknown and no response named it. */
  channelId: string | null;
}

/**
 * Whether a cached query, **other than the timeline**, can still hold a
 * removed message's text, and so has to be refetched. The timeline is
 * {@link ReportedMessageTimeline}'s, because refetching it costs the outbox.
 *
 * - **the channel's pin list** (`usePinnedMessages`,
 *   `["channels", channelId, "pins"]`) — every channel's when the channel is
 *   not known;
 * - **the message's attachment list** (`useMessageAttachments`,
 *   `["channels", channelId, "messages", messageId, …]`);
 * - **bookmarks** — each row carries its message ({@link bookmarkKeys});
 * - **search** — message hits carry a snippet (`useSearch`,
 *   `["search", chapterId, …]`).
 *
 * All of these are this chapter's, because the client's cache is cleared on a
 * chapter switch; the chapter-keyed ones are still matched on it.
 */
export function readsRemovedMessage(
  queryKey: QueryKey,
  target: RemovedMessageTarget,
): boolean {
  const [root, second, third, fourth] = queryKey;
  if (root === "channels") {
    const inChannel = target.channelId === null || second === target.channelId;
    if (third === "pins") return inChannel;
    return inChannel && third === "messages" && fourth === target.messageId;
  }
  if (root === bookmarkKeys.all[0]) return second === target.chapterId;
  return root === "search" && second === target.chapterId;
}

/**
 * Whether a failed removal may nonetheless have removed the message: a 5xx,
 * or a failure with no HTTP status at all (the request may have landed and
 * only its response been lost). Every 4xx the route answers is decided before
 * the message is touched — the report is claimed first — so a 4xx removed
 * nothing.
 */
export function removalOutcomeUnknown(error: unknown): boolean {
  const status = statusOf(error);
  return status === undefined || status >= 500;
}

function refreshRemovedMessage(
  queryClient: QueryClient,
  timeline: ReportedMessageTimeline,
  target: RemovedMessageTarget,
  removed: boolean,
) {
  if (removed && target.channelId) {
    timeline.markRemoved(queryClient, target.channelId, target.messageId);
  } else {
    timeline.refetchHolding(queryClient, target.messageId);
  }
  return queryClient.invalidateQueries({
    predicate: (query) => readsRemovedMessage(query.queryKey, target),
  });
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
 * Takes the report and sends its id alone, matching the route: the report
 * names the message, so there is no message id on the wire to point at a
 * sibling. The API returns the resolved report and the message's channel id,
 * never the message — a report about a DM does not open the DM. Idempotent on
 * the message and on the report: one already removed still answers 200, with
 * `message_already_deleted: true`.
 *
 * Pessimistic on purpose. The removal is a soft delete the officer cannot undo,
 * so the UI waits for the server rather than rendering a state it could not
 * roll back (`spec/ui/web-dashboard/README.md` § mutation optimism).
 *
 * **On settle**, whatever the outcome, the queue is refetched. The cached
 * reads that can still show the message's text are refreshed whenever the
 * message may be gone: on success (the timeline patched, the rest refetched —
 * {@link ReportedMessageTimeline}, {@link readsRemovedMessage}) and on a
 * failure whose outcome is unknown ({@link removalOutcomeUnknown}). A 4xx
 * touched nothing, so it refreshes nothing but the queue.
 */
export function useRemoveReportedMessage(timeline: ReportedMessageTimeline) {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    // No retry, although the route is idempotent and a retry is safe. A first
    // attempt that removed the message and then lost its response would be
    // answered, on the web client's default `retry: 2`, with
    // `message_already_deleted: true` — and the officer told "already
    // removed" about a removal they just made. The unknown outcome is shown
    // instead, and the queue refetch says what happened.
    retry: false,
    mutationFn: async (report: RemovableReport): Promise<ChatReportRemoval> => {
      const { data, error } = await client.POST(
        "/v1/chat/reports/{id}/remove-message",
        { params: { path: { id: report.id } } },
      );
      if (error) throw error;
      return data;
    },
    onSettled: (removal, error, report) => {
      const messageId = removal?.message_id ?? report.message_id;
      if (chapterId && messageId && (removal || removalOutcomeUnknown(error))) {
        void refreshRemovedMessage(
          queryClient,
          timeline,
          {
            chapterId,
            messageId,
            channelId: removal?.channel_id ?? null,
          },
          Boolean(removal),
        );
      }
      return invalidateReportLists(queryClient, chapterId);
    },
  });
}
