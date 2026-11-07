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
-- 1. `aliases text[]` and `org_aliases text[]`: the other names a search
--    should find a row by. `aliases` are the school's (its short name and
--    nicknames: "RPI", "Rensselaer"), `org_aliases` the organization's
--    ("FIJI", "Phi Gam"). Matched, never shown. The directory seed carries
--    both (supabase/seed/chapter_directory.csv). They are kept apart because
--    the ranking below credits naming the organization more than the school.
-- 2. `chapter_directory_normalize(text)`: the one normalization both the rows
--    and the query go through. Lowercase; accents folded ("Mānoa" is
--    "manoa", "José" is "jose"); apostrophes dropped, so "St. John's" is
--    "st johns"; "&" between letters both joined and spelled out ("A&M" is
--    "am a and m"), and on its own spelled out ("William & Mary" is "william
--    and mary"); anything else but letters, digits and Greek is a space.
-- 3. Generated columns, so none of it can drift from the row:
--      `search_text`          every searchable field, normalized, space-led;
--      `search_org_names`     the organization's name and aliases,
--      `search_chapter_names` the chapter's name,
--      `search_school_names`  the school's name, short name and aliases,
--    each name normalized and space-wrapped (" tau nu "), which is what the
--    ranking compares and why it costs no regex at query time.
--    `search_vector` and its index go: nothing reads them once the repository
--    calls the function below.
-- 4. `search_chapter_directory(query, university, limit)`:
--      * Every word of the query must start a word in the row ("phi gam rens"
--        finds Tau Nu at Rensselaer). Joining words (and, at, of, the, in,
--        for) are skipped, so "sigma chi at ohio state" finds Sigma Chi there.
--      * A word of four or more letters that starts no word anywhere in the
--        directory may instead be a close spelling of one (trigram word
--        similarity >= 0.5). Only then: "kappa" starts words, so it never
--        matches "kappla"; and the trigram work stays off the common case.
--      * Only the first eight distinct words count, the query is cut at 200
--        characters, and a query with more than two words that start nothing
--        anywhere matches nothing, so a pasted paragraph costs what a name
--        does.
--      * `university` narrows to rows where a word of the school's name,
--        short name or an alias starts with it ("rens", "RPI", "polytech"). With a university and no query, the
--        call lists that school's chapters; with neither, it finds nothing.
--      * A 'retired' row (one the seed dropped that a chapter still links;
--        scripts/load-chapter-directory.mjs) is never offered.
--
-- RANKING
--
-- Rows where every word matched as typed come before rows that needed a typo
-- match. Within those, rows rank by how much of organization (counted
-- double), chapter and school the query names outright: the whole name, or
-- any of its aliases, is a phrase of the query, or the query is the start of
-- it. A one-word chapter ("Tau") counts only when the query starts it, or
-- "tau nu" would rank every chapter named Tau with Tau Nu. So "fiji tau nu"
-- names two for Tau Nu, "alpha phi alpha howard" puts Alpha Phi Alpha's Beta
-- above Sigma Gamma Rho's Alpha Phi chapter there, and "phi gamma delta" puts
-- Phi Gamma Delta above Phi Delta Theta's New York Gamma. Then closeness
-- (trigram word similarity of the whole query), then organization, school and
-- chapter name, so a page of results reads in order.
--
-- WHY IMMUTABLE WRAPPERS
--
-- A STORED generated column may call only immutable functions, and may not
-- hold a subquery. `array_to_string` is marked stable (its element output
-- could in principle depend on settings); for `text[]` it doesn't, and the
-- name arrays need a subquery over `unnest`. So the helpers below are SQL
-- functions declared immutable; the same construction is common in Supabase
-- projects.
--
-- NO INDEX
--
-- The function reads every row: the table is reference data of about 13,300
-- chapters, the prefix checks are `strpos` calls, and the trigram similarity
-- runs only for a word that starts nothing anywhere. Measured in the PGlite
-- harness on the real seed (2026-11-06, WASM Postgres, slower than the hosted
-- one): 17 ms for "fiji rpi", 25 ms for "phi gamma delta", 205 ms for "phi
-- gamma delta renselaer" (the typo pass), and 100 to 235 ms for a two-letter
-- prefix that starts a word in most rows ("ph", "un"), where the cost is
-- ranking thousands of matches. The scripts/pglite chapter directory tier
-- prints these on every run. A trigram GIN index can't serve "every word starts
-- some word, or nearly does", so it would be write cost for no read. If the
-- table grows by an order of magnitude, prefilter on the query's longest word
-- with `%>` and add the index then.
--
-- GRANTS
--
-- Only the API's service role calls any of these functions (the controller
-- answers the wizard; the repository uses the service client). PUBLIC, anon
-- and authenticated lose the default EXECUTE, as in 20260901173000.
--
-- LOCKS
--
-- The table is reference data the onboarding wizard reads, with no writer but
-- the seed loader. The rewrite for the generated columns takes ACCESS
-- EXCLUSIVE on it for well under a second at its size.

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

