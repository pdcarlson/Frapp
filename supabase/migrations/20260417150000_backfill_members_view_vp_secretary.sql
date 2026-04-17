-- Vice President / Secretary system roles need members:view alongside polls:view_all:
-- PollController (and PointsController) require members:view at class level; without it,
-- PermissionsGuard rejects every request even when route-level polls:view_all is present.

update public.roles
set permissions = permissions || array['members:view']::text[]
where is_system = true
  and name in ('Vice President', 'Secretary')
  and not ('members:view' = any (permissions));
