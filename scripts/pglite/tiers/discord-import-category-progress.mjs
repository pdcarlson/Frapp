import { db, miss } from "../harness.mjs";

// ─── Functional: an import's progress per Discord category ──────────────────
//
// `discord_import_category_progress` (20261106170000) adds up an import's
// mapping rows per Discord category for `GET :id/progress`. Proved against the
// real function:
//
//   - a thread counts under its parent row's category, not its own
//     `discord_category`, which the bot scan fills with the parent channel's
//     name;
//   - `done` is completed or skipped by the worker, `failed` is failed, and a
//     row mapped to skip is in no count;
//   - channels in no category come first, then categories by Discord
//     position, then a category with no position by where the import
//     reaches it;
//   - chapter scope: the wrong chapter id returns nothing;
//   - a signed-in client and the anon key may not call it.
//
// Everything runs inside one transaction and is rolled back.
console.log("\n=== Functional: an import's progress per Discord category ===");
{
  const A = "a7000000-0000-4000-8000-00000000000a";
  const B = "b7000000-0000-4000-8000-00000000000b";
  const IMPORT = "a7000000-0000-4000-8000-0000000000d1";
  const ELSEWHERE = "a7000000-0000-4000-8000-0000000000d2";

  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  const q = async (sql) => (await db.query(sql)).rows;

  try {
    await db.exec(`
      begin;
      insert into chapters (id, name, university) values ('${A}', 'A', 'U'), ('${B}', 'B', 'U');
      insert into discord_imports (id, chapter_id, status, consent_acknowledged_at) values
        ('${IMPORT}', '${A}', 'running', now()),
        ('${ELSEWHERE}', '${A}', 'completed', now());
      insert into discord_import_channels
        (import_id, discord_channel_id, discord_channel_name, discord_category,
         discord_category_position, parent_discord_channel_id, mapping_action,
         new_channel_name, status, position) values
        -- Committees, Discord position 4: a channel and two threads.
        ('${IMPORT}', 'c1', 'rush', 'Committees', 4, null, 'create_new', 'rush', 'completed', 3),
        ('${IMPORT}', 't1', 'rush › fall', 'rush', null, 'c1', 'create_new', 'rush', 'skipped', 4),
        ('${IMPORT}', 't2', 'rush › spring', 'rush', null, 'c1', 'create_new', 'rush', 'failed', 5),
        -- Notifications, Discord position 1, reached later.
        ('${IMPORT}', 'c2', 'alerts', 'Notifications', 1, null, 'create_new', 'alerts', 'running', 6),
        ('${IMPORT}', 't3', 'alerts › bot', 'alerts', null, 'c2', 'create_new', 'alerts', 'pending', 7),
        -- No category: comes first.
        ('${IMPORT}', 'c3', 'general', null, null, null, 'use_existing', null, 'pending', 8),
        -- A category with no position (an upload's shape): after the positioned ones.
        ('${IMPORT}', 'c4', 'misc', 'Other', null, null, 'create_new', 'misc', 'pending', 1),
        -- Mapped to skip, with its thread: in no count, and no line.
        ('${IMPORT}', 'c5', 'memes', 'Fun', 2, null, 'skip', null, 'skipped', 9),
        ('${IMPORT}', 't5', 'memes › old', 'memes', null, 'c5', 'skip', null, 'skipped', 10),
        -- Another import's row: not this import's progress.
        ('${ELSEWHERE}', 'c1', 'rush', 'Committees', 4, null, 'create_new', 'rush', 'completed', 0);
    `);

    const lines = await q(
      `select * from discord_import_category_progress('${IMPORT}', '${A}')`,
    );
    const expected = [
      { category: null, channels: 1, threads: 0, done: 0, failed: 0 },
      {
        category: "Notifications",
        channels: 1,
        threads: 1,
        done: 0,
        failed: 0,
      },
      { category: "Committees", channels: 1, threads: 2, done: 2, failed: 1 },
      { category: "Other", channels: 1, threads: 0, done: 0, failed: 0 },
    ];
    check(
      "one line per category: threads under their channel's category, skipped rows left out, in Discord's order",
      JSON.stringify(lines) === JSON.stringify(expected),
      { lines },
    );

    const wrongChapter = await q(
      `select * from discord_import_category_progress('${IMPORT}', '${B}')`,
    );
    check("the wrong chapter id returns nothing", wrongChapter.length === 0, {
      wrongChapter,
    });

    // As in the other Discord tiers: a forgotten revoke is checked against the
    // roles the harness has; hosted default privileges are not replayed.
    const guard = await q(`
      select has_function_privilege('authenticated', 'public.discord_import_category_progress(uuid, uuid)', 'execute') as authed,
             has_function_privilege('anon', 'public.discord_import_category_progress(uuid, uuid)', 'execute') as anon
    `);
    check(
      "neither a signed-in client nor the anon key may call it",
      guard[0]?.authed === false && guard[0]?.anon === false,
      guard[0],
    );
  } catch (e) {
    check(
      "category progress scenario ran",
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
