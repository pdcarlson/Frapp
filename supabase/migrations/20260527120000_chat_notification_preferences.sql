-- Chunk 05: chat_notification_preferences (per-channel + per-kind levels).
--
-- ADR-06: New table, NOT an extension of `notification_preferences`. The
-- existing table is boolean (`is_enabled`) and category-keyed; chat needs a
-- tri-state level (`all` | `mentions` | `off`) keyed by either a specific
-- channel id or a chat message kind (`system_audit`, …). Squatting on
-- `notification_preferences.category` to encode `channel:<uuid>` loses type
-- safety and complicates the migration path. A future unification PR can
-- consolidate when chat is the last preference producer.

create table chat_notification_preferences (
  id            uuid         primary key default gen_random_uuid(),
  user_id       uuid         not null references users(id) on delete cascade,
  chapter_id    uuid         not null references chapters(id) on delete cascade,
  -- scope:'channel' → scope_id is a chat_channels.id, scope_kind is null.
  -- scope:'kind'    → scope_kind is a chat_messages.kind, scope_id is null.
  scope         text         not null check (scope in ('channel','kind')),
  scope_id      uuid         null,
  scope_kind    text         null,
  level         text         not null check (level in ('all','mentions','off')),
  updated_at    timestamptz  not null default now(),
  -- Exactly one of scope_id / scope_kind must be present, matching `scope`.
  constraint chat_notif_prefs_scope_id_when_channel
    check ((scope = 'channel' and scope_id is not null and scope_kind is null)
        or (scope = 'kind'    and scope_kind is not null and scope_id is null))
);

-- One preference per (user, chapter, scope, key). The COALESCE turns the
-- nullable id/kind columns into a single non-null key so the unique index
-- can enforce both arms in one constraint.
create unique index idx_chat_notif_prefs_unique
  on chat_notification_preferences (
    user_id, chapter_id, scope, coalesce(scope_id::text, scope_kind)
  );

-- Worker reads recipient prefs filtered by user + chapter — primary path.
create index idx_chat_notif_prefs_user_chapter
  on chat_notification_preferences (user_id, chapter_id);

alter table chat_notification_preferences enable row level security;

-- Users can read their own preferences. Inserts/updates flow through the
-- API (service role); RLS denies direct client writes — the API guard
-- layer is the trust boundary, same as every other write table.
create policy "chat_notification_preferences_select_own"
  on chat_notification_preferences for select
  using (
    user_id in (select id from users where supabase_auth_id = auth.uid())
  );

create trigger trg_chat_notification_preferences_updated_at
  before update on chat_notification_preferences
  for each row execute function update_updated_at();
