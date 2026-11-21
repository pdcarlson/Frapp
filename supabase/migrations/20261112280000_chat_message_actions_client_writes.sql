-- Removing your own reaction works again, and clients can't write any other
-- chat_message_actions row directly (#724, #4513).
--
-- Both write policies from 20260523150000 found the caller with
-- `user_id in (select id from users where supabase_auth_id = auth.uid())`.
-- `users` is default-deny to the `authenticated` role, so inside the policy
-- that subselect sees no rows and neither policy ever matched:
--
-- - `chat_message_actions_delete` is what both apps use to take back a
--   reaction (ADR-05, `packages/chat-core/src/chat-client.ts` `unreact`). The
--   delete removed nothing and returned no error, so the chip disappeared on
--   the device and came back on the next load. Proven in PGlite by the
--   client-writes tier of `scripts/pglite/tiers/chat-black-box.mjs`, which
--   failed on "a member can take back their own reaction" until this ran.
-- - `chat_message_actions_insert` was refused by accident. No client
--   inserts: reactions, votes and sign-ups go through
--   `POST /v1/channels/messages/:messageId/actions`, which checks channel
--   access, the poll rules and a sign-up slot's limit, and writes as
--   service_role. The policy checked none of that, so a later `users` policy
--   letting a member read their own row would have let members write
--   straight past all of it (#4513). It is dropped, and INSERT and UPDATE are
--   revoked from the client roles.
--
-- The delete policy now finds the caller through `chat_action_is_callers`, a
-- `security definer` helper (the pattern 20260803150000 used for reads), and
-- covers `reaction:*` rows only, so a member can't delete their own vote on a
-- closed poll or free a sign-up slot behind the API's back.
--
-- This needs no app update: shipped builds already send the delete.
--
-- Locks: two policies dropped and one created on chat_message_actions (a
-- brief ACCESS EXCLUSIVE on the table), one function created. No rows are
-- read or written.
--
-- Rollback: db-rollback-playbook.md § Rollback reaction removal policy.

create or replace function public.chat_action_is_callers(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- Answers only about the caller: true when `p_user_id` is the app user
  -- behind `auth.uid()`. No other user's row can be learned from it.
  select exists (
    select 1 from public.users u
     where u.id = p_user_id
       and u.supabase_auth_id = auth.uid()
  );
$$;

revoke all on function public.chat_action_is_callers(uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.chat_action_is_callers(uuid) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.chat_action_is_callers(uuid) to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.chat_action_is_callers(uuid) to service_role;
  end if;
end
$$;

drop policy if exists "chat_message_actions_insert" on public.chat_message_actions;
drop policy if exists "chat_message_actions_delete" on public.chat_message_actions;

-- `to authenticated` through format(), as 20260803150000 does for the select
-- policy, so bare Postgres (PGlite) without the role still applies it.
do $$
declare
  v_role_clause text := '';
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    v_role_clause := 'to authenticated';
  end if;

  execute format($p$
    create policy "chat_message_actions_delete"
      on public.chat_message_actions for delete
      %s
      using (
        starts_with(action_type, 'reaction:')
        and public.chat_action_is_callers(user_id)
      )
  $p$, v_role_clause);
end
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke insert, update on public.chat_message_actions from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke insert, update on public.chat_message_actions from authenticated;
  end if;
end
$$;
