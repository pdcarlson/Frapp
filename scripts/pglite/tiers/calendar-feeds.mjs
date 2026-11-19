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
// - a link is looked up by `token_hash` (sha256 hex, unique), filled for a
//   plaintext insert by `calendar_feeds_fill_token_hash` while an older API
//   still serves (20261119182553);
// - a link keeps exactly one way to show it again: the legacy plaintext or
//   the sealed copy (`calendar_feeds_one_token_form`);
// - account deletion (`anonymize_user` setting `users.deleted_at`) deletes the
//   member's links through `users_drop_calendar_feeds`, and nobody else's.
try {
  const CH = "c1c1c1c1-0000-4000-8000-000000003322";
  const U = {
    a: "c3c3c3c3-0000-4000-8000-00000000000a",
    b: "c3c3c3c3-0000-4000-8000-00000000000b",
  };
  const T = (c) => c.repeat(43);
  const H = (c) => c.repeat(64);
  const sha = async (token) =>
    (
      await db.query(
        `select encode(sha256(convert_to($1, 'UTF8')), 'hex') as h`,
        [token],
      )
    ).rows[0].h;
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

  const legacy = (
    await db.query(
      `select token_hash from calendar_feeds where user_id = '${U.a}'`,
    )
  ).rows[0];
  checks.push([
    legacy?.token_hash === (await sha(T("a"))),
    "a plaintext insert gets the sha256 of its token as its hash",
  ]);
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
      `insert into calendar_feeds (chapter_id, user_id, token_hash, token_sealed) values ('${CH}', '${U.a}', '${H("c")}', 'v1.k1.sealed');`,
    )),
    "a revoked link leaves room for the next one, stored hashed and sealed",
  ]);
  await db.exec(
    `update calendar_feeds set revoked_at = now() where user_id = '${U.a}';`,
  );
  checks.push([
    await rejects(
      `insert into calendar_feeds (chapter_id, user_id, token_hash, token_sealed) values ('${CH}', '${U.a}', '${H("c")}', 'v1.k1.other');`,
    ),
    "a token hash is unique across links",
  ]);
  checks.push([
    await rejects(
      `insert into calendar_feeds (chapter_id, user_id, token_hash, token_sealed) values ('${CH}', '${U.a}', 'not-a-hash', 'v1.k1.sealed');`,
    ),
    "a token hash that isn't 64 hex characters is refused",
  ]);
  checks.push([
    await rejects(
      `insert into calendar_feeds (chapter_id, user_id, token_hash) values ('${CH}', '${U.a}', '${H("d")}');`,
    ),
    "a link with neither its plaintext nor its sealed copy is refused",
  ]);
  checks.push([
    await rejects(
      `insert into calendar_feeds (chapter_id, user_id, token, token_hash, token_sealed) values ('${CH}', '${U.a}', '${T("d")}', '${H("d")}', 'v1.k1.sealed');`,
    ),
    "a link with both its plaintext and its sealed copy is refused",
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
      `insert into calendar_feeds (chapter_id, user_id, token) values ('${CH}', '${U.b}', '${T("a")}');`,
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
