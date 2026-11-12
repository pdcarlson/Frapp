import { db, miss } from "../harness.mjs";

// ─── Calendar subscription links (#3322) ────────────────────────────────────
//
// `calendar_feeds` is reached from the API only through mocked repositories,
// so this is the one place its constraints and its trigger run. What each
// check pins, and the edit it catches:
// - one live link per member per chapter (`calendar_feeds_one_live_per_member`),
//   which `CalendarFeedService.ensure` and `reset` lean on when two requests
//   race: they read back the winner after their own insert is refused;
// - a revoked link doesn't count, so reset can make the next one;
// - a token is unique and at least 32 characters;
// - account deletion (`anonymize_user` setting `users.deleted_at`) deletes the
//   member's links through `users_drop_calendar_feeds`, and nobody else's.
try {
  const CH = "c1c1c1c1-0000-4000-8000-000000003322";
  const U = {
    a: "c3c3c3c3-0000-4000-8000-00000000000a",
    b: "c3c3c3c3-0000-4000-8000-00000000000b",
  };
  const T = (c) => c.repeat(43);
  await db.exec(`
    insert into chapters (id, name, university) values ('${CH}', 'Feeds', 'U');
    insert into users (id, supabase_auth_id, email, display_name) values
      ('${U.a}', gen_random_uuid(), 'feeds-a@example.com', 'A'),
      ('${U.b}', gen_random_uuid(), 'feeds-b@example.com', 'B');
    insert into calendar_feeds (chapter_id, user_id, token) values
      ('${CH}', '${U.a}', '${T("a")}'),
      ('${CH}', '${U.b}', '${T("b")}');
  `);

  const rejects = async (sql) => {
    try {
      await db.exec(sql);
      return false;
    } catch {
      return true;
    }
  };
  const count = async (where) =>
    (
      await db.query(
        `select count(*)::int as n from calendar_feeds where ${where}`,
      )
    ).rows[0].n;
  const checks = [];

  checks.push([
    await rejects(
      `insert into calendar_feeds (chapter_id, user_id, token) values ('${CH}', '${U.a}', '${T("c")}');`,
    ),
    "a second live link for the same member and chapter is refused",
  ]);
  await db.exec(
    `update calendar_feeds set revoked_at = now() where user_id = '${U.a}';`,
  );
  checks.push([
    !(await rejects(
      `insert into calendar_feeds (chapter_id, user_id, token) values ('${CH}', '${U.a}', '${T("c")}');`,
    )),
    "a revoked link leaves room for the next one",
  ]);
  checks.push([
    await rejects(
      `insert into calendar_feeds (chapter_id, user_id, token) values ('${CH}', '${U.b}', 'short');`,
    ),
    "a token shorter than 32 characters is refused",
  ]);
  await db.exec(
    `update calendar_feeds set revoked_at = now() where user_id = '${U.b}';`,
  );
  checks.push([
    await rejects(
      `insert into calendar_feeds (chapter_id, user_id, token) values ('${CH}', '${U.b}', '${T("c")}');`,
    ),
    "a token is unique across links",
  ]);

  await db.query(`select public.anonymize_user($1)`, [U.a]);
  checks.push([
    (await count(`user_id = '${U.a}'`)) === 0 &&
      (await count(`user_id = '${U.b}'`)) === 1,
    "account deletion deletes the member's links and nobody else's",
  ]);

  console.log("\n=== Calendar subscription links (#3322) ===");
  for (const [ok, name] of checks) {
    if (ok) {
      console.log(`OK    ${name}`);
    } else {
      miss();
      console.log(`MISS  ${name} (#3322)`);
    }
  }

  await db.exec(`
    delete from chapters where id = '${CH}';
    delete from users where id in ('${U.a}', '${U.b}');
  `);
} catch (e) {
  miss();
  console.log(
    `MISS  calendar subscription links (#3322)\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
  );
}
