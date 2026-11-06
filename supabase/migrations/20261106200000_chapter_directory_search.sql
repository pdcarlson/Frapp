-- Chapter directory search: school aliases, as-you-type prefixes and typo
-- tolerance (Paul, 2026-11-06, from the iOS "Find your chapter" step).
--
-- WHAT WAS WRONG
--
-- `GET /chapter-directory/search` ran `websearch_to_tsquery` against the
-- generated `search_vector` (20260523140000_chapter_directory.sql). That
-- matched whole stemmed words only, so:
--   * "Rensselaer" found nothing: the row stored only "RPI".
--   * a half-typed word ("phi gamma del") found nothing until the last word was
--     complete, which is most of the time in an autocomplete box.
--   * a typo ("renselaer") found nothing.
--
-- WHAT CHANGES
--
-- 1. `aliases text[]`: the other names a search should find a row by (the
--    school's short name and nicknames, the organization's: "RPI", "FIJI").
--    Matched, never shown. The directory seed carries them
--    (supabase/seed/chapter_directory.csv, `aliases` column).
-- 2. `search_text`: one normalized, lowercased, space-led string of every
--    searchable field, replacing `search_vector`. Generated, so it can't drift
--    from the row.
-- 3. `search_chapter_directory(query, university, limit)`: every word of the
--    query must start a word in the row ("phi gam rens" finds Tau Nu at
--    Rensselaer), and a word of four or more letters that starts nothing may
--    instead be a close spelling of one (trigram word similarity >= 0.5)
--    when it starts no word anywhere in the directory.
--
-- RANKING
--
-- Rows where every word matched as typed come before rows that needed a typo
-- match. Within those, rows rank by how much of organization (counted
-- double), chapter and school the query names outright (a whole name as a
-- phrase of the query, or the query starting it; a school by any alias too):
-- "fiji tau nu" names two for Tau Nu, "alpha phi alpha howard" puts Alpha Phi
-- Alpha's Beta above Sigma Gamma Rho's Alpha Phi chapter there, and "phi gamma
-- delta" puts Phi Gamma Delta above Phi Delta Theta's New York Gamma. Then closeness, then organization, school and
-- chapter name, so a page of results reads in order.
--
-- WHY AN IMMUTABLE WRAPPER
--
-- A STORED generated column may call only immutable functions, and
-- `array_to_string` is marked stable (its element output could in principle
-- depend on settings). For `text[]` it doesn't, so the wrapper below is
-- declared immutable; the same construction is common in Supabase projects.
--
-- NO INDEX
--
-- The function reads every row: the table is reference data of about 13,000
-- chapters, the prefix checks are `strpos` calls, and the trigram similarity
-- runs only for a word that starts nothing in the row. That is tens of
-- milliseconds on a debounced onboarding search. A trigram GIN index can't
-- serve "every word starts some word, or nearly does", so it would be write
-- cost for no read. If the table grows by an order of magnitude, prefilter on
-- the query's longest word with `%>` and add the index then.
--
-- LOCKS
--
-- The table is reference data the onboarding wizard reads, with no writer but
-- the seed loader. The rewrite for the generated column takes ACCESS
-- EXCLUSIVE on it for well under a second at its size.

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

alter table public.chapter_directory
  add column if not exists aliases text[] not null default '{}';

create or replace function public.chapter_directory_search_text(
  p_org_name text,
  p_org_letters text,
  p_designation text,
  p_university text,
  p_university_short text,
  p_aliases text[]
)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog, pg_temp
as $$
  select ' ' || btrim(
    regexp_replace(
      lower(
        concat_ws(
          ' ',
          p_org_name,
          p_org_letters,
          p_designation,
          p_university,
          p_university_short,
          array_to_string(p_aliases, ' ')
        )
      ),
      '[^a-z0-9&Ͱ-Ͽ]+',
      ' ',
      'g'
    )
  ) || ' '
$$;

comment on function public.chapter_directory_search_text(text, text, text, text, text, text[]) is
  'The normalized, space-led text search_chapter_directory matches against. Generates chapter_directory.search_text. See 20261106200000_chapter_directory_search.sql.';

alter table public.chapter_directory
  add column if not exists search_text text
  generated always as (
    public.chapter_directory_search_text(
      org_name,
      org_letters,
      chapter_designation,
      university,
      university_short,
      aliases
    )
  ) stored;

-- The cutover deletes what it replaces: nothing reads the tsvector once the
-- repository calls the function below.
drop index if exists public.idx_chapter_directory_search;
alter table public.chapter_directory drop column if exists search_vector;

