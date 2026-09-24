-- Hide a blocked member's reactions from the member who blocked them, at the
-- policy (#2494, Option A, approved on the issue 2026-09-23).
--
-- spec/behavior/chat/README.md § What a block does and does not hide says a
-- blocked member's reactions are hidden from the blocker on every message,
-- because a reaction is its author's own text (`reaction:` plus up to 41
-- characters). No API code sits on the path the chips come from: both clients
-- hydrate reactions with a direct PostgREST select on `chat_message_actions`
-- and take live ones from one global Realtime `postgres_changes` subscription
-- on it (packages/chat-core/src/realtime-manager.ts). RLS is the only gate on
-- either, and `chat_message_actions_select` (20260803150000) knew nothing of
-- `chat_member_blocks`, so the blocker's client received, and web rendered,
-- every reaction the blocked member left.
--
-- One clause at the SELECT policy covers both paths. Realtime evaluates the
-- subscriber's SELECT policy before it delivers an INSERT or UPDATE, the
-- property 20260816140000 already relies on. DELETE events are never
-- RLS-filtered, so the blocker can still receive the bare id of a removal they
-- never saw; clients ignore ids absent from their cache (20260803150000's
-- header).
--
-- What stays visible, and why:
--   * `vote` rows. A poll tally is chapter state, "counted, not hidden".
--   * Any other action type. Only `reaction:*` is rendered as the actor's
--     text. The prefix is `REACTION_ACTION_PREFIX` in
--     packages/chat-core/src/types.ts.
--   * Everything the blocked member reads. The helper answers only about the
--     caller's own list, so their reads do not change when someone blocks
--     them: no oracle.
--
-- The helper takes no blocker parameter. It resolves the viewer from
-- `auth.uid()`, so over RPC it only ever answers "have I blocked this member
-- in this message's chapter", which the caller already knows. It also answers
-- false for a message the caller cannot read (`can_read_chat_channel`, the
-- same predicate the policy's second conjunct reaches). Without that, an RPC
-- call would say whether a message id exists in a chapter where the caller
-- holds a block row, including a DM they are not in, and block rows outlive
-- leaving the chapter. Inside the policy the check changes no row's
-- visibility, because the row is already filtered on it, and it runs only
-- once a block row has matched, so a viewer who has blocked nobody pays one
-- indexed lookup per reaction row.
--
-- It is `security definer` because `users`, `chat_messages`, `chat_channels`
-- and `chat_member_blocks` are default-deny to the `authenticated` role, and a
-- plain subselect inside a policy would see no rows (#724). For the same reason
-- a helper that cannot read the table fails the select, which is fail-closed.
-- The search_path is `public, pg_temp` with pg_temp last (20260827190000,
-- #985).
--
-- Blocks are per chapter (20260915210000), so the chapter comes from the
-- message: `message_id -> chat_messages.channel_id -> chat_channels.chapter_id`.
-- The lookup is served by the `(chapter_id, blocker_user_id, blocked_user_id)`
-- unique index.
--
-- Rollback: re-create the policy exactly as 20260803150000 wrote it, then drop
-- the helper. DB_ROLLBACK_PLAYBOOK.md § Rollback hiding blocked members'
-- reactions.

create or replace function public.chat_viewer_has_blocked(p_actor uuid, p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- The read check sits in the select list so it runs only for the row a
  -- block matched. As a WHERE filter on `m` the planner applies it at the
  -- chat_messages scan, repeating the policy's own channel check on every
  -- readable reaction row whether or not the viewer has blocked anyone. Every
  -- join is on a unique key, so there is at most one row.
  select coalesce((
    select public.can_read_chat_channel(m.channel_id)
    from public.chat_messages      m
    join public.chat_channels      c on c.id = m.channel_id
    join public.users              u on u.supabase_auth_id = auth.uid()
    join public.chat_member_blocks b on b.chapter_id = c.chapter_id
                                    and b.blocker_user_id = u.id
                                    and b.blocked_user_id = p_actor
    where m.id = p_message_id
    limit 1
  ), false);
$$;

-- Same lockdown as can_read_chat_channel (20260906203000): Postgres grants
-- EXECUTE to PUBLIC by default and hosted Supabase grants anon directly, so
-- revoke both, then grant the role the policy runs as. Guarded on role
-- existence for bare-Postgres substrates (PGlite in CI).
revoke all on function public.chat_viewer_has_blocked(uuid, uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.chat_viewer_has_blocked(uuid, uuid) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.chat_viewer_has_blocked(uuid, uuid) to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.chat_viewer_has_blocked(uuid, uuid) to service_role;
  end if;
end
$$;

-- Re-created, not altered: the ledger in
-- apps/api/src/application/services/chat-read-surface-ledger.spec.ts refuses
-- `alter policy` and counts every `create policy` under this name. The first
-- two conjuncts and the `to authenticated` clause are 20260803150000's,
-- unchanged, including why the role clause goes through `format()`.
-- `starts_with` rather than `like 'reaction:%'`, because `%` is format()'s
-- escape character.
drop policy if exists "chat_message_actions_select" on public.chat_message_actions;

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
        and not (
          starts_with(action_type, 'reaction:')
          and public.chat_viewer_has_blocked(user_id, message_id)
        )
      )
  $p$, v_role_clause);
end
$$;
