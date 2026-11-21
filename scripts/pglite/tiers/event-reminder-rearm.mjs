import { db, miss } from "../harness.mjs";

console.log(
  "\n=== Functional: moving an event re-arms its reminder, and nothing else (#1550) ===",
);
{
  // The pre-event reminder claims (EVENT, id, EVENT_REMINDER, <UTC date of
  // start_time>), so a same-day move re-arms only because
  // `events_release_reminder_claims` deletes the claim. The landmark pins the
  // trigger's definition; this pins what its body deletes, which the
  // live-PostgREST spec (apps/api/test/integration/
  // event-reminder-rearm.integration-spec.ts) also covers but CI doesn't run
  // (#1568). The tier runs in one transaction it rolls back, so the deferred
  // trigger is fired with `set constraints ... immediate`, which also shows it
  // waits until then.
  const CHAPTER = "a1550000-0000-4000-8000-00000000000c";
  const EVENT = "a1550000-0000-4000-8000-0000000000e1";
  const OTHER = "a1550000-0000-4000-8000-0000000000e2";

  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  const claims = async () =>
    (
      await db.query(
        `select entity_id::text as id, threshold from scheduled_notification_dispatches
          where chapter_id = $1 order by entity_id, threshold`,
        [CHAPTER],
      )
    ).rows.map(
      (row) => `${row.id === EVENT ? "event" : "other"}:${row.threshold}`,
    );
  const fire = () =>
    db.exec("set constraints events_release_reminder_claims immediate;");

  try {
    await db.exec(`
      begin;
      insert into chapters (id, name, university) values ('${CHAPTER}', 'C', 'U');
      insert into events (id, chapter_id, name, start_time, end_time, point_value)
        values ('${EVENT}', '${CHAPTER}', 'Meeting', '2030-09-03 14:00Z', '2030-09-03 15:00Z', 0),
               ('${OTHER}', '${CHAPTER}', 'Meeting', '2030-09-03 14:00Z', '2030-09-03 15:00Z', 0);
      insert into scheduled_notification_dispatches
        (chapter_id, entity_type, entity_id, threshold, due_date)
        values ('${CHAPTER}', 'EVENT', '${EVENT}', 'EVENT_REMINDER', '2030-09-03'),
               ('${CHAPTER}', 'EVENT', '${EVENT}', 'AUTO_ABSENT', '2030-09-03'),
               ('${CHAPTER}', 'EVENT', '${OTHER}', 'EVENT_REMINDER', '2030-09-03');
    `);

    await db.exec(
      `update events set name = 'Meeting (B)', start_time = '2030-09-03 14:00Z' where id = '${EVENT}';`,
    );
    await fire();
    const unmoved = await claims();
    check(
      "a rename, or the same time saved again, keeps every claim",
      unmoved.length === 3,
      unmoved,
    );

    await db.exec(
      `set constraints events_release_reminder_claims deferred;
       update events set start_time = '2030-09-03 20:00Z' where id = '${EVENT}';`,
    );
    const beforeCommit = await claims();
    check(
      "the delete waits for the writer's commit",
      beforeCommit.length === 3,
      beforeCommit,
    );

    await fire();
    const moved = await claims();
    check(
      "a same-day move deletes that event's reminder claim and nothing else",
      JSON.stringify(moved) ===
        JSON.stringify(["event:AUTO_ABSENT", "other:EVENT_REMINDER"]),
      moved,
    );
  } catch (e) {
    check(
      "event-reminder-rearm scenario ran",
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
      console.log(
        `MISS  ${r.name}\n        ↳ ${JSON.stringify(r.detail ?? null).slice(0, 300)}`,
      );
    }
  }
}
