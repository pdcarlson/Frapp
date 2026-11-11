import { db, miss } from "../harness.mjs";

console.log(
  "\n=== Functional: the chapter's channel and category order (#4178) ===",
);
{
  // An officer drags a channel in the web rail and the API writes the whole
  // section's order through `reorder_chat_channels`; a category heading goes
  // through `reorder_chat_categories`. Every unit suite mocks both RPCs. This
  // is the CI-run proof that a drop renumbers its section in array order,
  // moves a channel across categories, keeps a channel the officer couldn't
  // see after the listed ones, never touches a DM, the audit log or another
  // chapter, and that an unarranged chapter stays null (A to Z).
  const CHAPTER = "a4178000-0000-4000-8000-00000000000c";
  const OTHER = "a4178000-0000-4000-8000-00000000000d";
  const CAT_A = "a4178000-0000-4000-8000-0000000000a1";
  const CAT_B = "a4178000-0000-4000-8000-0000000000a2";
  const CAT_C = "a4178000-0000-4000-8000-0000000000a3";
  const GENERAL = "a4178000-0000-4000-8000-0000000000c1";
  const RANDOM = "a4178000-0000-4000-8000-0000000000c2";
  const EXEC = "a4178000-0000-4000-8000-0000000000c3";
  const SECRET = "a4178000-0000-4000-8000-0000000000c4";
  const RUSH = "a4178000-0000-4000-8000-0000000000c5";
  const DM = "a4178000-0000-4000-8000-0000000000c6";
  const AUDIT = "a4178000-0000-4000-8000-0000000000c7";
  const FOREIGN = "a4178000-0000-4000-8000-0000000000c8";

  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  const order = async (ids) =>
    Object.fromEntries(
      (
        await db.query(
          `select id, category_id, display_order from chat_channels where id = any($1::uuid[])`,
          [ids],
        )
      ).rows.map((r) => [
        r.id,
        { category: r.category_id, order: r.display_order },
      ]),
    );

  try {
    await db.exec(`
      begin;
      insert into chapters (id, name, university) values
        ('${CHAPTER}', 'C', 'U'), ('${OTHER}', 'O', 'U');
      insert into chat_channel_categories (id, chapter_id, name, display_order) values
        ('${CAT_A}', '${CHAPTER}', 'A', 0),
        ('${CAT_B}', '${CHAPTER}', 'B', 0),
        ('${CAT_C}', '${CHAPTER}', 'C', 5);
      insert into chat_channels (id, chapter_id, name, type, category_id) values
        ('${GENERAL}', '${CHAPTER}', 'general', 'PUBLIC', null),
        ('${RANDOM}', '${CHAPTER}', 'random', 'PUBLIC', null),
        ('${EXEC}', '${CHAPTER}', 'exec', 'PRIVATE', '${CAT_A}'),
        ('${SECRET}', '${CHAPTER}', 'aaa-secret', 'PRIVATE', '${CAT_A}'),
        ('${RUSH}', '${CHAPTER}', 'rush', 'PUBLIC', '${CAT_B}'),
        ('${FOREIGN}', '${OTHER}', 'theirs', 'PUBLIC', null);
      insert into chat_channels (id, chapter_id, name, type, member_ids) values
        ('${DM}', '${CHAPTER}', 'dm', 'DM', array[gen_random_uuid(), gen_random_uuid()]);
      insert into chat_channels (id, chapter_id, name, type, is_audit_log) values
        ('${AUDIT}', '${CHAPTER}', 'chapter-audit', 'PUBLIC', true);
    `);

    const before = await order([GENERAL, RANDOM, EXEC]);
    check(
      "a chapter nobody has arranged has no display_order (the list stays A to Z)",
      Object.values(before).every((r) => r.order === null),
      before,
    );

    // Drag random above general in the default group.
    await db.query(
      `select * from reorder_chat_channels($1, null, $2::uuid[])`,
      [CHAPTER, [RANDOM, GENERAL]],
    );
    const flat = await order([RANDOM, GENERAL]);
    check(
      "a drop numbers its section in the order given",
      flat[RANDOM].order === 0 && flat[GENERAL].order === 1,
      flat,
    );

    // Drag rush from B into A, listing only what the officer sees there
    // (rush, exec); aaa-secret is a private channel they can't see.
    const returned = await db.query(
      `select id from reorder_chat_channels($1, $2, $3::uuid[])`,
      [CHAPTER, CAT_A, [RUSH, EXEC]],
    );
    const moved = await order([RUSH, EXEC, SECRET]);
    check(
      "a channel dropped into another category moves there, and an unlisted one keeps its place after the listed",
      moved[RUSH].category === CAT_A &&
        moved[RUSH].order === 0 &&
        moved[EXEC].order === 1 &&
        moved[SECRET].category === CAT_A &&
        moved[SECRET].order === 2 &&
        returned.rows.length === 2,
      { moved, returned: returned.rows.length },
    );

    // A DM, the audit log and another chapter's channel are never written,
    // even when listed.
    await db.query(
      `select * from reorder_chat_channels($1, null, $2::uuid[])`,
      [CHAPTER, [DM, AUDIT, FOREIGN, GENERAL]],
    );
    const untouched = await order([DM, AUDIT, FOREIGN, GENERAL]);
    check(
      "a DM, the audit log and another chapter's channel are never ordered",
      untouched[DM].order === null &&
        untouched[AUDIT].order === null &&
        untouched[FOREIGN].order === null &&
        untouched[FOREIGN].category === null &&
        untouched[GENERAL].order === 3,
      untouched,
    );

    // Categories: drag C to the top, listing C and A; B wasn't listed.
    const cats = await db.query(
      `select id, display_order from reorder_chat_categories($1, $2::uuid[])`,
      [CHAPTER, [CAT_C, CAT_A]],
    );
    const ids = cats.rows.map((r) => r.id);
    check(
      "categories take the order given, and one not listed follows in its old order",
      JSON.stringify(ids) === JSON.stringify([CAT_C, CAT_A, CAT_B]) &&
        cats.rows.map((r) => r.display_order).join(",") === "0,1,2",
      cats.rows,
    );

    const grants = await db.query(
      `select has_function_privilege('authenticated', 'reorder_chat_channels(uuid, uuid, uuid[])', 'execute') as ch,
              has_function_privilege('authenticated', 'reorder_chat_categories(uuid, uuid[])', 'execute') as cat`,
    );
    check(
      "neither RPC is callable by a signed-in client directly",
      grants.rows[0].ch === false && grants.rows[0].cat === false,
      grants.rows[0],
    );
  } catch (e) {
    check(
      "channel-order scenario ran",
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
