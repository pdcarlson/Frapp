-- Merge Backwork departments whose codes differ only in case or spaces (#3918).
--
-- #4485 (the code half of #3918) makes a department code match trimmed and in
-- any case, and stores a new one trimmed and upper-cased: `departmentCodeKey`
-- and `findDepartmentByCode` in packages/validation/src/backwork-courses.ts,
-- stated in spec/behavior/backwork.md § Auto-Vivification. Before it, an
-- upload matched the code exactly, so an uploader who typed "math" beside the
-- chapter's "MATH" created a second department. Its files sit under a
-- different course entry, miss that course's name and nicknames, and show as a
-- separate department in the filters. This folds each such group into one
-- department.
--
-- ORDER: merge with or after #4485. This runs once; merged first, an upload
-- between the two deploys can create a new variant that stays (harmless to
-- uploads once #4485 is live, and an officer can merge it by hand).
--
-- WHAT THIS CHANGES, per chapter, for each group of departments whose codes
-- are equal once trimmed and upper-cased (`upper(btrim(code, ws))`, `ws` being
-- every character JS's `trim()` removes, so the groups are #4485's):
--
-- - The department kept (the winner) is, in order: one whose code is already
--   stored as the key ("MATH", not "math" or " MATH"); then one with a full
--   name; then the oldest; then the lowest id. It keeps its code as stored.
-- - Each other department in the group (a loser), best-ranked first, goes the
--   way an officer's "Merge {CODE} into…" takes it
--   (BackworkService.mergeDepartments), plus one step that merge lacks:
--   - its course entries (`backwork_courses`) fold into the winner's entry for
--     the same course number through `backwork_course_write` with the API
--     merge's arguments (fill-only, clamped): the winner's name stays (the
--     loser's when the winner has none), and the loser's nicknames and name
--     join the winner's nicknames;
--   - its files (`backwork_resources.department_id`) move to the winner;
--   - its full name fills the winner's when the winner has none (the extra
--     step). When the winner has one, the loser's full name is dropped, as the
--     API merge drops it;
--   - it is deleted, and its now-folded course entries cascade with it.
--
-- Nothing else: no file is deleted, and a file's title, course number,
-- professor and tags are untouched. A department with no case variant is not
-- touched, not even to upper-case its code, and neither are codes that are
-- only whitespace. Tested against seeded rows by
-- scripts/pglite/tiers/merge-backwork-department-case-variants.mjs.
--
-- No trigger fires on `backwork_departments`, `backwork_resources` or
-- `backwork_courses`. Idempotent: once merged, no group has a second member,
-- so a second run changes nothing.
--
-- Upper-casing a non-ASCII code can differ between Postgres and JS (JS's "ß"
-- becomes "SS"); department codes are course prefixes like "MATH", so no group
-- is expected to split on that.

do $$
declare
  -- JS trim(): WhiteSpace (incl. every Zs space) and LineTerminator.
  ws constant text := E' \t\n\x0B\f\r\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF';
  m record;
  c record;
begin
  for m in
    with keyed as (
      select d.id, d.chapter_id, d.code, d.name, d.created_at,
             upper(btrim(d.code, ws)) as key
        from public.backwork_departments d
    ),
    ranked as (
      select k.*,
             row_number() over (
               partition by k.chapter_id, k.key
               order by (k.code = k.key) desc,
                        (k.name is not null) desc,
                        k.created_at,
                        k.id
             ) as rn
        from keyed k
       where k.key <> ''
    )
    select l.id as loser_id, l.name as loser_name, l.chapter_id,
           w.id as winner_id
      from ranked l
      join ranked w
        on w.chapter_id = l.chapter_id and w.key = l.key and w.rn = 1
     where l.rn > 1
     order by l.chapter_id, l.key, l.rn
  loop
    for c in
      select course_number, name, nicknames
        from public.backwork_courses
       where department_id = m.loser_id
       order by course_key, id
    loop
      perform public.backwork_course_write(
        m.chapter_id,
        m.winner_id,
        c.course_number,
        c.name is not null,
        c.name,
        false,
        c.nicknames || case when c.name is not null then array[c.name] else '{}'::text[] end,
        '{}'::text[],
        true
      );
    end loop;

    update public.backwork_resources
       set department_id = m.winner_id
     where department_id = m.loser_id
       and chapter_id = m.chapter_id;

    update public.backwork_departments
       set name = m.loser_name
     where id = m.winner_id
       and name is null
       and m.loser_name is not null;

    delete from public.backwork_departments where id = m.loser_id;
  end loop;
end
$$;
