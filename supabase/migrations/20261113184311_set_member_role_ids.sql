-- A member-roles save can no longer write back a role a concurrent delete
-- took away (#4830, deferred from #4547).
--
-- `PATCH /v1/members/:id/roles` (MemberService.updateRoles) reads the member
-- and the chapter's roles, decides the new `role_ids`, and used to write them
-- with a plain update. When `delete_role` (20261113164050) committed between
-- that read and that write, the write put the deleted id back (it was valid in
-- the stale roles read, and "already held" in the stale member read) and
-- dropped the Everyone `delete_role` had just given, leaving the member with a
-- dead id and 403 on every route.
--
-- set_member_role_ids(p_chapter_id, p_member_id, p_expected, p_role_ids)
-- writes `p_role_ids` only when the write still holds against what the save
-- read. In one transaction it
--
--   key-share locks every role of the chapter `p_role_ids` names, so a
--     `delete_role` of one of them (which locks the role `for update` first)
--     either waits for this write to commit and then strips the id from the
--     row it wrote, or has committed already and the role is gone here;
--   locks the member row, and writes nothing when its `role_ids` is no longer
--     exactly `p_expected` (a delete, or another save, moved it); and
--   writes nothing when an id in `p_role_ids` the member didn't already hold
--     names no role of the chapter (the role was deleted after the save read).
--
-- It returns the written row, or no row when it wrote nothing; the API
-- answers 409 so the client reloads and saves again. Refusing, rather than
-- dropping the dead id and writing the rest, is deliberate: the save chose
-- whether Everyone stays by the roles it asked for, so writing a subset could
-- leave the member with no access role at all.
--
-- Locks are taken role first, member second, the order `delete_role` takes
-- them, so the two cannot deadlock. Ids in `role_ids` (text[]) are compared
-- lower-cased, as `delete_role` and the guard compare them; the moved check
-- compares the array exactly, since it was read from that same row.
--
-- Security invoker, called by the API with the service role, like
-- `delete_role`. Not an RPC for anyone else.

create or replace function public.set_member_role_ids(
  p_chapter_id uuid,
  p_member_id uuid,
  p_expected text[],
  p_role_ids text[]
)
returns setof public.members
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  v_current text[];
begin
  perform 1
     from public.roles r
    where r.chapter_id = p_chapter_id
      and r.id::text in (select lower(x) from unnest(p_role_ids) as x)
      for key share;

  select m.role_ids into v_current
    from public.members m
   where m.id = p_member_id
     and m.chapter_id = p_chapter_id
     for update;
  if not found or v_current is distinct from p_expected then
    return;
  end if;

  if exists (
    select 1
      from unnest(p_role_ids) as x
     where not exists (
             select 1 from unnest(p_expected) as y where lower(y) = lower(x)
           )
       and not exists (
             select 1 from public.roles r
              where r.id::text = lower(x) and r.chapter_id = p_chapter_id
           )
  ) then
    return;
  end if;

  return query
    update public.members m
       set role_ids = p_role_ids
     where m.id = p_member_id
    returning m.*;
end;
$$;

comment on function public.set_member_role_ids(uuid, uuid, text[], text[]) is
  'Writes a member''s role_ids only if the row still holds p_expected and every newly given id names a live role of the chapter, under locks ordered as delete_role takes them; returns the row, or none when it wrote nothing (PATCH /v1/members/:id/roles answers 409, #4830). See 20261113184311_set_member_role_ids.sql.';

revoke execute on function public.set_member_role_ids(uuid, uuid, text[], text[]) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.set_member_role_ids(uuid, uuid, text[], text[]) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.set_member_role_ids(uuid, uuid, text[], text[]) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.set_member_role_ids(uuid, uuid, text[], text[]) to service_role;
  end if;
end
$$;
