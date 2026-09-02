export type ChannelType =
  'PUBLIC' | 'PRIVATE' | 'ROLE_GATED' | 'DM' | 'GROUP_DM';
export type MessageType = 'TEXT' | 'POLL';

/**
 * Extended kind set carried on the hot path (Chunk 02 schema).
 * The legacy `type` (TEXT/POLL) is kept for backward compatibility;
 * `kind` carries the richer set going forward.
 */
export const CHAT_MESSAGE_KINDS = [
  'text',
  'event',
  'task',
  'poll',
  'dues',
  'points',
  'hours',
  'system_audit',
  'imported',
  'loading',
  'announcement',
] as const;
export type ChatMessageKind = (typeof CHAT_MESSAGE_KINDS)[number];

export interface ChatChannelCategory {
  id: string;
  chapter_id: string;
  name: string;
  display_order: number;
  created_at: string;
}

export interface ChatChannel {
  id: string;
  chapter_id: string;
  name: string;
  description: string | null;
  type: ChannelType;
  required_permissions: string[] | null;
  member_ids: string[] | null;
  category_id: string | null;
  is_read_only: boolean;
  created_at: string;
  /**
   * Set once a GROUP_DM's membership drops to <= 1 via the leave endpoint
   * (#348); null for every other channel and for a GROUP_DM still active.
   * `ChannelAccessService.filterAccessibleChannels` excludes an archived
   * channel from the active list; it stays directly reachable by id.
   */
  archived_at: string | null;
}

/**
 * `ChatChannel` plus the caller-scoped capability a client needs to decide
 * whether to render a live composer, without re-implementing
 * `canAccessChannel` or being shipped the caller's raw alumni/permission
 * state. Computed per request by `ChannelAccessService.withPostCapability`
 * against the same predicate the write path enforces — never persisted, and
 * never a column on the row.
 */
export type ChatChannelView = ChatChannel & { can_post: boolean };

export interface ChatMessage {
  id: string;
  channel_id: string;
  /**
   * `users.id` of the sender, or `null` for a message whose author is not a
   * Signet user — today only an imported Discord archive row (`kind:'imported'`).
   *
   * Nullable rather than pointing at a synthetic `users` row: a row in `users` is
   * reachable from the chapter roster, the members directory, server-side mention
   * resolution and `anonymize_user`, so minting one per Discord handle would
   * publish non-members into all four to satisfy a foreign key. The DB constraint
   * `chat_messages_author_present` guarantees that a null sender always comes with
   * an `author_name`, so no message is ever anonymous.
   *
   * Every read path must therefore treat this as optional. Resolve a display label
   * through `resolveAuthorLabel` in `@repo/hooks` rather than reaching for
   * `sender_id` directly — it encodes the author_name → roster → id fallback once.
   */
  sender_id: string | null;
  /**
   * Author display name as the source system recorded it, for messages with no
   * `sender_id`. Denormalised on purpose: there is no row to join to, and a
   * Discord nickname from 2019 is not a fact to re-derive later.
   */
  author_name?: string | null;
  /**
   * Object path (not a URL) in the `chat-archive` bucket for an imported author's
   * avatar. Buckets are private, so a URL would bake in a signed-link expiry.
   */
  author_avatar_path?: string | null;
  /**
   * The author's id in the source system (a Discord snowflake). Author identity,
   * NOT message idempotency — two messages from the same author share it. The
   * per-message key is `external_message_id`.
   */
  author_external_id?: string | null;
  /**
   * The *message's* id in the source system (a Discord message snowflake), and
   * the importer's idempotency key: `idx_chat_messages_external_dedupe` is
   * UNIQUE on `(channel_id, external_message_id)`, so re-running an import is a
   * no-op rather than a second copy of the archive.
   *
   * Deliberately not `client_message_id`, which phase 1 originally used. That
   * column is the *client's* optimistic-send key (ADR-03) — minted by the
   * composer, round-tripped through the offline outbox, and compared against by
   * both clients to swap an optimistic bubble for the confirmed row. A foreign
   * system's identifier is a different fact, and sharing one column made every
   * reader of either path check which kind of value it held.
   */
  external_message_id?: string | null;
  content: string;
  type: MessageType;
  /** Extended hot-path kind (Chunk 02). Optional for older rows; defaults to 'text'. */
  kind?: ChatMessageKind | null;
  /** Inline card payload for rich kinds (event, poll, task, …). */
  payload?: Record<string, any> | null;
  /**
   * Idempotency key from the client (`chat-send` / NestJS POST messages). The
   * importer does NOT use this — see `external_message_id`.
   */
  client_message_id?: string | null;
  reply_to_id: string | null;
  metadata: Record<string, any>;
  is_pinned: boolean;
  pinned_at: string | null;
  edited_at: string | null;
  is_deleted: boolean;
  /**
   * `users.id` of every member mentioned in `content`, resolved server-side at
   * send time (C1 of #937).
   *
   * Server-side because it is a security boundary, not a convenience: mentions
   * override a per-channel mute in the push rules, so a client-supplied list
   * would let any member force a push to any other member in a channel they had
   * deliberately muted. Unresolvable `@`-tokens are dropped silently — an `@` in
   * prose is not an error.
   *
   * Optional for rows written before the column existed.
   */
  mentions?: string[] | null;
  created_at: string;
}

