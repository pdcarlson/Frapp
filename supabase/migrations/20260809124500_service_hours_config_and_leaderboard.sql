-- Service hours: chapter-configurable points rate, admin queue filters, and a
-- chapter-wide leaderboard (#273 — spec/behavior/service-hours.md, the
-- "Approval Workflow" and "Visibility" sections).
--
-- Three additive pieces; no column is dropped, renamed, or backfilled:
--   1. chapter_service_config          — the per-chapter minutes→point rate
--   2. idx_service_entries_chapter_... — backs the admin filters + leaderboard
--   3. get_service_leaderboard         — SQL-side aggregation of approved time

-- ── chapter_service_config ───────────────────────────────────────────────────
-- One row per chapter (PK = chapter_id), mirroring chapter_dues_config
-- (20260523120000). RLS is enabled with no policies: like every other chapter
-- config table, this is reached only through the API's service-role client.
--
-- The default of 60 is exactly the rate ServiceEntryService hardcoded before
-- this migration (DEFAULT_MINUTES_PER_POINT), so every existing chapter keeps
-- its current behavior and no backfill is needed — an absent row IS the
-- default, which is why nothing provisions rows here at onboarding.

create table if not exists chapter_service_config (
  chapter_id        uuid         primary key references chapters(id) on delete cascade,
  minutes_per_point int          not null default 60 check (minutes_per_point >= 1),
  created_at        timestamptz  not null default now(),
  updated_at        timestamptz  not null default now()
);

alter table chapter_service_config enable row level security;

drop trigger if exists trg_chapter_service_config_updated_at on chapter_service_config;
create trigger trg_chapter_service_config_updated_at
  before update on chapter_service_config
  for each row execute function update_updated_at();

-- ── admin queue + leaderboard index ──────────────────────────────────────────
-- The admin list filters on (chapter_id, status, date range) and the
-- leaderboard aggregates over the same three columns, so one composite index
-- serves both. idx_service_entries_chapter (chapter_id) is a strict prefix of
-- this one and is deliberately left in place: dropping an index is a
-- destructive change this issue does not call for, and it still backs the
-- unfiltered chapter listing.

create index if not exists idx_service_entries_chapter_status_date
  on service_entries (chapter_id, status, date desc);

-- ── get_service_leaderboard ──────────────────────────────────────────────────
-- Ranked approved service time per member. The aggregation runs in Postgres
-- rather than pulling every chapter row into Node — the pattern the points
-- leaderboard still uses and that #522 tracks fixing there.
--
-- `security invoker` matches the other read RPCs (get_points_report): the API
-- always calls this through the service-role client, and invoker keeps RLS
-- meaningful for any future authenticated caller.
--
-- Only APPROVED entries count, per the spec's "total approved hours" — PENDING
-- and REJECTED time is never ranked. Date bounds are inclusive on both ends
-- and compare against `date` (the day the service happened), not created_at,
-- so a range means what an officer reading the queue expects it to mean.

create or replace function get_service_leaderboard(
  p_chapter_id uuid,
  p_start_date date default null,
  p_end_date date default null
)
returns table (
  user_id uuid,
  member_name text,
  total_minutes bigint,
  entry_count bigint
)
language plpgsql
security invoker
as $$
begin
  return query
  select
    se.user_id,
    u.display_name as member_name,
    sum(se.duration_minutes)::bigint as total_minutes,
    count(*)::bigint as entry_count
  from service_entries se
  join users u on u.id = se.user_id
  where se.chapter_id = p_chapter_id
    and se.status = 'APPROVED'
    and (p_start_date is null or se.date >= p_start_date)
    and (p_end_date is null or se.date <= p_end_date)
  group by se.user_id, u.display_name
  order by total_minutes desc, u.display_name asc;
end;
$$;

-- Postgres grants EXECUTE on a new function to PUBLIC by default, and Supabase's
-- default privileges additionally grant it straight to anon/authenticated — which
-- is how the existing read RPCs ended up broadly callable (#678). Under
-- `security invoker` those callers hit RLS and get zero rows rather than a leak,
-- but there is no reason to ship a new function with the same default: the API is
-- the only intended caller, and it connects as service_role. All three are
-- revoked, not just PUBLIC. Mirrors approve_service_entry (20260603120000).
revoke execute on function get_service_leaderboard(uuid, date, date) from public;

-- anon/authenticated/service_role are Supabase-managed roles, absent in bare
-- Postgres substrates (e.g. PGlite in CI), so guard each on role existence to
-- keep the migration portable.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function get_service_leaderboard(uuid, date, date) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function get_service_leaderboard(uuid, date, date) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function get_service_leaderboard(uuid, date, date) to service_role;
  end if;
end
$$;
