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
//     nothing;
//   - since 20261109120000, a course's name and nicknames (`backwork_courses`)
//     find its files, the course number matched trimmed and case-insensitively,
//     and another chapter's course name never does.
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
  const COURSE = "a3848000-0000-4000-8000-0000000000c1";
  const COURSE_B = "a3848000-0000-4000-8000-0000000000c2";
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
      insert into backwork_courses (id, chapter_id, department_id, course_number, name, nicknames) values
        ('${COURSE}', '${A}', '${DEPT}', ' 2120 ', 'Cognition Fundamentals', '{Brainy}'),
        ('${COURSE_B}', '${B}', '${DEPT_B}', '2120', 'Perception', '{}');
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
      "finds a file by its course's name",
      (await search(A, "fundamentals")).join() === HW,
      await search(A, "fundamentals"),
    );
    check(
      "finds a file by its course's nickname",
      (await search(A, "brainy")).join() === HW,
      await search(A, "brainy"),
    );
    check(
      "never finds a file by another chapter's course name",
      (await search(A, "perception")).length === 0 &&
        !(await search(B, "brainy")).includes(HW),
      { a: await search(A, "perception"), b: await search(B, "brainy") },
    );
    // backwork_course_write (#3848): each write applies to the row as it is.
    const writeTo = async (dept, number, name, setName, mayRename, add, remove, clamp = false) =>
      (
        await db.query(
          `select name, nicknames from backwork_course_write($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [A, dept, number, setName, name, mayRename, add, remove, clamp],
        )
      ).rows[0];
    const write = (name, setName, mayRename, add, remove) =>
      writeTo(DEPT, "2120", name, setName, mayRename, add, remove);
    const first = await writeTo(DEPT, "3000", "Perception", true, false, ["Percept"], []);
    check(
      "a first write stores the name and nicknames",
      first.name === "Perception" && first.nicknames.join() === "Percept",
      first,
    );
    const renamed = await writeTo(DEPT, "3000", "Sensation", true, true, [], []);
    check(
      "an admin write (set and may-rename) changes a set name",
      renamed.name === "Sensation",
      renamed,
    );
    await write(null, false, false, ["Cog One"], []);
    const both = await write(null, false, false, ["Cog 1"], []);
    check(
      "two nickname adds both survive",
      ["Brainy", "Cog One", "Cog 1"].every((n) => both.nicknames.includes(n)),
      both,
    );
    const filled = await write("Something Else", true, false, [], []);
    check(
      "fill-only never overwrites a set name",
      filled.name === "Cognition Fundamentals",
      filled,
    );
    const swapped = await write(null, false, true, ["BRAINY"], ["brainy"]);
    check(
      "remove applies before add, so a case-only fix keeps the new spelling",
      swapped.nicknames.includes("BRAINY") && !swapped.nicknames.includes("Brainy"),
      swapped,
    );
    // A department merge: fold a source course into the target's twin,
    // fill-only and clamped, after someone added a nickname to the target.
    const many = Array.from({ length: 18 }, (_, i) => `Own ${i}`);
    await writeTo(DEPT, "4000", "Memory", true, false, many, []);
    await writeTo(DEPT, "4000", null, false, false, ["Late add"], []);
    const folded = await writeTo(
      DEPT,
      "4000",
      "Remembering",
      true,
      false,
      // The over-60 item first, where the 20 cap alone wouldn't cut it.
      ["😀".repeat(61), "Source nick", "Third", "Remembering"],
      [],
      true,
    );
    check(
      "a merge fold keeps an add made just before it and the target's name",
      folded.name === "Memory" &&
        folded.nicknames.includes("Late add") &&
        folded.nicknames.includes("Source nick"),
      folded,
    );
    check(
      "the merge clamp keeps 20, the target's own first, and drops one over 60",
      folded.nicknames.length === 20 &&
        folded.nicknames.slice(0, 19).join() === [...many, "Late add"].join() &&
        !folded.nicknames.some((n) => [...n].length > 60),
      folded,
    );
    // A fold with room under the cap: what the service sends for a source
    // course named "Brain Science" into a target named "Neuroscience".
    await writeTo(DEPT, "5000", "Neuroscience", true, false, ["Neuro"], []);
    const roomy = await writeTo(
      DEPT,
      "5000",
      "Brain Science",
      true,
      false,
      ["Brainy", "😀".repeat(61), "neuroscience", "Brain Science"],
      [],
      true,
    );
    check(
      "a fold keeps the losing source name as a nickname",
      roomy.name === "Neuroscience" && roomy.nicknames.includes("Brain Science"),
      roomy,
    );
    check(
      "a fold never makes the target's own name a nickname",
      !roomy.nicknames.some((n) => n.toLowerCase() === "neuroscience"),
      roomy,
    );
    check(
      "a fold drops a source nickname over 60 code points",
      !roomy.nicknames.some((n) => [...n].length > 60) &&
        roomy.nicknames.join() === "Neuro,Brainy,Brain Science",
      roomy,
    );
    check(
      "writes nothing for a department in another chapter",
      (
        await db.query(
          `select (backwork_course_write($1, $2, '2120', true, 'X', true, '{}', '{}')).id as id`,
          [A, DEPT_B],
        )
      ).rows[0].id === null,
      "row returned",
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
