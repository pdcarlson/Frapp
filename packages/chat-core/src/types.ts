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
import {
  isChatMessageFlag,
  isDecodableThumbhash,
  type ChatMessageFlag,
} from "@repo/validation";

export const CHAT_MESSAGE_QUERY_ROOT = "chat" as const;

/** Query key for a channel's normalized message cache. */
export function chatMessagesKey(channelId: string) {
  return [CHAT_MESSAGE_QUERY_ROOT, channelId, "messages"] as const;
}

/** A message thread's parent and the viewer's follow (#3785). */
export function chatThreadKey(channelId: string, rootId: string) {
  return [CHAT_MESSAGE_QUERY_ROOT, channelId, "thread", rootId] as const;
}

/**
 * A message thread's reply cache (#3785), in the `ChannelCache` shape. Its
 * replies are rows of the channel that never sit in the channel's cache.
 */
export function chatThreadRepliesKey(channelId: string, rootId: string) {
  return [
    CHAT_MESSAGE_QUERY_ROOT,
    channelId,
    "thread",
    rootId,
    "replies",
  ] as const;
}

/**
 * The cache that holds a message: its thread's when it is a thread reply
 * (`threadRootId`), else its channel's. Every row write (react, edit, delete,
 * a card action) patches through this, so a reply's write lands where the
 * thread panel reads it (#4034).
 */
export function messageCacheKey(
  channelId: string,
  threadRootId?: string | null,
) {
  return threadRootId
    ? chatThreadRepliesKey(channelId, threadRootId)
    : chatMessagesKey(channelId);
}

