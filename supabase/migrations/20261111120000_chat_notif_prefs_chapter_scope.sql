-- A member's chapter-wide chat level (#3840): "Mentions and DMs only" from
-- Settings → Notifications.
--
-- One more arm on `chat_notification_preferences`: `scope = 'chapter'`, with
-- both `scope_id` and `scope_kind` null, at most one row per (user, chapter).
-- `resolveLevel` (apps/api/src/application/services/push-rules.ts) reads it
-- after the channel and kind rows and before the channel's default, and only
-- ever to lower an ordinary channel's default: DMs, group DMs and the
-- announcements channel are untouched, and so is a channel already `off`.
--
-- "All messages" is the absence of a row (the API deletes it), so the table
-- only ever holds `mentions` here. The CHECK still allows the full level set
-- so a later "Off" needs no migration.

alter table chat_notification_preferences
  drop constraint chat_notif_prefs_scope_id_when_channel;

alter table chat_notification_preferences
  drop constraint chat_notification_preferences_scope_check;

alter table chat_notification_preferences
  add constraint chat_notification_preferences_scope_check
    check (scope in ('channel', 'kind', 'chapter'));

alter table chat_notification_preferences
  add constraint chat_notif_prefs_scope_id_when_channel
    check ((scope = 'channel' and scope_id is not null and scope_kind is null)
        or (scope = 'kind'    and scope_kind is not null and scope_id is null)
        or (scope = 'chapter' and scope_id is null and scope_kind is null));

-- The upsert target for the chapter arm. `nulls not distinct` so the two null
-- columns collide and a second write updates the row instead of adding one.
-- Channel rows differ by `scope_id` and kind rows by `scope_kind`, so neither
-- existing arm gains a collision it did not already have.
create unique index if not exists idx_chat_notif_prefs_chapter_unique
  on chat_notification_preferences (user_id, chapter_id, scope, scope_id, scope_kind)
  nulls not distinct;
