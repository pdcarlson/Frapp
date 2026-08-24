-- `kind = 'imported'` becomes a first-class archive marker at the database layer:
-- it must never light an unread badge, and it must never reach a Realtime
-- subscriber.
--
-- `chat_messages.kind` carries no CHECK constraint, so the value itself needs no
-- DDL (it is declared in TypeScript in three places -- see
-- spec/behavior/chat/README.md § Message Kinds and Actions). What DOES need SQL is
-- the two places the database makes a decision about a message.

-- ---------------------------------------------------------------------------
-- 1. Unread counts: say what we mean.
--
-- The previous body joined on `m.sender_id <> p_user_id`. Once `sender_id` is
-- nullable that predicate is NULL for every imported row, which the join treats as
-- false -- so imported messages were already excluded from the badge, by accident.
--
-- Relying on that would be a trap. The accident is invisible, it reads as a bug to
-- anyone auditing null-safety, and the obvious "fix" (`is distinct from`) silently
-- turns a fresh archive into a 47,000-unread badge for every member who has never
-- opened the channel -- the `-infinity` branch below means a member with no receipt
-- counts EVERYTHING.
--
-- So both things are now stated explicitly and independently:
--   * `is distinct from` -- null-safe sender comparison, correct on its own terms.
--   * `kind <> 'imported'` -- an archive is history, not news. This is the rule
--     that actually protects the badge, and it no longer depends on sender nullness.
--
-- Net behaviour is unchanged today; the difference is that it survives the next
-- person who reads this function.
--
-- Everything else about the function is untouched: still `stable`, still
-- `security definer` (chat_channels and channel_read_receipts are RLS-enabled with
-- zero policies), still `search_path = public, pg_temp` with pg_temp LAST.
create or replace function public.get_channel_unread_counts(
  p_chapter_id uuid,
  p_user_id    uuid
)
returns table (channel_id uuid, unread_count bigint, mention_count bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    c.id,
    count(m.id) filter (where m.id is not null),
    count(m.id) filter (where p_user_id = any (m.mentions))
  from chat_channels c
  left join channel_read_receipts r
    on r.channel_id = c.id
   and r.user_id = p_user_id
  left join chat_messages m
    on m.channel_id = c.id
   -- A deleted message is not unread.
   and m.is_deleted = false
   -- An imported archive message is never unread: it is history the chapter is
   -- importing, not a message anyone sent them. Without this a chapter that
   -- imports its Discord history hands every member a five-figure badge they
   -- cannot clear by reading.
   and m.kind <> 'imported'
   -- Your own messages are never unread to you. Without this every send would
   -- light up your own badge until you reopened the channel you just posted in.
   -- `is distinct from` rather than `<>` because sender_id is nullable now; a
   -- null-sender message is nobody's own message, so it counts.
   and m.sender_id is distinct from p_user_id
   -- No receipt means never opened, so everything counts. `-infinity` is what
   -- makes the left join's null cursor behave that way rather than counting zero.
   and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
  where c.chapter_id = p_chapter_id
  group by c.id;
$$;

-- `create or replace` preserves grants, but re-issuing them keeps this file
-- self-contained if it is ever replayed onto a substrate where the function did
-- not exist. `public` always exists, so its revoke is unguarded; anon /
-- authenticated / service_role are Supabase-managed and absent in bare Postgres
-- (PGlite in CI), so guard each on role existence -- same idiom as the other RPC
-- migrations.
revoke execute on function public.get_channel_unread_counts(uuid, uuid) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.get_channel_unread_counts(uuid, uuid) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.get_channel_unread_counts(uuid, uuid) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.get_channel_unread_counts(uuid, uuid) to service_role;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Realtime fan-out: keep imported rows out of the carrier.
--
-- THE PROBLEM. An import can be targeted at a channel members currently have
-- open, so every imported row would otherwise become a `postgres_changes` frame
-- delivered to every subscriber of that channel, each one its own `setQueryData`,
-- full cache spread and list re-render on the client
-- (packages/chat-core/src/realtime-manager.ts has no inbound batching).
--
-- WHAT DOES NOT WORK, AND WHY, SO NOBODY RE-PROPOSES IT:
--
--   * A publication row filter (`alter publication supabase_realtime add table
--     public.chat_messages where (kind <> 'imported')`) is SILENTLY IGNORED by
--     Supabase Realtime. `realtime.list_changes` builds wal2json's `add-tables`
--     parameter from `pg_publication_tables` -- table NAMES only. `prqual` is never
--     read, because row filters are a pgoutput feature and walrus decodes with
--     wal2json. It would also require `replica identity full`, which this repo
--     argues against at 20260803150000_chat_message_actions_membership_rls.sql:100.
--
--   * Dropping `chat_messages` from the publication for the duration of an import
--     stops live delivery for everyone, with no disconnect for the client's
--     resubscribe-then-backfill gate to recover from -- messages sent in that
--     window would simply never arrive.
--
-- WHAT DOES WORK. `realtime.list_changes` emits only rows where
-- `subscription_ids[1] is not null`, i.e. rows that matched a live subscription's
-- filters AND passed that subscriber's RLS check in `realtime.apply_rls`. So the
-- RLS policy IS the fan-out control, and narrowing it produces exactly zero frames
-- for imported rows.
--
-- This costs nothing functionally: NOTHING reads `chat_messages` directly through
-- PostgREST (verified -- there is no `from('chat_messages')` anywhere in apps/web,
-- apps/mobile or packages/*). Cold reads go through the NestJS API on the
-- service-role key, which bypasses RLS. This policy exists solely as the Realtime
-- carrier, and the archive deliberately does not use that carrier -- it is history,
-- fetched by the ordinary channel read.
--
-- The predicate goes in the POLICY, not in `can_read_chat_message`. That function
-- is also the `chat_message_actions` SELECT policy, so pushing `kind` into it would
-- break reactions and votes on imported messages.
--
-- The push worker subscribes on the service-role key (BYPASSRLS) and so still
-- receives these rows; its own `kind === 'imported'` early exit is the control
-- there. Both are needed.
--
-- KNOWN LIMITATION, stated so nobody rediscovers it as a bug. A SELECT policy is
-- per-row, not per-operation, so this suppresses UPDATE echoes on imported rows
-- as well as the INSERT flood it was written for. Moderating an archived message
-- -- a `channels:manage` soft-delete, a pin, an edit -- therefore does not
-- propagate live: other members keep rendering the old row until their next
-- channel read (reopen, reconnect backfill, or the degraded poll). DELETE is
-- unaffected, because Realtime does not apply RLS to deletes.
--
-- Accepted for now rather than worked around. The archive is static history and
-- moderating it is rare, whereas the alternative -- letting imported rows back
-- through the carrier -- reinstates exactly the fan-out this exists to prevent.
-- Making moderation live would mean a different transport for it (a broadcast
-- ping on the channel topic, the shape 20260816140000 uses for notifications),
-- which is its own change.
drop policy if exists "chat_messages_select" on public.chat_messages;

do $$
declare
  v_role_clause text := '';
begin
  -- `to authenticated` only when the role exists: bare Postgres substrates
  -- (PGlite in CI) have no Supabase roles, and the policy still has to create.
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
        and kind <> 'imported'
      )
  $p$, v_role_clause);
end
$$;
