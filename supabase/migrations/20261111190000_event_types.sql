-- Event types (#3730, step 1).
--
-- WHAT CHANGES
--
-- `event_types` is a chapter's own short list of the kinds of event it holds
-- ("Chapter meeting", "Philanthropy", "Work party"). A type carries the
-- defaults an event of that kind starts from:
--
--   point_value   points for attending, 0 to 100000 (the ledger ceiling a
--                 single event already has, POINTS_ADJUSTMENT_MAX).
--   is_mandatory  whether everyone must attend.
--
-- Picking a type in the New event form fills those in; the event keeps its
-- own copy, so editing a type later never rewrites events already made, and
-- an officer can still change either on one event.
--
-- `position` orders the chapter's list, lowest first. The picker shows it in
-- that order.
--
-- `events` gains `event_type_id`, nullable: an event made before types
-- existed, or made without picking one, has none. The foreign key is
-- composite, (event_type_id, chapter_id) to event_types (id, chapter_id), so
-- an event can only point at a type of its own chapter whatever the API does.
-- Deleting a type sets only `event_type_id` to null on its events
-- (`on delete set null (event_type_id)`, Postgres 15+); the events keep their
-- points and attendance.
--
-- SEEDED TYPES
--
-- Every chapter, existing and new, starts with seven types, the kinds the
-- design in #3730 and its 2026-11-08 comment name. A new chapter gets them from
-- a trigger on `chapters`, so no API path has to remember to; existing
-- chapters get them below. Officers rename, re-point or delete any of them.
--
-- RLS on with no policies, the posture of every chapter-owned table here: the
-- API reads and writes with the service role and enforces who may edit
-- (`events:update`; reads need `members:view`).

create table if not exists public.event_types (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  name text not null,
  point_value integer not null default 0,
  is_mandatory boolean not null default false,
  position integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_types_name_len
    check (char_length(btrim(name)) between 1 and 60),
  constraint event_types_point_value_range
    check (point_value between 0 and 100000),
  constraint event_types_position_range
    check (position between 0 and 100000),
  -- The target of the composite foreign key on events.
  constraint event_types_id_chapter unique (id, chapter_id)
);

-- One type per name in a chapter, ignoring case and outer whitespace.
create unique index if not exists idx_event_types_name
  on public.event_types (chapter_id, lower(btrim(name)));

alter table public.event_types enable row level security;

drop trigger if exists trg_event_types_updated_at on public.event_types;
create trigger trg_event_types_updated_at
  before update on public.event_types
  for each row execute function update_updated_at();

comment on table public.event_types is
  'A chapter''s kinds of event, each with the points and attendance an event of that kind starts from. Events point at one through events.event_type_id. See 20261111190000_event_types.sql.';

alter table public.events
  add column if not exists event_type_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'events_event_type_fk'
  ) then
    alter table public.events
      add constraint events_event_type_fk
      foreign key (event_type_id, chapter_id)
      references public.event_types (id, chapter_id)
      on delete set null (event_type_id);
  end if;
end
$$;

-- For the delete's set-null.
create index if not exists idx_events_event_type
  on public.events (event_type_id)
  where event_type_id is not null;

comment on column public.events.event_type_id is
  'The event_types row this event was made as, or null. Same chapter only (composite foreign key). The event keeps its own point_value and is_mandatory.';

-- ── Seeding ───────────────────────────────────────────────────────────────
--
-- Inserts the default types for one chapter, skipping any name it already
-- has, so running it twice adds nothing.

create or replace function public.seed_default_event_types(p_chapter_id uuid)
returns void
language sql
volatile
security invoker
set search_path = public, pg_temp
as $$
  insert into public.event_types (chapter_id, name, point_value, is_mandatory, position)
  select p_chapter_id, d.name, d.point_value, d.is_mandatory, d.position
    from (values
      ('Chapter meeting', 10, true, 1),
      ('Committee meeting', 5, false, 2),
      ('Philanthropy', 10, false, 3),
      ('Community service', 10, false, 4),
      ('Brotherhood', 5, false, 5),
      ('Work party', 5, false, 6),
      ('Social', 0, false, 7)
    ) as d(name, point_value, is_mandatory, position)
  on conflict (chapter_id, lower(btrim(name))) do nothing;
$$;

comment on function public.seed_default_event_types(uuid) is
  'Adds the seven default event types to one chapter, skipping names it already has. Run by trg_chapters_seed_event_types on every new chapter. See 20261111190000_event_types.sql.';

create or replace function public.chapters_seed_event_types()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  perform public.seed_default_event_types(new.id);
  return new;
end;
$$;

drop trigger if exists trg_chapters_seed_event_types on public.chapters;
create trigger trg_chapters_seed_event_types
  after insert on public.chapters
  for each row execute function public.chapters_seed_event_types();

-- Existing chapters.
select public.seed_default_event_types(id) from public.chapters;

-- Neither function is an RPC: the trigger calls them with the inserting
-- role's rights (the API's service role).
revoke all on function public.seed_default_event_types(uuid) from public;
revoke all on function public.chapters_seed_event_types() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.seed_default_event_types(uuid) from anon;
    revoke all on function public.chapters_seed_event_types() from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.seed_default_event_types(uuid) from authenticated;
    revoke all on function public.chapters_seed_event_types() from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.seed_default_event_types(uuid) to service_role;
    grant execute on function public.chapters_seed_event_types() to service_role;
  end if;
end
$$;
