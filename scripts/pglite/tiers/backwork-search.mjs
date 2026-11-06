import { db, miss } from "../harness.mjs";

// ─── Functional: backwork search over every field a row shows (#585) ────────
//
// 20261106190000 adds `search_backwork_resources`, the Backwork source of
// `GET /v1/search`. It joins the department and professor at query time, so
// replay alone proves nothing about what it finds. This tier seeds two
// chapters and checks the promises in the migration's header:
//
//   - it finds a file by department code or name, by professor, by tag, and
//     by the course written together ("cogs2120"), not only by title;
//   - a typo still finds the word it was meant to be ("homewrk");
//   - nothing comes from another chapter, even a better match;
//   - an unrelated word, an exclusion-only query and an empty query find
//     nothing.
//
// Everything runs inside one transaction and is rolled back.
console.log("\n=== Functional: backwork search over every field (#585) ===");
{
  const A = "a5850000-0000-4000-8000-00000000000a";
  const B = "b5850000-0000-4000-8000-00000000000b";
  const USER = "c5850000-0000-4000-8000-0000000000c1";
  const DEPT = "d5850000-0000-4000-8000-0000000000d1";
  const DEPT_B = "d5850000-0000-4000-8000-0000000000d2";
  const PROF = "e5850000-0000-4000-8000-0000000000e1";
  const HW = "f5850000-0000-4000-8000-0000000000f1";
  const EXAM = "f5850000-0000-4000-8000-0000000000f2";
  const OTHER = "f5850000-0000-4000-8000-0000000000f3";
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  const search = async (chapter, query) =>
    (
      await db.query(`select id from search_backwork_resources($1, $2, 20)`, [
        chapter,
        query,
      ])
    ).rows.map((row) => row.id);

  try {
    await db.exec(`
      begin;
      insert into chapters (id, name, university) values ('${A}', 'A', 'U'), ('${B}', 'B', 'U');
      insert into users (id, supabase_auth_id, email) values ('${USER}', gen_random_uuid(), 'u@example.com');
      insert into backwork_departments (id, chapter_id, code, name) values
        ('${DEPT}', '${A}', 'COGS', 'Cognitive Science'),
        ('${DEPT_B}', '${B}', 'COGS', 'Cognitive Science');
      insert into backwork_professors (id, chapter_id, name) values ('${PROF}', '${A}', 'Bramwell');
      insert into backwork_resources
        (id, chapter_id, department_id, course_number, professor_id, uploader_id, title, storage_path, file_hash, tags, created_at)
      values
        ('${HW}', '${A}', '${DEPT}', '2120', '${PROF}', '${USER}', 'Homework 2', 'a/hw.pdf', 'h1', '{curved}', now() - interval '1 day'),
        ('${EXAM}', '${A}', null, '1200', null, '${USER}', 'Data Structures Exam', 'a/exam.pdf', 'h2', '{}', now()),
        ('${OTHER}', '${B}', '${DEPT_B}', '2120', null, '${USER}', 'Homework 2', 'b/hw.pdf', 'h3', '{curved}', now());
    `);

    check(
      "finds a file by department code",
      (await search(A, "cogs")).join() === HW,
      await search(A, "cogs"),
    );
    check(
      "finds a file by department name",
      (await search(A, "cognitive")).join() === HW,
      await search(A, "cognitive"),
    );
    check(
      "finds a file by professor",
      (await search(A, "bramwell")).join() === HW,
      await search(A, "bramwell"),
    );
    check(
      "finds a file by tag",
      (await search(A, "curved")).join() === HW,
      await search(A, "curved"),
    );
    check(
      "finds a file by course written together",
      (await search(A, "cogs2120")).includes(HW),
      await search(A, "cogs2120"),
    );
    check(
      "forgives a typo",
      (await search(A, "homewrk")).join() === HW,
      await search(A, "homewrk"),
    );
    check(
      "never returns another chapter's file",
      !(await search(A, "homework")).includes(OTHER) &&
        (await search(B, "bramwell")).length === 0,
      { a: await search(A, "homework"), b: await search(B, "bramwell") },
    );
    check(
      "a near-miss that isn't a typo of any word finds nothing",
      (await search(A, "zoology")).length === 0,
      await search(A, "zoology"),
    );
    check(
      "an exclusion-only query finds nothing",
      (await search(A, "-homework")).length === 0,
      await search(A, "-homework"),
    );
    check(
      "an empty query finds nothing",
      (await search(A, "  ")).length === 0,
      await search(A, "  "),
    );
  } catch (e) {
    check(
      "backwork search scenario ran",
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
