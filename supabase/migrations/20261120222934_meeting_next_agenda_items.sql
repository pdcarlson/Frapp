-- Add to next meeting's agenda (#5790, spec/behavior/meetings.md § Suggested
-- tasks, spec/behavior/events.md § Suggested agenda items).
--
-- 1. `meeting_next_agenda_items`: an action item of posted minutes an officer
--    sent to the next meeting's agenda instead of making it a task. RLS on
--    and no policies: API only (service role), like `ai_suggestions`.
--    - `state` `placed`: it went straight onto the agenda of the next
--      upcoming meeting with the minutes' audience (`event_id`, and the
--      agenda item it became, `agenda_item_id`). Shawn, 2026-11-20.
--    - `state` `offered`: the officer can't edit that meeting, so every
--      upcoming meeting with that audience offers it under Suggested instead,
--      as it offers what the minutes tabled, until an agenda adds it.
--    - `state` `waiting`: no such meeting was on the calendar yet. It goes
--      onto the next one created, and is deleted at `expires_at` (30 days)
--      if none is.
--    - `ai_suggestion_id` (unique): the suggested task it was sent from, so a
--      suggestion sent twice is one item; `suggestion_payload` and
--      `suggestion_quote` keep that suggestion's words so Undo can put it
--      back, since a decided suggestion holds none. Set null if that row goes.
--    - Deleting the minutes deletes it: its words came from them. Deleting
--      the meeting it was placed on leaves it, with no meeting.
-- 2. `event_agenda_suggestions.kind` gains `minutes`: an `offered` item
--    under one event's agenda, with `source_meeting_id` the minutes it was
--    sent from.
--
-- Locks. The new table's foreign keys add triggers to `chapters`,
-- `meetings`, `events`, `ai_suggestions` and `users`, each taking SHARE ROW
-- EXCLUSIVE until commit; the table is new and empty, so that is
-- milliseconds. Swapping the kind check takes ACCESS EXCLUSIVE on
-- `event_agenda_suggestions` for the drop and the add; the add is NOT VALID
-- and the validate that follows takes only SHARE UPDATE EXCLUSIVE while it
-- reads the table (a few rows per upcoming meeting).

-- 1. ------------------------------------------------------------------------

create table if not exists public.meeting_next_agenda_items (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references chapters(id) on delete cascade,
  meeting_id uuid not null references meetings(id) on delete cascade,
  -- The minutes' own meeting, whose audience, type and series pick the next
  -- one. Null once that meeting is deleted: a waiting item then never moves.
  source_event_id uuid references events(id) on delete set null,
  text text not null check (char_length(text) between 1 and 200),
  state text not null check (state in ('placed', 'offered', 'waiting')),
  event_id uuid references events(id) on delete set null,
  agenda_item_id text check (agenda_item_id is null or char_length(agenda_item_id) between 1 and 64),
  expires_at timestamptz,
  ai_suggestion_id uuid references ai_suggestions(id) on delete set null,
  suggestion_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(suggestion_payload) = 'object' and octet_length(suggestion_payload::text) <= 16000),
  suggestion_quote text check (suggestion_quote is null or char_length(suggestion_quote) between 1 and 1000),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint meeting_next_agenda_items_suggestion_key unique (ai_suggestion_id),
  constraint meeting_next_agenda_items_placed_names_item check (
    state <> 'placed' or agenda_item_id is not null
  ),
  constraint meeting_next_agenda_items_waiting_expires check (
    (state = 'waiting') = (expires_at is not null)
  )
);

alter table public.meeting_next_agenda_items enable row level security;

-- What earlier minutes sent on, read for each upcoming meeting's Suggested
-- list; also the cascade from `meetings`.
create index if not exists idx_meeting_next_agenda_items_meeting
  on public.meeting_next_agenda_items (chapter_id, meeting_id);

-- The ones waiting for a meeting, read when one is created and swept when
-- they expire.
create index if not exists idx_meeting_next_agenda_items_waiting
  on public.meeting_next_agenda_items (chapter_id, expires_at)
  where state = 'waiting';

-- The cascades from `meetings`, `events` and `users`.
create index if not exists idx_meeting_next_agenda_items_meeting_id
  on public.meeting_next_agenda_items (meeting_id);
create index if not exists idx_meeting_next_agenda_items_event_id
  on public.meeting_next_agenda_items (event_id)
  where event_id is not null;
create index if not exists idx_meeting_next_agenda_items_source_event_id
  on public.meeting_next_agenda_items (source_event_id)
  where source_event_id is not null;
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
