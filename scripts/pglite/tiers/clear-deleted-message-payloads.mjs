import { readFileSync } from "node:fs";
import { join } from "node:path";

import { db, miss } from "../harness.mjs";

// ─── Functional: clear deleted messages' payloads (20261112060000) ──────────
//
// 20261112060000 removes the card data deleted chat messages still hold
// (#1575). It deletes production data, and replay runs it against an empty
// table, so replay alone proves nothing: dropping its `is_deleted` guard would
// wipe every live card and still replay green. This tier re-runs it against
// seeded rows and checks:
//
//   - a deleted card's payload is cleared, and its content, metadata and kind
//     are not touched;
//   - a live card, and a live imported row, keep their payload exactly;
//   - a deleted imported row keeps only `source` and `author_username`, and one
//     with no handle keeps only `source`;
//   - running it a second time changes nothing.
//
// Everything runs inside one transaction and is rolled back.
console.log(
  "\n=== Functional: clear deleted messages' payloads (20261112060000) ===",
);
{
  const CH = "c1575000-0000-4000-8000-000000000001";
  const U = "c1575000-0000-4000-8000-0000000000a1";
  const GEN = "c1575000-0000-4000-8000-0000000000c1";
  const msg = (n) => `c1575000-0000-4000-8000-00000000010${n}`;
  const sql = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20261112060000_clear_deleted_message_payloads.sql",
    ),
    "utf8",
  );
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  const row = async (id) =>
    (
      await db.query(
        `select content, kind, metadata, payload from chat_messages where id = $1`,
        [id],
      )
    ).rows[0];
  // jsonb stores keys in its own order, so compare with keys sorted.
  const canon = (v) =>
    Array.isArray(v)
      ? v.map(canon)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, canon(v[k])]),
          )
        : v;
  const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

  const card = { name: "Standards Board — Doe hearing", location: "House" };
  const archive = {
    source: "discord",
    author_username: "jkslayer",
    author_is_bot: false,
    reactions: [{ emoji: "🔥", count: 3 }],
    sticker_names: ["Doe hearing"],
  };

  try {
    await db.exec(`
      begin;
      insert into chapters (id, name, university) values ('${CH}', 'C1575', 'U');
      insert into users (id, supabase_auth_id, email) values
        ('${U}', gen_random_uuid(), 'c1575@x.test');
      insert into chat_channels (id, chapter_id, name, type, member_ids) values
        ('${GEN}', '${CH}', 'general', 'PUBLIC', '{}'::uuid[]);
      insert into chat_messages (id, channel_id, sender_id, content, kind, payload, metadata, is_deleted) values
        ('${msg(1)}', '${GEN}', '${U}', '[message deleted]', 'event', '${JSON.stringify(card)}', '{"kept":1}', true),
        ('${msg(2)}', '${GEN}', '${U}', '/event', 'event', '${JSON.stringify(card)}', '{}', false),
        ('${msg(3)}', '${GEN}', '${U}', '[message deleted]', 'imported', '${JSON.stringify(archive)}', '{"discord_import_id":"imp-1"}', true),
        ('${msg(4)}', '${GEN}', '${U}', 'hello', 'imported', '${JSON.stringify(archive)}', '{"discord_import_id":"imp-1"}', false),
        ('${msg(5)}', '${GEN}', '${U}', '[message deleted]', 'imported', '{"source":"discord","author_username":null,"reactions":[]}', '{}', true),
        ('${msg(6)}', '${GEN}', '${U}', '[message deleted]', 'text', null, '{}', true);
    `);

    await db.exec(sql);

    const deletedCard = await row(msg(1));
    check(
      "a deleted card's payload is cleared, and nothing else on it changes",
      deletedCard.payload === null &&
        deletedCard.content === "[message deleted]" &&
        deletedCard.kind === "event" &&
        same(deletedCard.metadata, { kept: 1 }),
      deletedCard,
    );
    check(
      "a live card keeps its payload",
      same((await row(msg(2))).payload, card),
      await row(msg(2)),
    );
    check(
      "a deleted imported row keeps only its source and Discord handle",
      same((await row(msg(3))).payload, {
        source: "discord",
        author_username: "jkslayer",
      }),
      await row(msg(3)),
    );
    check(
      "a live imported row keeps its whole archive payload",
      same((await row(msg(4))).payload, archive),
      await row(msg(4)),
    );
    check(
      "a deleted imported row with no handle keeps only its source",
      same((await row(msg(5))).payload, { source: "discord" }),
      await row(msg(5)),
    );

    const snapshot = async () =>
      (
        await db.query(
          `select string_agg(id::text || coalesce(payload::text, 'null'), '|' order by id) as s
           from chat_messages where channel_id = $1`,
          [GEN],
        )
      ).rows[0].s;
    const before = await snapshot();
    await db.exec(sql);
    const after = await snapshot();
    check(
      "running it twice changes nothing the second time",
      before === after,
      {
        before,
        after,
      },
    );
  } catch (e) {
    check(
      "clear deleted messages' payloads scenario ran",
      false,
      String(e?.message ?? e).split("\n")[0],
    );
  } finally {
    await db.exec("rollback;").catch(() => {});
  }

  for (const r of results) {
    if (r.ok) {
      console.log(`OK    ${r.name}`);
    } else {
      miss();
      console.log(`MISS  ${r.name}\n        ↳ ${JSON.stringify(r.detail)}`);
    }
  }
}
