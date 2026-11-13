import { readFileSync } from "node:fs";
import { join } from "node:path";

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
// - the migration's backfill renames a stored name of only U+FEFF in each
//   table to "Unnamed …" before adding the check, and a pledge class's group
//   follows its class (replay runs it on tables with no such rows, so this
//   re-runs the migration on seeded rows inside a rolled-back transaction).
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

  // The backfill: drop the checks, store a U+FEFF-only name in each table,
  // re-run the migration, and read the names back. Rolled back after.
  const migration = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20261113161332_names_not_blank_unicode.sql",
    ),
    "utf8",
  );
  const id = (n) => `d4770000-0000-4000-8000-00000000000${n}`;
  try {
    await db.exec(`
      begin;
      ${TABLES.map((t) => `alter table ${t} drop constraint ${t}_name_not_blank;`).join("\n")}
      insert into chapter_groups (id, chapter_id, kind, name)
        values ('${id(1)}', '${CH}', 'manual', U&'\\FEFF');
      insert into chapter_pledge_classes (id, chapter_id, name, position)
        values ('${id(2)}', '${CH}', U&'\\FEFF', 99);
      insert into event_types (id, chapter_id, name, position)
        values ('${id(3)}', '${CH}', U&'\\FEFF', 99);
      insert into role_tiers (id, chapter_id, position, name, permissions)
        values ('${id(4)}', '${CH}', 99, U&'\\FEFF', '{}');
      insert into roles (id, chapter_id, name, permissions)
        values ('${id(5)}', '${CH}', U&'\\FEFF', '{}');
    `);
    await db.exec(migration);
    const renamed = Object.fromEntries(
      (
        await db.query(
          `select 'chapter_groups' as t, name from chapter_groups where id = $1
           union all select 'chapter_pledge_classes', name from chapter_pledge_classes where id = $2
           union all select 'event_types', name from event_types where id = $3
           union all select 'role_tiers', name from role_tiers where id = $4
           union all select 'roles', name from roles where id = $5
           union all select 'class_group', name from chapter_groups where pledge_class_id = $2`,
          [id(1), id(2), id(3), id(4), id(5)],
        )
      ).rows.map((r) => [r.t, r.name]),
    );
    const expected = {
      chapter_groups: `Unnamed group ${id(1).slice(0, 8)}`,
      chapter_pledge_classes: `Unnamed class ${id(2).slice(0, 8)}`,
      event_types: `Unnamed type ${id(3).slice(0, 8)}`,
      role_tiers: `Unnamed tier ${id(4).slice(0, 8)}`,
      roles: `Unnamed role ${id(5).slice(0, 8)}`,
      class_group: `Unnamed class ${id(2).slice(0, 8)}`,
    };
    for (const [t, name] of Object.entries(expected)) {
      checks.push([
        renamed[t] === name,
        t === "class_group"
          ? `the backfill renames a pledge class's group with its class (got ${JSON.stringify(renamed[t])})`
          : `${t}: the backfill renames a U+FEFF-only name to "${name.split(" ").slice(0, 2).join(" ")} …" (got ${JSON.stringify(renamed[t])})`,
      ]);
    }
  } finally {
    await db.exec("rollback;").catch(() => {});
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
