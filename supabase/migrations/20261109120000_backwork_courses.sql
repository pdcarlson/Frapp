-- Backwork courses: the name people call a course, and its nicknames (#3848).
--
-- WHAT CHANGES
--
-- A backwork file stores a department (`backwork_departments.code`, with an
-- optional full name) and a free-text `course_number`. Nothing stored what the
-- course itself is called, so "Calc 1" or "Orgo" found nothing a member had
-- not typed into a title. `backwork_courses` is a per-chapter dictionary: one
-- row per (chapter, department, course number), with an optional display
-- `name` ("Calculus I") and any number of `nicknames` ("Calc 1", "Orgo").
--
-- A course is not a parent of its files. Files keep `department_id` +
-- `course_number` exactly as before, and a file joins its course by those two
-- values, the number compared trimmed and case-insensitively (`course_key`).
-- A course row exists only once someone names it; files never need one.
--
-- `department_id` cascades: deleting a department (which the API refuses while
-- any file is filed under it) deletes its course names with it. The department
-- merge moves them to the target first (BackworkService.mergeDepartments).
--
-- RLS on with no policies, the same posture as `backwork_departments`: the API
-- reads and writes with the service role and enforces who may edit.
--
-- `search_backwork_resources` (GET /v1/search's Backwork source) is replaced
-- to match the course name and nicknames too, at weight B with the course.
-- Everything else it does is unchanged from 20261106190000.

create table if not exists public.backwork_courses (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  department_id uuid not null references public.backwork_departments(id) on delete cascade,
  course_number text not null,
  course_key text generated always as (lower(btrim(course_number))) stored,
  name text,
  nicknames text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint backwork_courses_course_number_len
    check (char_length(btrim(course_number)) between 1 and 20),
  constraint backwork_courses_name_len
    check (name is null or char_length(name) between 1 and 255),
  -- At most 20 nicknames, each at most 60 characters (61 * 20 counts the
  -- separators). The API's DTO holds the per-item limit exactly.
  constraint backwork_courses_nicknames_cap
    check (
      cardinality(nicknames) <= 20
      and char_length(array_to_string(nicknames, ' ')) <= 61 * 20
    ),
  constraint backwork_courses_unique_course
    unique (chapter_id, department_id, course_key)
);

create index if not exists idx_backwork_courses_chapter
  on public.backwork_courses (chapter_id);
create index if not exists idx_backwork_courses_department
  on public.backwork_courses (department_id);

alter table public.backwork_courses enable row level security;

comment on table public.backwork_courses is
  'Per-chapter Backwork course names and nicknames, keyed by department and trimmed lowercase course number. Files join by (department_id, course_key). See 20261109120000_backwork_courses.sql.';

create or replace function public.search_backwork_resources(
  p_chapter_id uuid,
  p_query text,
  p_limit integer default 20
)
returns setof public.backwork_resources
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with q as (
    select
      websearch_to_tsquery('english', coalesce(p_query, '')) as ts,
      lower(btrim(coalesce(p_query, ''))) as raw
  ),
  scored as (
    select
      r.id,
      r.created_at,
      (
        setweight(to_tsvector('english', coalesce(r.title, '')), 'A')
        || setweight(
          to_tsvector(
            'english',
            concat_ws(
              ' ',
              r.course_number,
              d.code,
              d.code || r.course_number,
              d.name,
              c.name,
              array_to_string(c.nicknames, ' ')
            )
          ),
          'B'
        )
        || setweight(
          to_tsvector(
            'english',
            concat_ws(' ', p.name, array_to_string(r.tags, ' '))
          ),
          'C'
        )
      ) as doc,
      lower(
        concat_ws(
          ' ',
          r.title,
          d.code,
          r.course_number,
          d.name,
          c.name,
          array_to_string(c.nicknames, ' '),
          p.name,
          array_to_string(r.tags, ' ')
        )
      ) as hay
    from public.backwork_resources r
    left join public.backwork_departments d
      on d.id = r.department_id and d.chapter_id = r.chapter_id
    left join public.backwork_courses c
      on c.chapter_id = r.chapter_id
     and c.department_id = r.department_id
     and c.course_key = lower(btrim(r.course_number))
    left join public.backwork_professors p
      on p.id = r.professor_id and p.chapter_id = r.chapter_id
    where r.chapter_id = p_chapter_id
  ),
  matched as (
    select
      s.id,
      s.created_at,
      s.doc @@ q.ts as exact,
      ts_rank_cd(s.doc, q.ts) as rank,
      extensions.word_similarity(q.raw, s.hay) as sim
    from scored s, q
    where q.raw <> ''
      and not (numnode(q.ts) > 0 and querytree(q.ts) = 'T')
  )
  select r.*
  from matched m
  join public.backwork_resources r on r.id = m.id
  where m.exact or m.sim >= 0.6
  order by m.exact desc, m.rank desc, m.sim desc, m.created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

comment on function public.search_backwork_resources(uuid, text, integer) is
  'Backwork search for GET /v1/search: title, course (number, department, course name and nicknames), professor and tags, with trigram typo tolerance. One chapter only. See 20261106190000_backwork_search_wider.sql and 20261109120000_backwork_courses.sql.';

-- `create or replace` keeps the grants 20261106190000 set; restated so this
-- file alone says who may call it.
revoke execute on function public.search_backwork_resources(uuid, text, integer) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.search_backwork_resources(uuid, text, integer) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.search_backwork_resources(uuid, text, integer) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.search_backwork_resources(uuid, text, integer) to service_role;
  end if;
end
$$;
