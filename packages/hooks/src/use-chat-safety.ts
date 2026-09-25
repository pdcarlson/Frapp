"use client";

import { useCallback, useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type { components } from "@repo/api-sdk";
import type { BlockListStatus } from "@repo/validation";
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
// composes it where it has both halves in scope.

/** One per chapter: a block is scoped to the chapter it was made in. */
export const chatBlockKeys = createChapterQueryKeys("chat-blocks");

/**
 * Where the confirmed-changes overlay lives: under the chapter, but outside
 * `lists()`, so invalidating the list never drops it. In-memory like the rest
 * of the query cache, so it is session-scoped, and chapter-scoped by key (the
 * mobile app also clears the whole cache on a chapter switch).
 */
export function confirmedBlockChangesKey(chapterId: string) {
  return [...chatBlockKeys.chapter(chapterId), "confirmed"] as const;
}

export type ChatReportReason =
  components["schemas"]["CreateChatReportDto"]["reason"];

export type ChatReport = components["schemas"]["ChatReportDto"];

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
 * Throws unless the response was a 2xx.
 *
 * openapi-fetch 0.17 reports a non-2xx whose body is empty as `error:
 * undefined` (a 204-shaped or `Content-Length: 0` failure) or `error: ""` (an
 * empty text body), both falsy — so `if (error) throw error` reads a failed
 * block or report as a success and the UI would say it worked. The status is
 * the truth. What is thrown carries the status wherever the SDK put it, so
 * `statusOf` from `@repo/api-sdk` reads it back.
 */
function throwUnlessOk(result: { error?: unknown; response: Response }): void {
  if (result.response.ok) return;
  const { error } = result;
  if (error !== null && typeof error === "object") throw error;
  throw {
    statusCode: result.response.status,
    message: typeof error === "string" && error.length > 0 ? error : undefined,
  };
}

export interface BlockedUserIds {
  /**
   * Everyone known to be blocked: the last list the server returned, with
   * every block and unblock this client has confirmed since applied on top
   * (see `applyConfirmedBlockChange`). Possibly stale when `status` is not
   * `ready`, and empty when nothing was ever read or confirmed.
   *
   * Safe to use as a **floor** in every status (anyone on it is blocked as far
   * as anything this client has seen says), never as a ceiling: an id missing
   * from a stale or empty list proves nothing. That is why `status` exists.
   */
  ids: ReadonlySet<string>;
  /**
   * Members this client confirmed unblocking this session whom no read since
   * has contradicted. The only positive evidence a block *ended*: a ready list
   * that merely lacks someone does not prove it, because that is also what a
   * block made on another device looks like until the list is re-read.
   */
  unblocked: ReadonlySet<string>;
  /** About the server's list only: a confirmed change does not make it `ready`. */
  status: BlockListStatus;
  /** Re-reads the list. Bound to the query, so safe to hand to a button. */
  retry: () => void;
  /** True while any read of the list is in flight, including a retry. */
  isRetrying: boolean;
  /**
   * True while a read is parked waiting for the network (TanStack's `paused`
   * fetch status: the device is offline, so the query's retry waits for
   * reconnect). `retry` cannot run it any sooner — the read resumes on its own
   * when the device is back online — so a retry control should say that
   * rather than offer a tap that visibly does nothing.
   */
  isPaused: boolean;
}

/** One server read of the list, and which confirmed changes it could reflect. */
interface BlockListRead {
  ids: string[];
  /** `blockChangeSeq` when the read started — see `confirmedBlockChangesKey`. */
  readSeq: number;
}

/** A block or unblock the server confirmed to this client. */
interface ConfirmedBlockChange {
  blocked: boolean;
  seq: number;
}

/** The latest confirmed change per `users.id`. */
type ConfirmedBlockChanges = Readonly<Record<string, ConfirmedBlockChange>>;

const NO_IDS: ReadonlySet<string> = new Set();
const NO_CHANGES: ConfirmedBlockChanges = {};

/**
 * Orders confirmed changes against list reads, across every chapter and client.
 *
 * A read records the value when it *starts*; a change takes the next value when
 * the server *confirms* it. So a read whose `readSeq` is at least a change's
 * `seq` started after that change committed and reflects it, and one below it
 * may be the pre-change list — which is exactly the response a read already in
 * flight during a Block returns (#2257 review, finding 5b). Module-level and
 * monotonic; only ordering matters, never the value.
 */
let blockChangeSeq = 0;

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
 * The server's last list with every confirmed change it could not have seen
 * applied on top. A change the read *did* see is the server's to answer for:
 * applying it anyway would override a block or unblock made since on another
 * device.
 */
function effectiveBlockList(
  read: BlockListRead | undefined,
  changes: ConfirmedBlockChanges,
): { ids: ReadonlySet<string>; unblocked: ReadonlySet<string> } {
  const ids = new Set(read?.ids ?? []);
  const unblocked = new Set<string>();
  for (const [userId, change] of Object.entries(changes)) {
    const reflected = read !== undefined && change.seq <= read.readSeq;
    if (reflected) {
      if (!change.blocked && !ids.has(userId)) unblocked.add(userId);
      continue;
    }
    if (change.blocked) {
      ids.add(userId);
    } else {
      ids.delete(userId);
      unblocked.add(userId);
    }
  }
  if (ids.size === 0 && unblocked.size === 0) {
    return { ids: NO_IDS, unblocked: NO_IDS };
  }
  return { ids, unblocked };
}

/**
 * The viewer's own blocked members in the active chapter, with an honest
 * status.
 *
 * **An error wins over cached data.** TanStack v5 keeps `data` when a refetch
 * fails and only moves `status` to `"error"`, so reading `data` first would
 * report `ready` with a list the server just failed to confirm (#2315 defect
 * 3). The ids survive only as a floor.
 *
 * **A paused fetch is unavailable, not loading.** Under `offlineFirst`, or
 * offline under the default network mode, a first read parks until reconnect
 * and `status` stays `"pending"` the whole time; reporting that as "loading"
 * would promise a list that is not coming.
 *
 * **Confirmed changes apply whatever the status.** A Block the server
 * confirmed takes effect at once even while the list is loading or
 * unavailable, and an Unblock removes the id from the floor — the overlay
 * `applyConfirmedBlockChange` keeps, never a write into the list's own query,
 * which would flip it to `ready` (#2257 review, finding 5a).
 *
 * **No polling.** Retries ride the app's query defaults (reconnect, foreground)
 * and the `retry` handle a screen puts behind a button. An error-only
 * `refetchInterval` becomes a permanent 30s poll for every member once the
 * endpoint is down, because v5 sits at `"error"` indefinitely while keeping
 * `data` (#2315 defect 6).
 */
export function useBlockedUserIds(): BlockedUserIds {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  const query = useQuery({
    // `chapterId!` is safe under `enabled`: the factory refuses a null chapter
    // by design, and the query never runs without one.
    queryKey: chatBlockKeys.list(chapterId!),
    queryFn: async (): Promise<BlockListRead> => {
      // Taken before the request leaves: a change confirmed after this point
      // may or may not be in the answer, so the overlay keeps applying it.
      const readSeq = blockChangeSeq;
      const result = await client.GET("/v1/chat/blocks");
      throwUnlessOk(result);
      return { ids: readBlockedUserIds(result.data), readSeq };
    },
    enabled: !!chapterId,
  });

  const changesKey = confirmedBlockChangesKey(chapterId!);
  const changesQuery = useQuery({
    queryKey: changesKey,
    // Never a source of truth — only `applyConfirmedBlockChange` writes this
    // key. Returning the cached value means a broad invalidation (say, of the
    // whole `chat-blocks` family) re-reads the overlay rather than wiping it.
    queryFn: () =>
      queryClient.getQueryData<ConfirmedBlockChanges>(changesKey) ?? NO_CHANGES,
    initialData: NO_CHANGES,
    staleTime: Infinity,
    gcTime: Infinity,
    enabled: !!chapterId,
  });

  const { data, isError, isSuccess, fetchStatus, isFetching, refetch } = query;
  const changes = changesQuery.data;
  const { ids, unblocked } = useMemo(
    () => effectiveBlockList(data, changes),
    [data, changes],
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

  return {
    ids,
    unblocked,
    status,
    retry,
    isRetrying: isFetching,
    isPaused: fetchStatus === "paused",
  };
}

/**
 * Record a confirmed block/unblock, then re-read the list.
 *
 * The change goes into its own overlay rather than into the list's query:
 * `setQueryData` always lands as `success`, so writing over a list sitting at
 * `"error"` would flip an unavailable list to `ready` with whatever stale ids it
 * held, and seeding a list that was never read would report `ready` with one id
 * and nobody else blocked. The overlay applies in every status, so the change
 * still takes effect at once.
 *
 * A read already in flight started before the change and may answer with the
 * pre-change list. `invalidateQueries` does not cancel a *first* read (TanStack
 * dedupes onto it when there is no data yet), so it is cancelled explicitly
 * before the re-read; the `seq` ordering keeps the change applied even if that
 * stale answer lands anyway.
 */
async function applyConfirmedBlockChange(
  queryClient: QueryClient,
  chapterId: string,
  userId: string,
  blocked: boolean,
): Promise<void> {
  blockChangeSeq += 1;
  const seq = blockChangeSeq;
  queryClient.setQueryData<ConfirmedBlockChanges>(
    confirmedBlockChangesKey(chapterId),
    (prev) => ({ ...(prev ?? NO_CHANGES), [userId]: { blocked, seq } }),
  );

  const lists = chatBlockKeys.lists(chapterId);
  await queryClient.cancelQueries({ queryKey: lists });
  void queryClient.invalidateQueries({ queryKey: lists });
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
 *
 * A 404 means the target is not a member of this chapter (the API's `Member
 * not found`); read it with `statusOf` rather than showing a connection error.
 */
export function useBlockMember() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationFn: async (userId: string) => {
      const result = await client.POST("/v1/chat/blocks", {
        body: { user_id: userId },
      });
      throwUnlessOk(result);
      return result.data;
    },
    onSuccess: async (_data, userId) => {
      if (!chapterId) return;
      await applyConfirmedBlockChange(queryClient, chapterId, userId, true);
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
      const result = await client.DELETE("/v1/chat/blocks/{userId}", {
        params: { path: { userId } },
      });
      throwUnlessOk(result);
    },
    onSuccess: async (_data, userId) => {
      if (!chapterId) return;
      await applyConfirmedBlockChange(queryClient, chapterId, userId, false);
    },
  });
}

export interface ReportMessageInput {
  messageId: string;
  reason: ChatReportReason;
  /** Optional free text; blank is sent as absent. The API caps it at 1000. */
  details?: string;
}

export interface ReportMessageResult {
  report: ChatReport;
  /**
   * The API already held an open report from this member on this message and
   * returned it unchanged, so nothing new reached the queue. A client must not
   * say "Report sent" for this.
   */
  alreadyReported: boolean;
}

/** The API's `details` cap (`chat_message_reports_details_len`). */
export const CHAT_REPORT_DETAILS_MAX_LENGTH = 1000;

/** Report ids `POST /v1/chat/reports` has handed this client this session. */
const reportIdsSeen = new Set<string>();

/**
 * How much older than the response's own `Date` a report's `created_at` may be
 * and still be the row this request inserted. The insert stamps `created_at`
 * inside the request, so a fresh report is at most one request duration older;
 * a minute is generous for that and far short of a member re-opening the sheet
 * to report the same message again.
 */
const FRESH_REPORT_WINDOW_MS = 60_000;

/**
 * Whether the API answered with a report that already existed.
 *
 * The API keeps one open report per member per message and returns that first
 * report, unchanged and still a 2xx, to a second attempt — so the only evidence
 * is in the row. Any one of three signals decides:
 *
 * 1. This client has had that id back before this session.
 * 2. The row's reason or details differ from what was just sent; a new row
 *    stores exactly what the request carried.
 * 3. The row predates the response by more than a request could take. Measured
 *    against the response's `Date` header, the server's own clock, never the
 *    device's; with no readable header this signal abstains.
 */
function isExistingReport(
  report: ChatReport,
  sent: { reason: ChatReportReason; details: string | null },
  response: Response,
): boolean {
  if (reportIdsSeen.has(report.id)) return true;
  if (report.reason !== sent.reason) return true;
  if ((report.details ?? null) !== sent.details) return true;
  const serverNow = Date.parse(response.headers?.get("date") ?? "");
  const filedAt = Date.parse(report.created_at);
  return (
    Number.isFinite(serverNow) &&
    Number.isFinite(filedAt) &&
    serverNow - filedAt > FRESH_REPORT_WINDOW_MS
  );
}

/**
 * File a report as the signed-in member. The API authorizes it as a read of the
 * message's channel and keeps one open report per member per message, so a
 * double tap or a retry returns the same report rather than queueing two —
 * `alreadyReported` says when that happened.
 */
export function useReportMessage() {
  const client = useFrappClient();
  return useMutation({
    mutationFn: async ({
      messageId,
      reason,
      details,
    }: ReportMessageInput): Promise<ReportMessageResult> => {
      const trimmed = details?.trim() || null;
      const result = await client.POST("/v1/chat/reports", {
        body: {
          message_id: messageId,
          reason,
          ...(trimmed ? { details: trimmed } : {}),
        },
      });
      throwUnlessOk(result);
      const report = result.data;
      // A 2xx with no body is not a report anyone can point at; saying "sent"
      // over it would be faking success.
      if (!report) throw new Error("The report response had no body");
      const alreadyReported = isExistingReport(
        report,
        { reason, details: trimmed },
        result.response,
      );
      reportIdsSeen.add(report.id);
      return { report, alreadyReported };
    },
  });
}
