-- Groups, and pingable tiers (#4076, the last slice of #4068).
--
-- Paul, 2026-11-10: "sometimes we just have groups (roles based on
-- demographics like pledge class, class year, floor of the house, live ins,
-- live outs, etc). it's nice to be able to ping the people in these groups or
-- build specific channels based on the people in those groups. they are more
-- for grouping brothers than for allowing permissions and thus can be simpler
-- versions". Paul with Shawn, 2026-11-11: a tier's name is pingable too.
--
-- WHAT A GROUP IS
--
-- A named set of members. It holds no permissions and sits in no tier: roles
-- answer "what may you do", groups answer "who is in this set". A group can
-- be @-mentioned and named in a channel's who-can-see and who-can-post lists
-- as `group:<id>`. Groups live in their own table rather than as role rows,
-- so nothing that reads roles (permissions, rank, tiers, the Roles page, the
-- presidency) has to learn to skip them, and nothing can give one a
-- permission: there is no column to put it in.
--
--   kind 'manual'        an officer names it and picks its members
--                        (chapter_group_members).
--   kind 'pledge_class'  one per chapter_pledge_classes row: its members are
--                        the members whose pledge_class_id is that class.
--   kind 'class_year'    one per graduation year a member of the chapter
--                        has: its members are the members whose
--                        users.graduation_year is that year.
--
-- Automatic groups need no upkeep: who is in them is read live from the
-- member's own data (`chapter_group_memberships`), so they are right the
-- moment a pledge class or graduation year changes. Only their rows are kept
-- by triggers here, so each has a stable id a channel list and a mention can
-- name:
--
--   a pledge class's row   made with the class, renamed with it, deleted with
--                          it (foreign key, cascade).
--   a class year's row     made the first time a member of the chapter has
--                          that year (a member joins, or a user sets their
--                          year). Never deleted: one nobody has any more is
--                          left out of the lists that offer groups, and stays
--                          valid in a channel list that already names it.
--
-- WHO IS IN A GROUP
--
-- `chapter_group_memberships` (a view): one row per (group, member). The API
-- reads it for mentions, channel access and the Groups page, and
-- `can_read_chat_channel` reads it for message RLS and realtime topics. It is
-- the one definition, so the server's channel check, its push audience and
-- the database's read check cannot disagree about who is in a group.
--
-- CHANNEL LISTS
--
-- `chat_access_list_valid` takes `group:<id>` beside `tier:` and `role:`;
-- `can_read_chat_channel` admits a member of a listed group; deleting a group
-- takes its entry off every list (`chat_access_strip_entry`, as a deleted role
-- or tier does). Its TypeScript twin is `canAccessChannel`, whose holder
-- (`RbacService.getChannelAccessHolder`) reads the same view.
--
-- PINGABLE TIERS
--
-- `role_tiers.mentionable`: on by default, as `roles.mentionable` is
-- (20261107061000). `@<tier name>` reaches every member holding a role in
-- the tier.
--
-- WHO MANAGES GROUPS
--
-- `groups:manage`, separate from `roles:manage`, so a house manager can keep
-- "Third floor" current without being able to grant permissions. Existing
-- chapters: every tier that can manage roles or channels gets it, and so does
-- any other role that can (as an override, which is how a role outside the
-- tiers, or one switched on beyond its tier, holds a permission). The
-- President's `*` already covers it. New chapters get it in their top two
-- starting tiers (`STARTING_ROLE_TIERS`).
--
-- Nothing here reads or writes production data beyond the backfills: one
-- group row per existing pledge class and per (chapter, graduation year)
-- among members, and the permission grant.

-- ---------------------------------------------------------------------------
-- 1. Groups.
-- ---------------------------------------------------------------------------

create table if not exists public.chapter_groups (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  kind text not null,
  name text not null,
  color text,
  mentionable boolean not null default true,
  pledge_class_id uuid,
  class_year integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chapter_groups_kind
    check (kind in ('manual', 'pledge_class', 'class_year')),
  constraint chapter_groups_name_len
    check (char_length(btrim(name)) between 1 and 80),
  -- Each kind carries exactly its own source.
  constraint chapter_groups_source check (
    (kind = 'manual' and pledge_class_id is null and class_year is null)
    or (kind = 'pledge_class' and pledge_class_id is not null and class_year is null)
    or (kind = 'class_year' and class_year is not null and pledge_class_id is null)
  ),
  constraint chapter_groups_pledge_class_fk
    foreign key (pledge_class_id, chapter_id)
    references public.chapter_pledge_classes (id, chapter_id)
    on delete cascade,
  -- The target of chapter_group_members' composite foreign key.
  constraint chapter_groups_id_chapter unique (id, chapter_id)
);

