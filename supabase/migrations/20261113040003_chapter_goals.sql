-- Chapter goals (#1062): what a chapter holds its members to, so Activity's
-- "This semester" block can draw a bar toward each.
--
-- One row per chapter and measure. `metric` is what is counted: `points`
-- (points this semester), `service` (approved service minutes this semester)
-- or `study` (study minutes this week, the Study screen's week). `goals`
-- holds the targets for that measure:
--
--   { "everyone": 2400 | null,
--     "roles": [ { "role_id": "<uuid>", "target": 3600 }, ... ] }
--
-- `everyone` is every member's goal; a role entry sets a different goal for
-- members who hold that role. A member who holds several roles with a goal
-- is held to the one on their highest-ranked role (lowest `roles.display_order`).
-- Targets are points for `points` and minutes for the other two. The API
-- validates the shape and bounds; the check here only keeps it an object.
--
-- Role ids live in jsonb, so deleting a role leaves its id behind. The API
-- drops ids that no longer name a role in the chapter when it reads them, and
-- the next save writes the list without them.
--
-- Written and read only by the API on the service-role path: row level
-- security is on and no policy grants a client anything.
--
-- Rollback: `drop table if exists public.chapter_goals;` (the API from before
-- this migration never reads it).

create table if not exists public.chapter_goals (
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  metric text not null check (metric in ('points', 'service', 'study')),
  goals jsonb not null default '{"everyone": null, "roles": []}'::jsonb
    check (jsonb_typeof(goals) = 'object'),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null,
  primary key (chapter_id, metric)
);

alter table public.chapter_goals enable row level security;

comment on table public.chapter_goals is
  'Goals a chapter sets for points, service hours and study hours (#1062): one row per chapter and metric. API only. See 20261113040003_chapter_goals.sql.';
