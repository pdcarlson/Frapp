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
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomClientId } from "@repo/api-sdk";
import type { MentionPick } from "@repo/validation";
import { firstName } from "./channel-preview";
import { replyPreviewText } from "./reply-preview";
import {
  chatThreadKey,
  chatThreadRepliesKey,
  optimisticMessage,
  type ChannelCache,
  type ChatMessage,
  type MessageGif,
  type OutgoingGif,
  type ThreadLastReply,
  type RawChatMessage,
  type RawChatMessageAction,
} from "./types";
import {
  applyReactionInsert,
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
import { IncompleteActionsError, readMessageActions } from "./history";

// The keys live beside `chatMessagesKey` so `chat-client` can route a reply's
// writes without importing this module (which imports it).
export { chatThreadKey, chatThreadRepliesKey };

/** How many replies one read brings: the newest page, then older on demand. */
const THREAD_PAGE_LIMIT = 50;

export type ThreadFollowState = "following" | "muted";
export type ThreadFollowChoice = ThreadFollowState | "none";

/** `GET /v1/channels/:id/threads/:rootId`. */
export interface ThreadMeta {
  root: RawChatMessage;
  follow_state: ThreadFollowState | null;
  last_read_at: string | null;
  /**
   * The parent's reactions and votes, read beside it on the client (not on
   * the wire): the parent is drawn from here while the timeline's cache
   * doesn't hold it (#4034).
   */
  root_actions?: readonly RawChatMessageAction[];
}

/**
 * The reactions and votes on the replies `ids` names, read the way the
 * timeline reads a page's (`readMessageActions`), so a reply's reactions and a
 * card's tally are on the first paint, not only after a live frame (#4034).
 * `null` when there is no client to read with or the read came back
 * incomplete (a failed batch, or rows that moved under it): a partial set is
 * never merged, since a tally drawn from it would be wrong.
 */
async function readActions(
  supabase: SupabaseClient | null | undefined,
  ids: readonly string[],
): Promise<readonly RawChatMessageAction[] | null> {
  if (!supabase) return null;
  if (ids.length === 0) return [];
  const { actions, incomplete } = await readMessageActions(supabase, ids);
  return incomplete ? null : actions;
}

/**
 * Sets the actions on the replies `ids` names to `actions`, the server's
 * whole set for them: what they held is dropped first, so a reaction removed
 * or a vote changed while no live frame reached this cache is put right, as
 * the timeline's newest-page read puts its rows right
 * (`reconcileNewestPage`). Replies outside `ids` keep theirs.
 */
function reconcileReplyActions(
  cache: ChannelCache,
  ids: ReadonlySet<string>,
  actions: readonly RawChatMessageAction[],
): ChannelCache {
  if (ids.size === 0) return cache;
  const byId = { ...cache.byId };
  for (const [key, message] of Object.entries(cache.byId)) {
    if (ids.has(message.id)) {
      byId[key] = { ...message, reactions: {}, actions: [] };
    }
  }
  const actionIndex = { ...cache.actionIndex };
  for (const [actionId, entry] of Object.entries(cache.actionIndex)) {
    if (ids.has(entry.messageKey)) delete actionIndex[actionId];
  }
  return actions.reduce((next, action) => applyReactionInsert(next, action), {
    ...cache,
    byId,
    actionIndex,
  });
}

/** The ids of the confirmed replies a cache holds. */
function heldReplyIds(cache: ChannelCache | undefined): string[] {
  if (!cache) return [];
  return Object.values(cache.byId)
    .filter((message) => message._status === "confirmed" && !!message.id)
    .map((message) => message.id);
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
  supabase?: SupabaseClient | null,
): Promise<ThreadMeta> {
  const { data, error } = await api.GET("/v1/channels/{id}/threads/{rootId}", {
    params: { path: { id: channelId, rootId } },
  });
  if (error || !data) throw apiError(error, "Couldn't open this thread");
  const meta = data as unknown as ThreadMeta;
  // An incomplete read draws the parent without them: the next read of the
  // thread (a reconnect, a refocus, a write to it) reads them again.
  const rootActions = await readActions(supabase, [meta.root.id]);
  return rootActions?.length ? { ...meta, root_actions: rootActions } : meta;
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
  supabase?: SupabaseClient | null,
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
  const ids = rows.map((row) => row.id).filter(Boolean);
  const actions = await readActions(supabase, ids);
  // An older page is merged once and never read again, so one whose actions
  // came back incomplete is refused, as the timeline refuses one
  // (`readOlderPage`): the caller says so and the member can retry. The
  // newest page draws without them; the next gap read reconciles them.
  if (before && supabase && actions === null) {
    throw new IncompleteActionsError();
  }
  queryClient.setQueryData<ChannelCache>(
    chatThreadRepliesKey(channelId, rootId),
    (prev) => {
      const merged = mergeServerRows(prev ?? emptyCache(), rows);
      return actions
        ? reconcileReplyActions(merged, new Set(ids), actions)
        : merged;
    },
  );
  return { hasMore: rows.length >= THREAD_PAGE_LIMIT };
}

/** How far a gap read pages back before giving up and leaving the rest to scroll. */
const BACKFILL_MAX_PAGES = 10;

/**
 * Fills the gap after a reconnect or a poll (`spec/ui/resilience/` rule 5):
 * reads every reply after the newest one the cache holds, paging back from the
 * newest until it meets a held row, and merges them. With nothing held it is
 * the newest page.
 */
export async function backfillThreadReplies(
  queryClient: QueryClient,
  api: FrappApiClient,
  channelId: string,
  rootId: string,
  supabase?: SupabaseClient | null,
): Promise<void> {
  const key = chatThreadRepliesKey(channelId, rootId);
  const held = queryClient.getQueryData<ChannelCache>(key);
  const newest = held
    ? [...held.order]
        .reverse()
        .map((k) => held.byId[k])
        .find((m) => m && m._status === "confirmed")
    : undefined;
  if (!newest) {
    await loadThreadReplies(
      queryClient,
      api,
      channelId,
      rootId,
      undefined,
      supabase,
    );
    return;
  }
  let before: string | undefined;
  for (let page = 0; page < BACKFILL_MAX_PAGES; page += 1) {
    const { data, error } = await api.GET(
      "/v1/channels/{id}/threads/{rootId}/messages",
      {
        params: {
          path: { id: channelId, rootId },
          query: {
            limit: THREAD_PAGE_LIMIT,
            ...(before ? { before } : { since: newest.id }),
          },
        },
      },
    );
    if (error || !data) throw apiError(error, "Couldn't load replies");
    const rows = data as unknown as RawChatMessage[];
    queryClient.setQueryData<ChannelCache>(key, (prev) =>
      mergeServerRows(prev ?? emptyCache(), rows),
    );
    const oldest = rows.at(-1);
    // A short page, or one that reached back to what we held: the gap is closed.
    if (
      !oldest ||
      rows.length < THREAD_PAGE_LIMIT ||
      oldest.created_at <= newest.created_at
    ) {
      break;
    }
    before = oldest.created_at;
  }
  // Then every held reply's actions, not only the new rows': a reaction
  // removed or a vote changed during the gap reached no live frame here.
  // Incomplete, they stay as they were until the next gap read.
  const ids = heldReplyIds(queryClient.getQueryData<ChannelCache>(key));
  const actions = await readActions(supabase, ids);
  if (!actions) return;
  queryClient.setQueryData<ChannelCache>(key, (prev) =>
    prev ? reconcileReplyActions(prev, new Set(ids), actions) : prev,
  );
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
  // An INSERT lands even before the first read does: that read's snapshot may
  // predate the row, and the read merges over what this leaves (the timeline's
  // `patchCache` keeps such rows the same way). An UPDATE of a row the cache
  // doesn't hold has nothing on screen to change.
  if (event === "UPDATE" && !queryClient.getQueryData(key)) return;
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
  /** The members the `@` picker wrote into `content` (#3835). */
  mentionPicks?: readonly MentionPick[] | null;
  /** Reuse the failed row's id for Retry, so the server dedupes. */
  clientMessageId?: string;
  /**
   * A GIF from the picker (#4657): the reply is the GIF alone, so `content`
   * is empty, as a channel GIF send's is (#4631).
   */
  gif?: OutgoingGif | null;
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
      gif: args.gif ?? null,
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
        mention_picks: args.mentionPicks?.length
          ? [...args.mentionPicks]
          : undefined,
        gif: args.gif
          ? {
              id: args.gif.id,
              title: args.gif.title || undefined,
              url: args.gif.url,
              width: args.gif.width,
              height: args.gif.height,
              token: args.gif.token,
            }
          : undefined,
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

/**
 * The picker's GIF a failed reply still holds, token and all, so its Retry
 * sends the GIF again (#4657); `null` for a text reply. The optimistic row
 * keeps what `sendThreadReply` was given, and only an unsent row has it.
 */
export function outgoingGifOf(
  gif: MessageGif | null | undefined,
): OutgoingGif | null {
  if (!gif) return null;
  const token = (gif as Partial<OutgoingGif>).token;
  return typeof token === "string" && token ? { ...gif, token } : null;
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
 * The viewer's followed and muted threads in a channel (#4297), keyed apart
 * from the channel's message caches so nothing that resets those sweeps it.
 */
export function chatFollowedThreadsKey(channelId: string) {
  return ["chat-followed-threads", channelId] as const;
}

/**
 * How many replies are new to the viewer in each thread they follow in a
 * channel (`GET /v1/channels/{id}/threads/followed`), by root id. A muted
 * thread, and one with nothing new, is left out: the server counts a muted
 * thread as 0.
 */
export async function fetchThreadUnread(
  api: FrappApiClient,
  channelId: string,
): Promise<Record<string, number>> {
  const { data, error } = await api.GET("/v1/channels/{id}/threads/followed", {
    params: { path: { id: channelId } },
  });
  if (error || !data) throw apiError(error, "Couldn't read your threads");
  const unread: Record<string, number> = {};
  for (const row of data as Array<{
    thread_root_id: string;
    unread_count: number;
  }>) {
    if (row.unread_count > 0) unread[row.thread_root_id] = row.unread_count;
  }
  return unread;
}

/**
 * One string that changes when a loaded parent's thread gains a reply: the
 * latest reply among them, left out the open thread's. "-" when the only
 * loaded thread is the open one, empty when no loaded message has a thread,
 * so nothing is read.
 */
export function threadVersion(
  messages: readonly ChatMessage[],
  openThreadId: string | null = null,
): string {
  let any = false;
  let latest = "";
  for (const message of messages) {
    if (!message.thread) continue;
    any = true;
    if (message.id === openThreadId) continue;
    const at = message.thread.last_reply_at;
    if (at && at > latest) latest = at;
  }
  if (!any) return "";
  return latest || "-";
}

/**
 * How the thread card names a preview's replier (#4297). Callers bind
 * `@repo/hooks`' helpers to their roster, as for the Chat home preview
 * (`PreviewNames`): `nameOf` is the replier's resolved name or `null`
 * (`resolveAuthorName`), `fallbackLabel` what the timeline prints without one
 * (`resolveAuthorLabel` with no viewer: "Member 2f4a1c").
 */
export interface ThreadPreviewNames {
  nameOf: (senderId: string) => string | null;
  fallbackLabel: (senderId: string) => string;
}

/**
 * The thread card's preview line (#4297), one rule for web and the phone:
 * the replier's first name ("You" for the viewer's own, the fallback label
 * for someone the roster can't name, none for an unlinked import) and the
 * reply's one-line text (`replyPreviewText`: "Attachment", "2 attachments",
 * a card's kind). `fullName` is for the face's initials.
 */
export function threadPreviewParts(
  preview: ThreadLastReply,
  viewerId: string | null,
  names: ThreadPreviewNames,
): { name: string | null; fullName: string | null; text: string } {
  const sender = preview.sender_id;
  const fullName = sender ? names.nameOf(sender) : null;
  const name =
    sender === null
      ? null
      : sender === viewerId
        ? "You"
        : fullName
          ? firstName(fullName)
          : names.fallbackLabel(sender);
  return { name, fullName, text: replyPreviewText(preview) };
}

/**
 * What a screen reader hears for the thread card (#4297), on web and the
 * phone alike: "3 replies, 2 new, last reply 5m ago, latest from Devin: grill
 * is in my garage", without the parts the card doesn't draw.
 */
export function threadCardLabel(parts: {
  replies: string;
  fresh: string | null;
  lastReply: string | null;
  preview: { name: string | null; text: string } | null;
}): string {
  const { replies, fresh, lastReply, preview } = parts;
  return [
    replies,
    fresh,
    lastReply,
    preview
      ? `latest${preview.name ? ` from ${preview.name}` : ""}: ${preview.text}`
      : null,
  ]
    .filter(Boolean)
    .join(", ");
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