create or replace function public.search_chapter_directory(
  p_query text,
  p_university text default null,
  p_limit integer default 20
)
returns setof public.chapter_directory
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with q as (
    -- Normalized as search_text is: lowercase, anything but letters, digits,
    -- "&" and Greek (Ͱ-Ͽ, U+0370 to U+03FF) is a space.
    select btrim(
      regexp_replace(lower(coalesce(p_query, '')), '[^a-z0-9&Ͱ-Ͽ]+', ' ', 'g')
    ) as norm
  ),
  words as (
    select t.word,
      -- A word that starts a word somewhere in the directory is taken as
      -- typed; only a word that starts nothing anywhere is tried as a typo.
      -- That keeps "kappa" from matching "kappla", and keeps the trigram
      -- work off the common case (every word typed right).
      exists (
        select 1 from public.chapter_directory x where strpos(x.search_text, ' ' || t.word) > 0
      ) as found
    from q, unnest(array_remove(string_to_array(q.norm, ' '), '')) as t(word)
  ),
  phrase as (
    -- The parts of a row a query can name outright, normalized like the query.
    select
      d.id,
      public.chapter_directory_search_text(d.org_name, null, null, null, null, null) as org,
      public.chapter_directory_search_text(null, null, d.chapter_designation, null, null, null) as chapter,
      public.chapter_directory_search_text(null, null, null, d.university, null, null) as school
    from public.chapter_directory d
  ),
  scored as (
    select
      d.id,
      d.org_name,
      d.university,
      coalesce(d.chapter_designation, '') as designation,
      -- Words that start a word in the row, as typed.
      (
        select count(*) from words w where strpos(d.search_text, ' ' || w.word) > 0
      ) as prefix_hits,
      -- Words that matched either way: as typed, or as a close spelling.
      (
        select count(*)
        from words w
        where strpos(d.search_text, ' ' || w.word) > 0
          or (
            not w.found
            and length(w.word) >= 4
            and extensions.word_similarity(w.word, d.search_text) >= 0.5
          )
      ) as hits,
      (select count(*) from words) as wanted,
      -- How much of organization, chapter and school the query names
      -- outright: the whole name is a phrase of the query ("sigma chi ohio
      -- state"), or the query is the start of it ("phi gam"). A school also
      -- counts by any alias ("fiji rpi").
      (
        -- The organization counts double: it is what the search is for.
        2 * (
          strpos(' ' || q.norm || ' ', p.org) > 0
          or strpos(p.org, ' ' || q.norm) = 1
        )::int
        -- A one-word chapter ("Tau") counts only when the query starts it,
        -- or "tau nu" would rank every chapter named Tau with Tau Nu.
        + (
          p.chapter <> '  '
          and (
            strpos(p.chapter, ' ' || q.norm) = 1
            or (strpos(btrim(p.chapter), ' ') > 0 and strpos(' ' || q.norm || ' ', p.chapter) > 0)
          )
        )::int
        + (
          strpos(' ' || q.norm || ' ', p.school) > 0
          or strpos(p.school, ' ' || q.norm) = 1
          or exists (
            select 1
            from unnest(d.aliases || d.university_short) as a(name)
            where strpos(
              ' ' || q.norm || ' ',
              public.chapter_directory_search_text(null, null, null, a.name, null, null)
            ) > 0
          )
        )::int
      ) as named,
      q.norm
    from public.chapter_directory d
    join phrase p on p.id = d.id
    cross join q
    where q.norm <> ''
      and (
        p_university is null
        or btrim(p_university) = ''
        or d.university_short ilike '%' || btrim(p_university) || '%'
        or d.university ilike '%' || btrim(p_university) || '%'
      )
  )
  select d.*
  from scored s
  join public.chapter_directory d on d.id = s.id
  where s.wanted > 0 and s.hits = s.wanted
  order by
    (s.prefix_hits = s.wanted) desc,
    s.named desc,
    extensions.word_similarity(s.norm, d.search_text) desc,
    s.org_name,
    s.university,
    s.designation
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

comment on function public.search_chapter_directory(text, text, integer) is
  'Onboarding chapter search for GET /chapter-directory/search: word prefixes over organization, letters, chapter, school and aliases, with trigram typo tolerance. See 20261106200000_chapter_directory_search.sql.';

revoke execute on function public.search_chapter_directory(text, text, integer) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.search_chapter_directory(text, text, integer) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.search_chapter_directory(text, text, integer) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.search_chapter_directory(text, text, integer) to service_role;
  end if;
end
$$;