/** Prefix that marks a `chat_message_actions.action_type` as an emoji reaction. */
const REACTION_ACTION_PREFIX = "reaction:";

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
 * - `recorded` asserts the write **did** happen and the chat card did not.
 *   Reached on an explicit `card_posted: false` (#1789). Retry is the dangerous
 *   action here (a fresh command mints a new key and doubles an append-only
 *   write); there is no `_replay` and the UI must not offer one. Distinct from
 *   `unconfirmed` on purpose: collapsing them would put a Retry in front of a
 *   committed row that `/task` and `/event` cannot dedupe.
 *
 * Collapsing `failed` and `unconfirmed` would put a discard control in front
 * of a committed ledger row, which is the append-only double-grant
 * `points.md` § Anti-Fraud exists to prevent.
 */
export type MessageStatus =
  "pending" | "confirmed" | "failed" | "unconfirmed" | "recorded";

export const CHAT_MESSAGE_KINDS = [
  "text",
  "event",
  "task",
  "poll",
  "dues",
  "points",
  "hours",
  "rush",
  "system_audit",
  "imported",
  "loading",
  "announcement",
  "signup",
  "form",
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
  /** The message's flag (#3921), who added it and when; see `ChatMessage.flag`. */
  flag?: string | null;
  flagged_by?: string | null;
  flagged_at?: string | null;
  edited_at?: string | null;
  is_deleted?: boolean | null;
  deleted_at?: string | null;
  client_message_id?: string | null;
  /**
   * `users.id` of everyone the body mentions, plus a reply's quoted author,
   * resolved by the API at send and edit time
   * (`spec/behavior/chat/README.md` § Mentions). `null` on a masked
   * row, whose mentions the server withholds with its body.
   */
  mentions?: string[] | null;
  /** The parent when this row is a thread reply (#3785); see `ChatMessage.thread`. */
  thread_root_id?: string | null;
  thread_reply_count?: number | null;
  thread_last_reply_at?: string | null;
  thread_recent_sender_ids?: string[] | null;
  /** The parent's newest reply not deleted (#4297); see `ThreadSummary.last_reply`. */
  thread_last_reply?: RawThreadLastReply | null;
  /**
   * Whether the server evaluated the viewer's block list and found this row's
   * sender on it (#2257, `spec/behavior/chat/README.md` § The masking contract).
   *
   * Optional **here and only here**, because the two sources this shape covers
   * are genuinely different. The REST reads set it on every row, masked or not,
   * which is what lets a client tell "the server does not mask" from "this
   * message is fine". The Postgres Changes echo is a raw table row with no
   * viewer attached and therefore carries no such column at all.
   *
   * So an absent value means "this row arrived by a path that could not mask
   * it", and `normalizeRow` resolves that to `false` **and** records the
   * absence as `ChatMessage._blockEvaluated: false`. The `false` is NOT the
   * masking signal — a client still applies its own list to echoed rows, which
   * is exactly why the contract requires `GET /v1/chat/blocks` to exist — and
   * the provenance flag is how it knows which rows need that (#2315).
   */
  sender_blocked?: boolean | null;
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
  /**
   * The flag a member put on this message after it was sent (#3921), or
   * `null`. A value outside `CHAT_MESSAGE_FLAGS` (a flag a newer server added)
   * normalizes to `null`, so an older client draws nothing rather than a
   * label it cannot name. All three fields are null together.
   * `spec/behavior/chat/README.md` § Message flags.
   *
   * Optional only so a hand-built message (a test fixture) need not name it;
   * `normalizeRow` always sets all three.
   */
  flag?: ChatMessageFlag | null;
  /**
   * Who added the flag. `null` with a flag set means the server withheld
   * them (the viewer blocked them) or their account is gone: draw the flag
   * with no "flagged by".
   */
  flagged_by?: string | null;
  flagged_at?: string | null;
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
  /**
   * Each photo's display geometry, from `metadata.attachment_photos` (#3879):
   * one entry per photo, sized or not, so `attachment_count` minus its length
   * is the number of files. Lets a reader draw each photo's box, blurred,
   * before the attachments read returns. `undefined` on a message sent before
   * the server stamped it (and on any import), which then draws as it did.
   */
  attachment_photos?: readonly AttachmentPhoto[];
  /**
   * The GIF this message is (#4631), from `metadata.gif`, which only the
   * server writes, after holding its URL to the GIF provider's media host.
   * A GIF message has no text and no files. Absent on every other message.
   */
  gif?: MessageGif;
  /**
   * Who the body mentions, plus a reply's quoted author, as the API resolved
   * it (`users.id`). The one
   * per-message answer to "was I addressed": the in-body chip marks any
   * `@handle`, this marks only the members the server notified (#1192). Empty
   * until the server's row arrives, so an optimistic send highlights nobody.
   */
  mentions: string[];
  /**
   * The parent message when this row is a reply inside a message thread
   * (#3785, `spec/behavior/chat/README.md` § Message threads); `null` for a
   * timeline message. A thread reply never belongs in a channel's timeline
   * cache. Optional so an optimistic row built before threads still types.
   */
  thread_root_id?: string | null;
  /**
   * On a thread's parent, its summary for the chip ("3 replies · last reply
   * 5m ago", up to three avatars); `null` on a message nobody has replied to
   * in a thread. The server's trigger keeps it, and the parent's UPDATE echo
   * carries it.
   */
  thread?: ThreadSummary | null;
  /**
   * Whether the **server** masked this row for the viewer, set on every row
   * rather than only the masked ones (#2257).
   *
   * Not a substitute for the client's own list. Rows arriving over the Realtime
   * echo carry no viewer and normalize to `false` here whatever the viewer's
   * list says, so a client that rendered on this flag alone would show a
   * blocked member's *live* messages in full. Read it as "the server already
   * masked this one", and keep applying the list from `GET /v1/chat/blocks` on
   * top — `spec/behavior/chat/README.md` § The masking contract.
   *
   * Required, deliberately: `normalizeRow` always sets it, and an optional flag
   * would put "is it there?" in front of every reader.
   *
   * Meaningful only alongside {@link ChatMessage._blockEvaluated}: on a row the
   * server never evaluated, `false` is a default, not a verdict. `true` on such
   * a row is a verdict carried over: `mergeServerRow` keeps it when an echo
   * overwrites a copy the server masked, so the echo's raw body still reads as
   * one the server withheld from this viewer.
   */
  sender_blocked: boolean;
  /**
   * Whether this row reached the cache through a read that ran the viewer's
   * block list over it — i.e. the raw row carried a `sender_blocked` field
   * (#2315, `spec/behavior/chat/README.md` § The masking contract).
   *
   * **Provenance, not timing.** The Realtime `postgres_changes` echo (INSERT
   * *and* UPDATE) carries no viewer and no such field, so a row it delivers is
   * unevaluated; so is the viewer's own send/edit/delete response. REST reads
   * (the initial page, the reconnect backfill, the polling fallback) carry it on
   * every row. `mergeServerRow` replaces a cached row wholesale, so a later echo
   * of an evaluated row — a pin, an edit, a duplicate INSERT — clears this back
   * to `false`, which is right: the raw row it wrote is unmasked content. If
   * the overwritten row was server-*masked*, `mergeServerRow` carries its
   * `sender_blocked: true` onto the echo (still unevaluated), because the
   * echo's body is exactly what the mask withheld.
   *
   * Never derive this from `created_at`: a timestamp says when a row was
   * written, never how it arrived, and an UPDATE echo re-delivers a row under
   * the same `created_at` it was read with.
   *
   * `_`-prefixed because it is client-derived state, not a column. A consumer
   * that renders a row with this `false` must first tombstone it if
   * `sender_blocked` is `true` (a verdict carried over from a masked copy —
   * its body is what the mask withheld) unless the consumer has confirmed
   * unblocking the sender, then apply its own block list, and must hold the
   * row, not render it, while that list is loading or unavailable — unless
   * the consumer confirmed unblocking the sender, or already showed the row
   * against a ready list or as a server-cleared row while the list was not
   * ready (a pin or edit echo replaces it unevaluated), since nothing
   * re-evaluates an echoed row: the
   * reconnect backfill reads only after the last-seen cursor, which the echo
   * itself advanced (`classifyMessage` and `blockClearance` in `./blocks.ts`,
   * which the mobile thread and the web timeline both classify through;
   * `spec/behavior/chat/README.md` § The masking contract has every rule).
   */
  _blockEvaluated: boolean;
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

/** A thread parent's summary, as `normalizeRow` reads it off the row. */
export interface ThreadSummary {
  reply_count: number;
  last_reply_at: string | null;
  /** Up to three, newest first. */
  recent_sender_ids: string[];
  /**
   * The newest reply that isn't deleted, for the thread card's preview line
   * (#4297). `null` (or absent, on a row from an older server) when there is
   * none to show, including on a read that masked a replier the viewer
   * blocked. The Realtime echo carries it unmasked, so a client shows it only
   * through `threadPreviewVisible`.
   */
  last_reply?: ThreadLastReply | null;
}

/** The parent's copy of its newest reply, as the API serves it. */
export interface RawThreadLastReply {
  id?: unknown;
  sender_id?: unknown;
  content?: unknown;
  kind?: unknown;
  attachment_count?: unknown;
  created_at?: unknown;
  sender_blocked?: unknown;
}

/** The parent's copy of its newest reply, read defensively (#4297). */
export interface ThreadLastReply {
  id: string;
  sender_id: string | null;
  /** Cut to 500 characters by the server; flatten it with `replyPreviewText`. */
  content: string;
  kind: ChatMessageKind;
  attachment_count: number;
  created_at: string;
  /**
   * The server's verdict that it withheld this preview because the viewer
   * blocked its replier (`content` is then empty). Only a REST read sets it;
   * `mergeServerRow` carries it onto the parent's next Realtime echo while the
   * same replier's reply is still the latest, as it carries a masked
   * message's `sender_blocked`.
   */
  sender_blocked: boolean;
}

/**
 * The parent's newest reply, or `null` when the row carries none or one this
 * client can't read: without its id there is no reply to classify.
 */
function threadLastReplyOf(
  raw: RawThreadLastReply | null | undefined,
): ThreadLastReply | null {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.id !== "string" || raw.id.length === 0) return null;
  return {
    id: raw.id,
    sender_id: typeof raw.sender_id === "string" ? raw.sender_id : null,
    content: typeof raw.content === "string" ? raw.content : "",
    kind: coerceKind(typeof raw.kind === "string" ? raw.kind : null),
    attachment_count: attachmentCount({
      attachment_count: raw.attachment_count,
    }),
    created_at: typeof raw.created_at === "string" ? raw.created_at : "",
    sender_blocked: raw.sender_blocked === true,
  };
}

/**
 * The parent's thread summary, or `null` when it has no replies. Defensive
 * like `attachmentCount`: an absent or malformed count is no thread.
 */
function threadSummaryOf(row: RawChatMessage): ThreadSummary | null {
  const count = row.thread_reply_count;
  if (typeof count !== "number" || !Number.isFinite(count) || count < 1) {
    return null;
  }
  return {
    reply_count: Math.floor(count),
    last_reply_at: row.thread_last_reply_at ?? null,
    recent_sender_ids: Array.isArray(row.thread_recent_sender_ids)
      ? row.thread_recent_sender_ids
          .filter((id): id is string => typeof id === "string")
          .slice(0, 3)
      : [],
    last_reply: threadLastReplyOf(row.thread_last_reply),
  };
}

/**
 * A row's flag fields, or all three null when the flag is absent or one this
 * client does not know (#3921).
 */
function flagOf(
  row: RawChatMessage,
): Pick<ChatMessage, "flag" | "flagged_by" | "flagged_at"> {
  if (!isChatMessageFlag(row.flag)) {
    return { flag: null, flagged_by: null, flagged_at: null };
  }
  return {
    flag: row.flag,
    flagged_by: row.flagged_by ?? null,
    flagged_at: row.flagged_at ?? null,
  };
}

/** Normalizes a raw row into a confirmed cache message. */
export function normalizeRow(row: RawChatMessage): ChatMessage {
  const clientId =
    typeof row.client_message_id === "string" &&
    row.client_message_id.length > 0
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
    ...flagOf(row),
    edited_at: row.edited_at ?? null,
    is_deleted: Boolean(row.is_deleted) || row.deleted_at != null,
    created_at: row.created_at,
    client_message_id: clientId,
    attachment_count: attachmentCount(row.metadata),
    ...attachmentPhotosField(row.metadata),
    ...gifField(row.metadata),
    mentions: mentionIds(row.mentions),
    thread_root_id: row.thread_root_id ?? null,
    thread: threadSummaryOf(row),
    // Absent means the row reached us by a path with no viewer to mask against
    // (the Postgres Changes echo), never "the sender is fine" — see
    // `RawChatMessage.sender_blocked`.
    sender_blocked: row.sender_blocked === true,
    // Presence of the field, not its value: a `false` the server wrote is a
    // verdict, an absent field is no verdict at all (#2315).
    _blockEvaluated: typeof row.sender_blocked === "boolean",
    reactions: {},
    actions: [],
    _status: "confirmed",
  };
}

