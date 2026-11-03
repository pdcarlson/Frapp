import { db, miss } from "../harness.mjs";

// ─── Functional: a channel an import merged into can be deleted (#2922) ─────
//
// `discord_import_channels.target_channel_id` is `on delete set null`, but
// `discord_import_channels_target_present` required a target on every
// `use_existing` row, so deleting any channel an import had merged into failed
// the CHECK and rolled back (`DELETE /v1/channels/:id` answered 500). Proved
// against the real schema:
//
//   - an officer's delete of a channel two imports merged into (one finished,
//     one still running) succeeds, and both mapping rows keep their record
//     with the target cleared;
//   - `discord_import_channels_new_name_present` still refuses a `create_new`
//     row with no name, and the old constraint is gone;
//   - the database accepts a `use_existing` row with no target: the mapping
//     routes and `start` refuse one, and the worker stops on one.
//
// Everything runs inside one transaction and is rolled back.
console.log("\n=== Functional: a channel an import merged into can be deleted (#2922) ===");
{
  const A = "a2922000-0000-4000-8000-00000000000a";
  const GENERAL = "a2922000-0000-4000-8000-0000000000c1";
  const DONE = "a2922000-0000-4000-8000-0000000000d1";
  const LIVE = "a2922000-0000-4000-8000-0000000000d2";

  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  const q = async (sql) => (await db.query(sql)).rows;
  // Postgres aborts the transaction on an error, so each refusal runs under
  // its own savepoint and is rolled back to it.
  const refused = async (sql) => {
    await db.exec("savepoint p2922;");
    try {
      await db.exec(sql);
      return null;
    } catch (e) {
      return String(e?.message ?? e);
    } finally {
      await db.exec("rollback to savepoint p2922;");
    }
  };

  try {
    await db.exec(`
      begin;
      insert into chapters (id, name, university) values ('${A}', 'A', 'U');
      insert into chat_channels (id, chapter_id, name, type) values ('${GENERAL}', '${A}', 'general', 'PUBLIC');
      insert into discord_imports (id, chapter_id, status, consent_acknowledged_at) values
        ('${DONE}', '${A}', 'completed', now()),
        ('${LIVE}', '${A}', 'running', now());
      insert into discord_import_channels
        (import_id, discord_channel_id, discord_channel_name, mapping_action, target_channel_id) values
        ('${DONE}', 'x1', 'general', 'use_existing', '${GENERAL}'),
        ('${LIVE}', 'y1', 'general', 'use_existing', '${GENERAL}');
    `);

    const deleteError = await refused(`delete from chat_channels where id = '${GENERAL}';`);
    check("an officer's delete of a channel two imports merged into succeeds", deleteError === null, { deleteError });

    await db.exec(`delete from chat_channels where id = '${GENERAL}';`);
    const rows = await q(
      `select import_id, mapping_action, target_channel_id from discord_import_channels
        where import_id in ('${DONE}', '${LIVE}') order by import_id`,
    );
    check(
      "both mapping rows keep their record, still merges, with the target cleared",
      rows.length === 2 && rows.every((r) => r.mapping_action === "use_existing" && r.target_channel_id === null),
      { rows },
    );

    const unnamed = await refused(`
      insert into discord_import_channels (import_id, discord_channel_id, discord_channel_name, mapping_action)
      values ('${DONE}', 'x2', 'rush', 'create_new');
    `);
    const untargeted = await refused(`
      insert into discord_import_channels (import_id, discord_channel_id, discord_channel_name, mapping_action)
      values ('${DONE}', 'x3', 'rush', 'use_existing');
    `);
    const constraints = await q(`
      select conname from pg_constraint
       where conrelid = 'public.discord_import_channels'::regclass
         and conname in ('discord_import_channels_target_present', 'discord_import_channels_new_name_present')
    `);
    check(
      "a create_new row still needs its name, a use_existing row may have no target, and the old CHECK is gone",
      /discord_import_channels_new_name_present/.test(unnamed ?? "") &&
        untargeted === null &&
        constraints.length === 1 &&
        constraints[0].conname === "discord_import_channels_new_name_present",
      { unnamed, untargeted, constraints },
    );
  } catch (e) {
    check("merged-into channel delete scenario ran", false, String(e?.message ?? e).split("\n")[0]);
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