-- One group per pledge class and per (chapter, year).
create unique index if not exists idx_chapter_groups_pledge_class
  on public.chapter_groups (pledge_class_id)
  where kind = 'pledge_class';
create unique index if not exists idx_chapter_groups_class_year
  on public.chapter_groups (chapter_id, class_year)
  where kind = 'class_year';
-- Two manual groups can't share a name. An automatic group's name is its
-- class's or year's, so it is not held to this: a chapter adding a pledge
-- class named like a manual group must not be refused for it.
create unique index if not exists idx_chapter_groups_manual_name
  on public.chapter_groups (chapter_id, lower(btrim(name)))
  where kind = 'manual';
create index if not exists idx_chapter_groups_chapter
  on public.chapter_groups (chapter_id);

alter table public.chapter_groups enable row level security;

drop trigger if exists trg_chapter_groups_updated_at on public.chapter_groups;
create trigger trg_chapter_groups_updated_at
  before update on public.chapter_groups
  for each row execute function update_updated_at();

comment on table public.chapter_groups is
  'Named sets of members with no permissions (#4076): manual ones an officer keeps, and one per pledge class and per graduation year, whose members follow the members'' own data. Members: chapter_group_memberships. See 20261113040002_chapter_groups.sql.';
comment on column public.chapter_groups.mentionable is
  'Whether any member may @ the group. On by default; while off, only a member who can manage channels or roles can ping it, as for a role.';

-- ---------------------------------------------------------------------------
-- 2. A manual group's members.
-- ---------------------------------------------------------------------------

create table if not exists public.chapter_group_members (
  group_id uuid not null,
  chapter_id uuid not null,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (group_id, user_id),
  constraint chapter_group_members_group_fk
    foreign key (group_id, chapter_id)
    references public.chapter_groups (id, chapter_id)
    on delete cascade,
  -- A member who leaves the chapter leaves its groups.
  constraint chapter_group_members_member_fk
    foreign key (user_id, chapter_id)
    references public.members (user_id, chapter_id)
    on delete cascade
);

create index if not exists idx_chapter_group_members_member
  on public.chapter_group_members (chapter_id, user_id);

alter table public.chapter_group_members enable row level security;

comment on table public.chapter_group_members is
  'Who is in each manual group (#4076). Automatic groups have no rows here: chapter_group_memberships reads theirs from the members'' own data. See 20261113040002_chapter_groups.sql.';

-- Only a manual group has hand-picked members: an automatic one's follow the
-- data, and a row here would add someone the data says isn't in it.
create or replace function public.chapter_group_members_manual_only()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.chapter_groups g
     where g.id = new.group_id
       and g.chapter_id = new.chapter_id
       and g.kind = 'manual'
  ) then
    raise exception 'Only a manual group has hand-picked members'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function public.chapter_group_members_manual_only()
  from public, anon, authenticated;

drop trigger if exists trg_chapter_group_members_manual_only
  on public.chapter_group_members;
create trigger trg_chapter_group_members_manual_only
  before insert or update on public.chapter_group_members
  for each row execute function public.chapter_group_members_manual_only();

-- Set a manual group's members to exactly `p_user_ids`, in one transaction
-- (`PUT /v1/groups/:id/members`). Refuses with no_data_found when the group
-- isn't a manual group of the chapter, and with the member foreign key's
-- foreign_key_violation when someone listed isn't a member of the chapter;
-- either way nothing changes. Returns the members after.
create or replace function public.set_chapter_group_members(
  p_chapter_id uuid,
  p_group_id uuid,
  p_user_ids uuid[]
)
returns setof uuid
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
begin
  perform 1
     from public.chapter_groups g
    where g.id = p_group_id
      and g.chapter_id = p_chapter_id
      and g.kind = 'manual'
      for update;
  if not found then
    raise exception 'set_chapter_group_members: no manual group % in chapter %',
      p_group_id, p_chapter_id
      using errcode = 'no_data_found';
  end if;

  delete from public.chapter_group_members gm
   where gm.group_id = p_group_id
     and gm.user_id <> all (coalesce(p_user_ids, '{}'::uuid[]));

  insert into public.chapter_group_members (group_id, chapter_id, user_id)
  select distinct p_group_id, p_chapter_id, u
    from unnest(coalesce(p_user_ids, '{}'::uuid[])) as u
  on conflict (group_id, user_id) do nothing;

  return query
    select gm.user_id
      from public.chapter_group_members gm
     where gm.group_id = p_group_id
     order by gm.user_id;
