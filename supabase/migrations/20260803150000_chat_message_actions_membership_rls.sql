-- Tighten chat_message_actions SELECT RLS to channel membership (FRA-38 / #279).
--
-- The previous SELECT policy was `using (auth.role() = 'authenticated')`, which let
-- ANY authenticated Supabase user read EVERY action row (reactions / poll votes)
-- across all chapters, private DMs, and role-gated channels. This is a real leak,
-- not just theoretical: the web client reads this table DIRECTLY via the
-- RLS-enforced user-JWT client —
--   * apps/web/lib/chat/use-chat-channel.ts  — initial reaction backfill
--   * apps/web/lib/chat/realtime-manager.ts  — a GLOBAL Realtime postgres_changes
--     subscription ("chat:actions:global") where RLS is the ONLY access gate
-- so the table cannot become service-role-only without breaking those reads.
--
-- Fix: replace the broad policy with a per-row membership check that mirrors the
-- canonical read predicate `canAccessChannel` (packages/validation/src/index.ts).
-- The check must read chat_messages / chat_channels / members / roles, which are
-- all default-deny (RLS enabled, no policies). Under the invoking `authenticated`
-- role those sub-selects would return nothing, so the predicate runs inside a
-- SECURITY DEFINER function that evaluates membership as the table owner.
-- `set search_path = public` hardens the definer against search-path injection;
-- auth.uid() is schema-qualified so it resolves with `auth` off the path, and it
-- still reads the request JWT inside a definer function (per-caller scoping holds).
-- A NULL auth.uid() (anon / no JWT) matches no user row -> the function returns
-- false -> deny (defense-in-depth with the retained auth.role()='authenticated').
--
-- INSERT / DELETE policies are intentionally left unchanged.

create or replace function public.can_read_chat_message(p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.chat_messages m
    join public.chat_channels c   on c.id = m.channel_id
    join public.users         u   on u.supabase_auth_id = auth.uid()
    join public.members       mem on mem.user_id = u.id
                                  and mem.chapter_id = c.chapter_id
    where m.id = p_message_id
      and (
        case c.type
          when 'PUBLIC'   then true
          when 'PRIVATE'  then u.id = any (coalesce(c.member_ids, '{}'::uuid[]))
          when 'DM'       then u.id = any (coalesce(c.member_ids, '{}'::uuid[]))
          when 'GROUP_DM' then u.id = any (coalesce(c.member_ids, '{}'::uuid[]))
          when 'ROLE_GATED' then
            coalesce(array_length(c.required_permissions, 1), 0) = 0
            or exists (
              select 1
              from public.roles r
              where r.chapter_id = c.chapter_id
                and r.id::text = any (mem.role_ids)
                and (
                  '*' = any (r.permissions)
                  or r.permissions && c.required_permissions
                )
            )
          else false
        end
      )
  );
$$;

-- Lock down EXECUTE: PostgREST/Realtime would otherwise expose this as an RPC to
-- anon. Postgres grants EXECUTE to PUBLIC by default and Supabase also grants
-- anon/authenticated; revoke broadly, then grant only authenticated (needed so the
-- RLS policy can call it) + service_role. Guard on role existence so the migration
-- also applies on bare-Postgres substrates (PGlite/CI) that lack Supabase roles.
revoke execute on function public.can_read_chat_message(uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.can_read_chat_message(uuid) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.can_read_chat_message(uuid) to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.can_read_chat_message(uuid) to service_role;
  end if;
end
$$;

-- Realtime delivers a postgres_changes event to a subscriber only if this SELECT
-- policy passes for the changed row. For DELETE (and the OLD image of UPDATE),
-- Realtime evaluates the policy against the old row; under the default replica
-- identity that old image holds only the primary key, so `message_id` would be
-- NULL and can_read_chat_message() would deny the event for EVERY subscriber —
-- silently breaking action-removal sync (un-reaction / un-vote), which the web
-- client applies solely from these DELETE events (apps/web/lib/chat/realtime-
-- manager.ts + cache.ts). REPLICA IDENTITY FULL puts the whole old row in that
-- image so the policy can scope the event to channel members. The rows are tiny,
-- so the added WAL volume is negligible; the separate per-subscriber cost of
-- evaluating this policy on the unfiltered global subscription is tracked in FRA-291.
alter table public.chat_message_actions replica identity full;

-- Replace the role-only SELECT policy with the membership-scoped one. `if exists`
-- mirrors the guarded revoke/grant block above so a replay or a forward-fix that
-- already dropped the policy (per the rollback playbook) does not abort here.
drop policy if exists "chat_message_actions_select" on public.chat_message_actions;

create policy "chat_message_actions_select"
  on public.chat_message_actions for select
  using (
    auth.role() = 'authenticated'
    and public.can_read_chat_message(message_id)
  );
