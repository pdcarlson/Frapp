"use client";

import { useCallback, useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type { components } from "@repo/api-sdk";
import { createChapterQueryKeys } from "./chapter-query-keys";
import { bookmarkKeys } from "./use-chat";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

// ── Report and block (#2257) ────────────────────────────────────────────────
//
// The member-side controls App Store Guideline 1.2 asks for, over
// `POST /v1/chat/reports` and `GET|POST|DELETE /v1/chat/blocks`. Contract:
// `spec/behavior/chat/README.md` § Report and block.
//
// These hooks deliberately stop at the block list and the server-masked
// surfaces this package owns (bookmarks). Refreshing a chat thread's message
// cache is the caller's job: that cache's key lives in `@repo/chat-core`, which
// this leaf package must not depend on (see `use-points.ts`), so each app
// composes the invalidation where it has both halves in scope.

/** One per chapter: a block is scoped to the chapter it was made in. */
export const chatBlockKeys = createChapterQueryKeys("chat-blocks");

export type ChatReportReason =
  components["schemas"]["CreateChatReportDto"]["reason"];

/**
 * The reasons `POST /v1/chat/reports` accepts, in the order a picker shows
 * them. The `satisfies` + the exhaustiveness check below make a reason the API
 * adds (or drops) a compile error here rather than a picker that silently
 * cannot file it.
 */
export const CHAT_REPORT_REASONS = [
  "harassment",
  "hate",
  "violence",
  "sexual",
  "self_harm",
  "spam",
  "other",
] as const satisfies readonly ChatReportReason[];

// Every member of the SDK's union is listed above. Fails to compile otherwise.
const _allReportReasonsListed: Record<
  Exclude<ChatReportReason, (typeof CHAT_REPORT_REASONS)[number]>,
  never
> = {};
void _allReportReasonsListed;

/**
 * Tri-state, never boolean. A failed read that looked like "nobody is blocked"
 * would fail open on a safety feature — the exact defect #2315 records.
 */
export type BlockListStatus = "ready" | "loading" | "unavailable";

export interface BlockedUserIds {
  /**
   * The last list the server returned — possibly stale when `status` is not
   * `ready`, and empty when nothing was ever read.
   *
   * Safe to use as a **floor** in every status (anyone on it was blocked at
   * least as recently as that read), never as a ceiling: an id missing from a
   * stale or empty list proves nothing. That is why `status` exists.
   */
  ids: ReadonlySet<string>;
  status: BlockListStatus;
  /** Re-reads the list. Bound to the query, so safe to hand to a button. */
  retry: () => void;
  /** True while any read of the list is in flight, including a retry. */
  isRetrying: boolean;
}

const NO_IDS: ReadonlySet<string> = new Set();

/**
 * Narrows the response to its id array, throwing on anything else.
 *
 * Throwing rather than defaulting to `[]` is the point: a body this client
 * cannot read is an unavailable list, not an empty one, and only an error puts
 * the query where `useBlockedUserIds` reports it as such.
 */
function readBlockedUserIds(data: unknown): string[] {
  const ids =
    data && typeof data === "object" && "blocked_user_ids" in data
      ? (data as { blocked_user_ids: unknown }).blocked_user_ids
      : undefined;
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) {
    throw new Error("Unreadable block list");
  }
  return ids;
}

/**
 * The viewer's own blocked members in the active chapter, with an honest
 * status.
 *
 * **An error wins over cached data.** TanStack v5 keeps `data` when a refetch
 * fails and only moves `status` to `"error"`, so reading `data` first would
 * report `ready` with a list the server just failed to confirm — right after a
 * Block, that is the pre-block list, and the newly blocked member's live
 * messages would render in full with no notice (#2315 defect 3).
 *
 * **A paused fetch is unavailable, not loading.** Under `offlineFirst` a first
 * read that fails offline parks its retry until reconnect, and `status` stays
 * `"pending"` the whole time; reporting that as "loading" would promise a
 * list that is not coming.
 *
 * **No polling.** Retries ride the app's query defaults (reconnect, foreground)
 * and the `retry` handle a screen puts behind a button. An error-only
 * `refetchInterval` becomes a permanent 30s poll for every member once the
 * endpoint is down, because v5 sits at `"error"` indefinitely while keeping
 * `data` (#2315 defect 6).
 */
