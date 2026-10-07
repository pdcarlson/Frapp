import type {
  ChatNotificationLevel,
  ChatNotificationPreference,
} from '../entities/chat-notification-preference.entity';

export const CHAT_NOTIFICATION_PREFERENCE_REPOSITORY =
  'CHAT_NOTIFICATION_PREFERENCE_REPOSITORY';

/** The columns every read of `chat_notification_preferences` selects. */
export type ChatNotificationPreferenceRow = Pick<
  ChatNotificationPreference,
  'user_id' | 'chapter_id' | 'scope' | 'scope_id' | 'scope_kind' | 'level'
>;

/**
 * Per-channel and per-kind chat notification levels (ADR-06). The push worker
 * reads them in batches; `ChatService` reads and writes the caller's own.
 */
export interface IChatNotificationPreferenceRepository {
  /**
   * Every row for a batch of users in one chapter, grouped by user. A user
   * absent from the map has no stored preferences. **Never throws on a query
   * error**: a failing chunk degrades to absent, because the worker must keep
   * deciding pushes for the rest of the batch.
   */
  findForUsers(
    userIds: string[],
    chapterId: string,
  ): Promise<Map<string, ChatNotificationPreferenceRow[]>>;
  /** Channel-scoped rows for the caller's mute UI. Throws on a query error. */
  findChannelPreferencesForUser(
    userId: string,
    chapterId: string,
  ): Promise<ChatNotificationPreferenceRow[]>;
  /** Kind-scoped rows for the caller's settings UI. Throws on a query error. */
  findKindPreferencesForUser(
    userId: string,
    chapterId: string,
  ): Promise<ChatNotificationPreferenceRow[]>;
  /** Return one kind to its default. Deleting a missing row succeeds. */
  deleteKindLevel(
    userId: string,
    chapterId: string,
    kind: string,
  ): Promise<void>;
  upsertKindLevel(
    userId: string,
    chapterId: string,
    kind: string,
    level: ChatNotificationLevel,
  ): Promise<ChatNotificationPreferenceRow>;
  upsertChannelLevel(
    userId: string,
    chapterId: string,
    channelId: string,
    level: ChatNotificationLevel,
  ): Promise<ChatNotificationPreferenceRow>;
}
