import { db, miss } from "../harness.mjs";

// ─── Google Calendar connections (#3322, step 2) ────────────────────────────
//
// `google_calendar_connections` is reached from the API only through mocked
// repositories, so this is the one place its constraints, its claim function
// and its triggers run. What each check pins, and the edit it catches:
// - one live connection per member per chapter, while a disconnecting one
//   doesn't count, so a member can connect again at once;
// - `claim_google_calendar_syncs` hands out only due, unleased connections
//   (and disconnecting ones), leases them, and pushes an active one's next
//   sync out fifteen minutes; a second claim gets nothing;
// - a write to `events` or `tasks` makes that chapter's active connections due
//   now, and no other chapter's;
// - account deletion turns the member's connections `disconnecting` (so the
//   API cleans up at Google) and drops their sign-ins in flight.
try {
  const CH = "c1c1c1c1-0000-4000-8000-000000004322";
  const OTHER = "c1c1c1c1-0000-4000-8000-000000004323";
  const U = {
    a: "c3c3c3c3-0000-4000-8000-00000000004a",
    b: "c3c3c3c3-0000-4000-8000-00000000004b",
  };
  await db.exec(`
    insert into chapters (id, name, university) values
      ('${CH}', 'Google', 'U'),
      ('${OTHER}', 'Elsewhere', 'U');
    insert into users (id, supabase_auth_id, email, display_name) values
      ('${U.a}', gen_random_uuid(), 'gcal-a@example.com', 'A'),
      ('${U.b}', gen_random_uuid(), 'gcal-b@example.com', 'B');
    insert into google_calendar_connections
      (chapter_id, user_id, refresh_token_sealed, sync_due_at) values
      ('${CH}', '${U.a}', 'sealed-a', now() - interval '1 minute'),
      ('${CH}', '${U.b}', 'sealed-b', now() + interval '10 minutes'),
      ('${OTHER}', '${U.a}', 'sealed-c', now() + interval '10 minutes');
    insert into google_calendar_oauth_states
      (chapter_id, user_id, return_to, expires_at) values
      ('${CH}', '${U.a}', 'frapp://google-calendar', now() + interval '10 minutes');
  `);

  const rejects = async (sql) => {
    try {
      await db.exec(sql);
      return false;
    } catch {
      return true;
    }
  };
  const one = async (sql) => (await db.query(sql)).rows[0];
  const checks = [];

  checks.push([
    await rejects(
      `insert into google_calendar_connections (chapter_id, user_id, refresh_token_sealed) values ('${CH}', '${U.a}', 'again');`,
    ),
    "a second live connection for the same member and chapter is refused",
  ]);
  checks.push([
    await rejects(
      `update google_calendar_connections set status = 'paused' where user_id = '${U.a}';`,
    ),
    "a status outside the three is refused",
  ]);

  const claimed = (
    await db.query(
      `select id, user_id, chapter_id, sync_lease_until > now() as leased,
              sync_due_at > now() + interval '14 minutes' as pushed_out
         from claim_google_calendar_syncs(now(), 10, 600)`,
    )
  ).rows;
  checks.push([
    claimed.length === 1 &&
      claimed[0].user_id === U.a &&
      claimed[0].chapter_id === CH &&
      claimed[0].leased &&
      claimed[0].pushed_out,
    "the claim takes only the due connection, leases it and moves its next sync fifteen minutes out",
  ]);
  checks.push([
    (
      await db.query(`select * from claim_google_calendar_syncs(now(), 10, 600)`)
    ).rows.length === 0,
    "a claimed connection is not handed out again while leased",
  ]);

  await db.exec(`
    update google_calendar_connections set sync_lease_until = null;
    insert into events (chapter_id, name, start_time, end_time)
      values ('${CH}', 'Meeting', now() + interval '1 day', now() + interval '1 day 1 hour');
  `);
  const due = await one(`
    select count(*) filter (where chapter_id = '${CH}' and sync_due_at <= now())::int as here,
           count(*) filter (where chapter_id = '${OTHER}' and sync_due_at <= now())::int as there
      from google_calendar_connections
  `);
  checks.push([
    due.here === 2 && due.there === 0,
    "an event written makes that chapter's connections due, and no other chapter's",
  ]);

  await db.exec(`
    update google_calendar_connections set sync_due_at = now() + interval '10 minutes';
    insert into tasks (chapter_id, title, assignee_id, created_by, due_date)
      values ('${OTHER}', 'Dues', '${U.a}', '${U.a}', current_date + 7);
  `);
  const afterTask = await one(`
    select count(*) filter (where chapter_id = '${OTHER}' and sync_due_at <= now())::int as there,
           count(*) filter (where chapter_id = '${CH}' and sync_due_at <= now())::int as here
      from google_calendar_connections
  `);
  checks.push([
    afterTask.there === 1 && afterTask.here === 0,
    "a task written makes its chapter's connections due",
  ]);

  await db.query(`select public.anonymize_user($1)`, [U.a]);
  const deleted = await one(`
    select count(*) filter (where user_id = '${U.a}' and status = 'disconnecting')::int as a_disconnecting,
           count(*) filter (where user_id = '${U.b}' and status = 'active')::int as b_active,
           (select count(*)::int from google_calendar_oauth_states where user_id = '${U.a}') as a_states
      from google_calendar_connections
  `);
  checks.push([
    deleted.a_disconnecting === 2 && deleted.b_active === 1 && deleted.a_states === 0,
    "account deletion leaves the member's connections to be cleaned up at Google, and drops their sign-ins",
  ]);
  checks.push([
    !(await rejects(
      `insert into google_calendar_connections (chapter_id, user_id, refresh_token_sealed) values ('${CH}', '${U.a}', 'new');`,
    )),
    "a disconnecting connection leaves room to connect again",
  ]);
  checks.push([
    (
      await db.query(`select * from claim_google_calendar_syncs(now(), 10, 600) where status = 'disconnecting'`)
    ).rows.length === 2,
    "the claim hands out connections waiting to be cleaned up",
  ]);

  console.log("\n=== Google Calendar connections (#3322) ===");
  for (const [ok, name] of checks) {
    if (ok) {
      console.log(`OK    ${name}`);
    } else {
      miss();
      console.log(`MISS  ${name} (#3322)`);
    }
  }

  await db.exec(`
    delete from chapters where id in ('${CH}', '${OTHER}');
    delete from users where id in ('${U.a}', '${U.b}');
  `);
} catch (e) {
  miss();
  console.log(
    `MISS  Google Calendar connections (#3322)\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
  );
}
