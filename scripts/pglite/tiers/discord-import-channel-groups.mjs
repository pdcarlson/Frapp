import { db, miss } from "../harness.mjs";

// ─── Functional: a deleted import takes the channel groups it made ──────────
//
// A Discord import can keep the server's categories as channel groups
// (20261105220000): `start` creates a `chat_channel_categories` row per
// category the chapter doesn't already have, records it in
// `discord_import_created_categories`, and the purge calls
// `delete_empty_discord_import_categories` after its channel step. Proved
// against the real function:
//
//   - a group this import created and left empty is deleted, and returned;
//   - a created group is kept while a channel sits in it, or while a mapping
//     row of an import that isn't being or hasn't been deleted still means to
//     put a channel there; a `purged` import's row pins nothing;
//   - a group a `purged` import created that this import put channels into is
//     re-reaped; one a finished import created, or one an officer made, is not
//     a candidate even when this import used it;
//   - chapter scope; an import that isn't `purging` deletes nothing, a
//     failed one waiting for a restart included;
//   - the mapping columns refuse a group on anything but a new channel, and a
//     blank name; deleting a group clears the rows that resolved to it;
//   - a signed-in client may not call either function, and the new table has
//     RLS on.
//
// The row lock that keeps an assignment landing mid-purge from losing its
// group needs two connections, which this harness doesn't have.
//
// Everything runs inside one transaction and is rolled back.
console.log("\n=== Functional: a deleted import takes the channel groups it made ===");
{
  const A = "a6000000-0000-4000-8000-00000000000a";
  const B = "b6000000-0000-4000-8000-00000000000b";
  const PURGING = "a6000000-0000-4000-8000-0000000000d1";
  const OTHER = "a6000000-0000-4000-8000-0000000000d2"; // completed
  const FAILED = "a6000000-0000-4000-8000-0000000000d5"; // remapped, waiting for a restart
  const RUNNING = "a6000000-0000-4000-8000-0000000000d3";
  const PURGED = "a6000000-0000-4000-8000-0000000000d4";
  const CHANNEL = "a6000000-0000-4000-8000-0000000000c1";
  const G = {
    EMPTY: "a6000000-0000-4000-8000-0000000000e1", // created here, empty: deleted
    HOLDS: "a6000000-0000-4000-8000-0000000000e2", // created here, holds a channel: kept
    PINNED: "a6000000-0000-4000-8000-0000000000e3", // created here, a running import's row means it: kept
    PINNED_BY_PURGED: "a6000000-0000-4000-8000-0000000000e4", // created here, only a purged import's row: deleted
    REREAP: "a6000000-0000-4000-8000-0000000000e5", // a purged import created it, this one used it: deleted
    OTHERS: "a6000000-0000-4000-8000-0000000000e6", // a finished import created it, this one used it: kept
    OFFICER: "a6000000-0000-4000-8000-0000000000e7", // an officer's group this one used: kept
    IN_B: "b6000000-0000-4000-8000-0000000000e1", // recorded here, but in another chapter: kept
    STALE: "a6000000-0000-4000-8000-0000000000f1", // the failed import made it, a remap dropped it: kept until it is purged
    STILL_MEANT: "a6000000-0000-4000-8000-0000000000f2", // the failed import made it, a row still points at it: kept
  };
  const DELETABLE = [G.EMPTY, G.PINNED_BY_PURGED, G.REREAP].sort();

  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  const q = async (sql) => (await db.query(sql)).rows;
  const ids = Object.values(G).map((id) => `'${id}'`).join(", ");
  const groupsLeft = async () =>
    (await q(`select id from chat_channel_categories where id in (${ids}) order by id`)).map((r) => r.id);
  const refused = async (sql) => {
    await db.exec("savepoint probe;");
    try {
      await db.exec(sql);
      await db.exec("rollback to savepoint probe;");
      return false;
    } catch {
      await db.exec("rollback to savepoint probe;");
      return true;
    }
  };

  try {
    await db.exec(`
      begin;
      insert into chapters (id, name, university) values ('${A}', 'A', 'U'), ('${B}', 'B', 'U');
      insert into discord_imports (id, chapter_id, status, consent_acknowledged_at) values
        ('${PURGING}', '${A}', 'purging', now()),
        ('${OTHER}', '${A}', 'completed', now()),
        ('${RUNNING}', '${A}', 'running', now()),
        ('${PURGED}', '${A}', 'purged', now()),
        ('${FAILED}', '${A}', 'failed', now());
      insert into chat_channel_categories (id, chapter_id, name, display_order) values
        ('${G.EMPTY}', '${A}', 'Generic', 1),
        ('${G.HOLDS}', '${A}', 'Secret', 2),
        ('${G.PINNED}', '${A}', 'Notifications', 3),
        ('${G.PINNED_BY_PURGED}', '${A}', 'Trees', 4),
        ('${G.REREAP}', '${A}', 'Committees', 5),
        ('${G.OTHERS}', '${A}', 'Officers', 6),
        ('${G.OFFICER}', '${A}', 'Social', 0),
        ('${G.IN_B}', '${B}', 'Generic', 1),
        ('${G.STALE}', '${A}', 'Pledges', 7),
        ('${G.STILL_MEANT}', '${A}', 'Alumni', 8);
      insert into chat_channels (id, chapter_id, name, type, category_id) values
        ('${CHANNEL}', '${A}', 'vault', 'PUBLIC', '${G.HOLDS}');
      insert into discord_import_created_categories (import_id, category_id) values
        ('${PURGING}', '${G.EMPTY}'), ('${PURGING}', '${G.HOLDS}'), ('${PURGING}', '${G.PINNED}'),
        ('${PURGING}', '${G.PINNED_BY_PURGED}'), ('${PURGING}', '${G.IN_B}'),
        ('${PURGED}', '${G.REREAP}'), ('${OTHER}', '${G.OTHERS}'),
        ('${FAILED}', '${G.STALE}'), ('${FAILED}', '${G.STILL_MEANT}');
      insert into discord_import_channels
        (import_id, discord_channel_id, discord_channel_name, mapping_action, new_channel_name,
         new_channel_group, new_channel_category_id) values
        ('${PURGING}', 'd1', 'general', 'create_new', 'general', 'Generic', '${G.EMPTY}'),
        ('${PURGING}', 'd2', 'vault', 'create_new', 'vault', 'Secret', '${G.HOLDS}'),
        ('${PURGING}', 'd3', 'committee', 'create_new', 'committee', 'Committees', '${G.REREAP}'),
        ('${PURGING}', 'd4', 'officers', 'create_new', 'officers', 'Officers', '${G.OTHERS}'),
        ('${PURGING}', 'd5', 'social', 'create_new', 'social', 'Social', '${G.OFFICER}'),
        ('${RUNNING}', 'f1', 'alerts', 'create_new', 'alerts', 'Notifications', '${G.PINNED}'),
        ('${PURGED}', 'g1', 'oak', 'create_new', 'oak', 'Trees', '${G.PINNED_BY_PURGED}'),
        ('${FAILED}', 'h1', 'alumni', 'create_new', 'alumni', 'Alumni', '${G.STILL_MEANT}'),
        -- Remapped with the category dropped: no group, so nothing points at Pledges.
        ('${FAILED}', 'h2', 'pledges', 'create_new', 'pledges', null, null);
    `);

    const wrongChapter = await q(`select * from delete_empty_discord_import_categories('${PURGING}', '${B}')`);
    const running = await q(`select * from delete_empty_discord_import_categories('${RUNNING}', '${A}')`);
    const finished = await q(`select * from delete_empty_discord_import_categories('${OTHER}', '${A}')`);
    const failed = await q(`select * from delete_empty_discord_import_categories('${FAILED}', '${A}')`);
    check(
      "the wrong chapter id, or a running, finished or failed import, deletes nothing",
      wrongChapter.length === 0 && running.length === 0 && finished.length === 0 && failed.length === 0 &&
        (await groupsLeft()).length === Object.keys(G).length,
      { wrongChapter, running, finished, failed },
    );

    const deleted = (await q(`select * from delete_empty_discord_import_categories('${PURGING}', '${A}') as id`))
      .map((r) => r.id)
      .sort();
    const left = await groupsLeft();
    check(
      "deletes exactly the empty groups this import made, and those a purged import made that it used, and returns them",
      JSON.stringify(deleted) === JSON.stringify(DELETABLE) && DELETABLE.every((id) => !left.includes(id)),
      { deleted, left },
    );
    check("keeps a created group a channel sits in", left.includes(G.HOLDS), { left });
    check(
      "keeps a created group a live import still means to put a channel in; a purged import's row pins nothing",
      left.includes(G.PINNED) && deleted.includes(G.PINNED_BY_PURGED),
      { left, deleted },
    );
    check(
      "keeps a group a finished import or an officer made, even when this import used it",
      left.includes(G.OTHERS) && left.includes(G.OFFICER),
      { left },
    );
    check("keeps another chapter's group", left.includes(G.IN_B), { left });

    const rows = await q(
      `select discord_channel_id, new_channel_group, new_channel_category_id from discord_import_channels
        where import_id = '${PURGING}' and discord_channel_id in ('d1', 'd3') order by 1`,
    );
    const records = await q(
      `select count(*)::int as n from discord_import_created_categories
        where category_id in (${DELETABLE.map((id) => `'${id}'`).join(", ")})`,
    );
    check(
      "the mapping rows keep their group name with the resolved group cleared, and the created-group records go",
      rows.length === 2 &&
        rows.every((r) => r.new_channel_category_id === null && r.new_channel_group !== null) &&
        records[0]?.n === 0,
      { rows, records },
    );
    const again = await q(`select * from delete_empty_discord_import_categories('${PURGING}', '${A}')`);
    check("a second call deletes nothing more", again.length === 0, { again });

    const groupOnMerge = await refused(`
      insert into discord_import_channels
        (import_id, discord_channel_id, discord_channel_name, mapping_action, target_channel_id, new_channel_group)
      values ('${RUNNING}', 'x1', 'merge', 'use_existing', '${CHANNEL}', 'Generic')`);
    const groupOnSkip = await refused(`
      insert into discord_import_channels
        (import_id, discord_channel_id, discord_channel_name, mapping_action, new_channel_category_id)
      values ('${RUNNING}', 'x2', 'skip', 'skip', '${G.OFFICER}')`);
    const blank = await refused(`
      insert into discord_import_channels
        (import_id, discord_channel_id, discord_channel_name, mapping_action, new_channel_name, new_channel_group)
      values ('${RUNNING}', 'x3', 'blank', 'create_new', 'blank', '   ')`);
    const tooLong = await refused(`
      insert into discord_import_channels
        (import_id, discord_channel_id, discord_channel_name, mapping_action, new_channel_name, new_channel_group)
      values ('${RUNNING}', 'x4', 'long', 'create_new', 'long', repeat('g', 101))`);
    check(
      "refuses a group on a merged or skipped channel, a blank group name, and one over 100 characters",
      groupOnMerge && groupOnSkip && blank && tooLong,
      { groupOnMerge, groupOnSkip, blank, tooLong },
    );

    await db.exec(`delete from chat_channel_categories where id = '${G.PINNED}';`);
    const unpinned = await q(
      `select new_channel_category_id from discord_import_channels
        where import_id = '${RUNNING}' and discord_channel_id = 'f1'`,
    );
    check(
      "an officer deleting a group clears the rows that resolved to it, so the channel lands with no group",
      unpinned.length === 1 && unpinned[0].new_channel_category_id === null,
      { unpinned },
    );

    // As in the channel tier: a forgotten revoke from anon or authenticated is
    // out of reach here, since hosted grants come through ALTER DEFAULT
    // PRIVILEGES, which is not replayed.
    const guard = await q(`
      select has_function_privilege('authenticated', 'public.delete_empty_discord_import_categories(uuid, uuid)', 'execute') as authed,
             has_function_privilege('authenticated', 'public.discord_import_category_holds_anything(uuid)', 'execute') as authed_check,
             has_function_privilege('anon', 'public.delete_empty_discord_import_categories(uuid, uuid)', 'execute') as anon,
             has_function_privilege('anon', 'public.discord_import_category_holds_anything(uuid)', 'execute') as anon_check,
             (select relrowsecurity from pg_class where oid = 'public.discord_import_created_categories'::regclass) as rls,
             (select count(*)::int from pg_indexes
               where indexname in ('idx_discord_import_channels_category', 'idx_chat_channels_category',
                                   'idx_discord_import_created_categories_category')) as indexes
    `);
    check(
      "neither a signed-in client nor the anon key may call either function, the created-group table has RLS on, and the indexes exist",
      guard[0]?.authed === false && guard[0]?.authed_check === false &&
        guard[0]?.anon === false && guard[0]?.anon_check === false &&
        guard[0]?.rls === true && guard[0]?.indexes === 3,
      guard[0],
    );
  } catch (e) {
    check("import channel groups scenario ran", false, String(e?.message ?? e).split("\n")[0]);
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
