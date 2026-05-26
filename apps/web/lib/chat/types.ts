/**
 * Shared types and normalizers for the chat hot path.
 *
 * The message cache is normalized: a single query key per channel holds
 * `{ byId, order }`, which makes idempotent merge-by-id O(1) and removes the
 * dupe/flicker bugs you get from scanning a flat array. Every inbound row
 * (Edge Function response, Postgres Changes echo, REST backfill) flows through
 * the same `mergeServerRow` in `./cache`, reconciled by `client_message_id`.
 */

export const CHAT_MESSAGE_QUERY_ROOT = "chat" as const;

/** Query key for a channel's normalized message cache. */
export function chatMessagesKey(channelId: string) {
  return [CHAT_MESSAGE_QUERY_ROOT, channelId, "messages"] as const;
}

/** Prefix that marks a `chat_message_actions.action_type` as an emoji reaction. */
export const REACTION_ACTION_PREFIX = "reaction:";

export function reactionActionType(emoji: string): string {
  return `${REACTION_ACTION_PREFIX}${emoji}`;
}

/** Alias of `reactionActionType` for callers that want the inverse-symmetric name. */
export const actionTypeFromEmoji = reactionActionType;

export function emojiFromActionType(actionType: string): string | null {
  return actionType.startsWith(REACTION_ACTION_PREFIX)
    ? actionType.slice(REACTION_ACTION_PREFIX.length)
    : null;
}

/** Lifecycle of a client-side message relative to the server. */
export type MessageStatus = "pending" | "confirmed" | "failed";

export const CHAT_MESSAGE_KINDS = [
  "text",
  "event",
  "task",
  "poll",
  "dues",
  "points",
  "hours",
  "system_audit",
  "loading",
  "announcement",
] as const;
export type ChatMessageKind = (typeof CHAT_MESSAGE_KINDS)[number];

/**
 * Raw `chat_messages` row as it arrives from Postgres Changes or the REST
 * backfill. Fields are optional because the two sources expose slightly
 * different projections; `normalizeRow` fills the gaps.
 */
export interface RawChatMessage {
  id: string;
  channel_id: string;
  sender_id: string;
  content?: string | null;
  kind?: string | null;
  payload?: Record<string, unknown> | null;
  reply_to_id?: string | null;
  metadata?: Record<string, unknown> | null;
  is_pinned?: boolean | null;
  pinned_at?: string | null;
  edited_at?: string | null;
  is_deleted?: boolean | null;
  deleted_at?: string | null;
  client_message_id?: string | null;
  created_at: string;
}

/** Raw `chat_message_actions` row. */
export interface RawChatMessageAction {
  id: string;
  message_id: string;
  user_id: string;
  action_type: string;
  payload?: Record<string, unknown> | null;
  created_at: string;
}

/**
 * Reactions folded onto a message: `action_type` → the set of user ids who
 * applied it. The viewer's membership in a set drives the reaction chip's
 * `aria-pressed`. Stored as a plain record (not a Map) so React Query's
 * structural sharing keeps working.
 */
export type ReactionState = Record<string, string[]>;

/** Normalized client-side message. `_`-prefixed fields are client-only. */
export interface ChatMessage {
  id: string;
  channel_id: string;
  sender_id: string;
  content: string;
  kind: ChatMessageKind;
  payload: Record<string, unknown> | null;
  reply_to_id: string | null;
  is_pinned: boolean;
  pinned_at: string | null;
  edited_at: string | null;
  is_deleted: boolean;
  created_at: string;
  /** Always present. Equals `client_message_id`, or the server id as a fallback. */
  client_message_id: string;
  reactions: ReactionState;
  _status: MessageStatus;
  _error?: string;
}

/**
 * Normalized per-channel cache. `order` holds the cache key of each message
 * (server `id` once confirmed, else `client_message_id`) sorted ascending by
 * `created_at`. `actionIndex` maps a `chat_message_actions.id` back to its
 * `(messageKey, actionType, userId)` so a Postgres `DELETE` event — which only
 * carries the row id under the default replica identity — can be resolved.
 */
export interface ChannelCache {
  byId: Record<string, ChatMessage>;
  order: string[];
  actionIndex: Record<
    string,
    { messageKey: string; actionType: string; userId: string }
  >;
}

function coerceKind(kind: string | null | undefined): ChatMessageKind {
  const found = CHAT_MESSAGE_KINDS.find((k) => k === kind);
  return found ?? "text";
}

/** Normalizes a raw row into a confirmed cache message. */
export function normalizeRow(row: RawChatMessage): ChatMessage {
  const clientId =
    typeof row.client_message_id === "string" && row.client_message_id.length > 0
      ? row.client_message_id
      : row.id;
  return {
    id: row.id,
    channel_id: row.channel_id,
    sender_id: row.sender_id,
    content: row.content ?? "",
    kind: coerceKind(row.kind),
    payload: row.payload ?? null,
    reply_to_id: row.reply_to_id ?? null,
    is_pinned: Boolean(row.is_pinned),
    pinned_at: row.pinned_at ?? null,
    edited_at: row.edited_at ?? null,
    is_deleted: Boolean(row.is_deleted) || row.deleted_at != null,
    created_at: row.created_at,
    client_message_id: clientId,
    reactions: {},
    _status: "confirmed",
  };
}

/** Builds the optimistic message inserted by `sendMessage` before the server replies. */
export function optimisticMessage(args: {
  clientMessageId: string;
  channelId: string;
  senderId: string;
  content: string;
  kind?: ChatMessageKind;
  payload?: Record<string, unknown> | null;
  replyToId?: string | null;
}): ChatMessage {
  return {
    id: args.clientMessageId,
    channel_id: args.channelId,
    sender_id: args.senderId,
    content: args.content,
    kind: args.kind ?? "text",
    payload: args.payload ?? null,
    reply_to_id: args.replyToId ?? null,
    is_pinned: false,
    pinned_at: null,
    edited_at: null,
    is_deleted: false,
    created_at: new Date().toISOString(),
    client_message_id: args.clientMessageId,
    reactions: {},
    _status: "pending",
  };
}
