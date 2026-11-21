import { db, miss } from "../harness.mjs";

// ─── Event types (#3730) ─────────────────────────────────────────────────────
//
// `event_types` is reached from the API only through mocked repositories, and
// its seeding lives in a trigger, so this is the one place that SQL runs.
// What each check pins, and the edit it catches:
// - a new chapter starts with no types: the seeding trigger is gone
//   (20261120220934_stop_seeding_event_types.sql, #5776);
// - a name is unique per chapter ignoring case and outer spaces;
// - an event can't point at another chapter's type (composite foreign key);
// - deleting a type clears only `event_type_id` on its events.
try {
  const CH_A = "c1c1c1c1-0000-4000-8000-000000003730";
  const CH_B = "c2c2c2c2-0000-4000-8000-000000003730";
  const EV = "c3c3c3c3-0000-4000-8000-000000003730";
  await db.exec(`
    insert into chapters (id, name, university) values
      ('${CH_A}', 'Types A', 'U'), ('${CH_B}', 'Types B', 'U');
  `);

  const rejects = async (sql) => {
    try {
      await db.exec(sql);
      return false;
    } catch {
      return true;
    }
  };
  const names = async (chapter) =>
    (
      await db.query(
        `select name from event_types where chapter_id = $1 order by position`,
        [chapter],
      )
    ).rows.map((r) => r.name);
  const typeId = async (chapter, name) =>
    (
      await db.query(
        `select id::text as id from event_types where chapter_id = $1 and name = $2`,
        [chapter, name],
      )
    ).rows[0]?.id;
  const checks = [];

  checks.push([
    (await names(CH_A)).length === 0,
    "a new chapter starts with no types (#5776)",
  ]);

  await db.exec(`
    insert into event_types (chapter_id, name, point_value, position) values
      ('${CH_A}', 'Brotherhood', 5, 1), ('${CH_A}', 'Social', 0, 2),
      ('${CH_B}', 'Brotherhood', 5, 1);
  `);

  checks.push([
    await rejects(
      `insert into event_types (chapter_id, name, position) values ('${CH_A}', '  social ', 9);`,
    ),
    "a chapter can't have two types of the same name, ignoring case and spaces",
  ]);

  checks.push([
    await rejects(
      `insert into event_types (chapter_id, name, position) values ('${CH_A}', E'\\t\\n ', 9);`,
    ),
    "a type name of only whitespace is refused (#4756)",
  ]);

  const otherType = await typeId(CH_B, "Brotherhood");
  checks.push([
    await rejects(
      `insert into events (chapter_id, name, start_time, end_time, event_type_id)
       values ('${CH_A}', 'Cross', now(), now() + interval '1 hour', '${otherType}');`,
    ),
    "an event can't point at another chapter's type",
  ]);

  const ownType = await typeId(CH_A, "Brotherhood");
  await db.exec(`
    insert into events (id, chapter_id, name, start_time, end_time, point_value, event_type_id)
    values ('${EV}', '${CH_A}', 'Bowling', now(), now() + interval '1 hour', 5, '${ownType}');
    delete from event_types where id = '${ownType}';
  `);
  const after = (
    await db.query(
      `select event_type_id, chapter_id::text as chapter_id, point_value from events where id = $1`,
      [EV],
    )
  ).rows[0];
  checks.push([
    after &&
      after.event_type_id === null &&
      after.chapter_id === CH_A &&
      after.point_value === 5,
    "deleting a type clears only the event's type",
  ]);

  console.log("\n=== Event types (#3730) ===");
  for (const [ok, name] of checks) {
    if (ok) {
      console.log(`OK    ${name}`);
    } else {
      miss();
      console.log(`MISS  ${name} (#3730)`);
    }
  }

  await db.exec(`delete from chapters where id in ('${CH_A}', '${CH_B}');`);
} catch (e) {
  miss();
  console.log(
    `MISS  event types (#3730)\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
  );
}
