-- #678: get_points_report, get_poll_vote_option_totals, and
-- get_poll_user_votes_for_messages were left on Postgres's EXECUTE-to-PUBLIC
-- default instead of following the repo's own lockdown convention (nine
-- other RPCs already do the revoke-from-public/anon/authenticated,
-- grant-to-service_role pair — see e.g. 20260602210000). All three are
-- `security invoker`, so anon gains no data RLS would not already block
-- (no privilege escalation) — this closes the convention gap so the next
-- RPC someone changes to `security definer` for performance doesn't
-- inherit a PUBLIC grant already in place. Both callers
-- (report.service.ts, supabase-poll-vote.repository.ts) go through the
-- API's service_role client, never anon/authenticated directly.
revoke execute on function get_points_report(uuid, uuid, timestamptz) from public;
revoke execute on function get_poll_vote_option_totals(uuid[]) from public;
revoke execute on function get_poll_user_votes_for_messages(uuid[], uuid) from public;

-- anon/authenticated/service_role are Supabase-managed roles, absent in bare
-- Postgres substrates (e.g. PGlite in CI), so guard each on role existence to
-- keep the migration portable.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function get_points_report(uuid, uuid, timestamptz) from anon;
    revoke execute on function get_poll_vote_option_totals(uuid[]) from anon;
    revoke execute on function get_poll_user_votes_for_messages(uuid[], uuid) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function get_points_report(uuid, uuid, timestamptz) from authenticated;
    revoke execute on function get_poll_vote_option_totals(uuid[]) from authenticated;
    revoke execute on function get_poll_user_votes_for_messages(uuid[], uuid) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function get_points_report(uuid, uuid, timestamptz) to service_role;
    grant execute on function get_poll_vote_option_totals(uuid[]) to service_role;
    grant execute on function get_poll_user_votes_for_messages(uuid[], uuid) to service_role;
  end if;
end
$$;
