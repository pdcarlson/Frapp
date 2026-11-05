import { readFileSync } from "node:fs";
import { join } from "node:path";

import { db, miss } from "../harness.mjs";

// ─── Functional: starting descriptions for the default channels ─────────────
//
// 20261105200000 writes a starting `description` into the four channels every
// chapter is seeded with. Replay runs it against an empty table, so replay
// alone proves nothing about it; this tier re-runs the same SQL against rows
// it seeds and checks the three things the migration promises:
//
//   - only a description that was never set (null) is written: an officer's
//     text, and a description an officer cleared ('' from Chat admin), stay;
//   - only the seeded name and type pairs are touched, so a PRIVATE channel
//     named `general` or a PUBLIC one named `alumni` is left alone;
//   - running it a second time changes nothing.
//
// Everything runs inside one transaction and is rolled back.
console.log(
  "\n=== Functional: default channel descriptions (20261105200000) ===",
);
{
  const A = "a3489000-0000-4000-8000-00000000000a";
  const B = "b3489000-0000-4000-8000-00000000000b";
  const GENERAL = "The whole chapter. Plans, questions, whatever's going on.";
  const ALUMNI = "Alumni and actives keeping in touch.";
  const sql = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20261105200000_default_channel_descriptions.sql",
    ),
    "utf8",
  );
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  const describe = async (chapter, name) =>
    (
      await db.query(
        `select description from chat_channels where chapter_id = $1 and name = $2`,
        [chapter, name],
      )
    ).rows[0]?.description;

  try {
    await db.exec(`
      begin;
      insert into chapters (id, name, university) values ('${A}', 'A', 'U'), ('${B}', 'B', 'U');
      insert into chat_channels (chapter_id, name, type, description, required_permissions) values
        ('${A}', 'general', 'PUBLIC', null, null),
        ('${A}', 'announcements', 'PUBLIC', 'Our own words.', null),
        ('${A}', 'chapter-audit', 'PUBLIC', '', null),
        ('${A}', 'alumni', 'ROLE_GATED', null, '{members:view,alumni:post}'),
        ('${B}', 'general', 'PRIVATE', null, null),
        ('${B}', 'alumni', 'PUBLIC', null, null);
    `);

    await db.exec(sql);
    check(
      "a never-set description on a seeded channel gets its starting line",
      (await describe(A, "general")) === GENERAL &&
        (await describe(A, "alumni")) === ALUMNI,
      {
        general: await describe(A, "general"),
        alumni: await describe(A, "alumni"),
      },
    );
    check(
      "an officer's text and an officer's cleared description are kept",
      (await describe(A, "announcements")) === "Our own words." &&
        (await describe(A, "chapter-audit")) === "",
      {
        announcements: await describe(A, "announcements"),
        audit: await describe(A, "chapter-audit"),
      },
    );
    check(
      "a channel that only shares a seeded name, with another type, is left alone",
      (await describe(B, "general")) === null &&
        (await describe(B, "alumni")) === null,
      {
        general: await describe(B, "general"),
        alumni: await describe(B, "alumni"),
      },
    );

    const before = (
      await db.query(
        `select string_agg(chapter_id || name || coalesce(description, '∅'), '|' order by chapter_id, name) as s
         from chat_channels where chapter_id in ($1, $2)`,
        [A, B],
      )
    ).rows[0].s;
    await db.exec(sql);
    const after = (
      await db.query(
        `select string_agg(chapter_id || name || coalesce(description, '∅'), '|' order by chapter_id, name) as s
         from chat_channels where chapter_id in ($1, $2)`,
        [A, B],
      )
    ).rows[0].s;
    check(
      "running it twice changes nothing the second time",
      before === after,
      { before, after },
    );
  } catch (e) {
    check(
      "default channel descriptions scenario ran",
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