end;
$$;

revoke all on function public.set_chapter_group_members(uuid, uuid, uuid[])
  from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.set_chapter_group_members(uuid, uuid, uuid[]) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.set_chapter_group_members(uuid, uuid, uuid[]) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.set_chapter_group_members(uuid, uuid, uuid[]) to service_role;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Who is in each group.
-- ---------------------------------------------------------------------------

create or replace view public.chapter_group_memberships
with (security_invoker = true) as
  select gm.chapter_id, gm.group_id, gm.user_id
    from public.chapter_group_members gm
  union all
  select g.chapter_id, g.id as group_id, m.user_id
    from public.chapter_groups g
    join public.members m
      on m.chapter_id = g.chapter_id
     and m.pledge_class_id = g.pledge_class_id
   where g.kind = 'pledge_class'
  union all
  select g.chapter_id, g.id as group_id, m.user_id
    from public.chapter_groups g
    join public.members m
      on m.chapter_id = g.chapter_id
    join public.users u
      on u.id = m.user_id
     and u.graduation_year = g.class_year
   where g.kind = 'class_year';

comment on view public.chapter_group_memberships is
  'One row per (group, member) for every group (#4076): a manual group''s picked members, a pledge class''s members, a graduation year''s members. The one definition the API and can_read_chat_channel both read. See 20261113040002_chapter_groups.sql.';

-- The API reads it with the service role; nothing on a client does.
revoke all on public.chapter_group_memberships from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.chapter_group_memberships from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.chapter_group_memberships from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select on public.chapter_group_memberships to service_role;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Automatic groups' rows.
-- ---------------------------------------------------------------------------

-- The name a class year's group goes by.
create or replace function public.chapter_class_year_group_name(p_year integer)
returns text
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  select 'Class of ' || p_year::text;
$$;

