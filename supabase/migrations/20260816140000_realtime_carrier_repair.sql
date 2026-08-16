-- Repair the Realtime carrier: nothing has ever been replicated (G1 / #867).
--
-- Verified 2026-08-16 against BOTH deployed projects via read-only SQL: the
-- `supabase_realtime` publication contains NO TABLES AT ALL on production and
-- staging alike (puballtables = false, zero rows), and `ALTER PUBLICATION`
-- appears in ZERO migrations repo-wide.
-- (Project refs deliberately not written here: they come from Infisical
-- `SUPABASE_PROJECT_REF` and are not committed -- AGENT_INFRA.md § Project refs.)
--
-- Consequence: every `postgres_changes` subscription in the product has been
-- receiving nothing, in every environment, since the first deploy. This is NOT
-- the RLS default-deny problem #867 hypothesised -- it sits one layer lower and
-- is unconditional: a table absent from the publication never reaches Realtime
-- via the WAL at all, so no RLS policy could have rescued it. That is outcome
-- (c) in #937's G1 gate: "broken on web too, so fix the carrier first."
--
-- SIX subscriptions are dead. They split by whether the subscriber needs the
-- changed ROW or merely needs to know SOMETHING CHANGED:
--
--   payload consumers -> postgres_changes + table RLS  (section 1)
--     public.chat_messages         packages/chat-core/src/realtime-manager.ts:418
--     public.chat_message_actions  ...:549,562  ("chat:actions:global")
--     public.chapter_audit_log     apps/api/src/modules/chat-bridge-worker/  (service-role;
--                                  RLS bypassed, so publication membership is the whole fix)
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

  -- The sixth dead subscription, and the only server-side one:
  -- `ChatBridgeWorkerService` (apps/api/src/modules/chat-bridge-worker/) has
  -- been subscribed to `postgres_changes` INSERT on `chapter_audit_log` since it
  -- shipped, mirroring config changes, role edits and billing transitions into
  -- `#chapter-audit`. Same root cause, same silence: the channel joins and never
  -- fires, so that channel has always been empty.
  --
  -- No RLS policy needed here, unlike the chat pair: this subscriber uses the
  -- SERVICE-ROLE client, which bypasses RLS entirely. Publication membership is
  -- the whole fix, and adding a policy would only widen the table for no reader.
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chapter_audit_log'
  ) then
    alter publication supabase_realtime add table public.chapter_audit_log;
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

-- Definer functions must not be executable beyond what we intend (the hardening
-- from 20260803150000 and #678).
--
-- `revoke ... from public` alone is NOT enough, and assuming it is was the
-- defect this block exists to avoid: Postgres grants EXECUTE to PUBLIC by
-- default, but Supabase ALSO installs a direct grant to `anon` and
-- `authenticated` via `alter default privileges in schema public`. Revoking
-- PUBLIC leaves that direct `anon` grant in place, so the function stays
-- callable unauthenticated through PostgREST
-- (`POST /rest/v1/rpc/realtime_can_read_chapter_scope`) by anyone holding the
-- publishable key -- which ships in the web bundle.
--
-- It would return false today only because `auth.uid()` is NULL for anon. That
-- is a property of the *plan shape*, not of the grant, and 20260803150000
-- argues at length that this is exactly what must not be relied on: the moment
-- someone adds a non-`auth.uid()` branch these become unauthenticated
-- membership oracles with nothing behind them.
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.realtime_can_read_user_scope(uuid)',
    'public.realtime_can_read_chapter_scope(uuid)',
    'public.realtime_can_read_event_scope(uuid)'
  ]
  loop
    execute format('revoke all on function %s from public', v_fn);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', v_fn);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function %s to authenticated', v_fn);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', v_fn);
    end if;
  end loop;
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

