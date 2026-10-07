import { db, miss } from "../harness.mjs";

// ─── Unread and mention counts skip a blocked sender (#2521) ─────────────────
//
// `get_channel_unread_counts` is called only through a mocked repository in the
// Jest suites, so this is the one place its block rule runs. userA blocks userB
// in CH. What each scenario pins, and the edit it catches:
// - the blocker stops counting userB's messages and mentions in CH, while a
//   bystander's and a null-sender row still count, and a channel whose every
//   message is now skipped still returns its row, as zero;
// - nobody else's counts move: not a bystander's (a predicate keyed on the
//   sender alone), not the blocked member's own (an oracle);
// - the block is per chapter, in both directions;
// - unblocking gives back exactly the pre-block counts, from a read cursor
//   that never moved.
//
// Scenario names are cited by `chat-read-surface-ledger.spec.ts` as the proof
// for `ChatController_getUnreadCounts_v1`, which that spec checks is still a
// `name:` here. Rename one there too.
try {
  const CH = "e0e0e0e0-0000-4000-8000-000000002521";
  const CH_OTHER = "e0e0e0e0-0000-4000-8000-000000012521";
  const U = {
    a: "e1e1e1e1-0000-4000-8000-00000000000a", // the blocker
    b: "e1e1e1e1-0000-4000-8000-00000000000b", // the blocked member
    c: "e1e1e1e1-0000-4000-8000-00000000000c", // a bystander
  };
  const PUB = "e2e2e2e2-0000-4000-8000-000000000001";
  const DM = "e2e2e2e2-0000-4000-8000-0000000000ab";
  const PUB_OTHER = "e2e2e2e2-0000-4000-8000-000000010001";
  // Explicit timestamps, so the read cursor can sit between messages. Every
  // insert in one statement would otherwise share one `now()`.
  const at = (minutes) => `now() - interval '${60 - minutes} minutes'`;
  await db.exec(`
    insert into chapters (id, name, university) values
      ('${CH}', 'Unread blocks', 'U'), ('${CH_OTHER}', 'Unread blocks other', 'U');
    insert into users (id, supabase_auth_id, email, display_name) values
      ('${U.a}', gen_random_uuid(), 'unread-a@example.com', 'A'),
      ('${U.b}', gen_random_uuid(), 'unread-b@example.com', 'B'),
      ('${U.c}', gen_random_uuid(), 'unread-c@example.com', 'C');
    insert into chat_channels (id, chapter_id, name, type, member_ids) values
      ('${PUB}', '${CH}', 'general', 'PUBLIC', '{}'::uuid[]),
      ('${DM}', '${CH}', 'dm-a-b', 'DM', array['${U.a}', '${U.b}']::uuid[]),
      ('${PUB_OTHER}', '${CH_OTHER}', 'general', 'PUBLIC', '{}'::uuid[]);
    insert into chat_messages (channel_id, sender_id, author_name, content, mentions, created_at) values
      -- Before userA's cursor on PUB, so never unread to userA.
      ('${PUB}', '${U.b}', null, '@A early', array['${U.a}']::uuid[], ${at(1)}),
      ('${PUB}', '${U.c}', null, '@A from C', array['${U.a}']::uuid[], ${at(2)}),
      ('${PUB}', '${U.b}', null, 'plain from B', '{}'::uuid[], ${at(3)}),
      ('${PUB}', '${U.b}', null, '@A from B', array['${U.a}']::uuid[], ${at(4)}),
      ('${PUB}', null, 'Webhook Bot', 'live, no sender', '{}'::uuid[], ${at(5)}),
      -- The blocker's own messages. Never unread to userA, but userB counts
      -- them, so a predicate that also hid a blocker from the member they
      -- blocked (the oracle) would move userB's counts.
      ('${PUB}', '${U.a}', null, '@B from A', array['${U.b}']::uuid[], ${at(5.5)}),
      ('${DM}', '${U.a}', null, 'dm from A', '{}'::uuid[], ${at(5.5)}),
      ('${DM}', '${U.b}', null, 'dm one', '{}'::uuid[], ${at(6)}),
      ('${DM}', '${U.b}', null, '@A dm two', array['${U.a}']::uuid[], ${at(7)}),
      ('${PUB_OTHER}', '${U.b}', null, '@A elsewhere', array['${U.a}']::uuid[], ${at(8)});
    insert into channel_read_receipts (channel_id, user_id, last_read_at) values
      ('${PUB}', '${U.a}', ${at(1.5)});
  `);

  // "<channel>=<unread>/<mentions>" per channel, sorted: one string to compare.
  const LABEL = { [PUB]: "PUB", [DM]: "DM", [PUB_OTHER]: "PUB_OTHER" };
  const counts = async (user, chapter) =>
    (
      await db.query(
        `select channel_id::text as id, unread_count::int as u, mention_count::int as m
           from public.get_channel_unread_counts($1, $2)`,
        [chapter, user],
      )
    ).rows
      .map((r) => `${LABEL[r.id] ?? r.id}=${r.u}/${r.m}`)
      .sort()
      .join(" ");
  const snapshot = async () => ({
    aHere: await counts(U.a, CH),
    aThere: await counts(U.a, CH_OTHER),
    b: await counts(U.b, CH),
    c: await counts(U.c, CH),
  });
  const block = (chapter) =>
    db.exec(`
      insert into chat_member_blocks (chapter_id, blocker_user_id, blocked_user_id)
      values ('${chapter}', '${U.a}', '${U.b}');
    `);
  const unblockAll = () =>
    db.exec(`delete from chat_member_blocks where blocker_user_id = '${U.a}';`);

  const before = await snapshot();
  await block(CH);
  const blocked = await snapshot();
  await unblockAll();
  await block(CH_OTHER);
  const blockedElsewhere = await snapshot();
  await unblockAll();
  const unblocked = await snapshot();

  const UNREAD_BLOCK_SCENARIOS = [
    {
      // The control. Without it a fixture that never landed would pass every
      // "unchanged" check below. userA's PUB cursor sits after the first
      // message; userB and userC have no receipt, so everything counts except
      // their own messages.
      name: "before any block, unread and mention counts include every sender (#2521)",
      got: `${before.aHere} | ${before.aThere} | ${before.b} | ${before.c}`,
      want: "DM=2/1 PUB=4/2 | PUB_OTHER=1/1 | DM=1/0 PUB=3/1 | DM=3/0 PUB=5/0",
    },
    {
      name: "a blocker's unread and mention counts skip the blocked member's messages in that chapter (#2521)",
      got: blocked.aHere,
      // PUB keeps userC's mention and the null-sender row; DM keeps its row.
      want: "DM=0/0 PUB=2/1",
    },
    {
      name: "a bystander's counts are unchanged by someone else's block (#2521)",
      got: blocked.c,
      want: before.c,
    },
    {
      name: "the blocked member's own counts are unchanged by being blocked (no oracle) (#2521)",
      got: blocked.b,
      want: before.b,
    },
    {
      name: "a block is per chapter: one in CH leaves CH_OTHER's counts, and one in CH_OTHER leaves CH's (#2521)",
      got: `${blocked.aThere} | ${blockedElsewhere.aHere}`,
      want: `${before.aThere} | ${before.aHere}`,
    },
    {
      name: "unblocking restores the pre-block counts from the unmoved read cursor (#2521)",
      got: unblocked.aHere,
      want: before.aHere,
    },
  ];
  for (const s of UNREAD_BLOCK_SCENARIOS) {
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
    `MISS  unread counts skip a blocked sender (#2521)\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
  );
}
