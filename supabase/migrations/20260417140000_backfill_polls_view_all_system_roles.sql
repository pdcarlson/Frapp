-- Backfill polls:view_all for dashboard poll list access:
-- 1) Ensure Treasurer system roles include polls:view_all (existing chapters are not re-seeded from code).
-- 2) Add Vice President + Secretary system roles (same as new chapter seeds: members:view + polls:view_all;
--    both are required on insert — PollController / PointsController need members:view at class level) and bump later system role display_order.

-- Shift display_order for system roles that sit at or after the slot where VP/Secretary are inserted (3–4).
with chapters_needing_vp as (
  select c.id as chapter_id
  from public.chapters c
  where not exists (
    select 1
    from public.roles r
    where r.chapter_id = c.id
      and r.name = 'Vice President'
  )
)
update public.roles r
set display_order = r.display_order + 2
from chapters_needing_vp n
where r.chapter_id = n.chapter_id
  and r.is_system = true
  and r.display_order >= 3;

-- Treasurer: append polls:view_all when missing (skip wildcard presidents mis-tagged as Treasurer, if any).
update public.roles
set permissions = permissions || array['polls:view_all']::text[]
where is_system = true
  and name = 'Treasurer'
  and not ('polls:view_all' = any (permissions))
  and not ('*' = any (permissions));

insert into public.roles (chapter_id, name, permissions, is_system, display_order, color)
select c.id, 'Vice President', array['members:view', 'polls:view_all']::text[], true, 3, null
from public.chapters c
where not exists (
  select 1 from public.roles r where r.chapter_id = c.id and r.name = 'Vice President'
)
on conflict (chapter_id, name) do nothing;

insert into public.roles (chapter_id, name, permissions, is_system, display_order, color)
select c.id, 'Secretary', array['members:view', 'polls:view_all']::text[], true, 4, null
from public.chapters c
where not exists (
  select 1 from public.roles r where r.chapter_id = c.id and r.name = 'Secretary'
)
on conflict (chapter_id, name) do nothing;
