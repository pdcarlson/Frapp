import { db, miss } from "../harness.mjs";

// ─── Chat search with a filter and no text (#3965) ───────────────────────────
//
// `search_chat_messages_filtered` answers `GET /v1/search` when `q` is empty
// beside a message filter. It takes each channel's newest matches through an
// index and merges them, and builds its trait conditions per call. This tier
// proves the answer, not the plan (the plans and timings are in the PR and
// spec/behavior/search.md § Message filters):
// - it reads only the channels it is handed, never a sibling in the chapter;
// - each trait, the date bounds and the sender narrow as the spec says;
// - deleted messages and thread replies never come back;
// - the merge returns the overall newest rows, even when one channel holds
//   more matches than the limit;
// - a message with two attachments comes back once, and an attachment with no
//   content type is a file but not an image;
// - an unknown trait is an error, not a wider answer.
try {
  const CH = "f3965000-0000-4000-8000-000000000001";
  const U = { a: "f3965000-0000-4000-8000-0000000000aa", b: "f3965000-0000-4000-8000-0000000000bb" };
  const C = {
    one: "f3965000-0000-4000-8000-0000000c0001",
    two: "f3965000-0000-4000-8000-0000000c0002",
    hidden: "f3965000-0000-4000-8000-0000000c0003",
  };
  const M = (n) => `f3965000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  // minutes before a fixed instant, so the order is deterministic
  const at = (m) => `timestamptz '2026-11-01T12:00:00Z' - interval '${m} minutes'`;
  await db.exec(`
    insert into chapters (id, name, university) values ('${CH}', 'Search filters', 'U');
    insert into users (id, supabase_auth_id, email, display_name) values
      ('${U.a}', gen_random_uuid(), 'sf-a@example.com', 'A'),
      ('${U.b}', gen_random_uuid(), 'sf-b@example.com', 'B');
    insert into chat_channels (id, chapter_id, name, type) values
      ('${C.one}', '${CH}', 'one', 'PUBLIC'),
      ('${C.two}', '${CH}', 'two', 'PUBLIC'),
      ('${C.hidden}', '${CH}', 'hidden', 'PUBLIC');
    -- channel one: 12 plain messages from A, newest first at minutes 1..12
    insert into chat_messages (id, channel_id, sender_id, content, created_at)
      select ('f3965000-0000-4000-8000-' || lpad((100 + g)::text, 12, '0'))::uuid,
             '${C.one}', '${U.a}', 'plain ' || g, timestamptz '2026-11-01T12:00:00Z' - g * interval '1 minute'
      from generate_series(1, 12) g;
    -- channel two: B's link, poll, file and image, all older than channel one
    insert into chat_messages (id, channel_id, sender_id, content, kind, created_at) values
      ('${M(201)}', '${C.two}', '${U.b}', 'see https://example.com', 'text', ${at(100)}),
      ('${M(202)}', '${C.two}', '${U.b}', '', 'poll', ${at(101)}),
      ('${M(203)}', '${C.two}', '${U.b}', 'two files', 'text', ${at(102)}),
      ('${M(204)}', '${C.two}', '${U.b}', 'a photo', 'text', ${at(103)}),
      ('${M(205)}', '${C.two}', '${U.b}', 'untyped file', 'text', ${at(104)});
    -- never returned: deleted, a thread reply, and the channel not handed over
    insert into chat_messages (id, channel_id, sender_id, content, is_deleted, created_at) values
      ('${M(301)}', '${C.two}', '${U.b}', 'gone https://example.com', true, ${at(0)});
    insert into chat_messages (id, channel_id, sender_id, content, thread_root_id, created_at) values
      ('${M(302)}', '${C.two}', '${U.b}', 'reply https://example.com', '${M(201)}', ${at(0)});
    insert into chat_messages (id, channel_id, sender_id, content, kind, created_at) values
      ('${M(303)}', '${C.hidden}', '${U.b}', 'hidden https://example.com', 'poll', ${at(0)});
    insert into chat_message_attachments (message_id, channel_id, bucket, storage_path, filename, content_type) values
      ('${M(203)}', '${C.two}', 'chat', 'p/203a', 'a.pdf', 'application/pdf'),
      ('${M(203)}', '${C.two}', 'chat', 'p/203b', 'b.pdf', 'application/pdf'),
      ('${M(204)}', '${C.two}', 'chat', 'p/204', 'c.png', 'image/png'),
      ('${M(205)}', '${C.two}', 'chat', 'p/205', 'd', null),
      ('${M(303)}', '${C.hidden}', 'chat', 'p/303', 'e.png', 'image/png');
  `);

  const handed = `array['${C.one}', '${C.two}']::uuid[]`;
  const ids = async (sender, after, before, has, limit = 10) =>
    (
      await db.query(
        `select id from public.search_chat_messages_filtered(${handed}, $1, $2, $3, $4, $5)`,
        [sender, after, before, has, limit],
      )
    ).rows
      .map((r) => r.id.slice(-3))
      .join(",");

  const SCENARIOS = [
    {
      name: "a date-only search returns the overall newest 10 across channels, deleted and thread rows excluded (#3965)",
      got: await ids(null, "2000-01-01T00:00:00Z", null, []),
      want: "101,102,103,104,105,106,107,108,109,110",
    },
    {
      name: "the merge reaches an older channel once the newer one is exhausted (#3965)",
      got: await ids(null, null, "2026-11-01T11:00:00Z", []),
      want: "201,202,203,204,205",
    },
    {
      name: "has=link finds only the live, top-level link in a handed channel (#3965)",
      got: await ids(null, null, null, ["link"]),
      want: "201",
    },
    {
      name: "has=poll ignores the poll in a channel it was not handed (#3965)",
      got: await ids(null, null, null, ["poll"]),
      want: "202",
    },
    {
      name: "has=file returns each message once, an untyped attachment included (#3965)",
      got: await ids(null, null, null, ["file"]),
      want: "203,204,205",
    },
    {
      name: "has=image is an image content type only; file,image is the same (#3965)",
      got: `${await ids(null, null, null, ["image"])}|${await ids(null, null, null, ["file", "image"])}`,
      want: "204|204",
    },
    {
      name: "a sender narrows within the handed channels (#3965)",
      got: await ids(U.b, null, null, []),
      want: "201,202,203,204,205",
    },
    {
      name: "a sender with a trait narrows by both, through the flat sender path (#3965)",
      got: `${await ids(U.b, null, null, ["file"])}|${await ids(U.b, null, null, ["image"])}|${await ids(U.a, null, null, ["link"])}`,
      want: "203,204,205|204|",
    },
    {
      name: "after is inclusive and before exclusive (#3965)",
      got: await ids(null, "2026-11-01T11:57:00Z", "2026-11-01T11:59:00Z", []),
      want: "102,103",
    },
  ];

  let unknown;
  try {
    await ids(null, null, null, ["evil"]);
    unknown = "no error";
  } catch (e) {
    unknown = String(e?.message ?? e).includes("unknown has value") ? "refused" : String(e?.message ?? e);
  }
  SCENARIOS.push({
    name: "an unknown trait is refused, not ignored (#3965)",
    got: unknown,
    want: "refused",
  });

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
    delete from users where id in ('${U.a}', '${U.b}');
  `);
} catch (e) {
  miss();
  console.log(
    `MISS  chat search with a filter and no text (#3965)\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
  );
}
