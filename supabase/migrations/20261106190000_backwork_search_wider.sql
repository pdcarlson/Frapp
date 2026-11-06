-- Backwork search covers department, professor and tags, and forgives typos
-- (#585; the backwork redesign, Paul's pick 2026-11-05).
--
-- WHAT CHANGES
--
-- `GET /v1/search`'s Backwork source matched `title` and `course_number` only,
-- through the generated `backwork_resources.search_vector`
-- (20260829002000_search_vectors_backwork_events_members.sql). The spec has
-- always listed "title, department, course, professor, tags", and the web Find
-- dialog now shows Backwork hits, so a member who types a professor's name or
-- a tag found nothing. This adds `search_backwork_resources`, which matches
-- all of them and, when no word matches exactly, falls back to trigram
-- similarity, so "homewrk" still finds "Homework".
--
-- WHY A FUNCTION AND NOT A WIDER GENERATED COLUMN
--
-- That migration's header says why the generated column stopped at two
-- columns: department and professor are foreign keys, and a STORED generated
-- column cannot join. The two ways round it were to denormalize the names
-- onto `backwork_resources` with triggers on both taxonomy tables (and their
-- rename and merge paths), or to join at query time. This joins at query time:
-- nothing to keep in sync, and a rename or merge is searchable the moment it
-- commits. The cost is that the document is built per row instead of read
-- from an index, but the scan is one chapter's library (the `chapter_id`
-- index narrows it first), which is hundreds of rows, not the platform. If a
-- chapter's library ever grows past what that serves, denormalizing is the
-- next step, and `search_vector` stays in place for it.
--
-- WHY pg_trgm NOW
--
-- The earlier migrations left pg_trgm out because nothing needed it and an
-- unregistered extension fails the PGlite job. Typo tolerance is the point
-- here, and `scripts/pglite/harness.mjs` now registers it. It goes in the
-- `extensions` schema, Supabase's home for extensions, so it adds nothing to
-- `public`; the function names it by schema and so needs no search_path.
-- No trigram index: the similarity runs on the same one-chapter scan.
--
-- RANKING
--
-- Word matches first, by `ts_rank_cd` over a weighted document (title A;
-- course and department B; professor and tags C), then typo matches by
-- similarity, then newest. A query that is only stopwords ("the") has no
-- tsquery and falls through to similarity alone.

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

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
            concat_ws(' ', r.course_number, d.code, d.code || r.course_number, d.name)
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
          p.name,
          array_to_string(r.tags, ' ')
        )
      ) as hay
    from public.backwork_resources r
    left join public.backwork_departments d
      on d.id = r.department_id and d.chapter_id = r.chapter_id
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
  )
  select r.*
  from matched m
  join public.backwork_resources r on r.id = m.id
  where m.exact or m.sim >= 0.6
  order by m.exact desc, m.rank desc, m.sim desc, m.created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

comment on function public.search_backwork_resources(uuid, text, integer) is
  'Backwork search for GET /v1/search: title, course, department, professor and tags, with trigram typo tolerance. One chapter only. See 20261106190000_backwork_search_wider.sql.';

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
