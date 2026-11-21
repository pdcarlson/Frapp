import { db, miss } from "../harness.mjs";

// ─── Favorite GIFs (#5772) ──────────────────────────────────────────────────
//
// `gif_favorites` and its `anonymize_user` purge are reached from the API only
// through mocked repositories, so this is the one place their SQL runs. What
// each check pins, and the edit it catches:
// - a member stars a GIF once per provider;
// - the API's upsert target, `on conflict (user_id, provider, gif_id)`, names
//   a real unique constraint, so a repeat star is a no-op rather than a 42P10;
// - two members may star the same GIF;
// - account deletion deletes the member's favorites and nobody else's. The
//   users row is tombstoned, not deleted, so the foreign key's cascade never
//   fires: a later `anonymize_user` copied from an older migration would
//   silently drop the purge, and only this check would notice.
try {
  const U = {
    a: "c3c3c3c3-0000-4000-8000-00000000000a",
    b: "c3c3c3c3-0000-4000-8000-00000000000b",
  };
  await db.exec(`
    insert into users (id, supabase_auth_id, email, display_name) values
      ('${U.a}', gen_random_uuid(), 'gif-a@example.com', 'A'),
      ('${U.b}', gen_random_uuid(), 'gif-b@example.com', 'B');
  `);

  const star = (user, gif, provider = "klipy", conflict = "") =>
    db.exec(
      `insert into gif_favorites
         (user_id, provider, gif_id, title, full_url, full_width, full_height,
          preview_url, preview_width, preview_height)
       values ('${user}', '${provider}', '${gif}', '${gif}',
         'https://static.klipy.com/${gif}.gif', 200, 150,
         'https://static.klipy.com/${gif}.webp', 200, 150) ${conflict};`,
    );
  const rejects = async (run) => {
    try {
      await run();
      return false;
    } catch {
      return true;
    }
  };
  const count = async (where) =>
    (
      await db.query(
        `select count(*)::int as n from gif_favorites where ${where}`,
      )
    ).rows[0].n;
  const checks = [];

  await star(U.a, "dance");
  await star(U.a, "wave");
  await star(U.a, "dance", "tenor");
  await star(U.b, "dance");
  checks.push([
    (await count(`user_id = '${U.a}'`)) === 3 &&
      (await count(`user_id = '${U.b}'`)) === 1,
    "a member stars many GIFs, and two members the same one",
  ]);
  checks.push([
    await rejects(() => star(U.a, "dance")),
    "a member stars a GIF only once per provider",
  ]);
  checks.push([
    !(await rejects(() =>
      star(
        U.a,
        "dance",
        "klipy",
        "on conflict (user_id, provider, gif_id) do nothing",
      ),
    )) && (await count(`user_id = '${U.a}'`)) === 3,
    "a repeat star through the API's upsert target is a no-op",
  ]);

  await db.query(`select public.anonymize_user($1)`, [U.a]);
  checks.push([
    (await count(`user_id = '${U.a}'`)) === 0 &&
      (await count(`user_id = '${U.b}'`)) === 1,
    "account deletion deletes the member's favorites and nobody else's",
  ]);

  console.log("\n=== Favorite GIFs (#5772) ===");
  for (const [ok, name] of checks) {
    if (ok) {
      console.log(`OK    ${name}`);
    } else {
      miss();
      console.log(`MISS  ${name} (#5772)`);
    }
  }

  await db.exec(`delete from users where id in ('${U.a}', '${U.b}');`);
} catch (e) {
  miss();
  console.log(
    `MISS  favorite GIFs (#5772)\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
  );
}
