export type ChannelType = 'PUBLIC' | 'PRIVATE' | 'ROLE_GATED' | 'DM' | 'GROUP_DM';
export type MessageType = 'TEXT' | 'POLL';

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
  reply_to_id: string | null;
  metadata: Record<string, any>;
  is_pinned: boolean;
  pinned_at: string | null;
  edited_at: string | null;
  is_deleted: boolean;
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