/**
 * `normalizeRow`'s inverse: a normalized message back in the wire shape.
 *
 * Lives here, beside the function it must stay in step with, rather than in
 * whichever caller happens to need it. Every field `RawChatMessage` gains has
 * to be handled by both directions, and a projection kept in another package
 * would simply drop the new field — silently, because the round trip still
 * type-checks. `attachment_count` is the standing example: `normalizeRow`
 * derives it from `metadata`, so copying it across as a top-level field would
 * lose it.
 *
 * Client-only state (`_status`, `_error`, `_replay`) and the separately-carried
 * `reactions` / `actions` are deliberately not represented — the wire shape has
 * nowhere to put them, and whoever owns them re-applies them after the merge.
 *
 * `_blockEvaluated` is the one client-only field that *is* represented, because
 * the wire shape encodes it: `sender_blocked` is emitted only for a row the
 * server evaluated. Emitting it unconditionally would launder an unevaluated
 * Realtime echo into a "server-vouched" row on the way back through
 * `normalizeRow` — failing open on the block list (#2315).
 *
 * A verdict `mergeServerRow` carried onto an echo (unevaluated, with
 * `sender_blocked: true`) has no wire form: emitting the flag would claim the
 * server evaluated a raw body. So a persisted copy of one rehydrates as a plain
 * unevaluated echo, and a client restoring rows cannot rely on the carry.
 */
