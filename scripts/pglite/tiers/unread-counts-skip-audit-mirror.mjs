import { db, miss } from "../harness.mjs";

// ─── Unread counts skip `#chapter-audit` mirror entries (2026-11-06) ─────────
//
// `get_channel_unread_counts` is called only through a mocked repository in the
// Jest suites, so this is the one place the rule runs. Owner decision: audit
// entries arrive silently. What each scenario pins, and the edit it catches:
// - an entry the audit mirror wrote (`system_audit`, `client_message_id`
//   `audit:<id>`) never counts, as unread or as a mention;
// - the server's other `system_audit` notices (no `audit:` key, a null key
//   included) still count, so a predicate on the kind alone fails here;
// - an ordinary message in the same channel still counts.
try {
  const CH = "e0e0e0e0-0000-4000-8000-0000000a0d17";
  const U = "e1e1e1e1-0000-4000-8000-0000000a0d17";
  const AUDIT = "e2e2e2e2-0000-4000-8000-0000000a0d17";
  await db.exec(`
    insert into chapters (id, name, university) values ('${CH}', 'Audit unread', 'U');
    insert into users (id, supabase_auth_id, email, display_name) values
      ('${U}', gen_random_uuid(), 'audit-unread@example.com', 'A');
    insert into chat_channels (id, chapter_id, name, type, member_ids) values
      ('${AUDIT}', '${CH}', 'chapter-audit', 'PUBLIC', '{}'::uuid[]);
    insert into chat_messages (channel_id, sender_id, author_name, content, kind, client_message_id, mentions) values
      ('${AUDIT}', null, 'Frapp', 'chapter_config_updated: branding', 'system_audit', 'audit:one', array['${U}']::uuid[]),
      ('${AUDIT}', null, 'Frapp', 'chapter_profile_updated: accent_color', 'system_audit', 'audit:two', '{}'::uuid[]),
      ('${AUDIT}', null, 'Frapp', 'This poll has closed.', 'system_audit', null, '{}'::uuid[]),
      ('${AUDIT}', null, 'Frapp', 'Welcome.', 'system_audit', 'welcome:1', '{}'::uuid[]),
      ('${AUDIT}', null, 'Frapp', 'a member wrote here', 'text', 'c0ffee00-0000-4000-8000-000000000001', '{}'::uuid[]);
  `);
  const { rows } = await db.query(
    `select unread_count::int as u, mention_count::int as m
       from public.get_channel_unread_counts($1, $2) where channel_id = $3`,
    [CH, U, AUDIT],
  );
  const got = rows.map((r) => `${r.u}/${r.m}`).join(" ");
  const scenario = {
    name: "unread counts skip #chapter-audit mirror entries and keep other system notices (2026-11-06)",
    got,
    // The poll notice, the welcome and the member's message: 3 unread. The
    // mirror entry's mention does not count either.
    want: "3/0",
  };
  if (scenario.got === scenario.want) {
    console.log(`OK    ${scenario.name}`);
  } else {
    miss();
    console.log(
      `MISS  ${scenario.name}\n        ↳ expected ${scenario.want}, got ${scenario.got}`,
    );
  }
  await db.exec(`
    delete from chapters where id = '${CH}';
    delete from users where id = '${U}';
  `);
} catch (e) {
  miss();
  console.log(
    `MISS  unread counts skip #chapter-audit mirror entries\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
  );
}
