-- #1552: put BOTH presence topics behind Realtime RLS.
--
-- `presence:chapter:<chapterId>` (the web Directory's who-is-online roster, #419 /
-- #1551) and `chat:channel:<channelId>` (chat's presence + typing channel, read by
-- the push worker to skip recipients who are already looking, ADR-10) were PUBLIC
-- Realtime channels. A public channel is authenticated in neither direction:
-- anyone holding the anon key (it ships in the browser bundle) and a UUID could
-- join and read the roster, and could `track({ userId: <victim> })` to render any
-- member as online — on the chat topic that forged entry also suppresses the
-- victim's push notifications. Presence identity comes from the tracked payload,
-- not the caller's JWT, and that is what #1551 turned into a rendered claim
-- about a named person.
--
-- Realtime authorises PRIVATE channels through RLS on `realtime.messages`:
-- SELECT decides who may JOIN (and so receive presence sync, broadcasts and,
-- on the chat topic, the `postgres_changes` bound to the same channel), INSERT
-- decides who may `track()` presence or `send()` a broadcast. Both are needed —
-- a topic with only a SELECT arm lets a member join, report SUBSCRIBED, and then
-- has every `track()` and typing `send()` refused silently, so the roster shows
-- nobody and typing never appears while everything looks healthy. That is the
-- #867 shape the issue warns about, and it is why the client flips to
-- `private: true` ship in the SAME change as this migration and not before it.
--
-- Two predicates, because the two topics answer different questions:
--
--   * `presence:chapter:<id>` reuses `realtime_can_read_chapter_scope` — any
--     member of the chapter may see who in the chapter is online. Same predicate
--     the `events:` topic already uses.
--   * `chat:channel:<id>` gets `can_read_chat_channel`, the CHANNEL half of
--     `can_read_chat_message` extracted into its own function: PUBLIC channels
--     to any chapter member, PRIVATE / DM / GROUP_DM to `member_ids`, ROLE_GATED
--     by required permissions (wildcard included), a ROLE_GATED channel with no
--     requirement to nobody (FRA-321). Chapter membership alone would have leaked
--     who is present in every DM and role-gated channel to the whole chapter.
--     `can_read_chat_message` now delegates to it, so the message RLS and the
--     realtime authorisation cannot drift apart on what "may read this channel"
--     means — which is exactly the drift that produced FRA-321 between this
--     predicate and its TypeScript twin `canAccessChannel`.
--
-- Verified against the local Realtime server before this was written down:
-- on a private `chat:channel:` topic a member still receives `postgres_changes`
-- for `chat_messages`, receives typing broadcasts, sees presence, and can
-- `track()`; the service-role push worker joining the same topic privately sees
-- the member's presence; a worker left PUBLIC sees an EMPTY roster (private and
-- public are separate rooms, so the worker flips in the same change); an
-- authenticated non-member and the bare anon key get `CHANNEL_ERROR Unauthorized`.
--
-- What this does NOT close: the tracked `userId` is still not bound to the
-- caller. Realtime evaluates these policies against the topic and the message
-- `extension`, not the presence payload, so a member who may read a channel can
-- still publish an entry naming another member of it. Presence stays advisory
-- (AUTHORIZATION_MODEL.md) and is never an input to an authorization decision;
-- push suppression's failure mode is an extra push, by design (ADR-10).
--
-- The SELECT policy is recreated rather than altered: Postgres has no
-- ALTER POLICY ... USING that appends an arm, and the original create is
-- guarded `if exists ... return`, so a second `create policy` would no-op.
-- The three existing arms are copied verbatim; `else false` stays.
--
-- Guarded on the realtime schema existing: bare-Postgres substrates (CI's PGlite
-- harness) have no `realtime` schema and skip the policy half; the predicate
-- half runs everywhere, and the PGlite gate exercises it. Idempotent: `create or
-- replace` for the functions, `drop policy if exists` then `create` for the
-- policies, so `db push --local` on an already-migrated stack is a no-op in
-- effect.

-- ---------------------------------------------------------------------------
-- 1. The channel-access predicate, extracted from can_read_chat_message.
-- ---------------------------------------------------------------------------
-- Body is can_read_chat_message's CASE, verbatim, over a channel row instead of
-- a message's channel. `security definer` because `chat_channels`, `members`,
-- `users` and `roles` are API-only tables (RLS on, no policy) that the
-- `authenticated` role cannot read directly; `search_path = public, pg_temp`
-- per 20260827190000 (pg_temp last, so a caller cannot shadow a public object).
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
      and (
        case
          when c.type = 'PUBLIC' then true
          when c.type in ('PRIVATE', 'DM', 'GROUP_DM')
            then u.id = any (coalesce(c.member_ids, '{}'::uuid[]))
          when c.type = 'ROLE_GATED' then
            exists (
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
                  or r.permissions && c.required_permissions
                )
            )
          else false
        end
      )
  );
$$;

revoke all on function public.can_read_chat_channel(uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.can_read_chat_channel(uuid) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.can_read_chat_channel(uuid) to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.can_read_chat_channel(uuid) to service_role;
  end if;
end
$$;

-- can_read_chat_message keeps its signature and semantics and becomes the
-- one-line composition it always described: "may the caller read the channel
-- this message is in". Same definer/search_path shape as 20260827190000.
create or replace function public.can_read_chat_message(p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.chat_messages m
    where m.id = p_message_id
      and public.can_read_chat_channel(m.channel_id)
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. The realtime.messages policies.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'realtime') then
    return;
  end if;
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'realtime' and c.relname = 'messages') then
    return;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    return;
  end if;

  execute 'drop policy if exists "realtime_messages_scoped_select" on realtime.messages';
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
        -- `substring(... from N)` is 1-indexed: N is the prefix length + 1.
        case
          when realtime.topic() ~* '^notif:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
            public.realtime_can_read_user_scope(substring(realtime.topic() from 7)::uuid)
          when realtime.topic() ~* '^events:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
            public.realtime_can_read_chapter_scope(substring(realtime.topic() from 8)::uuid)
          when realtime.topic() ~* '^attendance:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
            public.realtime_can_read_event_scope(substring(realtime.topic() from 12)::uuid)
          when realtime.topic() ~* '^presence:chapter:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
            public.realtime_can_read_chapter_scope(substring(realtime.topic() from 18)::uuid)
          when realtime.topic() ~* '^chat:channel:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
            public.can_read_chat_channel(substring(realtime.topic() from 14)::uuid)
          else false
        end
      )
  $p$;

  -- INSERT is what authorises `track()` (extension = 'presence') and `send()`
  -- (extension = 'broadcast') on a private channel. The Directory topic takes
  -- presence only — nothing legitimately broadcasts there. The chat topic takes
  -- presence AND broadcast, because typing indicators are client broadcasts on
  -- it. The change-ping topics get nothing: they are receive-only (their writes
  -- come from DB triggers via `realtime.send`, as definer). Any other topic or
  -- extension falls to `else false`.
  execute 'drop policy if exists "realtime_messages_scoped_insert" on realtime.messages';
  execute $p$
    create policy "realtime_messages_scoped_insert"
      on realtime.messages for insert
      to authenticated
      with check (
        case
          when realtime.messages.extension = 'presence'
           and realtime.topic() ~* '^presence:chapter:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
            public.realtime_can_read_chapter_scope(substring(realtime.topic() from 18)::uuid)
          when realtime.messages.extension in ('presence', 'broadcast')
           and realtime.topic() ~* '^chat:channel:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
            public.can_read_chat_channel(substring(realtime.topic() from 14)::uuid)
          else false
        end
      )
  $p$;
end
$$;