export function toRawRow(message: ChatMessage): RawChatMessage {
  return {
    id: message.id,
    channel_id: message.channel_id,
    sender_id: message.sender_id,
    author_name: message.author_name,
    author_avatar_path: message.author_avatar_path,
    author_external_id: message.author_external_id,
    content: message.content,
    kind: message.kind,
    payload: message.payload,
    reply_to_id: message.reply_to_id,
    metadata: {
      attachment_count: message.attachment_count,
      ...(message.attachment_photos
        ? { attachment_photos: message.attachment_photos }
        : {}),
      ...(message.gif ? { gif: message.gif } : {}),
    },
    is_pinned: message.is_pinned,
    pinned_at: message.pinned_at,
    flag: message.flag ?? null,
    flagged_by: message.flagged_by ?? null,
    flagged_at: message.flagged_at ?? null,
    edited_at: message.edited_at,
    is_deleted: message.is_deleted,
    client_message_id: message.client_message_id,
    mentions: message.mentions,
    thread_root_id: message.thread_root_id ?? null,
    thread_reply_count: message.thread?.reply_count ?? 0,
    thread_last_reply_at: message.thread?.last_reply_at ?? null,
    thread_recent_sender_ids: message.thread?.recent_sender_ids ?? [],
    thread_last_reply: message.thread?.last_reply ?? null,
    ...(message._blockEvaluated
      ? { sender_blocked: message.sender_blocked }
      : {}),
    created_at: message.created_at,
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

/** One photo's display geometry on a message (`metadata.attachment_photos`). */
export interface AttachmentPhoto {
  width: number | null;
  height: number | null;
  thumbhash: string | null;
}

/** The API's own bounds (`ChatAttachmentService`): at most 10 files, edges 1 to 20000 px. */
const MAX_ATTACHMENTS_PER_MESSAGE = 10;
const MAX_PHOTO_EDGE = 20_000;

function photoEdge(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_PHOTO_EDGE
    ? value
    : null;
}

/**
 * Reads `metadata.attachment_photos` defensively, as a spreadable field.
 *
 * Absent (an older message, an import, a masked row) or malformed reads as no
 * field at all, so the reader draws as it did before geometry existed. More
 * entries than `attachment_count`, or a count past the API's 10, is a row this
 * can't trust either: the API now drops a client's own copies of both keys,
 * but older rows stored them verbatim, and a forged count drew one placeholder
 * per claimed file. Each entry gets the API's own checks: a lone width or
 * height says nothing about the shape, so it keeps both or none, and a
 * ThumbHash a decoder can't read in full is dropped, because expo-image's iOS
 * decoder crashes on a short one (`isDecodableThumbhash`).
 */
function attachmentPhotosField(metadata: unknown): {
  attachment_photos?: AttachmentPhoto[];
} {
  if (!metadata || typeof metadata !== "object") return {};
  const raw = (metadata as Record<string, unknown>)["attachment_photos"];
  const count = attachmentCount(metadata);
  if (
    !Array.isArray(raw) ||
    raw.length > count ||
    count > MAX_ATTACHMENTS_PER_MESSAGE
  ) {
    return {};
  }
  const photos: AttachmentPhoto[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return {};
    const { width, height, thumbhash } = entry as Record<string, unknown>;
    const w = photoEdge(width);
    const h = photoEdge(height);
    const sized = w !== null && h !== null;
    photos.push({
      width: sized ? w : null,
      height: sized ? h : null,
      thumbhash: isDecodableThumbhash(thumbhash) ? thumbhash : null,
    });
  }
  return { attachment_photos: photos };
}

/**
 * A GIF message's GIF (`metadata.gif`, #4631), as the API's
 * `GifService.messageGif` wrote it.
 */
export interface MessageGif {
  provider: string;
  id: string;
  /** Short words for a screen reader; may be empty. */
  title: string;
  url: string;
  width: number;
  height: number;
}

/** What a client sends: the picker result's GIF and the token the API signed it with. */
export interface OutgoingGif extends MessageGif {
  token: string;
}

/** The API's own bound on a GIF's edges (`MAX_GIF_EDGE` in its GIF port). */
const MAX_GIF_EDGE = 4096;

/** The hosts GIF media may come from: the GIF provider's own (KLIPY). */
const GIF_MEDIA_HOSTS: readonly string[] = ["klipy.com"];

/** Whether a URL is the GIF provider's own https media, as the API requires. */
export function isGifMediaUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port)
    return false;
  const host = url.hostname.toLowerCase();
  return GIF_MEDIA_HOSTS.some(
    (media) => host === media || host.endsWith(`.${media}`),
  );
}

