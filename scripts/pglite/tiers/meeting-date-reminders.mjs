import { db, miss } from "../harness.mjs";

console.log("\n=== Functional: reminders on minutes' Coming up dates (#5672) ===");
{
  // The unit suites mock the table: here the real one keeps one reminder per
  // member per date, so setting it again (the API's upsert on
  // `user_id, meeting_id, day, text_md5`) moves it, and deleting an account
  // or the minutes takes its reminders with it.
  const CHAPTER = "a5672000-0000-4000-8000-00000000000c";
  const AUTHOR = "a5672000-0000-4000-8000-0000000000a0";
  const [A, B] = [1, 2].map((n) => `a5672000-0000-4000-8000-0000000000b${n}`);
  const EVENT = "a5672000-0000-4000-8000-0000000000e1";
  const MEETING = "a5672000-0000-4000-8000-0000000000f1";

  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  const count = async (sql) => (await db.query(sql)).rows[0].n;
  const remind = (userId, day, text, at) =>
    db.query(
      `insert into meeting_date_reminders (user_id, chapter_id, meeting_id, day, text, remind_at)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (user_id, meeting_id, day, text_md5)
       do update set remind_at = excluded.remind_at, updated_at = now()
       returning id, remind_at`,
      [userId, CHAPTER, MEETING, day, text, at],
    );

  try {
    await db.exec(`
      begin;
      insert into chapters (id, name, university) values ('${CHAPTER}', 'C', 'U');
      insert into users (id, supabase_auth_id, email, display_name) values
        ('${AUTHOR}', gen_random_uuid(), 'a5672a@example.test', 'Author'),
        ('${A}', gen_random_uuid(), 'a5672b1@example.test', 'A'),
        ('${B}', gen_random_uuid(), 'a5672b2@example.test', 'B');
      insert into events (id, chapter_id, name, start_time, end_time)
        values ('${EVENT}', '${CHAPTER}', 'Chapter', now() - interval '2 hours', now() - interval '1 hour');
      insert into meetings (id, chapter_id, event_id, event_name, event_start_time, meeting_type, status, created_by)
        values ('${MEETING}', '${CHAPTER}', '${EVENT}', 'Chapter', now() - interval '2 hours', 'chapter', 'draft', '${AUTHOR}');
    `);

    const first = (await remind(A, "2026-12-04", "Winter formal", "2026-12-03T23:00:00Z")).rows[0];
    const moved = (await remind(A, "2026-12-04", "Winter formal", "2026-12-04T14:00:00Z")).rows[0];
    const rows = await count(
      `select count(*)::int as n from meeting_date_reminders where user_id = '${A}'`,
    );
    check(
      "setting a reminder again on the same date moves the one there is",
      first?.id === moved?.id && rows === 1 && new Date(moved.remind_at).toISOString() === "2026-12-04T14:00:00.000Z",
      { first, moved, rows },
    );

    await remind(A, "2026-12-04", "Officer installation", "2026-12-03T23:00:00Z");
    await remind(B, "2026-12-04", "Winter formal", "2026-12-03T23:00:00Z");
    const separate = await count(`select count(*)::int as n from meeting_date_reminders`);
    check("another date that day, or another member, is a reminder of its own", separate === 3, { separate });

    await db.exec(`update users set deleted_at = now() where id = '${A}';`);
    const afterDelete = await count(
      `select count(*)::int as n from meeting_date_reminders where user_id = '${A}'`,
    );
    check("deleting an account deletes its reminders", afterDelete === 0, { afterDelete });

    await db.exec(`delete from meetings where id = '${MEETING}';`);
    const afterMinutes = await count(`select count(*)::int as n from meeting_date_reminders`);
    check("deleting the minutes deletes their reminders", afterMinutes === 0, { afterMinutes });
  } catch (e) {
    check("meeting-date-reminders scenario ran", false, String(e?.message ?? e).split("\n")[0]);
  } finally {
    await db.exec("rollback;").catch(() => {});
  }

  for (const r of results) {
    if (r.ok) {
      console.log(`OK    ${r.name}`);
    } else {
      miss();
      console.log(`MISS  ${r.name}\n        ↳ ${JSON.stringify(r.detail ?? null).slice(0, 300)}`);
    }
  }
}