export function useBlockedUserIds(): BlockedUserIds {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const query = useQuery({
    // `chapterId!` is safe under `enabled`: the factory refuses a null chapter
    // by design, and the query never runs without one.
    queryKey: chatBlockKeys.list(chapterId!),
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/chat/blocks");
      if (error) throw error;
      return readBlockedUserIds(data);
    },
    enabled: !!chapterId,
  });

  const { data, isError, isSuccess, fetchStatus, isFetching, refetch } = query;
  const ids = useMemo<ReadonlySet<string>>(
    () => (data ? new Set(data) : NO_IDS),
    [data],
  );
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  const status: BlockListStatus = isError
    ? "unavailable"
    : isSuccess
      ? "ready"
      : fetchStatus === "paused"
        ? "unavailable"
        : "loading";

  return { ids, status, retry, isRetrying: isFetching };
}

/**
 * Fold a confirmed block/unblock into the cached list, then re-read it.
 *
 * The local fold is what keeps a failed re-read from resurrecting the pre-write
 * list as the floor. It is applied **only over a successful read**:
 * `setQueryData` always lands as `success`, so writing over a query sitting at
 * `"error"` would flip an unavailable list to `ready` with whatever stale ids it
 * held — and seeding a list that was never read would report `ready` with one
 * id and nobody else blocked.
 */
function applyConfirmedBlockChange(
  queryClient: QueryClient,
  chapterId: string,
  change: (ids: string[]) => string[],
): void {
  const key = chatBlockKeys.list(chapterId);
  if (queryClient.getQueryState(key)?.status === "success") {
    queryClient.setQueryData<string[]>(key, (prev) =>
      prev ? change(prev) : prev,
    );
  }
  void queryClient.invalidateQueries({
    queryKey: chatBlockKeys.lists(chapterId),
  });
  // Bookmarks are served through the same server-side mask as the timeline,
  // so a cached panel still shows whatever the old list let through.
  void queryClient.invalidateQueries({
    queryKey: bookmarkKeys.lists(chapterId),
  });
}

/**
 * Block a member in the active chapter. Idempotent server-side, so a retry is
 * safe. Silent to the blocked member by contract — nothing here, and nothing
 * in the response, tells them.
 */
export function useBlockMember() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationFn: async (userId: string) => {
      const { data, error } = await client.POST("/v1/chat/blocks", {
        body: { user_id: userId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, userId) => {
      if (!chapterId) return;
      applyConfirmedBlockChange(queryClient, chapterId, (ids) =>
        ids.includes(userId) ? ids : [...ids, userId],
      );
    },
  });
}

/** Unblock. The API answers 204 whether or not a block existed. */
export function useUnblockMember() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await client.DELETE("/v1/chat/blocks/{userId}", {
        params: { path: { userId } },
      });
      if (error) throw error;
    },
    onSuccess: (_data, userId) => {
      if (!chapterId) return;
      applyConfirmedBlockChange(queryClient, chapterId, (ids) =>
        ids.filter((id) => id !== userId),
      );
    },
  });
}

export interface ReportMessageInput {
  messageId: string;
  reason: ChatReportReason;
  /** Optional free text; blank is sent as absent. The API caps it at 1000. */
  details?: string;
}

/** The API's `details` cap (`chat_message_reports_details_len`). */
export const CHAT_REPORT_DETAILS_MAX_LENGTH = 1000;

/**
 * File a report as the signed-in member. The API authorizes it as a read of the
 * message's channel and keeps one open report per member per message, so a
 * double tap or a retry returns the same report rather than queueing two.
 */
export function useReportMessage() {
  const client = useFrappClient();
  return useMutation({
    mutationFn: async ({ messageId, reason, details }: ReportMessageInput) => {
      const trimmed = details?.trim();
      const { data, error } = await client.POST("/v1/chat/reports", {
        body: {
          message_id: messageId,
          reason,
          ...(trimmed ? { details: trimmed } : {}),
        },
      });
      if (error) throw error;
      return data;
    },
  });
}
