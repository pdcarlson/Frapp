import { db, miss } from "../harness.mjs";

// ─── Unread and mention counts: each skip rule on its own row (#4342) ─────────
//
// `get_channel_unread_counts` repeats its skip rules in two places: the
// channel count and the thread-mention count. The other unread tiers each
// prove one rule; this one gives every rule a row of its own, in both places,
// so dropping or mistyping any single predicate moves a number here. Every row
// below would count if its rule were missing:
// - channel: a deleted message, an imported one, the caller's own;
// - thread @mentions: a deleted reply, an imported one, the caller's own, and
//   one from a member the caller blocked.
// The control row in each place does count, and the fixture check proves the
// rows landed, so a fixture that silently failed can't pass as "skipped".
try {
  const CH = "e7e7e7e7-0000-4000-8000-000000004342";
  const U = {
    a: "e8e8e8e8-0000-4000-8000-00000000000a", // the caller
    b: "e8e8e8e8-0000-4000-8000-00000000000b", // blocked by the caller
    c: "e8e8e8e8-0000-4000-8000-00000000000c",
  };
  const GEN = "e9e9e9e9-0000-4000-8000-000000000001";
  const ROOT = "eaeaeaea-0000-4000-8000-000000000001";
  const at = (minutes) => `now() - interval '${60 - minutes} minutes'`;
  await db.exec(`
    insert into chapters (id, name, university) values ('${CH}', 'Unread filters', 'U');
    insert into users (id, supabase_auth_id, email, display_name) values
      ('${U.a}', gen_random_uuid(), 'uf-a@example.com', 'A'),
      ('${U.b}', gen_random_uuid(), 'uf-b@example.com', 'B'),
      ('${U.c}', gen_random_uuid(), 'uf-c@example.com', 'C');
    insert into chat_channels (id, chapter_id, name, type, member_ids) values
      ('${GEN}', '${CH}', 'general', 'PUBLIC', '{}'::uuid[]);
    insert into chat_member_blocks (chapter_id, blocker_user_id, blocked_user_id)
      values ('${CH}', '${U.a}', '${U.b}');
    -- Channel rows. Only the root counts.
    insert into chat_messages (id, channel_id, sender_id, content, mentions, created_at) values
      ('${ROOT}', '${GEN}', '${U.c}', 'root', '{}', ${at(1)});
    insert into chat_messages (channel_id, sender_id, content, mentions, is_deleted, created_at) values
      ('${GEN}', '${U.c}', '@A deleted', array['${U.a}'::uuid], true, ${at(2)}),
      ('${GEN}', '${U.a}', '@A own', array['${U.a}'::uuid], false, ${at(3)});
    insert into chat_messages (channel_id, sender_id, author_name, author_external_id, kind, content, mentions, created_at) values
      ('${GEN}', null, 'DiscordUser', '4342', 'imported', '@A imported', array['${U.a}'::uuid], ${at(4)});
    -- Thread replies that @mention the caller. Only the first counts.
    insert into chat_messages (channel_id, sender_id, content, thread_root_id, mentions, is_deleted, created_at) values
      ('${GEN}', '${U.c}', 'r live @A', '${ROOT}', array['${U.a}'::uuid], false, ${at(5)}),
      ('${GEN}', '${U.c}', 'r deleted @A', '${ROOT}', array['${U.a}'::uuid], true, ${at(6)}),
      ('${GEN}', '${U.a}', 'r own @A', '${ROOT}', array['${U.a}'::uuid], false, ${at(7)}),
      ('${GEN}', '${U.b}', 'r blocked @A', '${ROOT}', array['${U.a}'::uuid], false, ${at(8)});
    insert into chat_messages (channel_id, sender_id, author_name, author_external_id, kind, content, thread_root_id, mentions, created_at) values
      ('${GEN}', null, 'DiscordUser', '4342', 'imported', 'r imported @A', '${ROOT}', array['${U.a}'::uuid], ${at(9)});
  `);

  const landed = (
    await db.query(
      `select count(*) filter (where thread_root_id is null)::int as channel,
              count(*) filter (where thread_root_id is not null)::int as replies
         from chat_messages where channel_id = $1`,
      [GEN],
    )
  ).rows[0];
  const a = (
    await db.query(
      `select unread_count::int as u, mention_count::int as m
         from public.get_channel_unread_counts($1, $2) where channel_id = $3`,
      [CH, U.a, GEN],
    )
  ).rows[0];

  const SCENARIOS = [
    {
      name: "unread-filters fixture: 4 channel rows and 5 thread replies landed (#4342)",
      got: `${landed?.channel}/${landed?.replies}`,
      want: "4/5",
    },
    {
      name: "the channel count skips deleted, imported and own messages, one row each (#4342)",
      got: a?.u,
      want: 1,
    },
    {
      name: "thread mentions skip deleted, imported, own and blocked-sender replies, one row each (#4342)",
      got: a?.m,
      want: 1,
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
    delete from users where id in ('${U.a}', '${U.b}', '${U.c}');
  `);
} catch (e) {
  miss();
  console.log(
    `MISS  unread counts: each skip rule on its own row (#4342)\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
  );
}
