/**
 * A member's per-scope chat notification setting, persisted to
 * `chat_notification_preferences` (`20260527120000_…preferences.sql`).
 *
 * A preference targets exactly one of two scopes, enforced by a table CHECK:
 *
 * * `scope: 'channel'` → `scope_id` is a `chat_channels.id`, `scope_kind` null
 * * `scope: 'kind'`    → `scope_kind` is a `chat_messages.kind`, `scope_id` null
 *
 * The table has no `created_at` — only `updated_at`, since a preference is
 * upserted rather than versioned.
 */
export type ChatNotificationScope = 'channel' | 'kind';

export type ChatNotificationLevel = 'all' | 'mentions' | 'off';

export interface ChatNotificationPreference {
  id: string;
  user_id: string;
  chapter_id: string;
  scope: ChatNotificationScope;
  /** Set when `scope` is `'channel'`; null otherwise. */
  scope_id: string | null;
  /** Set when `scope` is `'kind'`; null otherwise. */
  scope_kind: string | null;
  level: ChatNotificationLevel;
  updated_at: string;
}