/**
 * A file attached to a chat message.
 *
 * A row, not a substring of the message body. The composer used to append
 * `📎 <name> (<storagePath>)` into `content`, which meant the object had no link
 * back to the message: it could not be rendered, listed, or cleaned up, and a
 * member could edit the sigil out and orphan the file. `ON DELETE CASCADE` from
 * `message_id` is the half that makes deletion tractable.
 *
 * `channel_id` is denormalised alongside `message_id` so the row's chapter is one
 * hop away (`chat_channels.chapter_id`), matching `chat_messages` itself —
 * `chat_messages` has no `chapter_id` either. It is always derived from the
 * message server-side, never taken from a client payload.
 */
export interface ChatMessageAttachment {
  id: string;
  message_id: string;
  channel_id: string;
  bucket: string;
  storage_path: string;
  filename: string;
  /** Null on rows recovered by the legacy backfill, where only a path was known. */
  content_type: string | null;
  /** Null for the same reason — a size is not recoverable from prose. */
  byte_size: number | null;
  width: number | null;
  height: number | null;
  /**
   * Source-system URL, reserved and **never populated by the Discord importer**.
   *
   * The idea was a retry handle for a partial media fetch. The importer does not
   * fetch: the admin's browser uploads the export's media directly, and
   * `discord_import_files` maps each export-relative path to the object it
   * became — so "retry" is "re-upload and re-run", which that table already
   * expresses. Storing a Discord CDN link instead would be a private-bucket
   * bypass with an expiry baked in.
   *
   * It is also stripped by the attachment repository on the way out — see
   * `stripAttachmentRow` there — so it cannot reach a client whatever a future
   * writer puts in it. Declared here because the column exists on the row;
   * treat it as write-only.
   */
  external_url: string | null;
  created_at: string;
}

/**
 * An attachment as the API hands it to a client: the row plus a short-lived
 * signed download URL.
 *
 * The URL is minted per request rather than stored. Every bucket in this repo is
 * private, so there is no durable URL to persist — and persisting one would bake
 * in its expiry.
 */
export interface ChatMessageAttachmentWithUrl extends ChatMessageAttachment {
  download_url: string;
}

/**
 * Unread and mention tallies for one channel, for one viewer.
 *
 * Computed on demand by `get_channel_unread_counts` rather than stored: the
 * inputs are `channel_read_receipts.last_read_at` and the messages themselves,
 * so a materialised counter would be a cache to invalidate on every send, edit,
 * delete and read.
 */
export interface ChannelUnreadCount {
  channel_id: string;
  unread_count: number;
  mention_count: number;
}

/**
 * Per-user reaction / vote / RSVP / card-action row (Chunk 02).
 * Unique on (message_id, user_id, action_type); enforced by
 * `idx_chat_message_actions_dedupe`.
 */
export interface ChatMessageAction {
  id: string;
  message_id: string;
  user_id: string;
  action_type: string;
  payload: Record<string, any>;
  created_at: string;
}

export interface MessageReaction {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}

export interface ChannelReadReceipt {
  id: string;
  channel_id: string;
  user_id: string;
  last_read_at: string;
  updated_at: string;
}

/**
 * A member's private bookmark on one message (#462).
 *
 * The row is the whole of the fact: there is no state on the message, because
 * a bookmark is a property of the (viewer, message) pair rather than of the
 * message. Unique on `(user_id, message_id)`.
 *
 * `chapter_id` is denormalized from the message's channel so the per-chapter
 * list is one indexed read. It is always derived server-side from the channel
 * the message lives in — never accepted from a caller — so it cannot disagree
 * with the channel's own chapter.
 */
export interface ChatMessageBookmark {
  id: string;
  user_id: string;
  message_id: string;
  chapter_id: string;
  created_at: string;
}

/**
 * A bookmark joined to the message it points at, which is what the Bookmarks
 * view actually renders.
 *
 * `message` is deliberately non-optional and NOT filtered on `is_deleted`: the
 * spec requires a bookmark whose message was deleted to surface the
 * "[message deleted]" placeholder rather than disappear, and `deleteMessage`
 * already rewrites `content` to exactly that string while keeping the row. So
 * the placeholder is the message's own content, and the only way to break that
 * guarantee is to filter deleted rows out of this query.
 */
export interface ChatMessageBookmarkWithMessage extends ChatMessageBookmark {
  message: ChatMessage;
}