/**
 * Reads `metadata.gif` defensively, as a spreadable field. Anything but the
 * provider's own https media and two whole edges in range reads as no GIF, so
 * a malformed row, or one written before the server owned the key, never
 * draws an image from anywhere else.
 */
export function messageGifOf(metadata: unknown): MessageGif | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = (metadata as Record<string, unknown>)["gif"];
  if (!raw || typeof raw !== "object") return null;
  const { provider, id, title, url, width, height } = raw as Record<
    string,
    unknown
  >;
  if (typeof url !== "string" || !isGifMediaUrl(url)) return null;
  const edge = (value: unknown) =>
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_GIF_EDGE;
  if (!edge(width) || !edge(height)) return null;
  return {
    provider: typeof provider === "string" ? provider : "",
    id: typeof id === "string" ? id : "",
    title: typeof title === "string" ? title : "",
    url,
    width: width as number,
    height: height as number,
  };
}

/**
 * A GIF's box in the thread, from its stored edges, so the row never jumps
 * on load: as large as fits `max`, never larger than the GIF itself, and
 * never under a pixel on a side.
 */
export function gifBoxSize(
  gif: Pick<MessageGif, "width" | "height">,
  max: { width: number; height: number },
): { width: number; height: number } {
  const width = Math.max(
    1,
    Math.round(
      Math.min(gif.width, max.width, (max.height * gif.width) / gif.height),
    ),
  );
  return {
    width,
    height: Math.max(1, Math.round((width * gif.height) / gif.width)),
  };
}

