-- #830: clear the Supabase security advisor's function WARNs, and keep them
-- cleared.
--
-- Measured on staging and prod on 2026-11-07, identical on both:
--
--   * lint 0028 (`anon_security_definer_function_executable`) x 3 and lint 0029
--     (`authenticated_security_definer_function_executable`) on the same three:
--     `realtime_notify_notifications`, `realtime_notify_events` and
--     `realtime_notify_event_attendance`. 20260816140000 created them after its
--     own hardening block, which revoked `anon` from a hand-written array that
--     did not name them, so they kept Supabase's default grants and are callable
--     through `/rest/v1/rpc/` with the publishable key. A direct call errors
--     inside the body today (it reads the trigger's transition table) and the
--     error is swallowed, so nothing leaks; but `realtime.send` is in reach, and
--     a swallowed exception is not a grant.
--   * lint 0011 (`function_search_path_mutable`) x 20: every `public` function
--     that does not pin `search_path`, all of them SECURITY INVOKER.
--
-- Both halves are catalog sweeps rather than lists, for the reason this issue
-- exists: the list in 20260816140000 went stale inside its own file, and six
-- of the twenty unpinned functions were written after the issue first counted
-- fourteen. What keeps the next function from repeating either mistake is the
-- PGlite tier `security-definer-search-path.mjs`, which reads the applied
-- catalog and fails CI; this file only brings the existing functions into line.

-- ---------------------------------------------------------------------------
-- 1. Trigger functions are not RPCs.
--
-- A trigger fires with no EXECUTE check on its function (Postgres checks the
-- privilege once, at CREATE TRIGGER), so a trigger function needs no grant for
-- any role, and keeping one only publishes it at `/rest/v1/rpc/<name>`. Every
-- SECURITY DEFINER trigger function in `public` loses EXECUTE for PUBLIC,
-- `anon` and `authenticated`. `service_role` keeps it: it bypasses RLS anyway,
-- and the advisor does not flag it.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as fn
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
       and p.prorettype = 'trigger'::regtype
       and not exists (
         select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e'
       )
  loop
    execute format('revoke all on function %s from public', r.fn);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', r.fn);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on function %s from authenticated', r.fn);
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. No SECURITY DEFINER function in `public` is callable without signing in.
--
-- The three above were the only ones left; this also covers any function the
-- sweep in 1 does not (a definer RPC that is not a trigger). Revoking PUBLIC
-- alone is not enough on Supabase: its default privileges grant `anon`
-- directly, which is the mistake 20260816140000's own comment describes.
do $$
declare
  r record;
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    return;
  end if;
  for r in
    select p.oid::regprocedure as fn
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
       and not exists (
         select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e'
       )
  loop
    execute format('revoke all on function %s from public', r.fn);
    execute format('revoke all on function %s from anon', r.fn);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Every function in `public` pins `search_path`.
--
-- `public, pg_temp`, the setting every definer function here already carries:
-- `public` is what these bodies resolved against before (the roles' default
-- path is `"$user", public, extensions` and no `"$user"` schema exists), and
-- `pg_temp` LAST stops a caller's temp table from shadowing a real one. None of
-- the twenty bodies names anything in `extensions` (checked against the
-- catalog), so dropping it from their path changes no lookup. Functions an
-- extension owns are left to the extension.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as fn
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind in ('f', 'p')
       and not exists (
         select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e'
       )
       and not exists (
         select 1 from unnest(coalesce(p.proconfig, '{}')) as cfg
          where cfg like 'search_path=%'
       )
  loop
    execute format('alter routine %s set search_path = public, pg_temp', r.fn);
  end loop;
end
$$;
