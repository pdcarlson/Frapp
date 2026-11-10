/**
 * Message threads (#3785, `spec/behavior/chat/README.md` § Message threads):
 * the client half both apps share.
 *
 * A thread's replies are messages in the parent's channel carrying
 * `thread_root_id`, but they never belong in the channel's timeline cache. A
 * thread has its own cache under `chatThreadRepliesKey`, in the same
 * `ChannelCache` shape so the timeline's merge rules (exactly-once by client
 * id, held-row updates) apply unchanged. It is fed by its own read and by the
 * realtime manager's `onThreadReply`, never by the timeline's echo path.
 *
 * Sending is optimistic (`spec/ui/resilience/` rule 6): the row shows at
 * once, a failure stays in the panel with Retry and Delete. There is no
 * durable outbox for thread replies in slice 1, so the composer disables
 * offline and says why rather than queueing.
 */

import type { QueryClient } from "@tanstack/react-query";
import { randomClientId } from "@repo/api-sdk";
import {
  CHAT_MESSAGE_QUERY_ROOT,
  optimisticMessage,
  type ChannelCache,
  type RawChatMessage,
} from "./types";
import {
  emptyCache,
  markFailed,
  mergeHeldServerRow,
  mergeServerRow,
  mergeServerRows,
  removeMessage,
  upsertOptimistic,
} from "./cache";
import {
  classifyChatError,
  RATE_LIMITED_COPY,
  type FrappApiClient,
} from "./chat-client";

/** How many replies one read brings: the newest page, then older on demand. */
export const THREAD_PAGE_LIMIT = 50;

export type ThreadFollowState = "following" | "muted";
export type ThreadFollowChoice = ThreadFollowState | "none";

/** `GET /v1/channels/:id/threads/:rootId`. */
export interface ThreadMeta {
  root: RawChatMessage;
  follow_state: ThreadFollowState | null;
  last_read_at: string | null;
}

/** The thread's parent and the viewer's follow. */
export function chatThreadKey(channelId: string, rootId: string) {
  return [CHAT_MESSAGE_QUERY_ROOT, channelId, "thread", rootId] as const;
}

/** The thread's reply cache (`ChannelCache` shape). */
export function chatThreadRepliesKey(channelId: string, rootId: string) {
  return [
    CHAT_MESSAGE_QUERY_ROOT,
    channelId,
    "thread",
    rootId,
    "replies",
  ] as const;
}

/** A thread read's answer, beside the replies cache it fills. */
export interface ThreadRepliesPage {
  /** Whether the read came back full, so older replies may remain. */
  hasMore: boolean;
}

function apiError(error: unknown, fallback: string): Error {
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message)
      : fallback;
  return Object.assign(new Error(message), { cause: error });
}

export async function fetchThread(
  api: FrappApiClient,
  channelId: string,
  rootId: string,
): Promise<ThreadMeta> {
  const { data, error } = await api.GET("/v1/channels/{id}/threads/{rootId}", {
    params: { path: { id: channelId, rootId } },
  });
  if (error || !data) throw apiError(error, "Couldn't open this thread");
  return data as unknown as ThreadMeta;
}

/**
 * Reads one page of replies (newest first on the wire) and merges it into the
 * thread's cache. `before` is the oldest held reply's `created_at` for an
 * older page; omitted, it is the newest page, merged over what the cache holds
 * so a refetch after a reconnect fills any gap without dropping live rows.
 */
export async function loadThreadReplies(
  queryClient: QueryClient,
  api: FrappApiClient,
  channelId: string,
  rootId: string,
  before?: string,
): Promise<ThreadRepliesPage> {
  const { data, error } = await api.GET(
    "/v1/channels/{id}/threads/{rootId}/messages",
    {
      params: {
        path: { id: channelId, rootId },
        query: { limit: THREAD_PAGE_LIMIT, ...(before ? { before } : {}) },
      },
    },
  );
  if (error || !data) throw apiError(error, "Couldn't load replies");
  const rows = data as unknown as RawChatMessage[];
  queryClient.setQueryData<ChannelCache>(
    chatThreadRepliesKey(channelId, rootId),
    (prev) => mergeServerRows(prev ?? emptyCache(), rows),
  );
  return { hasMore: rows.length >= THREAD_PAGE_LIMIT };
}

/**
 * A realtime thread row for `rootId`'s cache: an INSERT merges, an UPDATE
 * (edit, delete) only touches a row the cache holds, as on the timeline.
 * Rows for another thread are ignored.
 */
