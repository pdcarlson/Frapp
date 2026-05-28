export type ChannelType =
  | 'PUBLIC'
  | 'PRIVATE'
  | 'ROLE_GATED'
  | 'DM'
  | 'GROUP_DM';
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
}

export interface ChatMessage {
  id: string;
  channel_id: string;
  sender_id: string;
  content: string;
  type: MessageType;
  /** Extended hot-path kind (Chunk 02). Optional for older rows; defaults to 'text'. */
  kind?: ChatMessageKind | null;
  /** Inline card payload for rich kinds (event, poll, task, …). */
  payload?: Record<string, any> | null;
  /** Idempotency key from the client (`chat-send` / NestJS POST messages). */
  client_message_id?: string | null;
  reply_to_id: string | null;
  metadata: Record<string, any>;
  is_pinned: boolean;
  pinned_at: string | null;
  edited_at: string | null;
  is_deleted: boolean;
  created_at: string;
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
