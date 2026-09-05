-- #522: the points leaderboard loaded every transaction in the chapter into the
-- API process and summed them in JavaScript, so work and memory grew with the
-- chapter's whole history on one of the most-visited officer surfaces. Move the
-- aggregation into Postgres: the API now receives one row per member instead of
-- one row per transaction.
--
-- Deliberately mirrors get_points_report's signature shape (chapter, then an
-- exclusive lower and inclusive upper timestamp bound) because the two answer
-- the same question over the same table for the same window, and the API
-- resolves both from the SAME helpers (points-window.ts / the semester-archive
-- lookup). The window enum is NOT re-derived here: 'month' and 'semester' mean
-- what resolveWindowSince says they mean, in one place, so the leaderboard and
-- the points report cannot drift apart on what "this semester" is.
--
-- Bound SEMANTICS match get_points_report and the in-Node filter this replaces:
-- created_at > p_since (exclusive) and created_at <= p_until (inclusive). A null
-- bound is "unbounded on that side" — which is how the all-time window, and a
-- 'semester' window on a chapter with no archive yet, both arrive here.
--
-- The VALUES the two callers pass are not identical, and saying otherwise would
-- be wrong: for the 'month' and 'semester' enum windows the leaderboard sends
-- p_until = now while ReportService.getPointsReport leaves it null, so a row
-- dated ahead of the API host's clock counts in the report and not on the board.
-- That asymmetry is pre-existing — the in-Node filterByWindow applied
-- `createdAt <= now` too — and is deliberately preserved here rather than
-- quietly changed under a performance fix. Tracked in #1694, which also carries
-- the shared bound-resolver that would make the drift unrepresentable.
--
-- Every column reference is qualified with the `pt.` alias: the RETURNS TABLE
-- OUT parameters are named `user_id` and `total`, so a bare `user_id` would be
-- ambiguous against the column of the same name, and a bare `total` in ORDER BY
-- would resolve to the OUT parameter rather than the aggregate.

-- No new index ships with this function. The two existing ones already serve
-- both shapes: idx_point_transactions_chapter_user for the unbounded 'all'
-- window, idx_point_transactions_chapter_created_at for a bounded one. On a
-- synthetic 420k rows across 20 chapters (40k in the chapter read) that is
-- single-digit milliseconds either way — two independent runs measured
-- all-time at 10.3ms and 11.5ms, and a 120-day window at 2.3ms and 1.45ms.
--
-- A covering `(chapter_id, created_at) include (user_id, amount)` index was
-- trialled and is deliberately NOT shipped: no run made the query faster with
-- it (one measured the bounded window at 2.8ms with it against 1.45ms
-- without), so it would buy write amplification on an append-only table for
-- nothing.
--
-- Treat the plan claims here as weaker than the timings. Whether the planner
-- picks a covering index at all turned out to be sensitive to how the
-- competing indexes were built and whether the heap had been vacuumed --
-- freshly bulk-loaded data in an open transaction and REINDEXed data gave
-- different answers. So: re-measure on production-like data before adding one,
-- and do not add it on the reasoning that a GROUP BY "should" have a covering
-- index -- but equally, do not take "the planner ignores it" from this comment
-- as settled.

create or replace function get_points_leaderboard(
  p_chapter_id uuid,
  p_since timestamptz default null,
  p_until timestamptz default null
)
returns table (
  user_id uuid,
  total bigint
)
language plpgsql
security invoker
as $$
begin
  return query
  select
    pt.user_id,
    sum(pt.amount)::bigint as total
  from point_transactions pt
  where pt.chapter_id = p_chapter_id
    and (p_since is null or pt.created_at > p_since)
    and (p_until is null or pt.created_at <= p_until)
  group by pt.user_id
  -- Ties broken by user_id so the board is deterministic across calls. The
  -- in-Node version this replaces resolved ties by whichever member's newest
  -- in-window transaction came first out of `created_at desc`, which is
  -- incidental rather than specified: spec/behavior/points.md fixes rank as
  -- board-wide but says nothing about equal totals.
  order by sum(pt.amount) desc, pt.user_id asc;
end;
$$;

-- Postgres grants EXECUTE on a new function to PUBLIC by default, and Supabase's
-- default privileges additionally grant it to anon/authenticated — the drift
-- 20260901173000 closed for the existing read RPCs. Lock this one down at birth
-- rather than shipping it broadly callable and fixing it later: the API is the
-- only intended caller and connects as service_role.
revoke execute on function get_points_leaderboard(uuid, timestamptz, timestamptz) from public;

-- anon/authenticated/service_role are Supabase-managed roles and do not exist in
-- a bare Postgres (the PGlite migration gate), so each grant is guarded.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function get_points_leaderboard(uuid, timestamptz, timestamptz) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function get_points_leaderboard(uuid, timestamptz, timestamptz) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function get_points_leaderboard(uuid, timestamptz, timestamptz) to service_role;
  end if;
end
$$;
