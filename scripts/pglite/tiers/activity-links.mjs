import { db, miss } from "../harness.mjs";

// ─── Links on Activity (#3897) ──────────────────────────────────────────────
//
// `activity_action_links`, the `chat_messages` index triggers and the
// `anonymize_user` purge are reached from the API only through mocked
// repositories, so this is the one place their SQL runs. What each check
// pins, and the edit it catches:
// - the host list: a sign-up host counts, another Google file type does not,
//   and a URL with userinfo never does (its real host is after the `@`);
// - trailing punctuation is not part of the URL;
// - a send indexes with the channel's chapter, the sender and the thread root;
// - an edit drops a removed link and keeps the other, with an officer's
//   removal intact; a delete drops them all;
// - a Discord author link (a `sender_id` rewrite) moves the poster;
// - account deletion deletes the member's Done and Hide states.
try {
  const CH = "a1a1a1a1-0000-4000-8000-000000003897";
  const CHAN = "a2a2a2a2-0000-4000-8000-000000003897";
  const U = {
    a: "a3a3a3a3-0000-4000-8000-00000000000a",
    b: "a3a3a3a3-0000-4000-8000-00000000000b",
  };
  const MSG = "a4a4a4a4-0000-4000-8000-000000000001";
  const ROOT = "a4a4a4a4-0000-4000-8000-000000000002";
  const REPLY = "a4a4a4a4-0000-4000-8000-000000000003";
  await db.exec(`
    insert into chapters (id, name, university) values ('${CH}', 'Links', 'U');
    insert into users (id, supabase_auth_id, email, display_name) values
      ('${U.a}', gen_random_uuid(), 'links-a@example.com', 'A'),
      ('${U.b}', gen_random_uuid(), 'links-b@example.com', 'B');
    insert into chat_channels (id, chapter_id, name, type)
    values ('${CHAN}', '${CH}', 'general', 'PUBLIC');
  `);

  const extracted = async (body) =>
    (
      await db.query(
        `select url, host from public.activity_action_links($1) order by url`,
        [body],
      )
    ).rows
      .map((r) => `${r.host} ${r.url}`)
      .join(" | ");
  const links = async (message) =>
    (
      await db.query(
        `select url, posted_by::text as by, chapter_id::text as chapter,
                thread_root_id::text as root, removed_at is not null as removed
           from chat_message_links where message_id = $1 order by url`,
        [message],
      )
    ).rows;
  const checks = [];

  checks.push(
    [
      (await extracted(
        "fill https://forms.gle/abc. and https://www.docs.google.com/spreadsheets/d/1/edit!",
      )) ===
        "forms.gle https://forms.gle/abc | docs.google.com https://www.docs.google.com/spreadsheets/d/1/edit",
      "sign-up hosts count, trailing punctuation stripped, www. dropped from the host",
    ],
    [
      (await extracted(
        "https://forms.cloud.microsoft/r/x https://docs.google.com/a/school.edu/forms/d/x/viewform",
      )) ===
        "docs.google.com https://docs.google.com/a/school.edu/forms/d/x/viewform | forms.cloud.microsoft https://forms.cloud.microsoft/r/x",
      "Microsoft Forms' current domain and a Google Workspace path count",
    ],
    [
      (await extracted(
        "https://docs.google.com/presentation/d/1 https://youtube.com/watch?v=1",
      )) === "",
      "another Google file type and another host do not count",
    ],
    [
      (await extracted(
        "https://calendly.com:1@evil.example/x https://docs.google.com:x@evil.example/forms/a https://u@forms.gle/z",
      )) === "",
      "a URL with userinfo never counts, whatever host it names first",
    ],
  );

  await db.exec(`
    insert into chat_messages (id, channel_id, sender_id, content) values
      ('${MSG}', '${CHAN}', '${U.a}', 'https://forms.gle/one and https://calendly.com/two'),
      ('${ROOT}', '${CHAN}', '${U.a}', 'thread root');
    insert into chat_messages (id, channel_id, sender_id, content, thread_root_id)
    values ('${REPLY}', '${CHAN}', '${U.b}', 'https://forms.gle/reply', '${ROOT}');
  `);
  const sent = await links(MSG);
  checks.push(
    [
      sent.length === 2 &&
        sent.every((r) => r.by === U.a && r.chapter === CH && r.root === null),
      "a send indexes each link with the chapter and the sender",
    ],
    [
      (await links(REPLY))[0]?.root === ROOT,
      "a thread reply's link carries its thread root",
    ],
  );

  await db.exec(`
    update chat_message_links set removed_at = now(), removed_by = '${U.b}'
     where message_id = '${MSG}' and url = 'https://calendly.com/two';
    update chat_messages set content = 'only https://calendly.com/two now'
     where id = '${MSG}';
  `);
  const edited = await links(MSG);
  checks.push([
    edited.length === 1 &&
      edited[0].url === "https://calendly.com/two" &&
      edited[0].removed === true,
    "an edit drops the link it removed and keeps the other, removal intact",
  ]);

  await db.exec(
    `update chat_messages set sender_id = '${U.b}' where id = '${MSG}';`,
  );
  checks.push([
    (await links(MSG))[0]?.by === U.b,
    "a sender_id rewrite (Discord author link) moves the poster",
  ]);

  await db.exec(
    `update chat_messages set is_deleted = true where id = '${MSG}';`,
  );
  checks.push([
    (await links(MSG)).length === 0,
    "a deleted message takes its links with it",
  ]);

  await db.exec(`
    insert into chat_link_member_states (link_id, user_id, chapter_id, state)
    select id, '${U.a}', '${CH}', 'done' from chat_message_links
     where message_id = '${REPLY}';
  `);
  await db.query(`select public.anonymize_user($1)`, [U.a]);
  const left = (
    await db.query(
      `select count(*)::int as n from chat_link_member_states where user_id = $1`,
      [U.a],
    )
  ).rows[0].n;
  checks.push([
    left === 0,
    "account deletion deletes the member's link states",
  ]);

  console.log("\n=== Links on Activity (#3897) ===");
  for (const [ok, name] of checks) {
    if (ok) {
      console.log(`OK    ${name}`);
    } else {
      miss();
      console.log(`MISS  ${name} (#3897)`);
    }
  }

  await db.exec(`
    delete from chapters where id = '${CH}';
    delete from users where id in ('${U.a}', '${U.b}');
  `);
} catch (e) {
  miss();
  console.log(
    `MISS  links on Activity (#3897)\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
  );
}
