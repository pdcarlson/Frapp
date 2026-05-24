-- Chunk 03: onboarding wizard support
--
-- 1. Seed the well-known system user (all-zeros UUID) used as sender_id for
--    system_audit chat messages — the onboarding welcome message and the
--    Chunk 02 audit bridge (chapter-config.service.postAuditMessage). Without
--    this row the NOT NULL FK chat_messages.sender_id -> users(id) rejects
--    every system-authored post, so the audit bridge silently no-ops.
-- 2. chapter_directory_requests: captures manual-entry chapters (the officer's
--    chapter was not found in the directory) so the curated seed can be
--    backfilled later (#232). One row per manual onboarding submission.

-- ── system user (sender_id for system_audit messages) ──────────────────────

insert into users (id, supabase_auth_id, email, display_name)
values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000000',
  'system@frapp.local',
  'Frapp System'
)
on conflict (id) do nothing;

-- ── chapter_directory_requests ─────────────────────────────────────────────

create table chapter_directory_requests (
  id                   uuid         primary key default gen_random_uuid(),
  -- set null (not cascade): keep the backfill candidate even if the chapter is
  -- later deleted. requested_by is resolved from the authenticated session by
  -- the API, never from the client payload.
  chapter_id           uuid         references chapters(id) on delete set null,
  requested_by         uuid         references users(id) on delete set null,
  org_letters          text,
  org_name             text,
  chapter_designation  text,
  university           text         not null,
  university_short     text,
  founded_year         int,
  archetype            text,
  notes                text,
  status               text         not null default 'pending'
                         check (status in ('pending','imported','rejected')),
  created_at           timestamptz  not null default now()
);

-- Backfill queue scan (pending first, newest first) + per-chapter lookup
create index idx_chapter_directory_requests_status
  on chapter_directory_requests (status, created_at desc);
create index idx_chapter_directory_requests_chapter
  on chapter_directory_requests (chapter_id);

alter table chapter_directory_requests enable row level security;
-- No client policies: like chapter_directory, this table is API-only (service
-- role). It holds backfill candidates for the curated seed, not member-visible
-- chapter data.
