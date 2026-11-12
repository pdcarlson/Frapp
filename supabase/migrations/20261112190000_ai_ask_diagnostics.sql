-- Ask Frapp's beta diagnostics window (#4315; ADR-28 decision 8,
-- spec/behavior/ai.md § Stored AI text).
--
-- Ask stores nothing. The one exception is a 14-day window in which one
-- chapter's questions and answers are kept, sealed, for the Frapp team to
-- fix problems during the beta. The API offers it only to the chapter the
-- server names (`AI_DIAGNOSTICS_CHAPTER_ID`), only while it holds a sealing
-- key (`AI_STORED_TEXT_KEY`), and only after that chapter's president said
-- yes, which the audit log records.
--
-- 1. `ai_diagnostics_windows`: one row while a window is open, and no row
--    otherwise. Turning the window off, and its end date arriving, are both
--    a delete of this row. The unique index on a constant allows one row in
--    the whole table: one chapter, as the decision says. The check holds the
--    end date to at most 14 days after the start, so nothing can extend it.
-- 2. `ai_diagnostics_exchanges`: one sealed question and answer. Its text
--    is ciphertext (`v1.<key id>.<nonce>.<tag>.<ciphertext>`, AES-256-GCM,
--    sealed by the API); the database never sees the words. Every foreign
--    key cascades, so a row goes with its window (off means nothing kept),
--    with its chapter, with the asker's membership (they left the chapter,
--    or deleted their account, which removes their memberships) and with
--    the asker's user row.
--
-- Both tables have RLS on and no policies: the API reads and writes them
-- with the service role. Writes no row.
--
-- Locks. The foreign keys add triggers to `chapters`, `users` and `members`,
-- taking a SHARE ROW EXCLUSIVE lock on each until commit. The tables are
-- new and empty, so that is milliseconds.

-- 1. ------------------------------------------------------------------------

create table if not exists public.ai_diagnostics_windows (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null unique references chapters(id) on delete cascade,
  -- The president who said yes. Kept as an id only; the audit log holds the
  -- record of the decision.
  started_by uuid references users(id) on delete set null,
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  constraint ai_diagnostics_windows_at_most_14_days
    check (ends_at > started_at and ends_at <= started_at + interval '14 days')
);

-- One open window on the whole platform.
create unique index if not exists ai_diagnostics_windows_only_one
  on public.ai_diagnostics_windows ((true));

create index if not exists ai_diagnostics_windows_ends_at
  on public.ai_diagnostics_windows (ends_at);

alter table public.ai_diagnostics_windows enable row level security;

comment on table public.ai_diagnostics_windows is
  'The open Ask diagnostics window; a row exists only while questions are being kept, and at most one row exists. API only. See 20261112190000_ai_ask_diagnostics.sql.';

-- 2. ------------------------------------------------------------------------

create table if not exists public.ai_diagnostics_exchanges (
  id uuid primary key default gen_random_uuid(),
  window_id uuid not null
    references ai_diagnostics_windows(id) on delete cascade,
  chapter_id uuid not null references chapters(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  -- The sealed question, answer and source names. Ciphertext only.
  sealed text not null,
  created_at timestamptz not null default now()
);

create index if not exists ai_diagnostics_exchanges_window
  on public.ai_diagnostics_exchanges (window_id);
create index if not exists ai_diagnostics_exchanges_chapter
  on public.ai_diagnostics_exchanges (chapter_id);
create index if not exists ai_diagnostics_exchanges_member
  on public.ai_diagnostics_exchanges (member_id);
create index if not exists ai_diagnostics_exchanges_user
  on public.ai_diagnostics_exchanges (user_id);

alter table public.ai_diagnostics_exchanges enable row level security;

comment on table public.ai_diagnostics_exchanges is
  'Sealed Ask questions and answers kept under the open diagnostics window; deleted with the window. API only. See 20261112190000_ai_ask_diagnostics.sql.';
