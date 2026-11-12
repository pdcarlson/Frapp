import { readFileSync } from "node:fs";
import { join } from "node:path";

import { db, miss } from "../harness.mjs";

// ─── Functional: merge Backwork department case variants (20261112150500) ───
//
// 20261112150500 merges departments whose codes differ only in case or spaces
// (#3918). It changes production data, and replay runs it against an empty
// table, so replay alone proves nothing. This tier seeds two chapters and
// checks:
//
//   - each group collapses to one department, the winner picked by the
//     migration's order (the code stored as its key, then a full name, then
//     the oldest), keeping its code as stored;
//   - every file under a loser moves to the winner, and no file is lost;
//   - the groups are JS `trim()`'s: a tab and a no-break space pad a variant
//     as a space does, and codes that are only whitespace are left alone;
//   - a loser's course entry folds into the winner's, fill-only: the
//     winner's name stays, or the loser's fills an empty one, and the loser's
//     nicknames and name join the winner's nicknames; a course only the loser
//     had moves over; past the table's limits the fold clamps rather than
//     fails (a nickname over 60 characters dropped, the first 20 kept);
//   - a loser's full name fills a winner that has none;
//   - a department with no variant, and another chapter's same code, are not
//     touched, not even upper-cased;
//   - running it a second time changes nothing.
//
// Everything runs inside one transaction and is rolled back.
console.log(
  "\n=== Functional: merge Backwork department case variants (20261112150500) ===",
);
{
  const A = "a3918000-0000-4000-8000-00000000000a";
  const B = "b3918000-0000-4000-8000-00000000000b";
  const U = "c3918000-0000-4000-8000-0000000000c1";
  const d = (n) => `d3918000-0000-4000-8000-0000000000${n}`;
  const f = (n) => `f3918000-0000-4000-8000-0000000000${n}`;
  const MATH = d("01"); // A, "MATH", named, newest: wins as the key spelling
  const MATH_LOWER = d("02"); // A, "math", oldest
  const MATH_SPACED = d("03"); // A, " Math "
  const CHEM = d("04"); // A, "Chem", oldest, no name
  const CHEM_NAMED = d("05"); // A, "chem ", named: wins on the name
  const PHYS = d("06"); // A, "PHYS", no name
  const PHYS_LOWER = d("07"); // A, "phys", named "Physics"
  const BIO = d("08"); // A, "bio", no variant
  const B_MATH = d("09"); // B, "math", no variant in its chapter
  const MATH_TAB = d("10"); // A, "\tmath"
  const MATH_NBSP = d("11"); // A, "Math" + U+00A0
  const BLANK = d("12"); // A, " "
  const BLANK_2 = d("13"); // A, "  "
  const NBSP = "\u00A0";
  const twenty = Array.from({ length: 20 }, (_, i) => `n${String(i + 1).padStart(2, "0")}`);
  const long = "x".repeat(61);
  const sql = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20261112150500_merge_backwork_department_case_variants.sql",
    ),
    "utf8",
  );
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  const departments = async (chapter) =>
    (
      await db.query(
        `select id, code, name from backwork_departments where chapter_id = $1 order by code`,
        [chapter],
      )
    ).rows;
  const fileDepartment = async (id) =>
    (
      await db.query(
        `select department_id from backwork_resources where id = $1`,
        [id],
      )
    ).rows[0]?.department_id;
  const course = async (department, number) =>
    (
      await db.query(
        `select name, nicknames from backwork_courses where department_id = $1 and course_key = $2`,
        [department, number],
      )
    ).rows[0];

  try {
    await db.exec(`
      begin;
      insert into chapters (id, name, university) values ('${A}', 'A3918', 'U'), ('${B}', 'B3918', 'U');
      insert into users (id, supabase_auth_id, email) values
        ('${U}', gen_random_uuid(), 'u3918@x.test');
      insert into backwork_departments (id, chapter_id, code, name, created_at) values
        ('${MATH}', '${A}', 'MATH', 'Mathematics', now()),
        ('${MATH_LOWER}', '${A}', 'math', null, now() - interval '3 days'),
        ('${MATH_SPACED}', '${A}', ' Math ', 'Maths', now() - interval '2 days'),
        ('${CHEM}', '${A}', 'Chem', null, now() - interval '3 days'),
        ('${CHEM_NAMED}', '${A}', 'chem ', 'Chemistry', now()),
        ('${PHYS}', '${A}', 'PHYS', null, now()),
        ('${PHYS_LOWER}', '${A}', 'phys', 'Physics', now() - interval '1 day'),
        ('${BIO}', '${A}', 'bio', null, now()),
        ('${B_MATH}', '${B}', 'math', null, now()),
        ('${MATH_TAB}', '${A}', E'\\tmath', null, now()),
        ('${MATH_NBSP}', '${A}', 'Math${NBSP}', null, now()),
        ('${BLANK}', '${A}', ' ', null, now()),
        ('${BLANK_2}', '${A}', '  ', null, now());
      insert into backwork_resources
        (id, chapter_id, department_id, course_number, uploader_id, title, storage_path, file_hash)
      values
        ('${f("01")}', '${A}', '${MATH}', '1010', '${U}', 'Exam 1', 'a/1.pdf', 'h3918-1'),
        ('${f("02")}', '${A}', '${MATH_LOWER}', '1010', '${U}', 'Exam 2', 'a/2.pdf', 'h3918-2'),
        ('${f("03")}', '${A}', '${MATH_SPACED}', '2010', '${U}', 'Exam 3', 'a/3.pdf', 'h3918-3'),
        ('${f("04")}', '${A}', '${CHEM}', '1100', '${U}', 'Lab 1', 'a/4.pdf', 'h3918-4'),
        ('${f("05")}', '${A}', '${BIO}', '1000', '${U}', 'Quiz', 'a/5.pdf', 'h3918-5'),
        ('${f("06")}', '${B}', '${B_MATH}', '1010', '${U}', 'Exam', 'b/1.pdf', 'h3918-6'),
        ('${f("07")}', '${A}', '${MATH_TAB}', '1010', '${U}', 'Exam 4', 'a/7.pdf', 'h3918-7'),
        ('${f("08")}', '${A}', '${MATH_NBSP}', '1010', '${U}', 'Exam 5', 'a/8.pdf', 'h3918-8');
      insert into backwork_courses (chapter_id, department_id, course_number, name, nicknames) values
        ('${A}', '${MATH}', '1010', null, '{Calc}'),
        ('${A}', '${MATH_LOWER}', '1010', 'Calculus I', '{Calc 1}'),
        ('${A}', '${MATH_SPACED}', '2010', 'Linear Algebra', '{}'),
        ('${A}', '${PHYS_LOWER}', '1110', 'Mechanics', '{}'),
        ('${A}', '${CHEM_NAMED}', '1100', 'General Chemistry', '{}'),
        ('${A}', '${CHEM}', '1100', 'Gen Chem', '{Gen Chem I}'),
        ('${A}', '${CHEM_NAMED}', '1200', 'Organic', '{${twenty.join(",")}}'),
        ('${A}', '${CHEM}', '1200', '${long}', '{Orgo}');
    `);

    await db.exec(sql);

    const a = await departments(A);
    check(
      "each group collapses to one department, keeping the winner's code as stored",
      JSON.stringify(a.map((r) => r.id).sort()) ===
        JSON.stringify([MATH, CHEM_NAMED, PHYS, BIO, BLANK, BLANK_2].sort()),
      a,
    );
    check(
      "the key spelling wins over an older variant, and keeps its own name",
      a.find((r) => r.id === MATH)?.name === "Mathematics",
      a,
    );
    check(
      "with no key spelling, the variant with a full name wins",
      a.find((r) => r.id === CHEM_NAMED)?.code === "chem ",
      a,
    );
    check(
      "a loser's full name fills a winner that has none",
      a.find((r) => r.id === PHYS)?.name === "Physics",
      a,
    );
    check(
      "a department with no variant keeps its code as typed",
      a.find((r) => r.id === BIO)?.code === "bio",
      a,
    );
    check(
      "codes that are only whitespace are left alone",
      a.find((r) => r.id === BLANK)?.code === " " &&
        a.find((r) => r.id === BLANK_2)?.code === "  ",
      a,
    );
    const b = await departments(B);
    check(
      "another chapter's same code is not touched",
      b.length === 1 && b[0].id === B_MATH && b[0].code === "math",
      b,
    );

    const moved = await Promise.all(
      ["01", "02", "03", "04", "05", "06", "07", "08"].map((n) => fileDepartment(f(n))),
    );
    check(
      "every file under a loser moves to its winner, and the rest stay",
      JSON.stringify(moved) ===
        JSON.stringify([MATH, MATH, MATH, CHEM_NAMED, BIO, B_MATH, MATH, MATH]),
      moved,
    );

    const calc = await course(MATH, "1010");
    check(
      "a loser's course fills the winner's empty name and adds its nicknames",
      calc?.name === "Calculus I" &&
        JSON.stringify(calc.nicknames) === JSON.stringify(["Calc", "Calc 1"]),
      calc,
    );
    const linear = await course(MATH, "2010");
    check(
      "a course only the loser had moves to the winner",
      linear?.name === "Linear Algebra",
      linear,
    );
    const mech = await course(PHYS, "1110");
    check("a course moves with a named loser too", mech?.name === "Mechanics", mech);
    const chem = await course(CHEM_NAMED, "1100");
    check(
      "a named winner course keeps its name, and the loser's name joins its nicknames",
      chem?.name === "General Chemistry" &&
        JSON.stringify(chem.nicknames) === JSON.stringify(["Gen Chem I", "Gen Chem"]),
      chem,
    );
    const organic = await course(CHEM_NAMED, "1200");
    check(
      "past the limits the fold clamps: a losing name over 60 characters dropped, the first 20 kept",
      organic?.name === "Organic" &&
        JSON.stringify(organic.nicknames) === JSON.stringify(twenty),
      organic,
    );
    const orphans = (
      await db.query(
        `select count(*)::int as n from backwork_courses where department_id = any($1::uuid[])`,
        [[MATH_LOWER, MATH_SPACED, CHEM, PHYS_LOWER, MATH_TAB, MATH_NBSP]],
      )
    ).rows[0].n;
    check("no course entry is left on a deleted department", orphans === 0, orphans);

    const snapshot = async () =>
      (
        await db.query(
          `select
             (select string_agg(id::text || code || coalesce(name, '-'), '|' order by id)
                from backwork_departments where chapter_id in ($1, $2)) ||
             (select string_agg(id::text || coalesce(department_id::text, '-'), '|' order by id)
                from backwork_resources where chapter_id in ($1, $2)) ||
             (select string_agg(department_id::text || course_key || coalesce(name, '-') || array_to_string(nicknames, ','), '|' order by department_id, course_key)
                from backwork_courses where chapter_id in ($1, $2)) as s`,
          [A, B],
        )
      ).rows[0].s;
    const before = await snapshot();
    await db.exec(sql);
    const after = await snapshot();
    check("running it twice changes nothing the second time", before === after, {
      before,
      after,
    });
  } catch (e) {
    check(
      "merge Backwork department case variants scenario ran",
      false,
      String(e?.message ?? e).split("\n")[0],
    );
  } finally {
    await db.exec("rollback;").catch(() => {});
  }

  for (const r of results) {
    if (r.ok) {
      console.log(`OK    ${r.name}`);
    } else {
      miss();
      console.log(`MISS  ${r.name}\n        ↳ ${JSON.stringify(r.detail)}`);
    }
  }
}
