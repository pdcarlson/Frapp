/**
 * Shared types and normalizers for the chat hot path.
 *
 * The message cache is normalized: a single query key per channel holds
 * `{ byId, order }`, which makes idempotent merge-by-id O(1) and removes the
 * dupe/flicker bugs you get from scanning a flat array. Every inbound row
 * (Edge Function response, Postgres Changes echo, REST backfill) flows through
 * the same `mergeServerRow` in `./cache`, reconciled by `client_message_id`.
 */

import type { components } from "@repo/api-sdk/types";

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

/**
 * Lifecycle of a client-side message relative to the server.
 *
 * `failed` and `unconfirmed` are NOT interchangeable, and the difference is the
 * whole point of the second one (#1733):
 *
 * - `failed` asserts the write did **not** happen. `markFailed` is reached from
 *   a definitive 4xx, so the UI may safely offer retry *or* discard, and a
 *   re-send is a new attempt.
 * - `unconfirmed` asserts nothing. It is reached when the response was lost —
 *   a gateway 502/504, or a transport throw — after a request that may well
 *   have committed. Discarding is not safe (the row may exist and this is its
 *   only trace) and neither is a fresh attempt (it would double the write).
 *   The only correct action is replaying the **same** `client_message_id`, so
 *   the server's idempotency index can recognise it.
 *
 * Collapsing the two would put a discard control in front of a committed
 * ledger row, which is the append-only double-grant `points.md` § Anti-Fraud
 * exists to prevent.
 */
export type MessageStatus =
  | "pending"
  | "confirmed"
  | "failed"
  | "unconfirmed";

export const CHAT_MESSAGE_KINDS = [
  "text",
  "event",
  "task",
  "poll",
  "dues",
  "points",
  "hours",
  "system_audit",
  "imported",
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
  /** `null` for a message with no Signet user behind it — see `ChatMessage.sender_id`. */
  sender_id: string | null;
  author_name?: string | null;
  author_avatar_path?: string | null;
  author_external_id?: string | null;
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
  /**
   * `users.id` of the sender, or `null` when the author is not a Signet user —
   * today only an imported archive row (`kind: "imported"`). The database
   * guarantees a null sender carries an `author_name`, so a message is never
   * anonymous, but nothing may assume this is a string.
   *
   * Do not build a label from this directly: `resolveAuthorLabel` in
   * `@repo/hooks` holds the one author_name → roster → truncated-id fallback that
   * web and mobile share.
   */
  sender_id: string | null;
  /** Author display name for a message with no `sender_id`. */
  author_name: string | null;
  /** Object path in the `chat-archive` bucket, or null. Not a URL. */
  author_avatar_path: string | null;
  /** The author's source-system id. Identity, not idempotency. */
  author_external_id: string | null;
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
  /**
   * How many `chat_message_attachments` rows this message has.
   *
   * A count, not the attachments themselves. The rows are the source of truth
   * and are fetched on demand — they need a per-request signed download URL, so
   * there is nothing durable to cache — but a `postgres_changes` echo cannot
   * carry a join, so this is how a client learns there is anything to fetch. A
   * file-only message would otherwise render as an empty bubble for everyone
   * except its sender. Read from `metadata.attachment_count`, which the server
   * stamps at send time.
   */
  attachment_count: number;
  reactions: ReactionState;
  /**
   * Raw `chat_message_actions` rows for this message. Polls / card actions
   * need the per-row `payload` (vote option id, RSVP state, …) which the
   * compact `reactions` aggregate cannot represent. Kept in addition to
   * `reactions` so emoji-reaction chips stay O(1) lookups.
   */
  actions: RawChatMessageAction[];
  _status: MessageStatus;
  _error?: string;
  /**
   * Present only on `_status: "unconfirmed"` rows: exactly what an explicit
   * retry must replay (#1733). Carrying it on the row is what makes the retry
   * *this attempt's* rather than a fresh one — the body and, critically, the
   * `client_message_id` are the originals, so the server's idempotency index
   * recognises the replay instead of writing a second ledger row.
   */
  _replay?: ReplayRequest;
}

/**
 * A request that may be replayed verbatim under its original idempotency key.
 *
 * Deliberately a single-member union rather than a bare interface: `/points` is
 * the only command with a server-side dedupe index today
 * (`idx_point_transactions_dedupe`, #1719). `/task` and `/event` have none, so
 * replaying one would create a *second* task or event rather than
 * deduplicating.
 *
 * **Do not widen this union until the route you are adding has a server-side
 * dedupe index.** No open issue owns task/event idempotency — #1717 is scoped
 * to their response DTOs and `card_posted`, not to a dedupe key, and #1734's
 * body still names #1733 as what would give them one, which is no longer true
 * (#1733 shipped the `/points` half only). The discriminant makes widening a
 * compile-time decision rather than a silent one.
 */
export type ReplayRequest = {
  command: "points";
  channelId: string;
  clientMessageId: string;
  body: PointsAdjustBody;
};

/**
 * The `POST /v1/points/adjust` body, as `dispatchPoints` builds it.
 *
 * Derived from the generated contract rather than restated, so a change to the
 * route's DTO reaches this type. The call site alone does not cover that: it
 * would catch a rename or a new required field, but a *widened* member — a
 * third `category`, say — leaves a hand-written copy silently narrower, still
 * assignable to the POST and quietly unable to replay the new value.
 *
 * The two overrides are the difference between the route's contract and this
 * one. `AdjustPointsDto` marks both optional because a dashboard adjustment
 * sends neither; a replay is meaningless without both, since the whole point is
 * to re-send the original key to the original channel.
 */
export type PointsAdjustBody = Omit<
  components["schemas"]["AdjustPointsDto"],
  "channel_id" | "client_message_id"
> & {
  channel_id: string;
  client_message_id: string;
};

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
    sender_id: row.sender_id ?? null,
    author_name: row.author_name ?? null,
    author_avatar_path: row.author_avatar_path ?? null,
    author_external_id: row.author_external_id ?? null,
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
    attachment_count: attachmentCount(row.metadata),
    reactions: {},
    actions: [],
    _status: "confirmed",
  };
}

/**
 * Reads `metadata.attachment_count` defensively.
 *
 * `metadata` is free-form jsonb written by several services, and this key is
 * absent on every message sent before attachments existed. Anything that is not
 * a non-negative finite number counts as zero rather than being coerced — a
 * `NaN` here would render as "NaN files".
 */
function attachmentCount(metadata: unknown): number {
  if (!metadata || typeof metadata !== "object") return 0;
  const raw = (metadata as Record<string, unknown>)["attachment_count"];
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return 0;
  return Math.floor(raw);
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
  /** How many files this send is carrying, so the pending row is not blank. */
  attachmentCount?: number;
}): ChatMessage {
  return {
    id: args.clientMessageId,
    channel_id: args.channelId,
    sender_id: args.senderId,
    // An optimistic message is always authored by the signed-in viewer, so the
    // author_* trio — which exists for rows with no Signet user behind them — is
    // null by construction here.
    author_name: null,
    author_avatar_path: null,
    author_external_id: null,
    content: args.content,
    // Carried from the send, not left at zero. The composer clears its chips
    // synchronously on submit, and an offline send sits in the outbox until
    // reconnect — so a zero here renders an attachment-only message as a
    // completely blank bubble to its own sender, for as long as it is queued.
    attachment_count: args.attachmentCount ?? 0,
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
    actions: [],
    _status: "pending",
  };
}
