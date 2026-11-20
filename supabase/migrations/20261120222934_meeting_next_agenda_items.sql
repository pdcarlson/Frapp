-- Add to next meeting's agenda (#5790, spec/behavior/meetings.md § Suggested
-- tasks, spec/behavior/events.md § Suggested agenda items).
--
-- 1. `meeting_next_agenda_items`: an action item of posted minutes an officer
--    sent to the next meeting's agenda instead of making it a task. It names
--    no meeting (Paul, 2026-11-18: no rule picks "the next instance"): every
--    upcoming meeting with the same audience as those minutes offers it under
--    Suggested, as it offers what they tabled, until an agenda adds it. RLS
--    on and no policies: API only (service role), like `ai_suggestions`.
--    - `ai_suggestion_id` (unique): the suggested task it was sent from, so a
--      suggestion sent twice is one item. Set null if that row goes.
--    - Deleting the minutes deletes it: its words came from them.
-- 2. `event_agenda_suggestions.kind` gains `minutes`: such an item offered
--    under one event's agenda, with `source_meeting_id` the minutes it was
--    sent from.
--
-- Locks. The new table's foreign keys add triggers to `chapters`,
-- `meetings`, `ai_suggestions` and `users`, each taking SHARE ROW EXCLUSIVE
-- until commit; the table is new and empty, so that is milliseconds.
-- Swapping the kind check takes ACCESS EXCLUSIVE on
-- `event_agenda_suggestions` for the drop and the add; the add is NOT VALID
-- and the validate that follows takes only SHARE UPDATE EXCLUSIVE while it
-- reads the table (a few rows per upcoming meeting).

-- 1. ------------------------------------------------------------------------

create table if not exists public.meeting_next_agenda_items (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references chapters(id) on delete cascade,
  meeting_id uuid not null references meetings(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 200),
  ai_suggestion_id uuid references ai_suggestions(id) on delete set null,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint meeting_next_agenda_items_suggestion_key unique (ai_suggestion_id)
);

alter table public.meeting_next_agenda_items enable row level security;

-- What earlier minutes sent on, read for each upcoming meeting's Suggested
-- list; also the cascade from `meetings`.
create index if not exists idx_meeting_next_agenda_items_meeting
  on public.meeting_next_agenda_items (chapter_id, meeting_id);

-- The cascades from `meetings` and `users`.
create index if not exists idx_meeting_next_agenda_items_meeting_id
  on public.meeting_next_agenda_items (meeting_id);
create index if not exists idx_meeting_next_agenda_items_created_by
  on public.meeting_next_agenda_items (created_by)
  where created_by is not null;

-- 2. ------------------------------------------------------------------------

alter table public.event_agenda_suggestions
  drop constraint if exists event_agenda_suggestions_kind_check;

alter table public.event_agenda_suggestions
  add constraint event_agenda_suggestions_kind_check
  check (kind in ('tabled', 'minutes', 'ai')) not valid;

alter table public.event_agenda_suggestions
  validate constraint event_agenda_suggestions_kind_check;
