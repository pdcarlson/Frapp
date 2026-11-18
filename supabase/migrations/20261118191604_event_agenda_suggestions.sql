-- Suggested agenda items (#5534, spec/behavior/events.md § Suggested agenda
-- items, spec/behavior/meetings.md § Tabled items).
--
-- 1. `event_agenda_suggestions`: what an upcoming meeting's agenda is offered
--    under it, one row per suggestion, kept after it is decided. RLS on and
--    no policies: API only (service role), like `ai_suggestions`.
--    - `kind` `tabled`: a matter earlier posted minutes of a meeting with the
--      same audience tabled. `tabled_*` name where it was first tabled and how
--      many meetings have tabled it (`content.tabled` of the minutes, #5522).
--      `source_meeting_id` is the minutes that tabled it most recently.
--    - `kind` `ai`: an item a small model wrote (`agenda.suggest`), with a
--      few words of `reason`.
--    - `status` `open`, then `added` (with the agenda item it became) or
--      `dismissed`, by whom and when. A decided row keeps its text on
--      purpose: the chapter's recent added and dismissed items are the
--      examples the next prompt learns from (Paul, 2026-11-18, #5522). This is
--      why these are not `ai_suggestions`, which drop a decided row's text.
--    - `dedupe_key` (unique per event): the same matter, or the same words,
--      is offered once per event, whatever became of it. For a tabled matter
--      it is the first minutes, the count and the words, so a matter added to
--      a later agenda (an `added` row with that key in the chapter) is never
--      offered again unless a later meeting tables it again.
-- 2. `event_agenda_suggestion_runs`: when the model last wrote suggestions
--    for an event, so a page asks for them once, not on every view.
--
-- Deleting the event deletes both. Deleting minutes deletes the rows drawn
-- from them, decided ones included: their words came from those minutes.
--
-- 3. `delete_replaced_occurrences`, as `20261113220742` left it, now also
--    moves both tables' rows onto the rebuilt meeting when a series edit
--    rebuilds its upcoming meetings, as it moves excuses. The function is
--    otherwise unchanged.
--
-- Locks. `create or replace function` takes no table lock. The foreign keys add triggers to `chapters`, `events`, `meetings`
-- and `users`, each taking SHARE ROW EXCLUSIVE until commit, so writes to
-- those tables wait for this file to commit. Both tables are new and empty,
-- so that is milliseconds.

-- 1. ------------------------------------------------------------------------

create table if not exists public.event_agenda_suggestions (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references chapters(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  kind text not null check (kind in ('tabled', 'ai')),
  text text not null check (char_length(text) between 1 and 200),
  reason text check (reason is null or char_length(reason) between 1 and 200),
  source_meeting_id uuid references meetings(id) on delete cascade,
  -- The first minutes' id as the Tabled list names it: an identity, not a
  -- link the database keeps, since those minutes may be deleted later.
  tabled_meeting_id uuid,
  tabled_start_time timestamptz,
  tabled_times smallint check (tabled_times is null or tabled_times between 1 and 99),
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 400),
  -- Who the event invited when the row was written (`audienceKey` in the
  -- API): a row is shown, and read as an example, only for an event that
  -- invites the same people now.
  audience_key text not null check (char_length(audience_key) between 1 and 4000),
  status text not null default 'open'
    check (status in ('open', 'added', 'dismissed')),
  agenda_item_id text check (agenda_item_id is null or char_length(agenda_item_id) between 1 and 64),
  decided_by uuid references users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  constraint event_agenda_suggestions_event_key unique (event_id, dedupe_key),
  constraint event_agenda_suggestions_tabled_has_origin check (
    (kind = 'tabled') = (
      tabled_meeting_id is not null
      and tabled_start_time is not null
      and tabled_times is not null
    )
  ),
  constraint event_agenda_suggestions_decided_has_time check (
    (status = 'open') = (decided_at is null)
  ),
  constraint event_agenda_suggestions_added_names_item check (
    status <> 'added' or agenda_item_id is not null
  )
);

alter table public.event_agenda_suggestions enable row level security;

-- The examples a prompt reads: a chapter's decided rows, newest first.
create index if not exists idx_event_agenda_suggestions_decided
  on public.event_agenda_suggestions (chapter_id, decided_at desc)
  where status <> 'open';

-- A tabled matter already added to some agenda in the chapter.
create index if not exists idx_event_agenda_suggestions_added_key
  on public.event_agenda_suggestions (chapter_id, dedupe_key)
  where status = 'added';

-- The cascades from `meetings`.
create index if not exists idx_event_agenda_suggestions_source
  on public.event_agenda_suggestions (source_meeting_id)
  where source_meeting_id is not null;

-- 2. ------------------------------------------------------------------------

create table if not exists public.event_agenda_suggestion_runs (
  event_id uuid primary key references events(id) on delete cascade,
  chapter_id uuid not null references chapters(id) on delete cascade,
  generated_by uuid references users(id) on delete set null,
  generated_at timestamptz not null default now(),
  audience_key text not null check (char_length(audience_key) between 1 and 4000)
);

alter table public.event_agenda_suggestion_runs enable row level security;

create index if not exists idx_event_agenda_suggestion_runs_chapter
  on public.event_agenda_suggestion_runs (chapter_id);

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
