-- Chunk 02: chapter audit log
--
-- Append-only audit log for all officer actions. Every PATCH to chapter
-- config, role changes, dues changes, etc. writes a row here and the
-- chapter-config service also posts a system_audit chat message to
-- #chapter-audit so all members can see changes in real time.

create table chapter_audit_log (
  id              uuid         primary key default gen_random_uuid(),
  chapter_id      uuid         not null references chapters(id) on delete cascade,
  actor_user_id   uuid         not null references users(id) on delete cascade,
  action          text         not null,
  target_type     text         not null,
  target_id       text,
  scope           text         not null default 'chapter',
  diff            jsonb        not null default '{}',
  member_visible  boolean      not null default true,
  created_at      timestamptz  not null default now()
  -- Deliberately NO updated_at: this table is append-only.
  -- Policies below enforce no-update / no-delete.
);

-- Queries filter by chapter (descending time) and by actor
create index idx_audit_log_chapter_created_at on chapter_audit_log (chapter_id, created_at desc);
create index idx_audit_log_actor_created_at    on chapter_audit_log (actor_user_id, created_at desc);
create index idx_audit_log_chapter_visible     on chapter_audit_log (chapter_id, member_visible, created_at desc);

alter table chapter_audit_log enable row level security;

-- RLS: select is fine (API layer applies member-visibility filter).
-- Insert allowed (service role bypasses; direct client inserts are blocked
-- by the API guard layer, same as every other table in this schema).
-- Update and delete are denied at policy level to enforce append-only.
create policy "audit_log_no_update"
  on chapter_audit_log
  for update
  using (false);

create policy "audit_log_no_delete"
  on chapter_audit_log
  for delete
  using (false);
