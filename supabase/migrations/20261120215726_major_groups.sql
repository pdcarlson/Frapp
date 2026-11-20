-- Majors become automatic groups (#5778), beside pledge classes and class
-- years (20261113040007_chapter_groups.sql).
--
-- Shawn, 2026-11-20: "Let's make majors pingable… so that you don't need to
-- add roles for majors… when a person adds a new major that isn't in the
-- system already, then it automatically becomes pingable."
--
-- WHAT A MAJOR GROUP IS
--
--   kind 'major'   one per distinct major a member of the chapter has: its
--                  members are the members whose users.major is that major.
--
-- `users.major` is free text (up to 100 characters) and shared across
-- chapters, so a major's group is per chapter, read from that chapter's
-- members only, and majors match ignoring case and runs of whitespace:
-- "mechE", "MechE" and " MechE " are one group. `major_key` holds that
-- folded form (`chapter_major_key`, mirrored in TypeScript by
-- `majorGroupKey` in @repo/validation). Synonyms ("MechE" and "Mechanical
-- Engineering") stay apart: the profile's Major field suggests the chapter's
-- existing majors instead, so members pick one rather than make a near twin.
--
-- The group's name is the spelling most of its members use (ties go to the
-- first alphabetically), so one member's "mechanical engineering" doesn't
-- name the group for everyone who wrote "Mechanical Engineering". It is kept
-- by the triggers below whenever a member's major changes or a member joins
-- or leaves.
--
-- As with a class year, the row is made the first time a member of the
-- chapter has that major and never deleted: who is in it is read live
-- (`chapter_group_memberships`), so the last member to change their major
-- empties it, and an empty automatic group is left out of every list. The
-- next member to take the major brings the same row (and its color and ping
-- switch) back.
--
-- A major is for @mentions and task audiences only, never a channel list:
-- members set their own major (PATCH /v1/users/me), so a list naming one
-- would let anyone in by changing theirs. The API refuses one on a list
-- (`groupKindOpensChannels`), and `can_read_chat_channel` admits nobody
-- through a major's row either (redefined below, as 20261119210325's plus
-- that one kind).

-- ---------------------------------------------------------------------------
-- 1. The column, the kind, and the rules a row of it keeps.
-- ---------------------------------------------------------------------------

-- The folded form majors match on: trimmed, each run of whitespace one
-- space, lower case. Null for no major (null, empty or only spaces).
create or replace function public.chapter_major_key(p_major text)
returns text
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  select nullif(lower(btrim(regexp_replace(p_major, '\s+', ' ', 'g'))), '');
$$;

-- How a member's major reads as a group's name: trimmed, each run of
-- whitespace one space, their own capitalization kept.
create or replace function public.chapter_major_spelling(p_major text)
returns text
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  select nullif(btrim(regexp_replace(p_major, '\s+', ' ', 'g')), '');
$$;

alter table public.chapter_groups
  add column if not exists major_key text;

comment on column public.chapter_groups.major_key is
  'The major an automatic `major` group follows, folded (chapter_major_key: trimmed, whitespace collapsed, lower case), else null (#5778).';

alter table public.chapter_groups
  drop constraint if exists chapter_groups_kind;
alter table public.chapter_groups
  add constraint chapter_groups_kind
  check (kind in ('manual', 'pledge_class', 'class_year', 'major'));

alter table public.chapter_groups
  drop constraint if exists chapter_groups_source;
alter table public.chapter_groups
  add constraint chapter_groups_source check (
    (kind = 'manual' and pledge_class_id is null and class_year is null and major_key is null)
    or (kind = 'pledge_class' and pledge_class_id is not null and class_year is null and major_key is null)
    or (kind = 'class_year' and class_year is not null and pledge_class_id is null and major_key is null)
    or (kind = 'major' and major_key is not null and pledge_class_id is null and class_year is null)
  );

