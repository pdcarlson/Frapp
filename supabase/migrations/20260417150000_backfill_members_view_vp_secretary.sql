-- Idempotent repair: VP / Secretary rows created by an older revision of
-- 20260417140000_backfill_polls_view_all_system_roles.sql had only polls:view_all.
-- New installs get members:view on insert there; this migration is a no-op then.
-- PollController / PointsController require members:view at class level.

update public.roles
set permissions = permissions || array['members:view']::text[]
where is_system = true
  and name in ('Vice President', 'Secretary')
  and not ('members:view' = any (permissions));
