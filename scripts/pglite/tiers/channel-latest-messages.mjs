import { db, miss } from "../harness.mjs";

// ─── Chat home previews: each channel's latest message (2026-11-06) ──────────
//
// `get_channel_latest_messages` is called only through a mocked repository in
// the Jest suites, so this is the one place its rules run. What each scenario
// pins, and the edit it catches:
// - the latest message wins, a deleted one is skipped, and a channel with no
//   message has no row;
// - a sender the caller blocked in the chapter is skipped, falling back to the
//   message before, for the blocker only and only in that chapter;
// - `content` is cut to 500 characters, and `payload` comes back only on an
//   audit line;
// - a sender-written `attachment_count` that isn't a small whole number reads
//   as 0 instead of failing the read for the whole chapter;
// - `has_gif` says a GIF is the latest message, and the thread card's copy
//   of a GIF reply says so too (#4657).
//
// A scenario name is cited by `chat-read-surface-ledger.spec.ts` as the proof
// for `ChatController_getLatestMessages_v1`, which that spec checks is still a
// `name:` here. Rename one there too.
try {
  const CH = "f0f0f0f0-0000-4000-8000-000000001106";
  const CH_OTHER = "f0f0f0f0-0000-4000-8000-000000011106";
  const U = {
    a: "f1f1f1f1-0000-4000-8000-00000000000a", // the blocker
    b: "f1f1f1f1-0000-4000-8000-00000000000b", // the blocked member
    c: "f1f1f1f1-0000-4000-8000-00000000000c", // a bystander
  };
  const PUB = "f2f2f2f2-0000-4000-8000-000000000001";
  const LONG = "f2f2f2f2-0000-4000-8000-000000000002";
  const AUDIT = "f2f2f2f2-0000-4000-8000-000000000003";
  const ODD = "f2f2f2f2-0000-4000-8000-000000000004";
  const EMPTY = "f2f2f2f2-0000-4000-8000-000000000005";
  const PUB_OTHER = "f2f2f2f2-0000-4000-8000-000000010001";
  const at = (minutes) => `now() - interval '${60 - minutes} minutes'`;
  await db.exec(`
    insert into chapters (id, name, university) values
      ('${CH}', 'Latest previews', 'U'), ('${CH_OTHER}', 'Latest previews other', 'U');
    insert into users (id, supabase_auth_id, email, display_name) values
      ('${U.a}', gen_random_uuid(), 'latest-a@example.com', 'A'),
      ('${U.b}', gen_random_uuid(), 'latest-b@example.com', 'B'),
      ('${U.c}', gen_random_uuid(), 'latest-c@example.com', 'C');
    insert into chat_channels (id, chapter_id, name, type, member_ids) values
      ('${PUB}', '${CH}', 'general', 'PUBLIC', '{}'::uuid[]),
      ('${LONG}', '${CH}', 'long', 'PUBLIC', '{}'::uuid[]),
      ('${AUDIT}', '${CH}', 'chapter-audit', 'PUBLIC', '{}'::uuid[]),
      ('${ODD}', '${CH}', 'odd', 'PUBLIC', '{}'::uuid[]),
      ('${EMPTY}', '${CH}', 'empty', 'PUBLIC', '{}'::uuid[]),
      ('${PUB_OTHER}', '${CH_OTHER}', 'general', 'PUBLIC', '{}'::uuid[]);
    insert into chat_messages (channel_id, sender_id, author_name, content, kind, payload, metadata, is_deleted, created_at) values
      ('${PUB}', '${U.c}', null, 'from C', 'text', null, '{}', false, ${at(1)}),
      ('${PUB}', '${U.b}', null, 'from B', 'text', null, '{"attachment_count": 2}', false, ${at(2)}),
      ('${PUB}', '${U.c}', null, 'deleted', 'text', null, '{}', true, ${at(3)}),
      ('${LONG}', '${U.c}', null, repeat('x', 600), 'text', '{"kind":"card"}', '{}', false, ${at(1)}),
      ('${AUDIT}', '${U.c}', null, '', 'system_audit', '{"action":"chapter_profile_updated"}', '{}', false, ${at(1)}),
      ('${ODD}', '${U.c}', null, 'odd 1', 'text', null, '{"attachment_count": "x"}', false, ${at(1)}),
      ('${PUB_OTHER}', '${U.b}', null, 'B elsewhere', 'text', null, '{}', false, ${at(1)});
  `);

  const LABEL = {
    [PUB]: "PUB", [LONG]: "LONG", [AUDIT]: "AUDIT", [ODD]: "ODD",
    [EMPTY]: "EMPTY", [PUB_OTHER]: "PUB_OTHER",
  };
  const rows = async (user, chapter) =>
    (
      await db.query(
        `select channel_id::text as id, content, attachment_count::int as n,
                payload is not null as has_payload
           from public.get_channel_latest_messages($1, $2)`,
        [chapter, user],
      )
    ).rows;
  // "<channel>=<content>/<attachments>" per channel, sorted.
  const latest = async (user, chapter) =>
    (await rows(user, chapter))
      .filter((r) => r.id !== LONG && r.id !== AUDIT)
      .map((r) => `${LABEL[r.id] ?? r.id}=${r.content}/${r.n}`)
      .sort()
      .join(" ");

  const before = await latest(U.a, CH);
  const all = await rows(U.a, CH);
  const long = all.find((r) => r.id === LONG);
  const audit = all.find((r) => r.id === AUDIT);
  // An odd count that is still a JSON number: the regex half of the guard.
  await db.exec(`
    insert into chat_messages (channel_id, sender_id, content, metadata, created_at) values
      ('${ODD}', '${U.c}', 'odd 2', '{"attachment_count": 1.5}', ${at(2)});
  `);
  const oddFraction = await latest(U.a, CH);
  await db.exec(`
    insert into chat_member_blocks (chapter_id, blocker_user_id, blocked_user_id)
    values ('${CH}', '${U.a}', '${U.b}');
  `);
  const blocked = await latest(U.a, CH);
  const bystander = await latest(U.c, CH);
  const blockedElsewhere = await latest(U.a, CH_OTHER);

  // A GIF as the latest message, and as a thread reply (#4657).
  const GIF = `'{"gif":{"provider":"klipy","id":"g1","url":"https://static.klipy.com/g1.webp","width":200,"height":150}}'`;
  const PARENT = "f3f3f3f3-0000-4000-8000-000000000001";
  await db.exec(`
    insert into chat_messages (id, channel_id, sender_id, content, metadata, created_at) values
      ('${PARENT}', '${EMPTY}', '${U.c}', 'parent', '{}', ${at(4)});
    insert into chat_messages (channel_id, sender_id, content, metadata, thread_root_id, created_at) values
      ('${EMPTY}', '${U.c}', '', ${GIF}, '${PARENT}', ${at(5)});
    insert into chat_messages (channel_id, sender_id, content, metadata, created_at) values
      ('${EMPTY}', '${U.c}', '', ${GIF}, ${at(6)});
  `);
  const gifFlags = (
    await db.query(
      `select channel_id::text as id, has_gif
         from public.get_channel_latest_messages($1, $2)`,
      [CH, U.a],
    )
  ).rows
    .filter((r) => r.id === EMPTY || r.id === PUB)
    .map((r) => `${LABEL[r.id]}=${r.has_gif}`)
    .sort()
    .join(" ");
  const threadCard = (
    await db.query(
      `select thread_last_reply ->> 'has_gif' as has_gif
         from chat_messages where id = $1`,
      [PARENT],
    )
  ).rows[0]?.has_gif;

  const SCENARIOS = [
    {
      name: "the latest live message is each channel's preview; deleted rows and empty channels give none",
      got: before,
      want: "ODD=odd 1/0 PUB=from B/2",
    },
    {
      name: "a preview's content is cut to 500 characters, and only an audit line carries its payload",
      got: `${long?.content.length}/${long?.has_payload} ${audit?.has_payload}`,
      want: "500/false true",
    },
    {
      name: "a sender-written attachment_count that is not a small whole number reads as 0",
      got: oddFraction,
      want: "ODD=odd 2/0 PUB=from B/2",
    },
    {
      name: "a blocker's previews skip the blocked member's messages in that chapter",
      got: blocked,
      want: "ODD=odd 2/0 PUB=from C/0",
    },
    {
      name: "a block changes nobody else's previews, nor the blocker's in another chapter",
      got: `${bystander} | ${blockedElsewhere}`,
      want: "ODD=odd 2/0 PUB=from B/2 | PUB_OTHER=B elsewhere/0",
    },
    {
      name: "a GIF as the latest message, or as a thread's latest reply, is flagged has_gif",
      got: `${gifFlags} | ${threadCard}`,
      want: "EMPTY=true PUB=false | true",
    },
  ];
  for (const s of SCENARIOS) {
    if (s.got === s.want) {
      console.log(`OK    ${s.name}`);
    } else {
      miss();
      console.log(`MISS  ${s.name}\n        ↳ expected ${s.want}, got ${s.got}`);
    }
  }

  await db.exec(`
    delete from chapters where id in ('${CH}', '${CH_OTHER}');
    delete from users where id in ('${U.a}', '${U.b}', '${U.c}');
  `);
} catch (e) {
  miss();
  console.log(
    `MISS  channel latest messages\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
  );
}
