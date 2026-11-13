import { db, miss } from "../harness.mjs";

// ─── Unread dots on Activity (#4173) ─────────────────────────────────────────
//
// `activity_item_reads`, `activity_unread_starts`, `tasks.sent_back_at` and
// the `anonymize_user` purge are reached from the
// API only through mocked repositories, so this is the one place their SQL
// runs. What each check pins, and the edit it catches:
// - only the kinds the API sends are accepted, sign-ups and forms included
//   (#3926, 20261113062008);
// - the API's upsert target, `on conflict (user_id, chapter_id, kind,
//   item_id)`, names the primary key, so opening an item again moves its
//   `read_at` rather than failing with 42P10 (no matching constraint);
// - the same id under two kinds is two reads (a poll's message id is never a
//   task's id, but nothing relies on that);
// - a member's dots begin once: the API's insert, `on conflict (user_id,
//   chapter_id) do nothing`, names the primary key and never moves a start;
// - a task records when it was sent back;
// - account deletion deletes the member's reads and start, and nobody else's.
try {
  const CH = "b1b1b1b1-0000-4000-8000-000000004173";
  const U = {
    a: "b3b3b3b3-0000-4000-8000-00000000417a",
    b: "b3b3b3b3-0000-4000-8000-00000000417b",
  };
  const ITEM = "b6b6b6b6-0000-4000-8000-000000004173";
  await db.exec(`
    insert into chapters (id, name, university) values ('${CH}', 'Reads', 'U');
    insert into users (id, supabase_auth_id, email, display_name) values
      ('${U.a}', gen_random_uuid(), 'reads-a@example.com', 'A'),
      ('${U.b}', gen_random_uuid(), 'reads-b@example.com', 'B');
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
        `select count(*)::int as n from activity_item_reads where ${where}`,
      )
    ).rows[0].n;
  // What `SupabaseActivityItemReadRepository.markRead` sends.
  const markRead = (user, kind, at) =>
    db.exec(
      `insert into activity_item_reads (user_id, chapter_id, kind, item_id, read_at)
       values ('${user}', '${CH}', '${kind}', '${ITEM}', '${at}')
       on conflict (user_id, chapter_id, kind, item_id)
       do update set read_at = excluded.read_at;`,
    );
  const checks = [];

  checks.push([
    await rejects(
      `insert into activity_item_reads (user_id, chapter_id, kind, item_id)
       values ('${U.a}', '${CH}', 'file', '${ITEM}');`,
    ),
    "a kind the API never sends is refused",
  ]);

  await markRead(U.a, "task", "2026-11-11T10:00:00Z");
  await markRead(U.a, "task", "2026-11-11T12:00:00Z");
  const readAt = (
    await db.query(
      `select read_at from activity_item_reads where user_id = $1 and kind = 'task'`,
      [U.a],
    )
  ).rows.map((row) => new Date(row.read_at).toISOString());
  checks.push([
    readAt.length === 1 && readAt[0] === "2026-11-11T12:00:00.000Z",
    "opening an item again through the API's upsert target moves its read time",
  ]);

  await markRead(U.a, "poll", "2026-11-11T12:00:00Z");
  await markRead(U.b, "task", "2026-11-11T12:00:00Z");
  checks.push([
    (await count(`user_id = '${U.a}'`)) === 2,
    "the same id under two kinds is two reads",
  ]);

  // Sign-up and form cards (#3926): a dropped kind would fail the insert.
  const cardKinds = [];
  for (const kind of ["signup", "form"]) {
    cardKinds.push(
      !(await rejects(
        `insert into activity_item_reads (user_id, chapter_id, kind, item_id)
         values ('${U.b}', '${CH}', '${kind}', '${ITEM}');`,
      )),
    );
  }
  checks.push([
    cardKinds.every(Boolean),
    "a sign-up or form card's read is accepted",
  ]);
  // Taken back out, so the checks below count only what they set up.
  await db.exec(
    `delete from activity_item_reads where kind in ('signup', 'form');`,
  );

  // What `SupabaseActivityItemReadRepository.startUnread` sends.
  const start = (user, at) =>
    db.exec(
      `insert into activity_unread_starts (user_id, chapter_id, started_at)
       values ('${user}', '${CH}', '${at}')
       on conflict (user_id, chapter_id) do nothing;`,
    );
  await start(U.a, "2026-11-12T08:00:00Z");
  await start(U.a, "2026-11-13T08:00:00Z");
  await start(U.b, "2026-11-12T08:00:00Z");
  const startedAt = (
    await db.query(
      `select started_at from activity_unread_starts where user_id = $1`,
      [U.a],
    )
  ).rows.map((row) => new Date(row.started_at).toISOString());
  checks.push([
    startedAt.length === 1 && startedAt[0] === "2026-11-12T08:00:00.000Z",
    "a member's dots begin once, through the API's insert, and never move",
  ]);

  const sentBack = (
    await db.query(
      `select count(*)::int as n from information_schema.columns
        where table_name = 'tasks' and column_name = 'sent_back_at'`,
    )
  ).rows[0].n;
  checks.push([sentBack === 1, "a task records when it was sent back"]);

  await db.query(`select public.anonymize_user($1)`, [U.a]);
  const starts = async (user) =>
    (
      await db.query(
        `select count(*)::int as n from activity_unread_starts where user_id = $1`,
        [user],
      )
    ).rows[0].n;
  checks.push([
    (await count(`user_id = '${U.a}'`)) === 0 &&
      (await count(`user_id = '${U.b}'`)) === 1 &&
      (await starts(U.a)) === 0 &&
      (await starts(U.b)) === 1,
    "account deletion deletes the member's reads and start, and nobody else's",
  ]);

  console.log("\n=== Unread dots on Activity (#4173) ===");
  for (const [ok, name] of checks) {
    if (ok) {
      console.log(`OK    ${name}`);
    } else {
      miss();
      console.log(`MISS  ${name} (#4173)`);
    }
  }

  await db.exec(`
    delete from chapters where id = '${CH}';
    delete from users where id in ('${U.a}', '${U.b}');
  `);
} catch (e) {
  miss();
  console.log(
    `MISS  unread dots on Activity (#4173)\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
  );
}
