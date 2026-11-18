import { db, miss } from "../harness.mjs";

// ─── Read receipts on direct messages (#5519, Paul, 2026-11-18) ─────────────
//
// `get_channel_latest_messages.read_status` is read only through a mocked
// repository in the Jest suites, so this is the one place its rules run. What
// each scenario pins, and the edit it catches:
// - a DM's own last message is `sent` until the other member's cursor passes
//   it, then `read`; their message, or a channel's, carries no status;
// - a receiver who turned read receipts off never reports a read, and a
//   sender who turned them off is told about none (the switch is two-way);
// - a group DM is `read` only once every other member has read it;
// - a member who blocked the sender never counts as having read it;
// - an audit line in a DM is nobody's message to have sent.
try {
  const CH = "f0f0f0f0-0000-4000-8000-000000005519";
  const U = {
    a: "f1f1f1f1-0000-4000-8000-0000000055a1", // the sender
    b: "f1f1f1f1-0000-4000-8000-0000000055b1", // the other member of the DM
    c: "f1f1f1f1-0000-4000-8000-0000000055c1", // a third member of the group
  };
  const DM = "f2f2f2f2-0000-4000-8000-000000005501";
  const GROUP = "f2f2f2f2-0000-4000-8000-000000005502";
  const PUB = "f2f2f2f2-0000-4000-8000-000000005503";
  const AUDIT_DM = "f2f2f2f2-0000-4000-8000-000000005504";
  await db.exec(`
    insert into chapters (id, name, university) values ('${CH}', 'Read receipts', 'U');
    insert into users (id, supabase_auth_id, email, display_name) values
      ('${U.a}', gen_random_uuid(), 'rr-a@example.com', 'A'),
      ('${U.b}', gen_random_uuid(), 'rr-b@example.com', 'B'),
      ('${U.c}', gen_random_uuid(), 'rr-c@example.com', 'C');
    insert into chat_channels (id, chapter_id, name, type, member_ids) values
      ('${DM}', '${CH}', 'dm-rr', 'DM', array['${U.a}', '${U.b}']::uuid[]),
      ('${GROUP}', '${CH}', 'group', 'GROUP_DM', array['${U.a}', '${U.b}', '${U.c}']::uuid[]),
      ('${PUB}', '${CH}', 'general', 'PUBLIC', '{}'::uuid[]),
      ('${AUDIT_DM}', '${CH}', 'dm-rr-audit', 'DM', array['${U.a}', '${U.c}']::uuid[]);
    insert into chat_messages (channel_id, sender_id, content, kind, created_at) values
      ('${DM}', '${U.b}', 'hey', 'text', now() - interval '10 minutes'),
      ('${DM}', '${U.a}', 'hi back', 'text', now() - interval '5 minutes'),
      ('${GROUP}', '${U.a}', 'flyers?', 'text', now() - interval '5 minutes'),
      ('${PUB}', '${U.a}', 'to everyone', 'text', now() - interval '5 minutes'),
      ('${AUDIT_DM}', '${U.a}', '', 'system_audit', now() - interval '5 minutes');
  `);

  const LABEL = { [DM]: "DM", [GROUP]: "GROUP", [PUB]: "PUB", [AUDIT_DM]: "AUDIT" };
  // "<channel>=<status>" per channel, sorted; "-" for no status.
  const status = async (user) =>
    (
      await db.query(
        `select channel_id::text as id, read_status
           from public.get_channel_latest_messages($1, $2)`,
        [CH, user],
      )
    ).rows
      .map((r) => `${LABEL[r.id]}=${r.read_status ?? "-"}`)
      .sort()
      .join(" ");
  const read = (channel, user) =>
    db.exec(`
      insert into channel_read_receipts (channel_id, user_id, last_read_at)
      values ('${channel}', '${user}', now())
      on conflict (channel_id, user_id) do update set last_read_at = excluded.last_read_at;
    `);
  const setReceipts = (user, on) =>
    db.exec(`
      insert into user_settings (user_id, read_receipts) values ('${user}', ${on})
      on conflict (user_id) do update set read_receipts = excluded.read_receipts;
    `);

  const unread = await status(U.a);
  const receiverView = await status(U.b);
  await read(DM, U.b);
  await read(GROUP, U.b);
  const afterRead = await status(U.a);
  await read(GROUP, U.c);
  const groupAll = await status(U.a);
  await setReceipts(U.b, false);
  const receiverOff = await status(U.a);
  await setReceipts(U.b, true);
  await setReceipts(U.a, false);
  const senderOff = await status(U.a);
  await setReceipts(U.a, true);
  await db.exec(`
    insert into chat_member_blocks (chapter_id, blocker_user_id, blocked_user_id)
    values ('${CH}', '${U.b}', '${U.a}');
  `);
  const blockedBy = await status(U.a);

  const SCENARIOS = [
    {
      name: "the sender's own last DM message is sent until read; a channel and an audit line carry no status",
      got: unread,
      want: "AUDIT=- DM=sent GROUP=sent PUB=-",
    },
    {
      name: "someone else's message carries no status for the person who received it",
      got: receiverView,
      want: "AUDIT=- DM=- GROUP=- PUB=-",
    },
    {
      name: "a DM is read once the other member's cursor passes it; a group waits for everyone",
      got: afterRead,
      want: "AUDIT=- DM=read GROUP=sent PUB=-",
    },
    {
      name: "a group DM is read once every other member has read it",
      got: groupAll,
      want: "AUDIT=- DM=read GROUP=read PUB=-",
    },
    {
      name: "a receiver with read receipts off never reports a read, in a DM or a group",
      got: receiverOff,
      want: "AUDIT=- DM=sent GROUP=sent PUB=-",
    },
    {
      name: "a sender with read receipts off is told about no one's reads",
      got: senderOff,
      want: "AUDIT=- DM=sent GROUP=sent PUB=-",
    },
    {
      name: "a member who blocked the sender never counts as having read it",
      got: blockedBy,
      want: "AUDIT=- DM=sent GROUP=sent PUB=-",
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
    delete from chapters where id = '${CH}';
    delete from user_settings where user_id in ('${U.a}', '${U.b}', '${U.c}');
    delete from users where id in ('${U.a}', '${U.b}', '${U.c}');
  `);
} catch (e) {
  miss();
  console.log(
    `MISS  dm read receipts\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
  );
}