-- A major can run to 100 characters (`users.major`), past the 80 a group
-- someone names keeps to.
alter table public.chapter_groups
  drop constraint if exists chapter_groups_name_len;
alter table public.chapter_groups
  add constraint chapter_groups_name_len check (
    char_length(btrim(name)) between 1
      and (case when kind = 'major' then 100 else 80 end)
  );

-- One group per (chapter, major).
create unique index if not exists idx_chapter_groups_major
  on public.chapter_groups (chapter_id, major_key)
  where kind = 'major';

comment on table public.chapter_groups is
  'Named sets of members with no permissions (#4076): manual ones an officer keeps, and one per pledge class, per graduation year and per major (#5778), whose members follow the members'' own data. Members: chapter_group_memberships. See 20261113040007_chapter_groups.sql and 20261120215726_major_groups.sql.';

-- ---------------------------------------------------------------------------
-- 2. Who is in each group: majors join the view.
-- ---------------------------------------------------------------------------

create or replace view public.chapter_group_memberships
with (security_invoker = true) as
  select gm.chapter_id, gm.group_id, gm.user_id, 'manual'::text as kind
    from public.chapter_group_members gm
  union all
  select g.chapter_id, g.id as group_id, m.user_id, g.kind
    from public.chapter_groups g
    join public.members m
      on m.chapter_id = g.chapter_id
     and m.pledge_class_id = g.pledge_class_id
   where g.kind = 'pledge_class'
  union all
  select g.chapter_id, g.id as group_id, m.user_id, g.kind
    from public.chapter_groups g
    join public.members m
      on m.chapter_id = g.chapter_id
    join public.users u
      on u.id = m.user_id
     and u.graduation_year = g.class_year
   where g.kind = 'class_year'
  union all
  select g.chapter_id, g.id as group_id, m.user_id, g.kind
    from public.chapter_groups g
    join public.members m
      on m.chapter_id = g.chapter_id
    join public.users u
      on u.id = m.user_id
     and public.chapter_major_key(u.major) = g.major_key
   where g.kind = 'major';

comment on view public.chapter_group_memberships is
  'One row per (group, member) for every group (#4076): a manual group''s picked members, a pledge class''s members, a graduation year''s members, a major''s members (#5778), with the group''s kind. The one definition the API and can_read_chat_channel both read. A class_year or major row never opens a channel: members set their own year and major. See 20261113040007_chapter_groups.sql and 20261120215726_major_groups.sql.';

-- `create or replace view` keeps the grants 20261113040007 set (service_role
-- only); restated so this file alone says who reads it.
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
-- 3. Major groups' rows.
-- ---------------------------------------------------------------------------

