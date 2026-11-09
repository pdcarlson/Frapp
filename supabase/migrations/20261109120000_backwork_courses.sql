-- Backwork courses: the name people call a course, and its nicknames (#3848).
--
-- WHAT CHANGES
--
-- A backwork file stores a department (`backwork_departments.code`, with an
-- optional full name) and a free-text `course_number`. Nothing stored what the
-- course itself is called, so "Calc 1" or "Orgo" found nothing a member had
-- not typed into a title. `backwork_courses` is a per-chapter dictionary: one
-- row per (chapter, department, course number), with an optional display
-- `name` ("Calculus I") and up to 20 `nicknames` ("Calc 1", "Orgo"), each at
-- most 60 characters.
--
-- A course is not a parent of its files. Files keep `department_id` +
-- `course_number` exactly as before, and a file joins its course by those two
-- values, the number compared trimmed and case-insensitively (`course_key`).
-- A course row exists only once someone names it; files never need one.
--
-- `department_id` cascades: deleting a department (which the API refuses while
-- any file is filed under it) deletes its course names with it. The department
-- merge folds each into the target first, through `backwork_course_write`
-- (BackworkService.mergeDepartments).
--
-- RLS on with no policies, the same posture as `backwork_departments`: the API
-- reads and writes with the service role and enforces who may edit.
--
-- `search_backwork_resources` (GET /v1/search's Backwork source) is replaced
-- to match the course name and nicknames too, at weight B with the course.
-- Everything else it does is unchanged from 20261106190000.

-- The nickname limits, per element: a CHECK can't hold a subquery, but it can
-- call an immutable function that does. Mirrors MAX_COURSE_NICKNAMES and
-- MAX_COURSE_NICKNAME_LENGTH in @repo/validation (backwork-courses.ts).
create or replace function public.backwork_course_nicknames_ok(p_nicknames text[])
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select cardinality(p_nicknames) <= 20
     and not exists (
       select 1 from unnest(p_nicknames) as n
        where n is null or char_length(n) not between 1 and 60
     );
$$;

comment on function public.backwork_course_nicknames_ok(text[]) is
  'CHECK helper for backwork_courses.nicknames: at most 20, each 1 to 60 characters. See 20261109120000_backwork_courses.sql.';

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
  constraint backwork_courses_nicknames_cap
    check (public.backwork_course_nicknames_ok(nicknames)),
  constraint backwork_courses_unique_course
    unique (chapter_id, department_id, course_key)
);

-- No separate chapter_id index: the unique constraint's index leads with it.
create index if not exists idx_backwork_courses_department
  on public.backwork_courses (department_id);

alter table public.backwork_courses enable row level security;

comment on table public.backwork_courses is
  'Per-chapter Backwork course names and nicknames, keyed by department and trimmed lowercase course number. Files join by (department_id, course_key). See 20261109120000_backwork_courses.sql.';

-- ── Course writes, one statement each ─────────────────────────────────────
--
-- Every write to a course's name and nicknames goes through
-- `backwork_course_write`, an insert-or-update in one statement, so two
-- members saving at once can't lose each other's nicknames (each applies its
-- change to the row as it is when the statement runs) and two first writes
-- can't race on the unique key (the second updates the row the first made).
-- A department merge folds each source course into the target the same way.
--
--   nicknames  stored, minus `p_remove`, plus `p_add`, de-duplicated, stored
--              order then added order, minus any that repeat the resulting
--              name. Comparisons ignore case and collapse whitespace, as the
--              API's `normalizeCourseNicknames` does.
--   name       untouched unless `p_set_name`; then `p_name` when
--              `p_may_rename` (an admin), otherwise the stored name if there
--              is one, so a member or an upload only ever fills an empty name.
--   p_clamp    for a department merge, which must never fail on the table's
--              limits: drops any nickname over 60 characters and keeps the
--              first 20 (the target's own before the source's). Without it, a
--              list past the limits fails the CHECK, which the API answers
--              as a 400 after checking the same limits first.
--
-- Who may do what is decided in the API (`courseEditRefusal`); the API passes
-- `p_may_rename` and refuses a non-admin's removal before calling. The
-- department must belong to `p_chapter_id`, or nothing is written and the
-- function returns null.

create or replace function public.backwork_course_merge_nicknames(
  p_stored text[],
  p_add text[],
  p_remove text[],
  p_name text,
  p_clamp boolean
)
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $$
  with norm as (
    select regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g') as name_key
  ),
  combined as (
    select s.n, s.ord
      from unnest(coalesce(p_stored, '{}')) with ordinality as s(n, ord)
     where not exists (
       select 1 from unnest(coalesce(p_remove, '{}')) as r(n)
        where lower(regexp_replace(btrim(r.n), '\s+', ' ', 'g'))
            = lower(regexp_replace(btrim(s.n), '\s+', ' ', 'g'))
     )
    union all
    select a.n, 100000 + a.ord
      from unnest(coalesce(p_add, '{}')) with ordinality as a(n, ord)
  ),
  kept as (
    select distinct on (lower(regexp_replace(btrim(c.n), '\s+', ' ', 'g'))) c.n, c.ord
      from combined c, norm
     where btrim(c.n) <> ''
       and lower(regexp_replace(btrim(c.n), '\s+', ' ', 'g')) <> lower(norm.name_key)
       and (not p_clamp or char_length(c.n) <= 60)
     order by lower(regexp_replace(btrim(c.n), '\s+', ' ', 'g')), c.ord
  )
  select coalesce(
    (
      select array_agg(k.n order by k.ord)
        from (
          select n, ord from kept order by ord
           limit case when p_clamp then 20 end
        ) k
    ),
    '{}'
  );
$$;

comment on function public.backwork_course_merge_nicknames(text[], text[], text[], text, boolean) is
  'Nickname arithmetic for backwork_course_write: stored minus remove, plus add, case- and whitespace-insensitive, de-duplicated, without the name; clamped to the table limits when asked. See 20261109120000_backwork_courses.sql.';

create or replace function public.backwork_course_write(
  p_chapter_id uuid,
  p_department_id uuid,
  p_course_number text,
  p_set_name boolean,
  p_name text,
  p_may_rename boolean,
  p_add text[],
  p_remove text[],
  p_clamp boolean default false
)
returns public.backwork_courses
language sql
volatile
security invoker
set search_path = public, pg_temp
as $$
  insert into public.backwork_courses as c
    (chapter_id, department_id, course_number, name, nicknames)
  select
    p_chapter_id,
    d.id,
    btrim(p_course_number),
    case when p_set_name then p_name end,
    public.backwork_course_merge_nicknames(
      '{}', p_add, '{}', case when p_set_name then p_name end, p_clamp
    )
  from public.backwork_departments d
  where d.id = p_department_id and d.chapter_id = p_chapter_id
  on conflict on constraint backwork_courses_unique_course do update set
    name = case
      when not p_set_name then c.name
      when p_may_rename then p_name
      else coalesce(c.name, p_name)
    end,
    nicknames = public.backwork_course_merge_nicknames(
      c.nicknames,
      p_add,
      p_remove,
      case
        when not p_set_name then c.name
        when p_may_rename then p_name
        else coalesce(c.name, p_name)
      end,
      p_clamp
    ),
    updated_at = now()
  returning c.*;
$$;

comment on function public.backwork_course_write(uuid, uuid, text, boolean, text, boolean, text[], text[], boolean) is
  'One-statement insert-or-update of a Backwork course name and nicknames (PUT /v1/backwork/courses, upload naming and department merge, the last two fill-only). See 20261109120000_backwork_courses.sql.';

revoke execute on function public.backwork_course_write(uuid, uuid, text, boolean, text, boolean, text[], text[], boolean) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.backwork_course_write(uuid, uuid, text, boolean, text, boolean, text[], text[], boolean) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.backwork_course_write(uuid, uuid, text, boolean, text, boolean, text[], text[], boolean) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.backwork_course_write(uuid, uuid, text, boolean, text, boolean, text[], text[], boolean) to service_role;
  end if;
end
$$;

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