-- EVERY send is wrapped in its own exception block. This is load-bearing, and
-- the naive spelling is actively dangerous:
--
--   1. An AFTER ROW trigger fires INSIDE the writing transaction, not after
--      commit. `return null` does not change that -- the value is ignored for
--      AFTER triggers, but an exception raised in the body still unwinds the
--      caller's statement. So an unguarded `perform realtime.send(...)` makes a
--      best-effort ping a hard availability dependency of three core write
--      paths: every event create, every attendance check-in, every notification.
--   2. `realtime.messages` is DAILY PARTITIONED by the Realtime service. If
--      partition creation ever lags a UTC day boundary, the insert raises
--      `no partition of relation "messages" found for row` -- and that 500s the
--      member's check-in, for a ping nobody was waiting on.
--   3. `realtime` does not exist on bare Postgres at all (CI's PGlite harness,
--      any non-Supabase target). plpgsql resolves the call at RUNTIME, not at
--      CREATE time, so the migration would apply cleanly and then make three
--      core tables unwritable on first insert. Catching here covers that too,
--      which is why the trigger creation below needs no schema guard.
--
-- The cost is one subtransaction per row. These three tables are low-write
-- (notifications, events, attendance), so that is the right trade against
-- 500-ing a write to deliver a cache-invalidation hint.
-- FOR EACH STATEMENT over a transition table, NOT for each row.
--
-- Per-row was the obvious spelling and it is wrong at scale. `markAutoAbsent`
-- (apps/api/src/application/services/attendance.service.ts) inserts one
-- `event_attendance` row per member in a single `createMany` — 150 rows for a
-- 150-member chapter, from one admin click. Per-row that becomes:
--   * 150 trigger invocations, each opening its own `exception` subtransaction.
--     Past 64 subxids the transaction is flagged suboverflowed and every other
--     backend falls back to the pg_subtrans SLRU for visibility checks.
--   * 150 broadcast frames on ONE topic, all saying the same thing.
--   * 300 invalidations per viewer; TanStack v5 `invalidateQueries` defaults to
--     `cancelRefetch: true`, so each frame aborts the in-flight attendance and
--     event reads and restarts them.
-- One click, ~300 aborted requests per open browser, to deliver a single bit of
-- information. Statement-level with `select distinct` collapses all of it to one
-- ping per distinct scope, which is exactly what the client needs.
--
-- THREE triggers per table: Postgres forbids a transition table on a trigger
-- with more than one event, and they are operation-specific anyway --
-- NEW TABLE does not exist for DELETE, OLD TABLE does not exist for INSERT.
-- Both name the relation `changed`, so one function serves both. UPDATE rides
-- the NEW side: the scope columns here (`user_id`, `chapter_id`, `event_id`) are
-- effectively immutable, so a row moving between scopes is not a case worth
-- doubling the trigger count for.
create or replace function public.realtime_notify_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scope uuid;
begin
  begin
    for v_scope in select distinct user_id from changed where user_id is not null
    loop
      perform realtime.send(
        jsonb_build_object('table', 'notifications', 'op', tg_op),
        'change',
        'notif:' || v_scope::text,
        true
      );
    end loop;
  exception when others then
    -- Deliberately swallowed: the client falls back to its normal refetch, and
    -- a stale drawer is strictly better than a failed write.
    null;
  end;
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
  v_scope uuid;
begin
  begin
    for v_scope in select distinct chapter_id from changed where chapter_id is not null
    loop
      perform realtime.send(
        jsonb_build_object('table', 'events', 'op', tg_op),
        'change',
        'events:' || v_scope::text,
        true
      );
    end loop;
  exception when others then
    null;
  end;
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
  v_scope uuid;
begin
  begin
    for v_scope in select distinct event_id from changed where event_id is not null
    loop
      perform realtime.send(
        jsonb_build_object('table', 'event_attendance', 'op', tg_op),
        'change',
        'attendance:' || v_scope::text,
        true
      );
    end loop;
  exception when others then
    null;
  end;
  return null;
end;
$$;

-- AFTER so the ping reflects a change that actually happened. Note this does NOT
-- mean "after commit" -- see the block comment above for why each send carries
-- its own exception handler.
drop trigger if exists realtime_notify_notifications on public.notifications;
drop trigger if exists realtime_notify_notifications_ins on public.notifications;
drop trigger if exists realtime_notify_notifications_upd on public.notifications;
drop trigger if exists realtime_notify_notifications_del on public.notifications;
create trigger realtime_notify_notifications_ins
  after insert on public.notifications
  referencing new table as changed
  for each statement execute function public.realtime_notify_notifications();
create trigger realtime_notify_notifications_upd
  after update on public.notifications
  referencing new table as changed
  for each statement execute function public.realtime_notify_notifications();
create trigger realtime_notify_notifications_del
  after delete on public.notifications
  referencing old table as changed
  for each statement execute function public.realtime_notify_notifications();

drop trigger if exists realtime_notify_events on public.events;
drop trigger if exists realtime_notify_events_ins on public.events;
drop trigger if exists realtime_notify_events_upd on public.events;
drop trigger if exists realtime_notify_events_del on public.events;
create trigger realtime_notify_events_ins
  after insert on public.events
  referencing new table as changed
  for each statement execute function public.realtime_notify_events();
create trigger realtime_notify_events_upd
  after update on public.events
  referencing new table as changed
  for each statement execute function public.realtime_notify_events();
create trigger realtime_notify_events_del
  after delete on public.events
  referencing old table as changed
  for each statement execute function public.realtime_notify_events();

drop trigger if exists realtime_notify_event_attendance on public.event_attendance;
drop trigger if exists realtime_notify_event_attendance_ins on public.event_attendance;
drop trigger if exists realtime_notify_event_attendance_upd on public.event_attendance;
drop trigger if exists realtime_notify_event_attendance_del on public.event_attendance;
create trigger realtime_notify_event_attendance_ins
  after insert on public.event_attendance
  referencing new table as changed
  for each statement execute function public.realtime_notify_event_attendance();
create trigger realtime_notify_event_attendance_upd
  after update on public.event_attendance
  referencing new table as changed
  for each statement execute function public.realtime_notify_event_attendance();
create trigger realtime_notify_event_attendance_del
  after delete on public.event_attendance
  referencing old table as changed
  for each statement execute function public.realtime_notify_event_attendance();

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