function gifField(metadata: unknown): { gif?: MessageGif } {
  const gif = messageGifOf(metadata);
  return gif ? { gif } : {};
}

/**
 * `mentions` defensively: only an array of strings counts. A missing column
 * (an older cached row, a masked one) is no mentions, not an error.
 */
function mentionIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === "string");
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
  /** The GIF this send is, drawn at once from the picker's own result. */
  gif?: MessageGif | null;
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
    ...(args.gif ? { gif: args.gif } : {}),
    mentions: [],
    kind: args.kind ?? "text",
    payload: args.payload ?? null,
    reply_to_id: args.replyToId ?? null,
    is_pinned: false,
    pinned_at: null,
    flag: null,
    flagged_by: null,
    flagged_at: null,
    edited_at: null,
    is_deleted: false,
    created_at: new Date().toISOString(),
    client_message_id: args.clientMessageId,
    // An optimistic row is the viewer's own message. You cannot block yourself
    // (`ChatBlockService.blockMember` refuses it), so this is false by
    // construction rather than by default.
    sender_blocked: false,
    // No server read has seen it. Harmless for the viewer's own row, which a
    // block list can never hide, and honest for anything that reads provenance.
    _blockEvaluated: false,
    reactions: {},
    actions: [],
    _status: "pending",
  };
}
