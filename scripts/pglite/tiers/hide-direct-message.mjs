import { db, miss } from "../harness.mjs";

// ─── Hide a 1:1 DM for yourself (#2303) ─────────────────────────────────────
//
// `hide_direct_message` and `get_hidden_channel_ids` are called only through
// mocked repositories in the Jest suites, so this is the one place their SQL
// runs. What each check pins, and the edit it catches:
// - per member: dropping `r.user_id = p_user_id` hides the DM for both members;
// - strictly newer: `>=` instead of `>` would let the hide's own instant count;
// - a deleted message, or one from someone the hider blocked in THIS chapter,
//   does not resurface it (a block in another chapter does not count);
// - the hide never moves an existing read cursor backwards, and matches only a
//   DM in the named chapter.
try {
  const CH = "d0d0d0d0-0000-4000-8000-000000002303";
  const CH_OTHER = "d0d0d0d0-0000-4000-8000-000000012303";
  const U = {
    a: "d1d1d1d1-0000-4000-8000-00000000000a",
    b: "d1d1d1d1-0000-4000-8000-00000000000b",
    c: "d1d1d1d1-0000-4000-8000-00000000000c",
  };
  const DM = "d2d2d2d2-0000-4000-8000-0000000000ab";
  const DM_AC = "d2d2d2d2-0000-4000-8000-0000000000ac";
  const GROUP = "d2d2d2d2-0000-4000-8000-000000000abc";
  const DM_FOREIGN = "d2d2d2d2-0000-4000-8000-0000000100ab";
  await db.exec(`
    insert into chapters (id, name, university) values
      ('${CH}', 'Hide DM', 'U'), ('${CH_OTHER}', 'Hide DM other', 'U');
    insert into users (id, supabase_auth_id, email, display_name) values
      ('${U.a}', gen_random_uuid(), 'hide-a@example.com', 'A'),
      ('${U.b}', gen_random_uuid(), 'hide-b@example.com', 'B'),
      ('${U.c}', gen_random_uuid(), 'hide-c@example.com', 'C');
    insert into chat_channels (id, chapter_id, name, type, member_ids) values
      ('${DM}', '${CH}', 'dm-a-b', 'DM', array['${U.a}', '${U.b}']::uuid[]),
      ('${DM_AC}', '${CH}', 'dm-a-c', 'DM', array['${U.a}', '${U.c}']::uuid[]),
      ('${GROUP}', '${CH}', 'group-dm', 'GROUP_DM', array['${U.a}', '${U.b}', '${U.c}']::uuid[]),
      ('${DM_FOREIGN}', '${CH_OTHER}', 'dm-a-b', 'DM', array['${U.a}', '${U.b}']::uuid[]);
    insert into chat_messages (channel_id, sender_id, content) values ('${DM}', '${U.b}', 'before');
  `);
  const hide = async (channel, user, chapter = CH) =>
    (
      await db.query(`select * from public.hide_direct_message($1, $2, $3)`, [
        channel,
        chapter,
        user,
      ])
    ).rows;
  const hidden = async (user, chapter = CH) =>
    (
      await db.query(
        `select channel_id::text as id from public.get_hidden_channel_ids($1, $2)`,
        [chapter, user],
      )
    ).rows
      .map((r) => r.id)
      .sort()
      .join(",");
  const send = (channel, sender, deleted = false) =>
    db.query(
      `insert into chat_messages (channel_id, sender_id, content, is_deleted, created_at)
       values ($1, $2, 'after', $3, now() + interval '1 second')`,
      [channel, sender, deleted],
    );
  const count = async (sql) => (await db.query(sql)).rows[0].n;
  const checks = [];

  const messagesBefore = await count(
    `select count(*)::int as n from chat_messages where channel_id = '${DM}'`,
  );
  const hideRows = await hide(DM, U.a);
  checks.push(
    [
      hideRows.length === 1 && hideRows[0].hidden_at !== null,
      "hide_direct_message stamps the caller's receipt",
    ],
    [(await hidden(U.a)) === DM, "the hider's DM is hidden"],
    [
      (await hidden(U.b)) === "",
      "the other member's DM is not hidden (per member)",
    ],
    [
      (await count(
        `select count(*)::int as n from chat_messages where channel_id = '${DM}'`,
      )) === messagesBefore,
      "hiding deletes no message",
    ],
    [
      (await count(
        `select unread_count::int as n from public.get_channel_unread_counts('${CH}', '${U.a}') where channel_id = '${DM}'`,
      )) === 0,
      "hiding marks the DM read",
    ],
    [(await hide(GROUP, U.a)).length === 0, "a Group DM is never hidden"],
    [
      (await hide(DM, U.a, CH_OTHER)).length === 0,
      "a DM named under another chapter is not matched",
    ],
  );

  await send(DM, U.b, true);
  checks.push([
    (await hidden(U.a)) === DM,
    "a deleted message does not resurface it",
  ]);

  await db.exec(`
    insert into chat_member_blocks (chapter_id, blocker_user_id, blocked_user_id)
    values ('${CH}', '${U.a}', '${U.b}');
  `);
  await send(DM, U.b);
  checks.push([
    (await hidden(U.a)) === DM,
    "a message from a member the hider blocked does not resurface it",
  ]);

  await db.exec(`
    delete from chat_member_blocks where blocker_user_id = '${U.a}';
    insert into chat_member_blocks (chapter_id, blocker_user_id, blocked_user_id)
    values ('${CH_OTHER}', '${U.a}', '${U.b}');
  `);
  checks.push([
    (await hidden(U.a)) === "",
    "a block in another chapter does not keep it hidden",
  ]);

  await db.exec(
    `delete from chat_messages where channel_id = '${DM}' and content = 'after';`,
  );
  await hide(DM, U.a);
  await db.exec(
    `update chat_messages set created_at = (select hidden_at from channel_read_receipts where channel_id = '${DM}' and user_id = '${U.a}') where channel_id = '${DM}'`,
  );
  checks.push([
    (await hidden(U.a)) === DM,
    "a message at the hide's own instant does not resurface it",
  ]);

  await send(DM, U.a);
  checks.push([
    (await hidden(U.a)) === "",
    "the hider's own new message resurfaces it",
  ]);

  // `send` stamps a second ahead, so clear it before hiding again.
  await db.exec(
    `delete from chat_messages where channel_id = '${DM}' and content = 'after';`,
  );
  await hide(DM, U.a);
  await hide(DM_AC, U.a);
  checks.push(
    [
      (await hidden(U.a)) === [DM, DM_AC].sort().join(","),
      "every hidden DM is returned",
    ],
    [
      (await hidden(U.a, CH_OTHER)) === "",
      "hidden DMs are scoped to the chapter asked about",
    ],
  );

  await db.exec(
    `update channel_read_receipts set last_read_at = now() + interval '1 day' where channel_id = '${DM}' and user_id = '${U.a}'`,
  );
  const [rehide] = await hide(DM, U.a);
  checks.push([
    new Date(rehide.last_read_at).getTime() > Date.now() + 3_600_000,
    "a hide never moves the read cursor backwards",
  ]);

  for (const [ok, name] of checks) {
    if (ok) {
      console.log(`OK    ${name} (#2303)`);
    } else {
      miss();
      console.log(`MISS  ${name} (#2303)`);
    }
  }

  await db.exec(`
    delete from chapters where id in ('${CH}', '${CH_OTHER}');
    delete from users where id in ('${U.a}', '${U.b}', '${U.c}');
  `);
} catch (e) {
  miss();
  console.log(
    `MISS  hide a 1:1 DM (#2303)\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
  );
}
