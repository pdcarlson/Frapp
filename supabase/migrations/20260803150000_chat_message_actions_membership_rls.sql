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
        case
          when c.type = 'PUBLIC' then true
          -- Grouped exactly as canAccessChannel groups them, so the two stay
          -- legible side by side and a new member-list channel type is a
          -- one-line change in both.
          when c.type in ('PRIVATE', 'DM', 'GROUP_DM')
            then u.id = any (coalesce(c.member_ids, '{}'::uuid[]))
          when c.type = 'ROLE_GATED' then
            coalesce(array_length(c.required_permissions, 1), 0) = 0
            or exists (
              select 1
              from public.roles r
              where r.chapter_id = c.chapter_id
                -- `members.role_ids` is an unconstrained text[], and the API
                -- accepts role ids as `z.string().uuid()`, which permits
                -- uppercase. Postgres uuid equality is case-insensitive but
                -- text equality is not, so comparing as text would silently
                -- deny a member whose stored id differs only in case, while
                -- the app layer allowed them. Compare as uuid to match.
                and r.id = any (
                  array(
                    select v::uuid
                    from unnest(mem.role_ids) as v
                    where v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  )
                )
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

-- REPLICA IDENTITY IS DELIBERATELY LEFT AT THE DEFAULT.
--
-- It is tempting to set `replica identity full` here, reasoning that the DELETE
-- old-image must carry `message_id` for this policy to scope on, or removal sync
-- breaks for every subscriber. Both halves of that are wrong, per the Realtime
-- Postgres Changes docs:
--
--   "RLS policies are not applied to `DELETE` statements, because there is no way
--    for Postgres to verify that a user has access to a deleted record. When RLS
--    is enabled and `replica identity` is set to `full` on a table, the `old`
--    record contains only the primary key(s)."
--
-- So (1) DELETE events are never RLS-filtered — they were never at risk of being
-- dropped by this policy — and (2) with RLS enabled the `old` record is trimmed
-- to primary keys anyway, so FULL could not hand `message_id` to the policy or to
-- the client even if it were needed. It buys nothing and costs WAL volume on
-- every delete, permanently.
--
-- The client never needed more than the key: `dispatchActionDelete(old.id)`
-- (apps/web/lib/chat/realtime-manager.ts) resolves the removal through its local
-- `cache.actionIndex`, which only holds actions whose INSERT it was legitimately
-- delivered — and INSERT events ARE RLS-filtered, by the policy below.
--
-- Known residual, not closed by this migration: because DELETE is never
-- RLS-filtered, the unfiltered `chat:actions:global` subscription still fans a
-- bare action `id` out to every authenticated subscriber cross-chapter. That id
-- is opaque — no message, user, chapter or payload — and a client ignores ids
-- absent from its own cache, so it discloses only that *some* action somewhere
-- was removed. Scoping that subscription per-channel is FRA-291.

-- Replace the role-only SELECT policy with the membership-scoped one. `if exists`
-- mirrors the guarded revoke/grant block above so a replay or a forward-fix that
-- already dropped the policy (per the rollback playbook) does not abort here.
drop policy if exists "chat_message_actions_select" on public.chat_message_actions;

-- `to authenticated` is load-bearing, not decoration. EXECUTE on the helper is
-- revoked from anon (above), so whether an anon read returns no rows or fails
-- outright depends on whether the planner evaluates the cheap
-- `auth.role() = 'authenticated'` conjunct before the function call. Probed both
-- ways on PG 17.5: when the role conjunct is evaluated first it short-circuits
-- and the read cleanly returns zero rows, but when the function is reached
-- without EXECUTE the query dies with `42501 permission denied for function`
-- (which apps/web/lib/chat/use-chat-channel.ts discards, so it would degrade
-- silently). Postgres does not contractually fix that ordering — it costs quals
-- and may reorder, and hoisting `auth.role()` into an initplan (see FRA-291)
-- changes the shape again. The role clause removes the dependency on plan shape
-- entirely: anon never reaches the qual, so the outcome stops being incidental.
--
-- Emitted through `format()` because bare-Postgres substrates (PGlite in CI) have
-- no `authenticated` role and `to authenticated` would abort there — the same
-- `pg_roles` guard the revoke/grant block above uses. One policy body, one
-- variable clause, so the two substrates cannot drift apart.
do $$
declare
  v_role_clause text := '';
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    v_role_clause := 'to authenticated';
  end if;

  execute format($p$
    create policy "chat_message_actions_select"
      on public.chat_message_actions for select
      %s
      using (
        auth.role() = 'authenticated'
        and public.can_read_chat_message(message_id)
      )
  $p$, v_role_clause);
end
$$;
