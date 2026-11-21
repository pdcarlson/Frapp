-- Everyone becomes the floor, and the old Member row becomes Actives.
--
-- Paul, 2026-11-21: "Everyone comes in as nothing and gets no access to any
-- private channels by default. Then we give them a role and all 3 of the base
-- roles provide access based on how the chapter set it up." He picked, on
-- cards: build it, every current Everyone holder becomes an active, a member
-- with no base role reads and posts in the channels open to the whole chapter,
-- and the role is called "Actives" in a new chapter.
--
-- Until now the hidden Everyone role was the old Member role (#4191), keyed
-- `MEMBER` and sitting in the members' tier with the member defaults, and a
-- join that gave no member-access role added it. So whoever joined landed as
-- a full member and saw the members' channels.
--
-- WHAT IT WRITES, per chapter that has a `MEMBER`-keyed role
--
-- 1. The `MEMBER` row becomes the Actives base role. Its id, key, tier,
--    permissions, overrides, color and holders don't change, so every stored
--    reference to it (members' `role_ids`, channel and category see and post
--    lists, events' attendance by role, documents, tasks) now means the
--    actives, and every member who held Everyone is an active, with exactly
--    the access they had. It is renamed "Actives" ("Actives (base)" if the
--    chapter already has a role of that name) and becomes mentionable, as
--    every other role is by default.
-- 2. A new Everyone role (`system_key` EVERYONE) is added outside the tiers
--    with `members:view` only, the directory and the channels open to the
--    whole chapter. It takes the old row's `@everyone` switch, so a chapter
--    that opened `@everyone` to everyone keeps it open.
-- 3. Every member of the chapter gets the Everyone role, appended last.
-- 4. A chapter whose default invite role was the old row ("No role" in the
--    picker) has its default cleared, so a plain invite joins with Everyone
--    only. Pending invites that name "Everyone" now resolve to the new role
--    by name, so they also join as nobody in particular.
-- 5. A trigger keeps the Everyone role on every member row from now on,
--    whichever path writes it (redeem, role saves, role deletes, imports).
-- 6. `delete_role` stops handing the Actives role to a holder left with no
--    member-access role: everyone keeps the floor, and nobody becomes an
--    active without an officer saying so.
--
-- WHAT IT DOESN'T: no member's permissions shrink, no list is rewritten, no
-- tier moves. `reorder_role_tiers` still keys its floor on `MEMBER`, which is
-- now "New members and Alumni stay at or below the Actives tier", the rule it
-- always meant. `transfer_presidency` still appends the `MEMBER` row when the
-- outgoing President is left without member access; with Everyone always held
-- that no longer happens, and the outgoing President keeps their other roles.
--
-- A chapter whose Member role lost its `system_key` (the legacy gap,
-- spec/behavior/rbac.md) gets no Everyone role and is not touched.
--
-- Runs on staging when this merges, and on production only when Paul
-- deploys it. Idempotent: a second run finds every chapter done.

do $$
declare
  r record;
  v_name text;
  v_everyone uuid;
  v_order integer;
begin
  for r in
    select m.id, m.chapter_id, m.mentionable
      from public.roles m
     where m.system_key = 'MEMBER'
       and not exists (
         select 1 from public.roles e
          where e.chapter_id = m.chapter_id and e.system_key = 'EVERYONE'
       )
     order by m.chapter_id
  loop
    -- 1. Actives, unless the chapter already uses the name.
    v_name := 'Actives';
    if exists (
      select 1 from public.roles x
       where x.chapter_id = r.chapter_id and x.name = v_name and x.id <> r.id
    ) then
      v_name := 'Actives (base)';
    end if;
    update public.roles
       set name = v_name,
           mentionable = true
     where id = r.id;

    -- 2. The new floor, after every other role in the chapter's order.
    select coalesce(max(display_order), 0) + 1 into v_order
      from public.roles where chapter_id = r.chapter_id;
    insert into public.roles (
      chapter_id, name, system_key, tier_id, permission_overrides,
      permissions, is_system, display_order, color, mentionable
    ) values (
      r.chapter_id, 'Everyone', 'EVERYONE', null,
      '{"members:view": true}'::jsonb, array['members:view'], true, v_order,
      null, coalesce(r.mentionable, false)
    )
    returning id into v_everyone;

    -- 3. Everyone holds it.
    update public.members
       set role_ids = role_ids || v_everyone::text
     where chapter_id = r.chapter_id
       and not (v_everyone::text = any (role_ids));

    -- 4. "No role" means nothing now.
    update public.chapters
       set default_invite_role_id = null
     where id = r.chapter_id
       and default_invite_role_id = r.id;
  end loop;
end
$$;

-- 5. Every member row holds its chapter's Everyone role.
create or replace function public.members_keep_everyone_role()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_everyone uuid;
begin
  select r.id into v_everyone
    from public.roles r
   where r.chapter_id = new.chapter_id
     and r.system_key = 'EVERYONE'
   limit 1;
  if v_everyone is not null and not exists (
    select 1 from unnest(coalesce(new.role_ids, '{}')) as x
     where lower(x) = v_everyone::text
  ) then
    new.role_ids := coalesce(new.role_ids, '{}') || v_everyone::text;
  end if;
  return new;
end;
$$;

revoke execute on function public.members_keep_everyone_role()
  from public, anon, authenticated;

drop trigger if exists trg_members_keep_everyone_role on public.members;
create trigger trg_members_keep_everyone_role
  before insert or update of role_ids, chapter_id on public.members
  for each row execute function public.members_keep_everyone_role();

comment on function public.members_keep_everyone_role() is
  'Appends the chapter''s Everyone role (system_key EVERYONE) to a member row that lacks it, on every insert and role write. See 20261121001050_everyone_floor_actives.sql.';

-- 6. Deleting a role takes it off its holders and gives nobody Actives.
create or replace function public.delete_role(
  p_chapter_id uuid,
  p_role_id uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  v_role public.roles%rowtype;
  v_stripped uuid[];
begin
  select * into v_role
    from public.roles r
   where r.id = p_role_id
     and r.chapter_id = p_chapter_id
     for update;
  if not found then
    return null;
  end if;
  if v_role.is_system then
    raise exception 'delete_role: system roles cannot be deleted'
      using errcode = 'insufficient_privilege';
  end if;

  perform 1
     from public.members m
    where m.chapter_id = p_chapter_id
      and exists (
        select 1 from unnest(m.role_ids) as x where lower(x) = p_role_id::text
      )
      for update;

  -- The Everyone role stays on each row (trg_members_keep_everyone_role).
  with written as (
    update public.members m
       set role_ids = array(
             select x from unnest(m.role_ids) with ordinality as u(x, n)
              where lower(u.x) <> p_role_id::text
              order by u.n
           )
     where m.chapter_id = p_chapter_id
       and exists (
         select 1 from unnest(m.role_ids) as x where lower(x) = p_role_id::text
       )
    returning m.id
  )
  select coalesce(array_agg(w.id order by w.id), '{}'::uuid[])
    into v_stripped
    from written w;

  delete from public.roles r where r.id = p_role_id;

  return jsonb_build_object(
    'role', to_jsonb(v_role),
    'stripped_member_ids', to_jsonb(v_stripped),
    'given_everyone_member_ids', '[]'::jsonb
  );
end;
$$;

comment on function public.delete_role(uuid, uuid) is
  'Deletes a non-system role and takes it off every holder in one transaction (DELETE /v1/roles/:id, #4547); the Everyone role stays on each row. See 20261121001050_everyone_floor_actives.sql.';