-- Make or rename the major groups for the listed majors (folded) in the
-- listed chapters: one row per (chapter, major) that a member of the chapter
-- has now, named by the spelling most of them use. A major nobody in the
-- chapter has any more keeps its row and name (an empty automatic group is
-- hidden).
create or replace function public.sync_chapter_major_groups(
  p_chapter_ids uuid[],
  p_keys text[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(cardinality(p_chapter_ids), 0) = 0
     or coalesce(cardinality(p_keys), 0) = 0 then
    return;
  end if;

  insert into public.chapter_groups (chapter_id, kind, name, major_key)
  select distinct on (s.chapter_id, s.major_key)
         s.chapter_id, 'major', left(s.spelling, 100), s.major_key
    from (
      select m.chapter_id,
             public.chapter_major_key(u.major) as major_key,
             public.chapter_major_spelling(u.major) as spelling,
             count(*) as n
        from public.members m
        join public.users u on u.id = m.user_id
       where m.chapter_id = any (p_chapter_ids)
         and public.chapter_major_key(u.major) = any (p_keys)
       group by 1, 2, 3
    ) s
   order by s.chapter_id, s.major_key, s.n desc, s.spelling
  on conflict (chapter_id, major_key) where kind = 'major'
  do update set name = excluded.name
   where public.chapter_groups.name is distinct from excluded.name;
end;
$$;

revoke all on function public.sync_chapter_major_groups(uuid[], text[])
  from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.sync_chapter_major_groups(uuid[], text[]) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.sync_chapter_major_groups(uuid[], text[]) from authenticated;
  end if;
end
$$;

-- A member joins, moves, or leaves: their major's group in that chapter (a
-- leaver can change which spelling most members use).
create or replace function public.members_sync_major_group()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text;
begin
  if tg_op in ('INSERT', 'UPDATE') then
    select public.chapter_major_key(u.major) into v_key
      from public.users u where u.id = new.user_id;
    if v_key is not null then
      perform public.sync_chapter_major_groups(array[new.chapter_id], array[v_key]);
    end if;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    select public.chapter_major_key(u.major) into v_key
      from public.users u where u.id = old.user_id;
    if v_key is not null then
      perform public.sync_chapter_major_groups(array[old.chapter_id], array[v_key]);
    end if;
  end if;
  return null;
end;
$$;

revoke execute on function public.members_sync_major_group()
  from public, anon, authenticated;

drop trigger if exists trg_members_sync_major_group on public.members;
create trigger trg_members_sync_major_group
  after insert or delete or update of user_id, chapter_id on public.members
  for each row execute function public.members_sync_major_group();

-- A user changes their major: the old one's and the new one's groups in
-- every chapter they're in.
create or replace function public.users_sync_major_groups()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.major is not distinct from old.major then
    return null;
  end if;
  perform public.sync_chapter_major_groups(
    array(select m.chapter_id from public.members m where m.user_id = new.id),
    array_remove(
      array[public.chapter_major_key(old.major), public.chapter_major_key(new.major)],
      null
    )
  );
  return null;
end;
$$;

revoke execute on function public.users_sync_major_groups()
  from public, anon, authenticated;

drop trigger if exists trg_users_sync_major_groups on public.users;
create trigger trg_users_sync_major_groups
  after update of major on public.users
  for each row execute function public.users_sync_major_groups();

-- Backfill: the majors chapters' members already have.
insert into public.chapter_groups (chapter_id, kind, name, major_key)
select distinct on (s.chapter_id, s.major_key)
       s.chapter_id, 'major', left(s.spelling, 100), s.major_key
  from (
    select m.chapter_id,
           public.chapter_major_key(u.major) as major_key,
           public.chapter_major_spelling(u.major) as spelling,
           count(*) as n
      from public.members m
      join public.users u on u.id = m.user_id
     where public.chapter_major_key(u.major) is not null
     group by 1, 2, 3
  ) s
 order by s.chapter_id, s.major_key, s.n desc, s.spelling
on conflict (chapter_id, major_key) where kind = 'major' do nothing;

-- ---------------------------------------------------------------------------
-- 4. A major opens no channel.
-- ---------------------------------------------------------------------------

-- As 20261119210325's, with `major` beside `class_year` in the group branch.
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
      -- The chat routes all require members:view (`ChatController`'s class
      -- guard), so a member without it reads no channel here either: not its
      -- messages, reactions, live echo, presence or typing. Same resolution as
      -- `RbacService.memberHasAnyPermission`: the union of the member's roles
      -- in this chapter, where `*` grants everything (2026-11-19, Paul).
      and exists (
        select 1
        from public.roles pr
        where pr.chapter_id = c.chapter_id
          and pr.id = any (
            array(
              select v::uuid
              from unnest(mem.role_ids) as v
              where v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            )
          )
          and ('*' = any (pr.permissions) or 'members:view' = any (pr.permissions))
      )
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
                -- A member sets their own graduation year and major, so a
                -- class year or a major would let anyone in: they are for
                -- @mentions only (#5778).
                and gm.kind not in ('class_year', 'major')
                and ('group:' || gm.group_id::text) = any (c.who_can_see)
            )
          else false
        end
      )
  );
$$;
