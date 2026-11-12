import { db, miss } from "../harness.mjs";

// ─── The thread card's latest-reply preview (#4297) ──────────────────────────
//
// `chat_messages.thread_last_reply` is kept by two triggers that the Jest
// suites never run (`20261112020000_chat_thread_last_reply.sql`). What each
// scenario pins:
// - a reply sets it, an older one landing late doesn't replace a newer one;
// - `attachment_count` is the reply's number, else 0;
// - editing an older reply writes nothing, editing the held one updates it;
// - deleting the held one falls back to the newest left, then to null;
// - the helper and trigger functions aren't callable by a client role.
try {
  const CH = "f3f3f3f3-0000-4000-8000-000000004297";
  const U = "f4f4f4f4-0000-4000-8000-000000004297";
  const GEN = "f5f5f5f5-0000-4000-8000-000000004297";
  const ROOT = "f6f6f6f6-0000-4000-8000-000000004297";
  const R = (n) => `f7f7f7f7-0000-4000-8000-00000000429${n}`;
  const at = (minutes) => `now() - interval '${60 - minutes} minutes'`;
  await db.exec(`
    insert into chapters (id, name, university) values ('${CH}', 'Preview', 'U');
    insert into users (id, supabase_auth_id, email, display_name) values
      ('${U}', gen_random_uuid(), 'thr-preview@example.com', 'P');
    insert into chat_channels (id, chapter_id, name, type, member_ids) values
      ('${GEN}', '${CH}', 'general', 'PUBLIC', '{}'::uuid[]);
    insert into chat_messages (id, channel_id, sender_id, content, created_at) values
      ('${ROOT}', '${GEN}', '${U}', 'root', ${at(1)});
  `);
  const held = async () =>
    (
      await db.query(
        `select coalesce(thread_last_reply ->> 'content', '∅') ||
                '/' || coalesce(thread_last_reply ->> 'attachment_count', '∅') as s
           from chat_messages where id = $1`,
        [ROOT],
      )
    ).rows[0]?.s;

  await db.exec(`
    insert into chat_messages (id, channel_id, sender_id, content, thread_root_id, metadata, created_at) values
      ('${R(1)}', '${GEN}', '${U}', 'first', '${ROOT}', '{"attachment_count": 2}', ${at(5)});
  `);
  const afterFirst = await held();
  await db.exec(`
    insert into chat_messages (id, channel_id, sender_id, content, thread_root_id, metadata, created_at) values
      ('${R(2)}', '${GEN}', '${U}', 'second', '${ROOT}', '{"attachment_count": "x"}', ${at(9)});
    insert into chat_messages (id, channel_id, sender_id, content, thread_root_id, created_at) values
      ('${R(3)}', '${GEN}', '${U}', 'late', '${ROOT}', ${at(3)});
  `);
  const afterLate = await held();
  await db.exec(
    `update chat_messages set content = 'first, edited' where id = '${R(1)}'`,
  );
  const afterOldEdit = await held();
  await db.exec(
    `update chat_messages set content = 'second, edited' where id = '${R(2)}'`,
  );
  const afterHeldEdit = await held();
  await db.exec(
    `update chat_messages set content = '[message deleted]', is_deleted = true where id = '${R(2)}'`,
  );
  const afterHeldDelete = await held();
  await db.exec(
    `update chat_messages set is_deleted = true where id in ('${R(1)}', '${R(3)}')`,
  );
  const afterAllDeleted = await held();
  const grants = (
    await db.query(
      `select has_function_privilege('authenticated', 'public.chat_thread_reply_preview(public.chat_messages)', 'execute')
           or has_function_privilege('authenticated', 'public.chat_messages_keep_thread_last_reply()', 'execute') as open`,
    )
  ).rows[0]?.open;

  const SCENARIOS = [
    {
      name: "a reply sets the parent's preview, with its attachment count",
      got: afterFirst,
      want: "first/2",
    },
    {
      name: "a newer reply replaces it, an older one landing late does not",
      got: afterLate,
      want: "second/0",
    },
    {
      name: "editing an older reply leaves it; editing the held one updates it",
      got: `${afterOldEdit} ${afterHeldEdit}`,
      want: "second/0 second, edited/0",
    },
    {
      name: "deleting the held reply falls back to the newest left, then to none",
      got: `${afterHeldDelete} ${afterAllDeleted}`,
      want: "first, edited/2 ∅/∅",
    },
    {
      name: "the preview helper and its trigger aren't callable by a signed-in client",
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
    delete from users where id = '${U}';
  `);
} catch (e) {
  miss();
  console.log(
    `MISS  thread latest-reply preview\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
  );
}
