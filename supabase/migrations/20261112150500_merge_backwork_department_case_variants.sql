-- Merge Backwork departments whose codes differ only in case or spaces (#3918).
--
-- spec/behavior/backwork.md § Auto-Vivification owns the rule: a department
-- code matches trimmed and in any case, and a new one is stored trimmed and
-- upper-cased (#4485, `findDepartmentByCode` / `departmentCodeKey` in
-- packages/validation/src/backwork-courses.ts). Before #4485 an upload matched
-- the code exactly, so an uploader who typed "math" beside the chapter's
-- "MATH" created a second department. Its files sit under a different course
-- entry, miss that course's name and nicknames, and show as a separate
-- department in the filters. This folds each such group into one department,
-- the same way an officer's "Merge {CODE} into…" does
-- (BackworkService.mergeDepartments).
--
-- ORDER: merge with or after #4485. This runs once; merged first, an upload
-- between the two deploys can create a new variant that stays.
--
-- WHAT THIS CHANGES, per chapter, for each group of departments whose codes
-- are equal once trimmed and upper-cased (`upper(btrim(code, whitespace))`):
--
-- - The department kept (the winner) is, in order: one whose code is already
--   stored as the key ("MATH", not "math" or " MATH"); then one with a full
--   name; then the oldest; then the lowest id. It keeps its code as stored.
-- - Each other department in the group (a loser), best-ranked first:
--   - its course entries (`backwork_courses`) fold into the winner's entry for
--     the same course number through `backwork_course_write`, fill-only and
--     clamped, exactly as the API's merge does: the winner's name stays (the
--     loser's when the winner has none), and the loser's nicknames and name
--     join the winner's nicknames;
--   - its files (`backwork_resources.department_id`) move to the winner;
--   - its full name fills the winner's when the winner has none;
--   - it is deleted, and its now-folded course entries cascade with it.
--
-- Nothing else: no file is deleted, and a file's title, course number,
-- professor and tags are untouched. A department with no case variant is not
-- touched, not even to upper-case its code. Tested against seeded rows by
-- scripts/pglite/tiers/merge-backwork-department-case-variants.mjs.
--
-- No trigger fires on `backwork_departments`, `backwork_resources` or
-- `backwork_courses`. Idempotent: once merged, no group has a second member,
-- so a second run changes nothing.
--
-- Trimming: Postgres's `btrim` trims only the characters it is given, so this
-- passes the ASCII whitespace JS's `trim()` removes. Upper-casing a non-ASCII
-- code can differ between Postgres and JS (JS's "ß" becomes "SS"); department
-- codes are course prefixes like "MATH", so no group is expected to split on
-- that.

do $$
declare
  ws constant text := E' \t\n\r\f\x0B';
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
