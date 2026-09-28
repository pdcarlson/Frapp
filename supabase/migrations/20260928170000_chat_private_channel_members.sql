-- #1302: add and remove a PRIVATE channel's members.
--
-- Until now the creator seed was the whole of PRIVATE membership management
-- (#1008): `POST /v1/channels` writes `member_ids: [creator]`, and nothing
-- writes the column again. These two RPCs back
-- `POST /v1/channels/{id}/members` and `DELETE /v1/channels/{id}/members/{userId}`
-- (`ChatService.addPrivateChannelMember` / `removePrivateChannelMember`); the
-- rules are in spec/behavior/chat/README.md § Channels.
--
-- Atomic, in the shape `leave_group_dm` established
-- (20260901180000_chat_channels_archived_at.sql): each UPDATE computes the new
-- array from the row's own column, so a concurrent caller blocked on the row
-- lock re-evaluates both the SET expression and the WHERE clause against the
-- just-committed row (EvalPlanQual). An app-side read-modify-write would let
-- two officers adding different members at once each write their own array
-- and silently drop the other's add.
--
-- `member_ids` stays a `uuid[]` rather than a join table. Every reader of
-- channel membership reads the array: `canAccessChannel`, the RLS helper
-- `can_read_chat_message`, search's channel filter and the push worker. A join
-- table would rewrite all of them, one of them an RLS policy, to buy nothing
-- these RPCs don't already give.
--
-- Both RPCs repeat the service's type check in the statement, the way
-- `leave_group_dm` does: a row that is not `PRIVATE`, or that sits in another
-- chapter, updates nothing and returns no row.
--
-- `security invoker`, like `leave_group_dm`: the API calls them with the
-- service-role client, which bypasses RLS, and EXECUTE is locked to
-- service_role below.

-- ---------------------------------------------------------------------------
-- 1. Add a member. Idempotent: adding someone already listed changes nothing
--    and still returns the row. A NULL list (a PRIVATE row from before #1008)
--    is treated as empty, so an add repairs it.
-- ---------------------------------------------------------------------------
create or replace function public.add_private_channel_member(
  p_channel_id uuid,
  p_chapter_id uuid,
  p_user_id uuid
)
returns setof public.chat_channels
language sql
security invoker
set search_path = public, pg_temp
as $$
  update chat_channels
     set member_ids = case
           when p_user_id = any(coalesce(member_ids, '{}'::uuid[])) then member_ids
           else array_append(coalesce(member_ids, '{}'::uuid[]), p_user_id)
         end
   where id = p_channel_id
     and chapter_id = p_chapter_id
     and type = 'PRIVATE'
  returning *;
$$;

-- ---------------------------------------------------------------------------
-- 2. Remove a member. Idempotent for someone not listed. Refuses (returns no
--    row) when the removal would leave the list empty: a PRIVATE channel with
--    no members is readable by nobody, and nobody could add to it through
--    membership, which is the #1008 defect by another route. The guard is in
--    the WHERE clause, not the service, so two concurrent removals of the last
--    two members cannot both pass it: the second re-evaluates against the
--    first's committed row and matches nothing.
--
--    `array_length` of an empty array is NULL, not 0, hence the coalesce.
-- ---------------------------------------------------------------------------
create or replace function public.remove_private_channel_member(
  p_channel_id uuid,
  p_chapter_id uuid,
  p_user_id uuid
)
returns setof public.chat_channels
language sql
security invoker
set search_path = public, pg_temp
as $$
  update chat_channels
     set member_ids = array_remove(member_ids, p_user_id)
   where id = p_channel_id
     and chapter_id = p_chapter_id
     and type = 'PRIVATE'
     and coalesce(array_length(array_remove(member_ids, p_user_id), 1), 0) >= 1
  returning *;
$$;

revoke execute on function public.add_private_channel_member(uuid, uuid, uuid) from public;
revoke execute on function public.remove_private_channel_member(uuid, uuid, uuid) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.add_private_channel_member(uuid, uuid, uuid) from anon;
    revoke execute on function public.remove_private_channel_member(uuid, uuid, uuid) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.add_private_channel_member(uuid, uuid, uuid) from authenticated;
    revoke execute on function public.remove_private_channel_member(uuid, uuid, uuid) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.add_private_channel_member(uuid, uuid, uuid) to service_role;
    grant execute on function public.remove_private_channel_member(uuid, uuid, uuid) to service_role;
  end if;
end
$$;
