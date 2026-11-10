import { db, miss } from "../harness.mjs";

// ─── Message threads (#3785) ─────────────────────────────────────────────────
//
// The trigger and RPCs that carry the thread rules run only through mocked
// repositories in the Jest suites, so this is where they are exercised. What
// each scenario pins:
// - the parent's summary: count, latest reply, three newest distinct repliers;
// - a thread reply never counts toward its channel's unread or preview;
// - a thread @mention counts until the later of the channel and thread reads;
// - `get_followed_thread_unread` counts new replies for a follower only, never
//   for a muted or unfollowed row, and skips your own and deleted replies.
try {
  const CH = "f3f3f3f3-0000-4000-8000-000000003785";
  const U = {
    a: "f4f4f4f4-0000-4000-8000-00000000000a", // the root's author, mentioned
    b: "f4f4f4f4-0000-4000-8000-00000000000b",
    c: "f4f4f4f4-0000-4000-8000-00000000000c",
    d: "f4f4f4f4-0000-4000-8000-00000000000d",
  };
  const GEN = "f5f5f5f5-0000-4000-8000-000000000001";
  const ROOT = "f6f6f6f6-0000-4000-8000-000000000001";
  const at = (minutes) => `now() - interval '${60 - minutes} minutes'`;
  await db.exec(`
    insert into chapters (id, name, university) values ('${CH}', 'Threads', 'U');
    insert into users (id, supabase_auth_id, email, display_name) values
      ('${U.a}', gen_random_uuid(), 'thr-a@example.com', 'A'),
      ('${U.b}', gen_random_uuid(), 'thr-b@example.com', 'B'),
      ('${U.c}', gen_random_uuid(), 'thr-c@example.com', 'C'),
      ('${U.d}', gen_random_uuid(), 'thr-d@example.com', 'D');
    insert into chat_channels (id, chapter_id, name, type, member_ids) values
      ('${GEN}', '${CH}', 'general', 'PUBLIC', '{}'::uuid[]);
    insert into chat_messages (id, channel_id, sender_id, content, created_at) values
      ('${ROOT}', '${GEN}', '${U.a}', 'root', ${at(1)});
    insert into chat_messages (channel_id, sender_id, content, thread_root_id, mentions, created_at) values
      ('${GEN}', '${U.b}', 'r1 @A', '${ROOT}', array['${U.a}'::uuid], ${at(2)}),
      ('${GEN}', '${U.c}', 'r2', '${ROOT}', '{}', ${at(3)}),
      ('${GEN}', '${U.d}', 'r3', '${ROOT}', '{}', ${at(4)}),
      ('${GEN}', '${U.b}', 'r4', '${ROOT}', '{}', ${at(5)});
  `);

  const summary = (
    await db.query(
      `select thread_reply_count as n,
              thread_recent_sender_ids = array['${U.b}', '${U.d}', '${U.c}']::uuid[] as order_ok,
              thread_last_reply_at = (select max(created_at) from chat_messages where thread_root_id = '${ROOT}') as last_ok
         from chat_messages where id = '${ROOT}'`,
    )
  ).rows[0];
  const counts = async (user) =>
    (
      await db.query(
        `select unread_count::int as u, mention_count::int as m
           from public.get_channel_unread_counts($1, $2) where channel_id = $3`,
        [CH, user, GEN],
      )
    ).rows[0];
  const preview = (
    await db.query(
      `select content from public.get_channel_latest_messages($1, $2) where channel_id = $3`,
      [CH, U.c, GEN],
    )
  ).rows[0]?.content;
  const aBefore = await counts(U.a);
  const cBefore = await counts(U.c);
  // A reads the thread: the mention clears, the channel's own count does not change.
  await db.exec(`
    insert into chat_thread_follows (thread_root_id, user_id, channel_id, state, last_read_at)
    values ('${ROOT}', '${U.a}', '${GEN}', 'following', ${at(2)} + interval '1 second');
  `);
  const aThreadRead = await counts(U.a);
  // A new mention after that, then A reads only the channel: it clears too.
  await db.exec(`
    insert into chat_messages (channel_id, sender_id, content, thread_root_id, mentions, created_at) values
      ('${GEN}', '${U.c}', 'r5 @A', '${ROOT}', array['${U.a}'::uuid], ${at(6)});
  `);
  const aNewMention = await counts(U.a);
  await db.exec(`
    insert into channel_read_receipts (channel_id, user_id, last_read_at)
    values ('${GEN}', '${U.a}', ${at(7)});
  `);
  const aChannelRead = await counts(U.a);

  await db.exec(`
    insert into chat_thread_follows (thread_root_id, user_id, channel_id, state, last_read_at) values
      ('${ROOT}', '${U.b}', '${GEN}', 'following', ${at(3)} + interval '1 second'),
      ('${ROOT}', '${U.c}', '${GEN}', 'muted', null),
      ('${ROOT}', '${U.d}', '${GEN}', 'unfollowed', null);
    update chat_messages set is_deleted = true where content = 'r3';
  `);
  const followed = async (user) =>
    (
      await db.query(
        `select state || '/' || unread_count::int as s
           from public.get_followed_thread_unread($1, $2)`,
        [GEN, user],
      )
    ).rows
      .map((r) => r.s)
      .join(",");
  const bFollowed = await followed(U.b);
  const cFollowed = await followed(U.c);
  const dFollowed = await followed(U.d);

  const SCENARIOS = [
    {
      name: "a thread's parent counts its replies and keeps the three newest distinct repliers",
      got: `${summary?.n}/${summary?.order_ok}/${summary?.last_ok}`,
      want: "4/true/true",
    },
    {
      name: "a thread reply never counts toward its channel's unread or becomes its preview",
      got: `${cBefore?.u} ${preview}`,
      want: "1 root",
    },
    {
      name: "a thread @mention counts until the thread is read",
      got: `${aBefore?.u}/${aBefore?.m} ${aThreadRead?.u}/${aThreadRead?.m}`,
      want: "0/1 0/0",
    },
    {
      name: "a thread @mention also clears when the channel is read",
      got: `${aNewMention?.m} ${aChannelRead?.m}`,
      want: "1 0",
    },
    {
      name: "followed threads count new replies for a follower only, skipping own and deleted ones",
      got: `${bFollowed} | ${cFollowed} | ${dFollowed}`,
      // B read through r2; after it come r3 (deleted), r4 (B's own) and r5.
      want: "following/1 | muted/0 | ",
    },
  ];
  for (const s of SCENARIOS) {
    if (s.got === s.want) {
      console.log(`OK    ${s.name}`);
    } else {
      miss();
      console.log(
        `MISS  ${s.name}\n        ↳ expected ${s.want}, got ${s.got}`,
      );
    }
  }

  await db.exec(`
    delete from chapters where id = '${CH}';
    delete from users where id in ('${U.a}', '${U.b}', '${U.c}', '${U.d}');
  `);
} catch (e) {
  miss();
  console.log(
    `MISS  message threads\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
  );
}
