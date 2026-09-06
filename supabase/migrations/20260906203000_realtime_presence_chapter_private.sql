-- #1552 (phase 1): put the Directory's presence topic behind Realtime RLS.
--
-- `presence:chapter:<chapterId>` is the channel the web Directory uses to show
-- who is online (#419 / #1551). It was PUBLIC, and a public Realtime channel is
-- authenticated in neither direction: anyone holding the anon key (it ships in
-- the browser bundle) and a chapter UUID could join it and read the roster, and
-- could `track({ userId: <victim> })` to render any member as online. Presence
-- identity comes from the tracked payload, not the caller's JWT, and that is
-- what #1551 turned into a rendered claim about a named person.
--
-- Realtime authorises PRIVATE channels through RLS on `realtime.messages`:
-- SELECT decides who may JOIN (and so receive presence sync / broadcast), INSERT
-- decides who may `track()` presence or `send()` a broadcast. Both are needed
-- here — a topic with only a SELECT branch would let a member join, report
-- SUBSCRIBED, and then have every `track()` refused silently, so the Directory
-- would show nobody online while looking healthy. That is the #867 shape the
-- issue warns about, and it is why the client flip to `private: true` ships in
-- the SAME change as this migration and not before it.
--
-- What this phase does and does not close:
--
--   * Closes the outsider case entirely. Only an authenticated member of the
--     chapter (via `realtime_can_read_chapter_scope`, the same SECURITY DEFINER
--     predicate the `events:` topic already uses) may join or publish.
--   * Does NOT bind the tracked `userId` to the caller. A chapter MEMBER can still
--     publish a presence entry naming another member. Realtime evaluates these
--     policies against the topic and the message `extension`, not against the
--     presence payload, so there is no honest predicate to write for it here;
--     presence stays advisory (AUTHORIZATION_MODEL.md) and is never an input to
--     an authorization decision.
--   * Does NOT touch chat's `chat:channel:<channelId>` presence. That topic also
--     carries `postgres_changes` and typing broadcasts, is read by the push worker
--     (ADR-10), and needs a per-CHANNEL predicate — chapter membership would leak
--     DM and role-gated channel presence to the whole chapter. Phase 2.
--
-- The SELECT policy is recreated rather than altered: Postgres has no
-- ALTER POLICY ... USING that appends an arm, and the original create is
-- guarded `if exists ... return`, so a second `create policy` would no-op.
-- The three existing arms are copied verbatim; `else false` stays.
--
-- Guarded on the realtime schema existing: bare-Postgres substrates (CI's PGlite
-- harness) have no `realtime` schema and skip this file's effect entirely.
-- Idempotent: `drop policy if exists` then `create`, so `db push --local` on an
-- already-migrated stack is a no-op in effect.

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
          else false
        end
      )
  $p$;

  -- INSERT is what authorises `track()` (extension = 'presence') and `send()`
  -- (extension = 'broadcast') on a private channel. Only the presence topic
  -- gets it, and only for presence: the change-ping topics are receive-only
  -- (their writes come from DB triggers via `realtime.send`, as definer), and
  -- nothing legitimately broadcasts on the Directory topic. Any other topic or
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
          else false
        end
      )
  $p$;
end
$$;