export function applyThreadRealtimeRow(
  queryClient: QueryClient,
  channelId: string,
  rootId: string,
  row: RawChatMessage,
  event: "INSERT" | "UPDATE",
): void {
  if (row.thread_root_id !== rootId) return;
  const key = chatThreadRepliesKey(channelId, rootId);
  const prev = queryClient.getQueryData<ChannelCache>(key);
  // Before the first read lands there is nothing to merge into; that read
  // brings the row.
  if (!prev) return;
  queryClient.setQueryData<ChannelCache>(key, (cache) =>
    event === "UPDATE"
      ? mergeHeldServerRow(cache ?? emptyCache(), row)
      : mergeServerRow(cache ?? emptyCache(), row),
  );
}

export interface SendThreadReplyArgs {
  channelId: string;
  rootId: string;
  senderId: string;
  content: string;
  /** Reuse the failed row's id for Retry, so the server dedupes. */
  clientMessageId?: string;
}

/**
 * Posts a reply into a thread, optimistically. Resolves on success; on a
 * failure the row stays in the panel marked failed with the reason, and this
 * resolves with that reason so the caller can toast it.
 */
export async function sendThreadReply(
  queryClient: QueryClient,
  api: FrappApiClient,
  args: SendThreadReplyArgs,
): Promise<{ error: string | null }> {
  const clientId = args.clientMessageId ?? randomClientId();
  const key = chatThreadRepliesKey(args.channelId, args.rootId);
  const optimistic = {
    ...optimisticMessage({
      clientMessageId: clientId,
      channelId: args.channelId,
      senderId: args.senderId,
      content: args.content,
    }),
    thread_root_id: args.rootId,
  };
  queryClient.setQueryData<ChannelCache>(key, (prev) =>
    upsertOptimistic(prev ?? emptyCache(), optimistic),
  );
  try {
    const { data, error } = await api.POST("/v1/channels/{id}/messages", {
      params: { path: { id: args.channelId } },
      body: {
        client_message_id: clientId,
        content: args.content,
        kind: "text",
        thread_root_id: args.rootId,
      },
    });
    if (error || !data) throw apiError(error, "Couldn't send reply");
    const message = (data as { message?: RawChatMessage }).message;
    if (!message) throw new Error("thread reply returned no message");
    queryClient.setQueryData<ChannelCache>(key, (prev) =>
      mergeServerRow(prev ?? emptyCache(), message),
    );
    return { error: null };
  } catch (err) {
    const classified = classifyChatError(err);
    const reason =
      classified.status === 429 ? RATE_LIMITED_COPY : classified.message;
    queryClient.setQueryData<ChannelCache>(key, (prev) =>
      markFailed(prev ?? emptyCache(), clientId, reason),
    );
    return { error: reason };
  }
}

/** Removes a failed reply the member chose not to retry. */
export function discardThreadReply(
  queryClient: QueryClient,
  channelId: string,
  rootId: string,
  clientMessageId: string,
): void {
  queryClient.setQueryData<ChannelCache>(
    chatThreadRepliesKey(channelId, rootId),
    (prev) => removeMessage(prev ?? emptyCache(), clientMessageId),
  );
}

export async function setThreadFollow(
  api: FrappApiClient,
  channelId: string,
  rootId: string,
  state: ThreadFollowChoice,
): Promise<ThreadFollowState | null> {
  const { data, error } = await api.PUT(
    "/v1/channels/{id}/threads/{rootId}/follow",
    {
      params: { path: { id: channelId, rootId } },
      body: { state },
    },
  );
  if (error || !data) throw apiError(error, "Couldn't change this thread");
  return (data as { follow_state: ThreadFollowState | null }).follow_state;
}

export async function markThreadRead(
  api: FrappApiClient,
  channelId: string,
  rootId: string,
): Promise<void> {
  const { error } = await api.POST("/v1/channels/{id}/threads/{rootId}/read", {
    params: { path: { id: channelId, rootId } },
  });
  if (error) throw apiError(error, "Couldn't mark this thread read");
}

/**
 * The thread chip's text: "3 replies · last reply 5m ago".
 * `now` is injectable for tests.
 */
export function threadChipLabel(
  replyCount: number,
  lastReplyAt: string | null,
  now: number = Date.now(),
): { replies: string; lastReply: string | null } {
  const replies = replyCount === 1 ? "1 reply" : `${replyCount} replies`;
  if (!lastReplyAt) return { replies, lastReply: null };
  const at = Date.parse(lastReplyAt);
  if (!Number.isFinite(at)) return { replies, lastReply: null };
  return { replies, lastReply: `last reply ${relativeAgo(now - at)}` };
}

function relativeAgo(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return `${Math.max(1, Math.floor(days / 30))}mo ago`;
}
