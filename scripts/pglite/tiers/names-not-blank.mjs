import { db, miss } from "../harness.mjs";

// ─── Name not-blank checks agree with the API (#4770) ────────────────────────
//
// The API refuses a blank name with `@Matches(/\S/)`, so the database's
// `*_name_not_blank` checks must call exactly the characters JavaScript's `\s`
// matches "blank". What each check pins, and the edit it catches:
// - each of the five constraints refuses a one-character name for exactly the
//   BMP code points `/\s/` matches (a constraint put back on `[:space:]`,
//   whose meaning follows the collation and lets U+FEFF through, or a
//   character dropped from or added to the list);
// - each table refuses a name of only U+FEFF, and of only U+00A0 and U+202F,
//   through a real insert (the constraint is attached to its table).
// `\s` matches nothing outside the BMP, so the BMP sweep covers all of it.
const TABLES = [
  "chapter_groups",
  "chapter_pledge_classes",
  "event_types",
  "role_tiers",
  "roles",
];
try {
  const CH = "c4c4c4c4-0000-4000-8000-000000004770";
  await db.exec(
    `insert into chapters (id, name, university) values ('${CH}', 'Blank names', 'U');`,
  );
  const checks = [];

  const jsBlank = [];
  for (let cp = 1; cp <= 0xffff; cp += 1) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    if (/\s/.test(String.fromCodePoint(cp))) jsBlank.push(cp);
  }

  const constraints = (
    await db.query(
      `select conrelid::regclass::text as tbl, pg_get_constraintdef(oid) as def
         from pg_constraint
        where conname like '%\\_name\\_not\\_blank' and contype = 'c'
        order by 1`,
    )
  ).rows;
  checks.push([
    JSON.stringify(constraints.map((c) => c.tbl)) === JSON.stringify(TABLES),
    `the five name not-blank constraints exist (found ${constraints.map((c) => c.tbl).join(", ")})`,
  ]);

  for (const { tbl, def } of constraints) {
    const expr = def.replace(/^CHECK /, "");
    const refused = (
      await db.query(
        `select cp from (
           select cp, chr(cp) as name from generate_series(1, 65535) cp
            where cp not between 55296 and 57343
         ) s
          where not ${expr}
          order by cp`,
      )
    ).rows.map((r) => r.cp);
    checks.push([
      JSON.stringify(refused) === JSON.stringify(jsBlank),
      `${tbl}: a one-character name is refused exactly when JS \\s matches it` +
        (JSON.stringify(refused) === JSON.stringify(jsBlank)
          ? ""
          : ` (db ${refused.map((c) => c.toString(16)).join(",")})`),
    ]);
  }

  const insert = {
    chapter_groups: (name) =>
      `insert into chapter_groups (chapter_id, kind, name) values ('${CH}', 'manual', ${name})`,
    chapter_pledge_classes: (name) =>
      `insert into chapter_pledge_classes (chapter_id, name, position) values ('${CH}', ${name}, 99)`,
    event_types: (name) =>
      `insert into event_types (chapter_id, name, position) values ('${CH}', ${name}, 99)`,
    role_tiers: (name) =>
      `insert into role_tiers (chapter_id, position, name, permissions) values ('${CH}', 99, ${name}, '{}')`,
    roles: (name) =>
      `insert into roles (chapter_id, name, permissions) values ('${CH}', ${name}, '{}')`,
  };
  const refusedInsert = async (sql) => {
    try {
      await db.exec(sql);
      return false;
    } catch (e) {
      return /_name_not_blank/.test(String(e?.message ?? e));
    }
  };
  for (const tbl of TABLES) {
    checks.push([
      await refusedInsert(insert[tbl](`U&'\\FEFF'`)),
      `${tbl}: a name of only U+FEFF is refused`,
    ]);
    checks.push([
      await refusedInsert(insert[tbl](`U&'\\00A0\\202F'`)),
      `${tbl}: a name of only U+00A0 and U+202F is refused`,
    ]);
  }

  console.log("\n=== Name not-blank checks agree with JS \\s (#4770) ===");
  for (const [ok, name] of checks) {
    if (ok) {
      console.log(`OK    ${name}`);
    } else {
      miss();
      console.log(`MISS  ${name} (#4770)`);
    }
  }

  await db.exec(`delete from chapters where id = '${CH}';`);
} catch (e) {
  miss();
  console.log(
    `MISS  name not-blank checks (#4770)\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
  );
}
