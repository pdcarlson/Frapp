import { db, miss } from "../harness.mjs";

// ─── Forward a message: the copy's lifecycle (#4864) ─────────────────────────
//
// `chat_messages.forwarded_from` is kept by triggers, an RPC and the account
// deletion function that the Jest suites never run
// (`20261113185033_chat_message_forwarded_from.sql`). What each scenario pins:
// - an edit to the original changes no copy;
// - a soft delete of the original blanks every copy of it to `deleted: true`,
//   keeping only where and when, and leaves other copies alone;
// - a hard delete of the original (here, its channel going) does the same;
// - Chat home's preview carries the copy, cut to 500, and withholds it from a
//   caller who blocked the original's author;
// - the notifications of a forward with no comment go when its original is
//   soft- or hard-deleted, and a forward with a comment keeps its own;
// - a notification the push worker inserts after the blanking is dropped;
// - a forward inserted after its original is deleted (or of a message that
//   never existed) lands with its copy blanked;
// - `anonymize_user` rewrites the deleted member's name in their copies only;
// - the trigger functions aren't callable by a signed-in client.
try {
  const CH = "f8f8f8f8-0000-4000-8000-000000004864";
  const A = "f9f9f9f9-0000-4000-8000-00000000486a"; // the original's author
  const F = "f9f9f9f9-0000-4000-8000-00000000486f"; // the forwarder
  const V = "f9f9f9f9-0000-4000-8000-000000004860"; // a viewer who blocks A
  const SRC = "fafafafa-0000-4000-8000-000000004864";
  const GONE = "fafafafa-0000-4000-8000-000000004865"; // a channel to drop
  const DEST = "fafafafa-0000-4000-8000-000000004866";
  const O1 = "fbfbfbfb-0000-4000-8000-000000004861";
  const O2 = "fbfbfbfb-0000-4000-8000-000000004862";
  const O3 = "fbfbfbfb-0000-4000-8000-000000004863";
  const W1 = "fcfcfcfc-0000-4000-8000-000000004861";
  const W2 = "fcfcfcfc-0000-4000-8000-000000004862";
  const W3 = "fcfcfcfc-0000-4000-8000-000000004863";
  const GONE2 = "fafafafa-0000-4000-8000-000000004867";
  const O4 = "fbfbfbfb-0000-4000-8000-000000004864";
  const O5 = "fbfbfbfb-0000-4000-8000-000000004865";
  const W4 = "fcfcfcfc-0000-4000-8000-000000004864"; // no comment, of O4
  const W5 = "fcfcfcfc-0000-4000-8000-000000004865"; // with a comment, of O4
  const W6 = "fcfcfcfc-0000-4000-8000-000000004866"; // no comment, of O5
  const W7 = "fcfcfcfc-0000-4000-8000-000000004867"; // sent after O4 went
  const W8 = "fcfcfcfc-0000-4000-8000-000000004868"; // of no message at all
  const NOWHERE = "fbfbfbfb-0000-4000-8000-000000004869";
  const at = (minutes) => `now() - interval '${60 - minutes} minutes'`;
  const copyOf = (id, channel, content) =>
    `jsonb_build_object('message_id', '${id}', 'channel_id', '${channel}',
       'sender_id', '${A}', 'author_name', 'Ana', 'content', ${content},
       'gif', null, 'attachment_count', 1, 'created_at', '2026-11-01T00:00:00Z')`;
  await db.exec(`
    insert into chapters (id, name, university) values ('${CH}', 'Forwards', 'U');
    insert into users (id, supabase_auth_id, email, display_name) values
      ('${A}', gen_random_uuid(), 'fwd-a@example.com', 'Ana'),
      ('${F}', gen_random_uuid(), 'fwd-f@example.com', 'Fay'),
      ('${V}', gen_random_uuid(), 'fwd-v@example.com', 'Vic');
    insert into chat_channels (id, chapter_id, name, type, member_ids) values
      ('${SRC}', '${CH}', 'source', 'PUBLIC', '{}'::uuid[]),
      ('${GONE}', '${CH}', 'gone', 'PUBLIC', '{}'::uuid[]),
      ('${DEST}', '${CH}', 'dest', 'PUBLIC', '{}'::uuid[]);
    insert into chat_messages (id, channel_id, sender_id, content, created_at) values
      ('${O1}', '${SRC}', '${A}', 'one', ${at(1)}),
      ('${O2}', '${SRC}', '${A}', 'two', ${at(2)}),
      ('${O3}', '${GONE}', '${A}', 'three', ${at(3)});
    insert into chat_messages (id, channel_id, sender_id, content, forwarded_from, created_at) values
      ('${W1}', '${DEST}', '${F}', '', ${copyOf(O1, SRC, "'one'")}, ${at(10)}),
      ('${W2}', '${DEST}', '${F}', '', ${copyOf(O2, SRC, "'two'")}, ${at(11)}),
      ('${W3}', '${DEST}', '${F}', '', ${copyOf(O3, GONE, "repeat('z', 600)")}, ${at(12)});
  `);
  const copy = async (id) =>
    (
      await db.query(
        `select coalesce(forwarded_from ->> 'content', '∅') || '/' ||
                coalesce(forwarded_from ->> 'author_name', '∅') || '/' ||
                coalesce(forwarded_from ->> 'sender_id', '∅') || '/' ||
                coalesce(forwarded_from ->> 'attachment_count', '∅') || '/' ||
                coalesce(forwarded_from ->> 'deleted', '∅') || '/' ||
                coalesce(forwarded_from ->> 'message_id', '∅') as s
           from chat_messages where id = $1`,
        [id],
      )
    ).rows[0]?.s;

  // The preview, before anything is deleted: W3 is DEST's latest message.
  const preview = async (user) =>
    (
      await db.query(
        `select length(forwarded_from ->> 'content') || '/' ||
                (forwarded_from ->> 'sender_blocked') || '/' ||
                coalesce(forwarded_from ->> 'author_name', '∅') as s
           from public.get_channel_latest_messages($1, $2)
          where channel_id = $3`,
        [CH, user, DEST],
      )
    ).rows[0]?.s;
  const clearPreview = await preview(F);
  await db.exec(`
    insert into chat_member_blocks (chapter_id, blocker_user_id, blocked_user_id)
      values ('${CH}', '${V}', '${A}');
  `);
  const blockedPreview = await preview(V);

  await db.exec(
    `update chat_messages set content = 'one, edited' where id = '${O1}'`,
  );
  const afterEdit = await copy(W1);
  await db.exec(
    `update chat_messages set content = '[message deleted]', is_deleted = true where id = '${O1}'`,
  );
  const afterSoftDelete = `${await copy(W1)} ${await copy(W2)}`;
  await db.exec(`delete from chat_channels where id = '${GONE}'`);
  const afterHardDelete = await copy(W3);

  // Notifications of forwards (#4864): seeded after the preview reads, so
  // DEST's latest message is unchanged for them.
  await db.exec(`
    insert into chat_channels (id, chapter_id, name, type, member_ids) values
      ('${GONE2}', '${CH}', 'gone too', 'PUBLIC', '{}'::uuid[]);
    insert into chat_messages (id, channel_id, sender_id, content, created_at) values
      ('${O4}', '${SRC}', '${A}', 'four', ${at(4)}),
      ('${O5}', '${GONE2}', '${A}', 'five', ${at(5)});
    insert into chat_messages (id, channel_id, sender_id, content, forwarded_from, created_at) values
      ('${W4}', '${DEST}', '${F}', ' ', ${copyOf(O4, SRC, "'four'")}, ${at(4)}),
      ('${W5}', '${DEST}', '${F}', 'look', ${copyOf(O4, SRC, "'four'")}, ${at(4)}),
      ('${W6}', '${DEST}', '${F}', '', ${copyOf(O5, GONE2, "'five'")}, ${at(5)});
    insert into notifications (chapter_id, user_id, title, body, data, chat_message_id) values
      ('${CH}', '${V}', 'Fay', 'w4 Forwarded: four', '{}', '${W4}'),
      ('${CH}', '${V}', 'Fay', 'w5 look', '{}', '${W5}'),
      ('${CH}', '${V}', 'Fay', 'w6 Forwarded: five', '{}', '${W6}');
  `);
  const bodies = async () =>
    (
      await db.query(
        `select coalesce(string_agg(body, ' | ' order by body), '∅') as s
           from notifications where chapter_id = $1`,
        [CH],
      )
    ).rows[0]?.s;
  const notifsBefore = await bodies();
  await db.exec(
    `update chat_messages set content = '[message deleted]', is_deleted = true where id = '${O4}'`,
  );
  const notifsAfterSoftDelete = await bodies();
  await db.exec(`delete from chat_channels where id = '${GONE2}'`);
  const notifsAfterHardDelete = await bodies();
  // The push worker, still fanning out W4 and W5 from their Realtime rows.
  await db.exec(`
    insert into notifications (chapter_id, user_id, title, body, data, chat_message_id) values
      ('${CH}', '${F}', 'Fay', 'late w4 Forwarded: four', '{}', '${W4}'),
      ('${CH}', '${F}', 'Fay', 'late w5 look', '{}', '${W5}');
  `);
  const notifsAfterLateInsert = await bodies();
  // A forward the API built before O4 went, inserted after; and one whose
  // original never existed.
  await db.exec(`
    insert into chat_messages (id, channel_id, sender_id, content, forwarded_from, created_at) values
      ('${W7}', '${DEST}', '${F}', '', ${copyOf(O4, SRC, "'four'")}, ${at(6)}),
      ('${W8}', '${DEST}', '${F}', 'hm', ${copyOf(NOWHERE, SRC, "'ghost'")}, ${at(6)});
  `);
  const lateForwards = `${await copy(W7)} ${await copy(W8)}`;

  await db.exec(`select * from anonymize_user('${A}')`);
  const afterAnonymize = `${await copy(W1)} ${await copy(W2)}`;

  const grants = (
    await db.query(
      `select has_function_privilege('authenticated', 'public.chat_messages_blank_forwards_on_soft_delete()', 'execute')
           or has_function_privilege('authenticated', 'public.chat_messages_blank_forwards_on_delete()', 'execute')
           or has_function_privilege('authenticated', 'public.chat_forward_snapshot_blanked(jsonb)', 'execute')
           or has_function_privilege('authenticated', 'public.chat_messages_blank_forward_of_deleted()', 'execute') as open`,
    )
  ).rows[0]?.open;

  const blanked = (id) => `/∅/∅/0/true/${id}`;
  const SCENARIOS = [
    {
      name: "Chat home's preview carries a forward's copy, cut to 500",
      got: clearPreview,
      want: "500/false/Ana",
    },
    {
      name: "the preview withholds a copy of a blocked author's message",
      got: blockedPreview,
      want: "0/true/∅",
    },
    {
      name: "an edit to the original changes no copy",
      got: afterEdit,
      want: `one/Ana/${A}/1/∅/${O1}`,
    },
    {
      name: "a soft delete of the original blanks its copies, and only its",
      got: afterSoftDelete,
      want: `${blanked(O1)} two/Ana/${A}/1/∅/${O2}`,
    },
    {
      name: "a hard delete of the original blanks its copies too",
      got: afterHardDelete,
      want: blanked(O3),
    },
    {
      name: "forward notifications are seeded",
      got: notifsBefore,
      want: "w4 Forwarded: four | w5 look | w6 Forwarded: five",
    },
    {
      name: "a soft delete of the original removes a comment-less forward's notifications, not a commented one's",
      got: notifsAfterSoftDelete,
      want: "w5 look | w6 Forwarded: five",
    },
    {
      name: "a hard delete of the original removes a comment-less forward's notifications",
      got: notifsAfterHardDelete,
      want: "w5 look",
    },
    {
      name: "a notification inserted after the blanking is dropped for a comment-less forward only",
      got: notifsAfterLateInsert,
      want: "late w5 look | w5 look",
    },
    {
      name: "a forward inserted after its original is deleted, or of no message, lands blanked",
      got: lateForwards,
      want: `${blanked(O4)} ${blanked(NOWHERE)}`,
    },
    {
      name: "account deletion renames the member in the copies of their messages",
      got: afterAnonymize,
      want: `${blanked(O1)} two/Deleted User/${A}/1/∅/${O2}`,
    },
    {
      name: "the forward triggers aren't callable by a signed-in client",
      got: String(grants),
      want: "false",
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
    delete from users where id in ('${A}', '${F}', '${V}');
  `);
} catch (e) {
  miss();
  console.log(
    `MISS  forwarded copies\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
  );
}
