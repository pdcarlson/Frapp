-- Backwork drafts (#5208, phase 2 of #3487).
--
-- Bulk upload saves each document as a draft once its file is redacted and
-- stored, whether or not its fields are filled in. The uploader then fixes the
-- batch in one table and publishes it.
--
-- A draft is a `backwork_resources` row whose `draft_fields` is not null. The
-- file columns (`storage_path`, `file_hash`, `is_redacted`, `uploader_id`) are
-- real from the start, so the duplicate check and storage cleanup work as for
-- any row. The metadata stays in `draft_fields` (the confirm body's shape:
-- title, department_code, course_number, course_name, professor_name, year,
-- semester, assignment_type, assignment_number, document_variant, tags) until
-- publish, so a half-typed department or professor never creates a taxonomy
-- row other members see. Publishing resolves those names exactly as a confirm
-- does, writes the columns, and sets `draft_fields` to null.
--
-- A draft is visible only to its uploader. Every read path but the uploader's
-- own drafts list filters `draft_fields is null`: the API's list, zip links,
-- single-file read, Activity, and the search function below.

alter table public.backwork_resources
  add column if not exists draft_fields jsonb;

alter table public.backwork_resources
  drop constraint if exists backwork_resources_draft_fields_object;
alter table public.backwork_resources
  add constraint backwork_resources_draft_fields_object
  check (draft_fields is null or jsonb_typeof(draft_fields) = 'object');

comment on column public.backwork_resources.draft_fields is
  'Not null while the row is a draft (#5208): the unpublished metadata, in the confirm body''s shape. Drafts are visible only to their uploader. See 20261116182814_backwork_drafts.sql.';

-- The uploader's drafts list. Partial, so published rows cost it nothing.
create index if not exists idx_backwork_resources_drafts
  on public.backwork_resources (chapter_id, uploader_id, created_at)
  where draft_fields is not null;

-- `search_backwork_resources` leaves drafts out. Otherwise unchanged from
-- 20261109230000_backwork_courses.sql.
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
      and r.draft_fields is null
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
  'Backwork search for GET /v1/search: title, course (number, department, course name and nicknames), professor and tags, with trigram typo tolerance. One chapter only. Drafts are never returned. See 20261106190000_backwork_search_wider.sql, 20261109230000_backwork_courses.sql and 20261116182814_backwork_drafts.sql.';

-- `create or replace` keeps the grants 20261106190000 set.
