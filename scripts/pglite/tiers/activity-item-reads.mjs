import { db, miss } from "../harness.mjs";

// ─── Unread dots on Activity (#4173) ─────────────────────────────────────────
//
// `activity_item_reads` and the `anonymize_user` purge are reached from the
// API only through mocked repositories, so this is the one place their SQL
// runs. What each check pins, and the edit it catches:
// - only the five kinds the API sends are accepted;
// - the API's upsert target, `on conflict (user_id, chapter_id, kind,
//   item_id)`, names the primary key, so opening an item again moves its
//   `read_at` rather than failing with 42P10 (no matching constraint);
// - the same id under two kinds is two reads (a poll's message id is never a
//   task's id, but nothing relies on that);
// - account deletion deletes the member's reads and nobody else's.
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

  await db.query(`select public.anonymize_user($1)`, [U.a]);
  checks.push([
    (await count(`user_id = '${U.a}'`)) === 0 &&
      (await count(`user_id = '${U.b}'`)) === 1,
    "account deletion deletes the member's reads and nobody else's",
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
