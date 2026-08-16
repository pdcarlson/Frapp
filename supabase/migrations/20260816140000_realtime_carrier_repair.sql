-- Repair the Realtime carrier: nothing has ever been replicated (G1 / #867).
--
-- Verified 2026-08-16 against BOTH deployed projects via read-only SQL:
--   frapp-prod    (unttyvyfezddlyafcydh) -- publication `supabase_realtime`
--                 contains NO TABLES AT ALL (puballtables = false, zero rows).
--   frapp-staging (hnoyzpidbmizhbqaiity) -- identical.
-- and `ALTER PUBLICATION` appears in ZERO migrations repo-wide.
--
-- Consequence: every `postgres_changes` subscription in the product has been
-- receiving nothing, in every environment, since the first deploy. This is NOT
-- the RLS default-deny problem #867 hypothesised -- it sits one layer lower and
-- is unconditional: a table absent from the publication never reaches Realtime
-- via the WAL at all, so no RLS policy could have rescued it. That is outcome
-- (c) in #937's G1 gate: "broken on web too, so fix the carrier first."
--
-- Five subscriptions are dead. They split cleanly by whether the subscriber
-- needs the changed ROW or merely needs to know SOMETHING CHANGED:
--
--   payload consumers -> postgres_changes + table RLS  (section 1)
--     public.chat_messages         packages/chat-core/src/realtime-manager.ts:418
--     public.chat_message_actions  ...:549,562  ("chat:actions:global")
--
--   ping-only consumers -> private broadcast           (sections 2-4)
--     public.notifications      apps/web/components/layout/dashboard-notification-drawer.tsx:96
--     public.events             apps/web/components/events/events-page.tsx:71
--     public.event_attendance   apps/web/components/events/attendance-panel.tsx:110
--   -- all three reach Realtime through `useRealtimeTable`, whose entire body is
--   -- `queryClient.invalidateQueries(...)`. They never read `payload.new`.
--
-- WHY THE SPLIT IS A SECURITY REQUIREMENT, not a stylistic preference:
-- Realtime evaluates the SAME RLS policy PostgREST does. Across this whole
-- schema only three tables carry any policy at all (`users`, `members`,
-- `chat_message_actions`); everything else is RLS-on/zero-policy, i.e. the
-- browser's user-JWT client cannot read it and the NestJS API mediates every
-- read with the service role. So granting `notifications` / `events` /
-- `event_attendance` a SELECT policy purely to make Realtime fire would ALSO
-- publish them to direct PostgREST reads from the browser, and every guard that
-- currently enforces access in Nest (ChapterGuard, PermissionsGuard, module
-- gating, per-handler narrowing) would have to be re-expressed exactly as an
-- RLS predicate or the browser gets a bypass around the entire authorization
-- layer. #867 names that risk directly ("an E2-class change wanting its own
-- review"). Private broadcast delivers the ping those three actually need while
-- leaving them default-deny -- no new read surface.

-- ---------------------------------------------------------------------------
-- 1. Chat: publish the two tables whose subscribers consume the row.
-- ---------------------------------------------------------------------------

-- `alter publication ... add table` throws if the table is already a member, so
-- every add is guarded. Re-running this migration must be a no-op (the repo
-- treats `db push --local` as idempotent -- AGENTS.md § Gotchas).
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    -- Managed platforms create this publication for us; a bare Postgres (CI,
    -- PGlite harness) has never seen it. Create it empty so the adds below
    -- have a target and the migration is substrate-independent.
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_message_actions'
  ) then
    alter publication supabase_realtime add table public.chat_message_actions;
  end if;
end
$$;

