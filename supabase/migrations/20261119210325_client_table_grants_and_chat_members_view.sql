-- Narrows what the publishable (anon) key and a signed-in client can reach in
-- the database directly, and makes the chat read rule match the API's.
--
-- 1. Table grants. Supabase grants every role all privileges on every public
--    table by default, so row-level security was the only barrier between a
--    client key and a table. The apps read only two tables directly
--    (`chat_messages` for history and the Realtime echo, `chat_message_actions`
--    for reactions, votes and their echo) and delete only their own reaction
--    rows; everything else goes through the API as service_role. So `anon`
--    keeps nothing and `authenticated` keeps exactly SELECT on those two and
--    DELETE on `chat_message_actions`. The default privileges for tables and
--    sequences that later migrations create are revoked too, so a new table
--    starts closed. Function EXECUTE is unchanged: the policies above call
--    their security definer helpers as the client role.
--    `scripts/pglite/tiers/client-table-grants.mjs` asserts the exact set.
--
-- 2. `can_read_chat_channel` also requires members:view, which every chat
--    route already requires. It gates `chat_messages`/`chat_message_actions`
--    reads and the private `chat:channel:` Realtime topic.
--
-- Asked by: Paul (API review, 2026-11-19).

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema public from anon;
    revoke all on all sequences in schema public from anon;
    alter default privileges in schema public revoke all on tables from anon;
    alter default privileges in schema public revoke all on sequences from anon;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on all tables in schema public from authenticated;
    revoke all on all sequences in schema public from authenticated;
    alter default privileges in schema public revoke all on tables from authenticated;
    alter default privileges in schema public revoke all on sequences from authenticated;

    grant select on public.chat_messages to authenticated;
    grant select, delete on public.chat_message_actions to authenticated;
  end if;
end
$$;

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
                -- A member sets their own graduation year, so a class year
                -- would let anyone in: it is for @mentions only.
                and gm.kind <> 'class_year'
                and ('group:' || gm.group_id::text) = any (c.who_can_see)
            )
          else false
        end
      )
  );
$$;