alter table public.chapter_directory
  add column if not exists aliases text[] not null default '{}',
  add column if not exists org_aliases text[] not null default '{}';

create or replace function public.chapter_directory_normalize(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog, pg_temp
as $$
  select btrim(
    regexp_replace(
      replace(
        regexp_replace(
          regexp_replace(
            lower(translate(coalesce(p_text, ''), 'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüýÿĀāĂăĄąĆćĈĉĊċČčĎďĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĨĩĪīĬĭĮįİĴĵĶķĹĺĻļĽľŃńŅņŇňŌōŎŏŐőŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽžßøØđĐłŁı', 'AAAAAACEEEEIIIINOOOOOUUUUYaaaaaaceeeeiiiinooooouuuuyyAaAaAaCcCcCcCcDdEeEeEeEeEeGgGgGgGgHhIiIiIiIiIJjKkLlLlLlNnNnNnOoOoOoRrRrRrSsSsSsSsTtTtUuUuUuUuUuUuWwYyYZzZzZzsoOdDlLi')),
            '[''’ʻ`]', '', 'g'
          ),
          '([a-z0-9]+)&([a-z0-9]+)', '\1\2 \1 and \2', 'g'
        ),
        '&', ' and '
      ),
      '[^a-z0-9Ͱ-Ͽ]+', ' ', 'g'
    )
  )
$$;

comment on function public.chapter_directory_normalize(text) is
  'The normalization chapter directory search applies to rows and queries alike: lowercase, accents folded, apostrophes dropped, & spelled out, other punctuation a space. See 20261106220000_chapter_directory_search.sql.';

create or replace function public.chapter_directory_search_text(
  p_org_name text,
  p_org_letters text,
  p_designation text,
  p_university text,
  p_university_short text,
  p_aliases text[],
  p_org_aliases text[]
)
returns text
language sql
immutable
parallel safe
set search_path = public, pg_catalog, pg_temp
as $$
  select ' ' || public.chapter_directory_normalize(
    concat_ws(
      ' ',
      p_org_name,
      p_org_letters,
      p_designation,
      p_university,
      p_university_short,
      array_to_string(p_aliases, ' '),
      array_to_string(p_org_aliases, ' ')
    )
  ) || ' '
$$;

comment on function public.chapter_directory_search_text(text, text, text, text, text, text[], text[]) is
  'Generates chapter_directory.search_text, the normalized, space-led text search_chapter_directory matches query words against. See 20261106220000_chapter_directory_search.sql.';

create or replace function public.chapter_directory_search_names(p_names text[])
returns text[]
language sql
immutable
parallel safe
set search_path = public, pg_catalog, pg_temp
as $$
  select coalesce(array_agg(distinct ' ' || t.name || ' '), '{}')
  from (
    select public.chapter_directory_normalize(n) as name
    from unnest(p_names) as n
  ) t
  where t.name <> ''
$$;

comment on function public.chapter_directory_search_names(text[]) is
  'Generates chapter_directory''s search_*_names columns: each name normalized and space-wrapped, for the ranking in search_chapter_directory. See 20261106220000_chapter_directory_search.sql.';

alter table public.chapter_directory
  add column if not exists search_text text
    generated always as (
      public.chapter_directory_search_text(
        org_name, org_letters, chapter_designation, university, university_short, aliases, org_aliases
      )
    ) stored,
  add column if not exists search_org_names text[]
    generated always as (public.chapter_directory_search_names(array[org_name] || org_aliases)) stored,
  add column if not exists search_chapter_names text[]
    generated always as (public.chapter_directory_search_names(array[chapter_designation])) stored,
  add column if not exists search_school_names text[]
    generated always as (
      public.chapter_directory_search_names(array[university, university_short] || aliases)
    ) stored;

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
    select
      left(public.chapter_directory_normalize(p_query), 200) as norm,
      nullif(public.chapter_directory_normalize(p_university), '') as school
  ),
  picked as (
    -- The first eight distinct words, joining words aside.
    select w.word
    from (
      select distinct on (t.word) t.word, t.n
      from q, unnest(string_to_array(q.norm, ' ')) with ordinality as t(word, n)
      where t.word <> '' and t.word not in ('and', 'at', 'of', 'the', 'in', 'for')
      order by t.word, t.n
    ) w
    order by w.n
    limit 8
  ),
  words as (
    select
      p.word,
      -- Whether the word starts a word anywhere in the directory. Only one
      -- that starts nothing is tried as a typo.
      exists (
        select 1
        from public.chapter_directory x
        where x.source <> 'retired' and strpos(x.search_text, ' ' || p.word) > 0
      ) as found
    from picked p
  ),
  wanted as (
    select count(*) as n from words
  ),
  scored as (
    select
      d.id,
      -- Words that start a word in the row, as typed.
      (select count(*) from words w where strpos(d.search_text, ' ' || w.word) > 0) as prefix_hits,
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
      ) as hits
    from public.chapter_directory d
    cross join q
    where d.source <> 'retired'
      -- A query with more than two words that start nothing anywhere is not
      -- a name with a typo or two, and no row could match it.
      and (select count(*) from words where not found) <= 2
      and (
        q.school is null
        or exists (
          select 1 from unnest(d.search_school_names) as n(name)
          where strpos(n.name, ' ' || q.school) > 0
        )
      )
  )
  select d.*
  from scored s
  cross join wanted
  cross join q
  join public.chapter_directory d on d.id = s.id
  where (wanted.n > 0 and s.hits = wanted.n)
     or (wanted.n = 0 and q.school is not null)
  order by
    (s.prefix_hits = wanted.n) desc,
    (
      -- The organization counts double: it is what the search is for.
      2 * (exists (
        select 1 from unnest(d.search_org_names) as n(name)
        where strpos(' ' || q.norm || ' ', n.name) > 0 or strpos(n.name, ' ' || q.norm) = 1
      ))::int
      + (exists (
        select 1 from unnest(d.search_chapter_names) as n(name)
        where strpos(n.name, ' ' || q.norm) = 1
          or (strpos(btrim(n.name), ' ') > 0 and strpos(' ' || q.norm || ' ', n.name) > 0)
      ))::int
      + (exists (
        select 1 from unnest(d.search_school_names) as n(name)
        where strpos(' ' || q.norm || ' ', n.name) > 0 or strpos(n.name, ' ' || q.norm) = 1
      ))::int
    ) desc,
    extensions.word_similarity(q.norm, d.search_text) desc,
    d.org_name,
    d.university,
    coalesce(d.chapter_designation, '')
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

comment on function public.search_chapter_directory(text, text, integer) is
  'Onboarding chapter search for GET /chapter-directory/search: word prefixes over organization, letters, chapter, school and aliases, with trigram typo tolerance. See 20261106220000_chapter_directory_search.sql.';

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.chapter_directory_normalize(text)',
    'public.chapter_directory_search_text(text, text, text, text, text, text[], text[])',
    'public.chapter_directory_search_names(text[])',
    'public.search_chapter_directory(text, text, integer)'
  ] loop
    execute format('revoke execute on function %s from public', fn);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke execute on function %s from anon', fn);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke execute on function %s from authenticated', fn);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', fn);
    end if;
  end loop;
end
$$;
