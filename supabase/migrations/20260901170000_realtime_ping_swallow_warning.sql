-- Make the ping-trigger swallow observable (#978).
--
-- 20260816140000_realtime_carrier_repair.sql wraps each `realtime.send` call
-- in `notifications` / `events` / `event_attendance`'s AFTER-statement
-- triggers with `exception when others then null`. That swallow is correct
-- and stays: an AFTER trigger fires inside the writing transaction, so an
-- unguarded send would turn a best-effort cache-invalidation hint into a hard
-- availability dependency of every event create, attendance check-in and
-- notification write (see the block comment above the trigger functions in
-- that migration for the full argument, including the daily-partition-lag
-- failure mode).
--
-- But nothing counted the swallow. If `realtime.send` starts failing in
-- production -- partition lag, a Realtime schema upgrade changing grants on
-- `realtime.messages`, permission drift on the definer -- the dashboard
-- silently stops updating live and every write still succeeds, with no log
-- line, no metric, no Sentry event. That silence is exactly what let the
-- carrier itself go unnoticed from the first deploy until 2026-08-16.
--
-- Fix: each handler now `raise warning`s with the table, the topic it was
-- sending to, and SQLERRM before swallowing, so a sustained failure shows up
-- in the Supabase log stream and can be alerted on. Worded "ping trigger
-- failed", not "realtime.send failed": the same handler also wraps the
-- `changed` transition-table scan that feeds the loop, so a future schema
-- change breaking that scan (not just a `realtime.send` failure) would
-- otherwise be mislabeled. `raise warning` inside an exception handler does
-- not affect the surrounding transaction -- the swallow's guarantee (writes
-- still succeed when the send fails) is unchanged.
--
-- Deliberately not rate-limited: these three tables are low-write (per the
-- original migration's own analysis), and per its implementation notes, "a
-- noisy log beats an invisible one" -- a rate limit is a follow-up if this
-- ever proves too chatty in practice, not a blocker here.
--
-- Known gap, not fixed here: the exception handler wraps the *entire* loop
-- over distinct scopes, not each iteration, so one statement that touches N
-- distinct scopes (e.g. a 50-member bulk notify) and fails for all of them
-- logs only ONE warning (whichever scope the loop reached first), not N --
-- the remaining N-1 are neither retried nor logged for that statement. This
-- is unchanged, pre-existing behavior of the original statement-level swallow
-- (kept deliberately, to avoid the per-row subtransaction-overflow cost that
-- 20260816140000's own design notes reject), not something introduced here.
-- A *sustained* failure still surfaces -- every subsequent triggering
-- statement logs its own warning independently -- so the log stream remains
-- a reliable signal of an ongoing outage; only a single bulk statement's
-- full blast radius is under-counted. Tracked as a follow-up rather than
-- widened into this fix: see #978's PR thread.
--
-- Bodies are otherwise byte-for-byte the applied definitions from
-- 20260827190000_secdef_search_path_pg_temp.sql (`create or replace`
-- preserves signature and return type, so dependent triggers keep resolving
-- -- no drop, no recreate, no dependency churn).
--
-- Rollback: re-run the prior definitions with a bare `null;` exception body.
-- See docs/internal/ops/DB_ROLLBACK_PLAYBOOK.md.

CREATE OR REPLACE FUNCTION public.realtime_notify_notifications()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    -- Deliberately swallowed: the client falls back to its normal refetch,
    -- and a stale drawer is strictly better than a failed write. Logged so
    -- the swallow is observable (#978). Labeled "ping trigger failed", not
    -- "realtime.send failed": this handler also wraps the `changed` scan
    -- above it, so a future schema change breaking that scan would be
    -- mislabeled as a send failure under the more specific wording.
    raise warning 'ping trigger failed for notifications (topic=notif:%): %',
      coalesce(v_scope::text, '?'), sqlerrm;
  end;
  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.realtime_notify_events()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    -- Deliberately swallowed, logged so the swallow is observable (#978).
    -- See realtime_notify_notifications() for why this says "ping trigger
    -- failed" rather than "realtime.send failed".
    raise warning 'ping trigger failed for events (topic=events:%): %',
      coalesce(v_scope::text, '?'), sqlerrm;
  end;
  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.realtime_notify_event_attendance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    -- Deliberately swallowed, logged so the swallow is observable (#978).
    -- See realtime_notify_notifications() for why this says "ping trigger
    -- failed" rather than "realtime.send failed".
    raise warning 'ping trigger failed for event_attendance (topic=attendance:%): %',
      coalesce(v_scope::text, '?'), sqlerrm;
  end;
  return null;
end;
$function$
;
