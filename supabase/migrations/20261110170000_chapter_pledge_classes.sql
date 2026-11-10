-- Pledge classes and a member's order number (#3939).
--
-- WHAT CHANGES
--
-- `chapter_pledge_classes` is a chapter's own ordered list of the classes its
-- members joined in ("Alpha", "Beta", "Fall 2019"). `position` orders the
-- list, lowest first, which is oldest first; the names are the chapter's and
-- carry no order of their own (Greek letters don't sort alphabetically).
--
-- `members` gains two nullable columns:
--
--   pledge_class_id  the class this member belongs to, or null.
--   order_number     an integer an officer gives the member. A chapter that
--                    numbers people inside a class and one that numbers
--                    everyone chapter-wide (a roll or bond number) both store
--                    it here: sorting by (class position, order_number) is
--                    right for both. It needs no class, so a chapter that
--                    keeps only a chapter-wide number can use it alone.
--
-- A chapter that uses neither has no rows and two null columns; nothing else
-- reads them.
--
-- The foreign key is composite, (pledge_class_id, chapter_id) to
-- chapter_pledge_classes (id, chapter_id), so a member can only point at a
-- class of their own chapter whatever the API does. Deleting a class sets
-- only `pledge_class_id` to null (`on delete set null (pledge_class_id)`,
-- Postgres 15+); `order_number` stays, and `chapter_id` is never touched.
--
-- RLS on with no policies, the posture of every chapter-owned table here: the
-- API reads and writes with the service role and enforces who may edit
-- (`roles:manage`; reads need `members:view`).
--
-- Both columns are new and null on every existing row, so adding the foreign
-- key validates against nothing and no row is rewritten.

create table if not exists public.chapter_pledge_classes (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  name text not null,
  position integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chapter_pledge_classes_name_len
    check (char_length(btrim(name)) between 1 and 80),
  constraint chapter_pledge_classes_position_range
    check (position between 0 and 100000),
  -- The target of the composite foreign key on members.
  constraint chapter_pledge_classes_id_chapter unique (id, chapter_id)
);

-- One class per name in a chapter, ignoring case and outer whitespace.
create unique index if not exists idx_chapter_pledge_classes_name
  on public.chapter_pledge_classes (chapter_id, lower(btrim(name)));

alter table public.chapter_pledge_classes enable row level security;

drop trigger if exists trg_chapter_pledge_classes_updated_at
  on public.chapter_pledge_classes;
create trigger trg_chapter_pledge_classes_updated_at
  before update on public.chapter_pledge_classes
  for each row execute function update_updated_at();

comment on table public.chapter_pledge_classes is
  'A chapter''s ordered list of pledge classes; position orders them oldest first. Members point at one through members.pledge_class_id. See 20261110170000_chapter_pledge_classes.sql.';

alter table public.members
  add column if not exists pledge_class_id uuid,
  add column if not exists order_number integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'members_order_number_range'
  ) then
    alter table public.members
      add constraint members_order_number_range
      check (order_number is null or order_number between 1 and 1000000);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'members_pledge_class_fk'
  ) then
    alter table public.members
      add constraint members_pledge_class_fk
      foreign key (pledge_class_id, chapter_id)
      references public.chapter_pledge_classes (id, chapter_id)
      on delete set null (pledge_class_id);
  end if;
end
$$;

-- For the delete's set-null and for reading a class's members.
create index if not exists idx_members_pledge_class
  on public.members (pledge_class_id)
  where pledge_class_id is not null;

comment on column public.members.pledge_class_id is
  'The chapter_pledge_classes row this member belongs to, or null. Same chapter only (composite foreign key).';
comment on column public.members.order_number is
  'The member''s order within their pledge class, or chapter-wide (roll or bond number), set by officers. Null when the chapter keeps none.';

-- ── Reordering the list, one statement ────────────────────────────────────
--
-- Sets each listed class's position to its place in `p_ids` (1-based). Only
-- rows of `p_chapter_id` are touched; an id from another chapter matches
-- nothing. The API passes the chapter's whole list, so positions stay dense.

create or replace function public.reorder_chapter_pledge_classes(
  p_chapter_id uuid,
  p_ids uuid[]
)
returns setof public.chapter_pledge_classes
language sql
volatile
security invoker
set search_path = public, pg_temp
as $$
  update public.chapter_pledge_classes c
     set position = o.ord::integer
    from unnest(p_ids) with ordinality as o(id, ord)
   where c.id = o.id
     and c.chapter_id = p_chapter_id
  returning c.*;
$$;

comment on function public.reorder_chapter_pledge_classes(uuid, uuid[]) is
  'Sets each listed pledge class''s position to its 1-based place in p_ids, within one chapter (PUT /v1/pledge-classes/order). See 20261110170000_chapter_pledge_classes.sql.';

-- ── Assigning members, all or none ────────────────────────────────────────
--
-- `p_assignments` is a JSON array of
-- `{ "member_id": uuid, "pledge_class_id": uuid|null, "order_number": int|null }`.
-- Each listed member of `p_chapter_id` gets both values. The function is the
-- whole check, so there is no read-then-write gap for another officer's
-- delete to land in:
--
--   a listed member who is not in the chapter (another chapter's, or removed
--   a moment ago) raises `no_data_found` (P0002) after the update, which
--   undoes it: nothing is written;
--   a class of another chapter, or one deleted a moment ago, fails the
--   composite foreign key (23503), and nothing is written.
--
-- The API answers the first as 404 and the second as 400.

create or replace function public.assign_member_pledge_classes(
  p_chapter_id uuid,
  p_assignments jsonb
)
returns setof public.members
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  v_listed integer;
  v_updated integer;
begin
  select count(distinct a.member_id) into v_listed
    from jsonb_to_recordset(p_assignments) as a(member_id uuid);

  return query
    update public.members m
       set pledge_class_id = a.pledge_class_id,
           order_number = a.order_number
      from jsonb_to_recordset(p_assignments)
             as a(member_id uuid, pledge_class_id uuid, order_number integer)
     where m.id = a.member_id
       and m.chapter_id = p_chapter_id
    returning m.*;
  get diagnostics v_updated = row_count;

  if v_updated <> v_listed then
    raise exception
      'assign_member_pledge_classes: % of % listed members are not in the chapter',
      v_listed - v_updated, v_listed
      using errcode = 'no_data_found';
  end if;
end;
$$;

comment on function public.assign_member_pledge_classes(uuid, jsonb) is
  'Sets pledge_class_id and order_number on each listed member of one chapter, all or none; raises no_data_found when a listed member is not in it (PUT /v1/pledge-classes/assignments). See 20261110170000_chapter_pledge_classes.sql.';

revoke execute on function public.reorder_chapter_pledge_classes(uuid, uuid[]) from public;
revoke execute on function public.assign_member_pledge_classes(uuid, jsonb) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.reorder_chapter_pledge_classes(uuid, uuid[]) from anon;
    revoke execute on function public.assign_member_pledge_classes(uuid, jsonb) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.reorder_chapter_pledge_classes(uuid, uuid[]) from authenticated;
    revoke execute on function public.assign_member_pledge_classes(uuid, jsonb) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.reorder_chapter_pledge_classes(uuid, uuid[]) to service_role;
    grant execute on function public.assign_member_pledge_classes(uuid, jsonb) to service_role;
  end if;
end
$$;