-- Make the class-year group for each listed (chapter, year) that has none.
-- A year outside 1900-2200 is someone's typo, not a class: it gets no group
-- (and must not fail the profile save that set it).
create or replace function public.ensure_chapter_class_year_groups(
  p_user_id uuid,
  p_chapter_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.chapter_groups (chapter_id, kind, name, class_year)
  select distinct m.chapter_id, 'class_year',
         public.chapter_class_year_group_name(u.graduation_year),
         u.graduation_year
    from public.members m
    join public.users u on u.id = m.user_id
   where m.user_id = p_user_id
     and (p_chapter_id is null or m.chapter_id = p_chapter_id)
     and u.graduation_year between 1900 and 2200
  on conflict (chapter_id, class_year) where kind = 'class_year' do nothing;
end;
$$;

revoke all on function public.ensure_chapter_class_year_groups(uuid, uuid)
  from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.ensure_chapter_class_year_groups(uuid, uuid) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.ensure_chapter_class_year_groups(uuid, uuid) from authenticated;
  end if;
end
$$;

-- A member joins (or a row moves): their year's group in that chapter.
create or replace function public.members_ensure_class_year_group()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.ensure_chapter_class_year_groups(new.user_id, new.chapter_id);
  return null;
end;
$$;

revoke execute on function public.members_ensure_class_year_group()
  from public, anon, authenticated;

drop trigger if exists trg_members_ensure_class_year_group on public.members;
create trigger trg_members_ensure_class_year_group
  after insert or update of user_id, chapter_id on public.members
  for each row execute function public.members_ensure_class_year_group();

-- A user sets their year: its group in every chapter they're in.
create or replace function public.users_ensure_class_year_groups()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.graduation_year is not null
     and new.graduation_year is distinct from old.graduation_year then
    perform public.ensure_chapter_class_year_groups(new.id, null);
  end if;
  return null;
end;
$$;

revoke execute on function public.users_ensure_class_year_groups()
  from public, anon, authenticated;

drop trigger if exists trg_users_ensure_class_year_groups on public.users;
create trigger trg_users_ensure_class_year_groups
  after update of graduation_year on public.users
  for each row execute function public.users_ensure_class_year_groups();

-- A pledge class is added or renamed: its group follows.
create or replace function public.chapter_pledge_classes_sync_group()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.chapter_groups (chapter_id, kind, name, pledge_class_id)
    values (new.chapter_id, 'pledge_class', new.name, new.id)
    on conflict (pledge_class_id) where kind = 'pledge_class' do nothing;
  elsif new.name is distinct from old.name then
    update public.chapter_groups
       set name = new.name
     where kind = 'pledge_class'
       and pledge_class_id = new.id;
  end if;
  return null;
end;
$$;

revoke execute on function public.chapter_pledge_classes_sync_group()
  from public, anon, authenticated;

drop trigger if exists trg_chapter_pledge_classes_sync_group
  on public.chapter_pledge_classes;
create trigger trg_chapter_pledge_classes_sync_group
  after insert or update of name on public.chapter_pledge_classes
  for each row execute function public.chapter_pledge_classes_sync_group();

-- Backfill: the classes and years chapters already have.
insert into public.chapter_groups (chapter_id, kind, name, pledge_class_id)
select pc.chapter_id, 'pledge_class', pc.name, pc.id
  from public.chapter_pledge_classes pc
on conflict (pledge_class_id) where kind = 'pledge_class' do nothing;

insert into public.chapter_groups (chapter_id, kind, name, class_year)
select distinct m.chapter_id, 'class_year',
       public.chapter_class_year_group_name(u.graduation_year),
       u.graduation_year
  from public.members m
  join public.users u on u.id = m.user_id
 where u.graduation_year between 1900 and 2200
on conflict (chapter_id, class_year) where kind = 'class_year' do nothing;

-- ---------------------------------------------------------------------------
-- 5. Channel lists take groups.
-- ---------------------------------------------------------------------------

create or replace function public.chat_access_list_valid(p_entries text[])
returns boolean
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  select p_entries is null or not exists (
    select 1
      from unnest(p_entries) as e
     where e is null
        or e !~ '^(tier|role|group):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );
$$;

drop trigger if exists chapter_groups_strip_chat_access on public.chapter_groups;
create trigger chapter_groups_strip_chat_access
  after delete on public.chapter_groups
  for each row execute function public.chat_access_strip_entry('group');

-- As 20261111233000's, plus a member of a listed group. `*` still passes
-- through the roles branch.
create or replace function public.can_read_chat_channel(p_channel_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.chat_channels c
    join public.users         u   on u.supabase_auth_id = auth.uid()
    join public.members       mem on mem.user_id = u.id
                                  and mem.chapter_id = c.chapter_id
    where c.id = p_channel_id
      and (
        case
          when c.type in ('PRIVATE', 'DM', 'GROUP_DM')
            then u.id = any (coalesce(c.member_ids, '{}'::uuid[]))
          when c.type in ('PUBLIC', 'ROLE_GATED') then
            c.who_can_see is null
            or exists (
              select 1
              from public.roles r
              where r.chapter_id = c.chapter_id
                and r.id = any (
                  array(
                    select v::uuid
                    from unnest(mem.role_ids) as v
                    where v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  )
                )
                and (
                  '*' = any (r.permissions)
                  or ('role:' || r.id::text) = any (c.who_can_see)
                  or (
                    r.tier_id is not null
                    and ('tier:' || r.tier_id::text) = any (c.who_can_see)
                  )
                )
            )
            or exists (
              select 1
              from public.chapter_group_memberships gm
              where gm.chapter_id = c.chapter_id
                and gm.user_id = u.id
                and ('group:' || gm.group_id::text) = any (c.who_can_see)
            )
          else false
        end
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- 6. Pingable tiers.
-- ---------------------------------------------------------------------------

alter table public.role_tiers
  add column if not exists mentionable boolean not null default true;

comment on column public.role_tiers.mentionable is
  'Whether any member may @ the tier, which reaches every member holding a role in it (#4076). On by default; while off, only a member who can manage channels or roles can ping it.';

-- ---------------------------------------------------------------------------
-- 7. groups:manage for whoever already manages roles or channels.
-- ---------------------------------------------------------------------------

update public.role_tiers
   set permissions = permissions || array['groups:manage']
 where permissions && array['roles:manage', 'channels:manage']
   and not ('groups:manage' = any (permissions));

-- After the tiers above: a role still holding roles:manage or channels:manage
-- without groups:manage has it as an override of its own (outside the tiers,
-- or switched on for that role alone), so it gets this one the same way. One
-- that switched groups:manage off already keeps that.
update public.roles
   set permission_overrides =
         permission_overrides || jsonb_build_object('groups:manage', true)
 where permissions && array['roles:manage', 'channels:manage']
   and not ('*' = any (permissions))
   and not ('groups:manage' = any (permissions))
   and not (permission_overrides ? 'groups:manage');
