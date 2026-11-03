import { db, miss } from "../harness.mjs";

// ─── Functional: a deleted import takes its emptied channels (#2905) ─────────
//
// The purge deletes an import's messages, then calls
// `delete_empty_discord_import_channels` for the channels the import created.
// Before #2905 each one it left behind met a re-import of the same server as a
// name clash, or as a duplicate when hidden from the admin. Proved against the
// real function:
//
//   - a channel the import created and left empty is deleted, whether it is
//     recorded in `discord_import_created_channels` or, for an import from
//     before that table, named by a `create_new` row (once, even when a
//     thread's row shares it); a recorded channel no mapping row names any
//     more, as after remapping a failed import, is deleted too;
//   - a created channel is kept while it holds a live message, a deleted
//     one, another import's messages, or a points-ledger link;
//   - a created channel another import merged into is kept while that
//     import isn't deleted, a finished one included; a merge by a `purging`
//     or `purged` import, this one included, pins nothing (#2922);
//   - a channel this import merged into is a candidate only when a
//     `purging` or `purged` import recorded creating it, which re-reaps what
//     that import's purge had to keep (#2922; `purging` too, since a purge
//     writes `purged` only after its channel step, and two can run at once);
//   - a `create_new` row naming a channel older than the import, or one
//     without the worker's "Imported from Discord #…" description (an upload
//     mapped before #2859), doesn't make it a candidate;
//   - another import's `create_new` row doesn't pin a channel; only a
//     `use_existing` one does;
//   - chapter scope: a row pointing into another chapter deletes nothing
//     there, and the wrong chapter id deletes nothing at all;
//   - an import that isn't `purging` loses nothing;
//   - a signed-in client may not call it, and the new table has RLS on.
//
// The row lock that keeps a send landing mid-purge from being cascaded away
// needs two connections, which this harness doesn't have; the PR for #2905
// records the two-session proof against the local stack.
//
// Everything runs inside one transaction and is rolled back.
console.log("\n=== Functional: a deleted import takes its emptied channels (#2905) ===");
{
  const A = "a2905000-0000-4000-8000-00000000000a";
  const B = "b2905000-0000-4000-8000-00000000000b";
  const U = "a2905000-0000-4000-8000-000000000001";
  const PURGING = "a2905000-0000-4000-8000-0000000000d1";
  const OTHER = "a2905000-0000-4000-8000-0000000000d2";
  const RUNNING = "a2905000-0000-4000-8000-0000000000d3";
  const PURGED = "a2905000-0000-4000-8000-0000000000d4";
  const OTHER_PURGING = "a2905000-0000-4000-8000-0000000000d5";
  const CH = {
    EMPTY: "a2905000-0000-4000-8000-0000000000c1", // recorded and mapped: deleted
    THREADED: "a2905000-0000-4000-8000-0000000000c2", // mapped only, two rows: deleted once
    ORPHAN: "a2905000-0000-4000-8000-0000000000c3", // recorded only (remapped): deleted
    LIVE: "a2905000-0000-4000-8000-0000000000c4",
    DELETED_MSG: "a2905000-0000-4000-8000-0000000000c5",
    OTHER_MSGS: "a2905000-0000-4000-8000-0000000000c6",
    POINTS: "a2905000-0000-4000-8000-0000000000c7",
    MERGED_INTO: "a2905000-0000-4000-8000-0000000000c8",
    EXISTING: "a2905000-0000-4000-8000-0000000000c9",
    LEGACY: "a2905000-0000-4000-8000-0000000000ca",
    LEGACY_NEWER: "a2905000-0000-4000-8000-0000000000cc",
    RUNNING_CH: "a2905000-0000-4000-8000-0000000000cb",
    IN_B: "b2905000-0000-4000-8000-0000000000c1",
    // #2922: merges by deleted imports, and the re-reap.
    SELF_MERGED: "a2905000-0000-4000-8000-0000000000e1", // created here, merged into by this import: deleted
    MERGED_BY_PURGED: "a2905000-0000-4000-8000-0000000000e2", // created here, merged into by a purged import: deleted
    MERGED_BY_PURGING: "a2905000-0000-4000-8000-0000000000e3", // created here, merged into by another purging import: deleted
    REREAP: "a2905000-0000-4000-8000-0000000000e4", // a purged import created it, this one merged into it: deleted
    REREAP_PINNED: "a2905000-0000-4000-8000-0000000000e5", // as REREAP, but a running import merges into it too: kept
    REREAP_PURGING: "a2905000-0000-4000-8000-0000000000e7", // an import still purging created it, this one merged into it: deleted
    OTHERS_CREATED: "a2905000-0000-4000-8000-0000000000e6", // a completed import created it, this one merged into it: kept
  };
  const DELETABLE = [
    CH.EMPTY,
    CH.THREADED,
    CH.ORPHAN,
    CH.SELF_MERGED,
    CH.MERGED_BY_PURGED,
    CH.MERGED_BY_PURGING,
    CH.REREAP,
    CH.REREAP_PURGING,
  ].sort();

  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  const q = async (sql) => (await db.query(sql)).rows;
  const ids = Object.values(CH).map((id) => `'${id}'`).join(", ");
  const channelsLeft = async () =>
    (await q(`select id from chat_channels where id in (${ids}) order by id`)).map((r) => r.id);

  try {
    await db.exec(`
      begin;
      insert into chapters (id, name, university) values ('${A}', 'A', 'U'), ('${B}', 'B', 'U');
      insert into users (id, supabase_auth_id, email) values ('${U}', gen_random_uuid(), 'u@2905.test');
      insert into discord_imports (id, chapter_id, status, consent_acknowledged_at) values
        ('${PURGING}', '${A}', 'purging', now()),
        ('${OTHER}', '${A}', 'completed', now()),
        ('${RUNNING}', '${A}', 'running', now()),
        ('${PURGED}', '${A}', 'purged', now()),
        ('${OTHER_PURGING}', '${A}', 'purging', now());
      insert into chat_channels (id, chapter_id, name, type) values
        ('${CH.EMPTY}', '${A}', 'rush', 'PUBLIC'),
        ('${CH.ORPHAN}', '${A}', 'exec', 'PUBLIC'),
        ('${CH.LIVE}', '${A}', 'general', 'PUBLIC'),
        ('${CH.DELETED_MSG}', '${A}', 'memes', 'PUBLIC'),
        ('${CH.OTHER_MSGS}', '${A}', 'archive', 'PUBLIC'),
        ('${CH.POINTS}', '${A}', 'service', 'PUBLIC'),
        ('${CH.MERGED_INTO}', '${A}', 'social', 'PUBLIC'),
        ('${CH.EXISTING}', '${A}', 'announcements', 'PUBLIC'),
        ('${CH.RUNNING_CH}', '${A}', 'sports', 'PUBLIC'),
        ('${CH.IN_B}', '${B}', 'rush', 'PUBLIC'),
        ('${CH.SELF_MERGED}', '${A}', 'pledges', 'PUBLIC'),
        ('${CH.MERGED_BY_PURGED}', '${A}', 'alumni', 'PUBLIC'),
        ('${CH.MERGED_BY_PURGING}', '${A}', 'treasury', 'PUBLIC'),
        ('${CH.REREAP}', '${A}', 'philanthropy', 'PUBLIC'),
        ('${CH.REREAP_PINNED}', '${A}', 'brotherhood', 'PUBLIC'),
        ('${CH.OTHERS_CREATED}', '${A}', 'chapter', 'PUBLIC'),
        ('${CH.REREAP_PURGING}', '${A}', 'recruitment', 'PUBLIC');
      -- Named only by mapping rows, as for an import from before the created-
      -- channel record: the worker's description is what marks it as made.
      insert into chat_channels (id, chapter_id, name, type, description) values
        ('${CH.THREADED}', '${A}', 'formal', 'PUBLIC', 'Imported from Discord #formal');
      -- An officer's channel from before the import, and one made after the
      -- import row but not by the worker; a pre-#2859 upload row names both.
      insert into chat_channels (id, chapter_id, name, type, description, created_at) values
        ('${CH.LEGACY}', '${A}', 'intramurals', 'PUBLIC', 'Imported from Discord #intramurals', now() - interval '1 day');
      insert into chat_channels (id, chapter_id, name, type, description) values
        ('${CH.LEGACY_NEWER}', '${A}', 'pickup', 'PUBLIC', 'Pickup games');
      insert into discord_import_created_channels (import_id, channel_id) values
        ('${PURGING}', '${CH.EMPTY}'), ('${PURGING}', '${CH.ORPHAN}'), ('${PURGING}', '${CH.LIVE}'),
        ('${PURGING}', '${CH.DELETED_MSG}'), ('${PURGING}', '${CH.OTHER_MSGS}'), ('${PURGING}', '${CH.POINTS}'),
        ('${PURGING}', '${CH.MERGED_INTO}'), ('${PURGING}', '${CH.IN_B}'), ('${RUNNING}', '${CH.RUNNING_CH}'),
        ('${PURGING}', '${CH.SELF_MERGED}'), ('${PURGING}', '${CH.MERGED_BY_PURGED}'), ('${PURGING}', '${CH.MERGED_BY_PURGING}'),
        ('${PURGED}', '${CH.REREAP}'), ('${PURGED}', '${CH.REREAP_PINNED}'), ('${OTHER}', '${CH.OTHERS_CREATED}'),
        ('${OTHER_PURGING}', '${CH.REREAP_PURGING}');
      insert into discord_import_channels
        (import_id, discord_channel_id, discord_channel_name, mapping_action, new_channel_name, target_channel_id) values
        ('${PURGING}', 'd1', 'rush', 'create_new', 'rush', '${CH.EMPTY}'),
        ('${PURGING}', 'd2', 'formal', 'create_new', 'formal', '${CH.THREADED}'),
        ('${PURGING}', 'd2-thread', 'formal-thread', 'create_new', 'formal', '${CH.THREADED}'),
        ('${PURGING}', 'd6', 'announcements', 'use_existing', null, '${CH.EXISTING}'),
        ('${PURGING}', 'd7', 'intramurals', 'create_new', 'intramurals', '${CH.LEGACY}'),
        ('${PURGING}', 'd9', 'pickup', 'create_new', 'pickup', '${CH.LEGACY_NEWER}'),
        ('${PURGING}', 'd8', 'rush', 'create_new', 'rush', '${CH.IN_B}'),
        ('${OTHER}', 'e5', 'social', 'use_existing', null, '${CH.MERGED_INTO}'),
        -- A leftover create_new row of another import on a channel this one
        -- made: it holds nothing there, so it pins nothing.
        ('${OTHER}', 'e1', 'rush', 'create_new', 'rush', '${CH.EMPTY}'),
        ('${RUNNING}', 'f1', 'sports', 'create_new', 'sports', '${CH.RUNNING_CH}'),
        -- #2922: a failed import remapped through the API can merge into a
        -- channel its own first run created.
        ('${PURGING}', 'd10', 'pledges', 'use_existing', null, '${CH.SELF_MERGED}'),
        ('${PURGED}', 'g1', 'alumni', 'use_existing', null, '${CH.MERGED_BY_PURGED}'),
        ('${OTHER_PURGING}', 'h1', 'treasury', 'use_existing', null, '${CH.MERGED_BY_PURGING}'),
        -- Merges into channels other imports created.
        ('${PURGING}', 'd11', 'philanthropy', 'use_existing', null, '${CH.REREAP}'),
        ('${PURGING}', 'd13', 'brotherhood', 'use_existing', null, '${CH.REREAP_PINNED}'),
        ('${RUNNING}', 'f2', 'brotherhood', 'use_existing', null, '${CH.REREAP_PINNED}'),
        ('${PURGING}', 'd12', 'chapter', 'use_existing', null, '${CH.OTHERS_CREATED}'),
        ('${PURGING}', 'd14', 'recruitment', 'use_existing', null, '${CH.REREAP_PURGING}');
      -- What the purge leaves behind: a member's live message, a deleted one,
      -- another import's history, and a chat points adjustment whose card
      -- never posted.
      insert into chat_messages (channel_id, sender_id, content) values
        ('${CH.LIVE}', '${U}', 'posted after the import'),
        ('${CH.DELETED_MSG}', '${U}', '[message deleted]');
      update chat_messages set deleted_at = now() where channel_id = '${CH.DELETED_MSG}';
      insert into chat_messages (channel_id, content, kind, author_name, external_message_id, metadata) values
        ('${CH.OTHER_MSGS}', 'from the other import', 'imported', 'Pinstripe', '905', '{"discord_import_id":"${OTHER}"}');
      insert into point_transactions (chapter_id, user_id, amount, category, channel_id, client_message_id) values
        ('${A}', '${U}', 5, 'MANUAL', '${CH.POINTS}', 'client-2905');
    `);

    const wrongChapter = await q(`select * from delete_empty_discord_import_channels('${PURGING}', '${B}')`);
    const notPurging = await q(`select * from delete_empty_discord_import_channels('${RUNNING}', '${A}')`);
    check(
      "the wrong chapter id, or an import that isn't purging, deletes nothing",
      wrongChapter.length === 0 && notPurging.length === 0 && (await channelsLeft()).length === Object.keys(CH).length,
      { wrongChapter, notPurging },
    );

    const deleted = (await q(`select * from delete_empty_discord_import_channels('${PURGING}', '${A}') as id`))
      .map((r) => r.id)
      .sort();
    const left = await channelsLeft();
    check(
      "deletes exactly the created channels left empty, recorded or mapped, once each, and returns them",
      JSON.stringify(deleted) === JSON.stringify(DELETABLE) && DELETABLE.every((id) => !left.includes(id)),
      { deleted, left },
    );
    check(
      "keeps a created channel holding a live message, a deleted one, or another import's messages",
      left.includes(CH.LIVE) && left.includes(CH.DELETED_MSG) && left.includes(CH.OTHER_MSGS),
      { left },
    );
    check("keeps a created channel a points-ledger row points at", left.includes(CH.POINTS), { left });
    check(
      "keeps a created channel an import that isn't deleted merged into, a finished one included, and a channel it merged into that no deleted import created",
      left.includes(CH.MERGED_INTO) && left.includes(CH.EXISTING) && left.includes(CH.OTHERS_CREATED),
      { left },
    );
    check(
      "a merge by a purging or purged import, this one included, pins nothing (#2922)",
      [CH.SELF_MERGED, CH.MERGED_BY_PURGED, CH.MERGED_BY_PURGING].every((id) => deleted.includes(id)),
      { deleted },
    );
    check(
      "re-reaps a channel a purged, or still purging, import created that this one merged into, unless a live import's merge still pins it (#2922)",
      deleted.includes(CH.REREAP) && deleted.includes(CH.REREAP_PURGING) && left.includes(CH.REREAP_PINNED),
      { deleted, left },
    );
    check(
      "keeps a channel a create_new row names that is older than the import, or lacks the worker's description (an upload mapped before #2859)",
      left.includes(CH.LEGACY) && left.includes(CH.LEGACY_NEWER),
      { left },
    );
    check(
      "keeps another chapter's channel, and a running import's channel",
      left.includes(CH.IN_B) && left.includes(CH.RUNNING_CH),
      { left },
    );
    const targets = await q(
      `select discord_channel_id, target_channel_id from discord_import_channels
        where (import_id = '${PURGING}' and discord_channel_id in ('d1', 'd2', 'd2-thread', 'd10', 'd11'))
           or (import_id = '${PURGED}' and discord_channel_id = 'g1')
           or (import_id = '${OTHER_PURGING}' and discord_channel_id = 'h1')
        order by 1`,
    );
    const records = await q(
      `select count(*)::int as n from discord_import_created_channels where channel_id in (${DELETABLE.map((id) => `'${id}'`).join(", ")})`,
    );
    check(
      "the mapping rows keep their record with the target cleared, and the created-channel records go",
      targets.length === 7 && targets.every((r) => r.target_channel_id === null) && records[0]?.n === 0,
      { targets, records },
    );
    const again = await q(`select * from delete_empty_discord_import_channels('${PURGING}', '${A}')`);
    check("a second call deletes nothing more", again.length === 0, { again });

    // Both client roles exist here, so each is checked directly. That catches
    // a revoke from PUBLIC going missing and an explicit grant to either role.
    // It cannot catch a forgotten `revoke ... from anon` or `from
    // authenticated`: hosted grants both through ALTER DEFAULT PRIVILEGES,
    // which is not replayed here (see the can_read_chat_message() EXECUTE
    // assertion). docs/ops/database/promotion-log.md checks `authenticated` for these two
    // functions at promotion, but not `anon` (#3052).
    const guard = await q(`
      select has_function_privilege('authenticated', 'public.delete_empty_discord_import_channels(uuid, uuid)', 'execute') as authed,
             has_function_privilege('authenticated', 'public.discord_import_channel_holds_anything(uuid, uuid)', 'execute') as authed_check,
             has_function_privilege('anon', 'public.delete_empty_discord_import_channels(uuid, uuid)', 'execute') as anon,
             has_function_privilege('anon', 'public.discord_import_channel_holds_anything(uuid, uuid)', 'execute') as anon_check,
             (select relrowsecurity from pg_class where oid = 'public.discord_import_created_channels'::regclass) as rls,
             (select count(*)::int from pg_indexes
               where indexname in ('idx_point_transactions_channel', 'idx_discord_import_channels_target')) as indexes
    `);
    check(
      "neither a signed-in client nor the anon key may call either function, the created-channel table has RLS on, and both indexes exist",
      guard[0]?.authed === false && guard[0]?.authed_check === false &&
        guard[0]?.anon === false && guard[0]?.anon_check === false &&
        guard[0]?.rls === true && guard[0]?.indexes === 2,
      guard[0],
    );
  } catch (e) {
    check("emptied import channels scenario ran", false, String(e?.message ?? e).split("\n")[0]);
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
