-- #1302: add and remove a PRIVATE channel's members, and take a member
-- leaving the chapter off its PRIVATE channels.
--
-- Until now the creator seed was the whole of PRIVATE membership management
-- (#1008): `POST /v1/channels` writes `member_ids: [creator]`, and nothing
-- writes the column again. The first two RPCs back
-- `POST /v1/channels/{id}/members` and `DELETE /v1/channels/{id}/members/{userId}`
-- (`ChatService.addPrivateChannelMember` / `removePrivateChannelMember`), and
-- the third backs `MemberService.remove`. The rules are in
-- spec/behavior/chat/README.md § Channels.
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
-- All three repeat the service's type check in the statement, the way
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
-- 2. Remove a member. Refuses (returns no row) when the removal would leave
--    no current member of the chapter in the list: a PRIVATE channel nobody
--    in the chapter can read drops out of every access-filtered list,
--    officers' included, and only someone who still holds its id could add
--    to it again. That is the #1008 defect by another route.
--
--    The guard counts chapter members, not array entries.
--    `canAccessChannel` and `can_read_chat_channel` both require chapter
--    membership before they read the list, so an id whose member has left
--    the chapter admits nobody and must not count as the one who remains.
--
--    Someone not listed is a no-op that still returns the row, including on a
--    NULL or empty list, where there is nobody to keep.
--
--    The guard is in the WHERE clause, not the service, so two concurrent
--    removals of the last two members cannot both pass it: the second
--    re-evaluates against the first's committed row and matches nothing.
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
     and (
       not (p_user_id = any(coalesce(member_ids, '{}'::uuid[])))
       or exists (
         select 1
           from members m
          where m.chapter_id = p_chapter_id
            and m.user_id = any(array_remove(member_ids, p_user_id))
       )
     )
  returning *;
$$;

-- ---------------------------------------------------------------------------
-- 3. Take a member leaving the chapter off its PRIVATE channels
--    (`MemberService.remove`). Without it their id stays in every list they
--    were added to, which admits nobody while they are out of the chapter but
--    lets them straight back in, full history included, if they are ever
--    re-invited: a re-invite creates a new `members` row for the same
--    `users.id`. Returns the ids of the channels it changed.
--
--    PRIVATE only. DM and Group DM membership is fixed at creation apart from
--    leaving, and a returning member finding their own conversations again is
--    not a leak.
--
--    No last-member guard, unlike section 2: the member is leaving the
--    chapter regardless, and a channel whose only chapter member leaves was
--    already readable by nobody the moment their `members` row went.
-- ---------------------------------------------------------------------------
create or replace function public.remove_user_from_private_channels(
  p_chapter_id uuid,
  p_user_id uuid
)
returns setof uuid
language sql
security invoker
set search_path = public, pg_temp
as $$
  update chat_channels
     set member_ids = array_remove(member_ids, p_user_id)
   where chapter_id = p_chapter_id
     and type = 'PRIVATE'
     and p_user_id = any(member_ids)
  returning id;
$$;

revoke execute on function public.add_private_channel_member(uuid, uuid, uuid) from public;
revoke execute on function public.remove_private_channel_member(uuid, uuid, uuid) from public;
revoke execute on function public.remove_user_from_private_channels(uuid, uuid) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.add_private_channel_member(uuid, uuid, uuid) from anon;
    revoke execute on function public.remove_private_channel_member(uuid, uuid, uuid) from anon;
    revoke execute on function public.remove_user_from_private_channels(uuid, uuid) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.add_private_channel_member(uuid, uuid, uuid) from authenticated;
    revoke execute on function public.remove_private_channel_member(uuid, uuid, uuid) from authenticated;
    revoke execute on function public.remove_user_from_private_channels(uuid, uuid) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.add_private_channel_member(uuid, uuid, uuid) to service_role;
    grant execute on function public.remove_private_channel_member(uuid, uuid, uuid) to service_role;
    grant execute on function public.remove_user_from_private_channels(uuid, uuid) to service_role;
  end if;
end
$$;