-- Realtime enforces RLS per subscriber, so publication membership alone still
-- delivers nothing to `chat_messages` -- it is RLS-enabled with zero policies
-- (initial_schema.sql:469). #867 pre-authorised exactly this policy, conditional
-- on its question (2) being answered first: "if a policy is needed it should
-- mirror the SECURITY DEFINER can_read_chat_message() predicate". Question (2)
-- is now answered, so we mirror it rather than inventing a second spelling of
-- channel membership -- `can_read_chat_message` already exists (added by
-- 20260803150000) and is the SQL twin of `canAccessChannel`
-- (packages/validation/src/index.ts). A second predicate here is precisely the
-- drift that produced FRA-321.
--
-- `chat_message_actions` needs no new policy: 20260803150000 already gave it a
-- per-row membership SELECT policy built for this exact subscription, whose own
-- comment reads "RLS is the ONLY access gate". That work was correct; only the
-- publication half was ever missing.
do $$
declare
  v_role_clause text := '';
begin
  if exists (select 1 from pg_policies where schemaname = 'public'
               and tablename = 'chat_messages' and policyname = 'chat_messages_select') then
    return;
  end if;

  -- Mirrors the pg_roles guard in 20260803150000: substrates without Supabase's
  -- auth roles (the PGlite harness) still apply the policy, ungated by role.
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    v_role_clause := 'to authenticated';
  end if;

  execute format($p$
    create policy "chat_messages_select"
      on public.chat_messages for select
      %s
      using (
        auth.role() = 'authenticated'
        and public.can_read_chat_message(id)
      )
  $p$, v_role_clause);
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Scope predicates for the ping-only topics.
-- ---------------------------------------------------------------------------
--
-- Same construction as `can_read_chat_message` and for the same reason: these
-- read `users` / `members` / `events`, all default-deny, so under the invoking
-- `authenticated` role the sub-selects would return nothing and every check
-- would fail closed. SECURITY DEFINER evaluates them as the owner.
-- `set search_path = public` hardens the definer against search-path injection;
-- `auth.uid()` is schema-qualified so it still resolves with `auth` off the
-- path, and it continues to read the request JWT inside a definer function, so
-- per-caller scoping holds. A NULL auth.uid() (anon, no JWT) matches no user row
-- and every predicate returns false.

-- `notifications.user_id` is a `public.users.id`, NOT a `supabase_auth_id` --
-- the drawer filters `user_id=eq.${frappUser.userId}`. Resolve through `users`
-- rather than comparing against auth.uid() directly.
create or replace function public.realtime_can_read_user_scope(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    where u.id = p_user_id
      and u.supabase_auth_id = auth.uid()
  );
$$;

create or replace function public.realtime_can_read_chapter_scope(p_chapter_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    join public.members m on m.user_id = u.id
    where u.supabase_auth_id = auth.uid()
      and m.chapter_id = p_chapter_id
  );
$$;

-- Attendance is scoped by event, and an event belongs to exactly one chapter, so
-- chapter membership is the gate. Deliberately NOT narrower than the API: the
-- attendance panel is already behind `members:view` at the route, and this only
-- authorises a contentless "attendance changed" ping, never a row.
create or replace function public.realtime_can_read_event_scope(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.events e
    join public.members m on m.chapter_id = e.chapter_id
    join public.users u on u.id = m.user_id
    where e.id = p_event_id
      and u.supabase_auth_id = auth.uid()
  );
$$;

