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
--      suggestion sent twice is one item. Set null if that row goes.
--    - `suggestion_payload` and `suggestion_quote` keep that suggestion's
--      words for a day, so Undo can put it back (a decided suggestion holds
--      none); the API's hourly sweep empties them after that.
--    - Deleting the minutes deletes it: its words came from them. Deleting
--      the meeting it was placed on leaves it, with no meeting.
-- 2. `event_agenda_suggestions.kind` gains `minutes`: an `offered` item
--    under one event's agenda, with `source_meeting_id` the minutes it was
--    sent from.
-- 3. `delete_replaced_occurrences`, as `20261118191604` left it, now also
--    moves `meeting_next_agenda_items` rows onto the rebuilt meeting when a
--    series edit rebuilds its upcoming meetings, as it moves their agendas.
--    The function is otherwise unchanged.
--
-- Locks. The file runs in one transaction, so every lock below holds until
-- it commits. The new table's foreign keys add triggers to `chapters`,
-- `meetings`, `events`, `ai_suggestions` and `users`, each taking SHARE ROW
-- EXCLUSIVE until commit. Swapping the kind check takes ACCESS
-- EXCLUSIVE on `event_agenda_suggestions`, also until commit, through the
-- add's read of the table. `create or replace function` takes no table
-- lock. Every table touched is small (a few rows per upcoming meeting), so the
-- whole file commits in milliseconds; reads and writes on those tables wait
-- that long.

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
  check (kind in ('tabled', 'minutes', 'ai'));

-- 3. ------------------------------------------------------------------------

create or replace function public.delete_replaced_occurrences(
  p_chapter_id uuid,
  p_old_ids uuid[],
  p_from_ids uuid[],
  p_to_ids uuid[]
)
returns setof public.event_excuses
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
begin
  if coalesce(array_length(p_from_ids, 1), 0)
     <> coalesce(array_length(p_to_ids, 1), 0) then
    raise exception 'from and to must pair up'
      using errcode = '22023';
  end if;

  -- Both ends of every pair are this chapter's events, and only an old row
  -- being deleted is carried from.
  if exists (
    select 1
      from unnest(p_from_ids, p_to_ids) as m(from_id, to_id)
     where not (m.from_id = any(p_old_ids))
        or not exists (
          select 1 from public.events e
           where e.id = m.to_id and e.chapter_id = p_chapter_id
        )
  ) then
    raise exception 'every pair must carry from an old occurrence to one of the chapter''s events'
      using errcode = '22023';
  end if;

  -- A meeting's agenda and attachments are its own (#4934), so a rebuilt
  -- meeting takes over the one it replaces.
  update public.events e
     set agenda = o.agenda,
         attachments = o.attachments
    from unnest(p_from_ids, p_to_ids) as m(from_id, to_id)
    join public.events o
      on o.id = m.from_id
     and o.chapter_id = p_chapter_id
   where e.id = m.to_id
     and e.chapter_id = p_chapter_id;

  -- An approved excuse's EXCUSED row first, while the excuse still says which
  -- member it belongs to on the old meeting.
  update public.event_attendance a
     set event_id = m.to_id
    from unnest(p_from_ids, p_to_ids) as m(from_id, to_id)
   where a.event_id = m.from_id
     and a.status = 'EXCUSED'
     and exists (
       select 1 from public.event_excuses x
        where x.event_id = m.from_id
          and x.user_id = a.user_id
          and x.chapter_id = p_chapter_id
          and x.status = 'APPROVED'
     );

  update public.event_excuses x
     set event_id = m.to_id
    from unnest(p_from_ids, p_to_ids) as m(from_id, to_id)
   where x.event_id = m.from_id
     and x.chapter_id = p_chapter_id;

  -- Its suggested agenda items, decided ones included, and when the model
  -- last wrote them (#5534): what was added there stays added, what was
  -- dismissed stays dismissed, and the rebuilt meeting isn't asked again.
  update public.event_agenda_suggestions s
     set event_id = m.to_id
    from unnest(p_from_ids, p_to_ids) as m(from_id, to_id)
   where s.event_id = m.from_id
     and s.chapter_id = p_chapter_id;

  -- What an officer sent there from earlier minutes (#5790): the rebuilt
  -- meeting takes over the agenda item, so it takes over the record of it.
  update public.meeting_next_agenda_items n
     set event_id = m.to_id
    from unnest(p_from_ids, p_to_ids) as m(from_id, to_id)
   where n.event_id = m.from_id
     and n.chapter_id = p_chapter_id;

  update public.event_agenda_suggestion_runs r
     set event_id = m.to_id
    from unnest(p_from_ids, p_to_ids) as m(from_id, to_id)
   where r.event_id = m.from_id
     and r.chapter_id = p_chapter_id
     and not exists (
       select 1 from public.event_agenda_suggestion_runs t
        where t.event_id = m.to_id
     );

  return query
    select x.*
      from public.event_excuses x
     where x.event_id = any(p_old_ids)
       and x.chapter_id = p_chapter_id
       and x.status in ('PENDING', 'APPROVED');

  delete from public.events
   where id = any(p_old_ids)
     and chapter_id = p_chapter_id;
end;
$$;