-- Definer functions must not be executable by anon/PUBLIC beyond what we intend
-- (mirrors the revoke/grant hardening in 20260803150000 and issue #678).
do $$
begin
  execute 'revoke execute on function public.realtime_can_read_user_scope(uuid) from public';
  execute 'revoke execute on function public.realtime_can_read_chapter_scope(uuid) from public';
  execute 'revoke execute on function public.realtime_can_read_event_scope(uuid) from public';
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.realtime_can_read_user_scope(uuid) to authenticated';
    execute 'grant execute on function public.realtime_can_read_chapter_scope(uuid) to authenticated';
    execute 'grant execute on function public.realtime_can_read_event_scope(uuid) to authenticated';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Emit a contentless change ping on the three ping-only tables.
-- ---------------------------------------------------------------------------
--
-- `realtime.send(payload, event, topic, private)` rather than
-- `realtime.broadcast_changes(...)`: broadcast_changes ships the whole row, and
-- these three consumers read no row data whatsoever. Sending `{table, op}` and
-- nothing else means the transport carries no member, event or notification
-- content at all -- the client is told to refetch, and the refetch goes through
-- the API where the real authorization lives. Strictly less to leak.
--
-- The topic mirrors each subscription's existing `filter:` so authorization has
-- the same shape as the scoping the client already asked for.
-- DELETE carries no NEW row, so the topic key is read from `coalesce(new, old)`.

create or replace function public.realtime_notify_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.notifications := coalesce(new, old);
begin
  perform realtime.send(
    jsonb_build_object('table', 'notifications', 'op', tg_op),
    'change',
    'notif:' || v_row.user_id::text,
    true
  );
  return null;
end;
$$;

create or replace function public.realtime_notify_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.events := coalesce(new, old);
begin
  perform realtime.send(
    jsonb_build_object('table', 'events', 'op', tg_op),
    'change',
    'events:' || v_row.chapter_id::text,
    true
  );
  return null;
end;
$$;

create or replace function public.realtime_notify_event_attendance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.event_attendance := coalesce(new, old);
begin
  perform realtime.send(
    jsonb_build_object('table', 'event_attendance', 'op', tg_op),
    'change',
    'attendance:' || v_row.event_id::text,
    true
  );
  return null;
end;
$$;

-- AFTER ... FOR EACH ROW so the ping only fires on a committed change, and the
-- trigger cannot affect the write itself (the functions return null, which is
-- ignored for AFTER triggers).
drop trigger if exists realtime_notify_notifications on public.notifications;
create trigger realtime_notify_notifications
  after insert or update or delete on public.notifications
  for each row execute function public.realtime_notify_notifications();

drop trigger if exists realtime_notify_events on public.events;
create trigger realtime_notify_events
  after insert or update or delete on public.events
  for each row execute function public.realtime_notify_events();

drop trigger if exists realtime_notify_event_attendance on public.event_attendance;
create trigger realtime_notify_event_attendance
  after insert or update or delete on public.event_attendance
  for each row execute function public.realtime_notify_event_attendance();

-- ---------------------------------------------------------------------------
-- 4. Authorise the three private topics on realtime.messages.
-- ---------------------------------------------------------------------------
--
-- `realtime.messages` is RLS-enabled with zero policies today, which denies every
-- PRIVATE channel outright. This policy is purely additive -- it grants three
-- topic families and nothing else. Chat's existing typing/presence channels are
-- PUBLIC (`realtime-manager.ts` mints them without `private: true`) and public
-- channels bypass realtime.messages RLS entirely, so they are unaffected.
--
-- Guarded on the realtime schema existing: bare-Postgres substrates (CI's PGlite
-- harness) have no `realtime` schema, and the sections above are the part that
-- matters there.
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'realtime') then
    return;
  end if;
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'realtime' and c.relname = 'messages') then
    return;
  end if;
  if exists (select 1 from pg_policies where schemaname = 'realtime'
               and tablename = 'messages' and policyname = 'realtime_messages_scoped_select') then
    return;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    return;
  end if;

  execute $p$
    create policy "realtime_messages_scoped_select"
      on realtime.messages for select
      to authenticated
      using (
        -- The suffix is matched against a full UUID shape BEFORE it is cast.
        -- A topic is attacker-chosen (any client may attempt to subscribe to
        -- any string), and `'garbage'::uuid` raises rather than returning
        -- false -- which would turn a denial into an error, and a cheap error
        -- an unauthenticated-ish caller can trigger at will is a DoS lever.
        -- Same regex spelling as can_read_chat_message uses for role_ids.
        case
          when realtime.topic() ~* '^notif:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
            public.realtime_can_read_user_scope(substring(realtime.topic() from 7)::uuid)
          when realtime.topic() ~* '^events:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
            public.realtime_can_read_chapter_scope(substring(realtime.topic() from 8)::uuid)
          when realtime.topic() ~* '^attendance:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
            public.realtime_can_read_event_scope(substring(realtime.topic() from 12)::uuid)
          else false
        end
      )
  $p$;
end
$$;
