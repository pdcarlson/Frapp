import { db, miss } from "../harness.mjs";

// ─── Functional: ai_suggestions (20261112140130, #4309) ─────────────────────
//
// The table the API writes AI proposals to. It checks:
//
//   - a decided or expired row can't keep text (the payload, the quote or
//     whose words it was), so a decided suggestion holds no AI output;
//   - a row mid-accept (`accepting`) keeps its text and must say when the
//     accept began, so a failed accept can be put back intact;
//   - a batch can't be written twice: (batch_id, ordinal) is unique;
//   - deleting an event or a channel deletes its waiting and mid-accept
//     suggestions, keeps
//     its decided ones, and leaves another source's alone;
//   - a client role can't execute the trigger function.
//
// Everything runs inside one transaction and is rolled back.
console.log("\n=== Functional: ai_suggestions (20261112140130) ===");
{
  const CH = "a4309000-0000-4000-8000-00000000000a";
  const EV = "a4309000-0000-4000-8000-0000000000e1";
  const EV2 = "a4309000-0000-4000-8000-0000000000e2";
  const CHAN = "a4309000-0000-4000-8000-0000000000c1";
  const BATCH = "a4309000-0000-4000-8000-0000000000b1";
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  const rows = async (text, params = []) => (await db.query(text, params)).rows;
  const insert = (ordinal, source, sourceId, status = "pending", extra = "") =>
    db.query(
      `insert into ai_suggestions
         (chapter_id, batch_id, ordinal, kind, source_type, source_id, payload,
          quote, required_permission, status, decided_at, expires_at)
       values ($1, $2, $3, 'task', $4, $5, $6::jsonb, $7, 'tasks:manage', $8, $9,
               now() + interval '14 days') ${extra}`,
      [
        CH,
        BATCH,
        ordinal,
        source,
        sourceId,
        status === "pending" ? '{"title":"Book the venue"}' : "{}",
        status === "pending" ? "book the venue" : null,
        status,
        status === "accepted" || status === "dismissed" ? new Date() : null,
      ],
    );
  const refused = async (fn) => {
    await db.exec("savepoint expect_refusal");
    try {
      await fn();
      await db.exec("release savepoint expect_refusal");
      return false;
    } catch {
      await db.exec("rollback to savepoint expect_refusal");
      return true;
    }
  };

  try {
    await db.exec(`
      begin;
      insert into chapters (id, name, university) values ('${CH}', 'A', 'U');
      insert into events (id, chapter_id, name, start_time, end_time) values
        ('${EV}', '${CH}', 'Chapter meeting', now(), now() + interval '1 hour'),
        ('${EV2}', '${CH}', 'Exec meeting', now(), now() + interval '1 hour');
      insert into chat_channels (id, chapter_id, name, type)
        values ('${CHAN}', '${CH}', 'general', 'PUBLIC');
    `);

    await insert(0, "event", EV);
    await insert(1, "event", EV, "accepted");
    await insert(2, "event", EV2);
    await insert(3, "channel", CHAN);

    check(
      "a decided row can't keep its text",
      await refused(() =>
        db.query(
          `update ai_suggestions set status = 'accepted', decided_at = now()
            where batch_id = $1 and ordinal = 0`,
          [BATCH],
        ),
      ),
      {},
    );
    check(
      "an expired row can't keep its text",
      await refused(() =>
        db.query(
          `update ai_suggestions set status = 'expired'
            where batch_id = $1 and ordinal = 0`,
          [BATCH],
        ),
      ),
      {},
    );
    check(
      "a batch position can't be written twice",
      await refused(() => insert(0, "event", EV)),
      {},
    );
    check(
      "an unknown kind of source is refused",
      await refused(() => insert(9, "vault", EV)),
      {},
    );
    // #718: a member's own request is a source, and a card can propose a
    // points change or a new event (20261112240000_ai_act_suggestions.sql).
    const asked = (ordinal, kind) =>
      db.query(
        `insert into ai_suggestions
           (chapter_id, batch_id, ordinal, kind, source_type, source_id,
            payload, required_permission, expires_at)
         values ($1, $2, $3, $4, 'request', $5, '{}'::jsonb, 'points:adjust',
                 now() + interval '1 day')`,
        [CH, BATCH, ordinal, kind, EV],
      );
    check(
      "a member's request can hold a points change and a new event",
      !(await refused(() => asked(20, "points"))) &&
        !(await refused(() => asked(21, "new_event"))),
      {},
    );
    check(
      "an unknown kind of suggestion is refused",
      await refused(() => asked(22, "payment")),
      {},
    );
    await db.query(
      `delete from ai_suggestions where batch_id = $1 and ordinal in (20, 21)`,
      [BATCH],
    );

    check(
      "an accept can't begin without saying when",
      await refused(() =>
        db.query(
          `update ai_suggestions set status = 'accepting'
            where batch_id = $1 and ordinal = 0`,
          [BATCH],
        ),
      ),
      {},
    );
    check(
      "a row mid-accept keeps its text, and its push can be marked sent",
      !(await refused(() =>
        db.query(
          `update ai_suggestions
              set status = 'accepting', decided_at = now(), notified_at = now()
            where batch_id = $1 and ordinal = 0`,
          [BATCH],
        ),
      )),
      {},
    );

    await db.query(`delete from events where id = $1`, [EV]);
    const afterEvent = await rows(
      `select ordinal, status from ai_suggestions where batch_id = $1 order by ordinal`,
      [BATCH],
    );
    check(
      "deleting an event deletes its waiting and mid-accept suggestions and keeps its decided one",
      JSON.stringify(afterEvent.map((r) => [r.ordinal, r.status])) ===
        JSON.stringify([
          [1, "accepted"],
          [2, "pending"],
          [3, "pending"],
        ]),
      { afterEvent },
    );

    await db.query(`delete from chat_channels where id = $1`, [CHAN]);
    const afterChannel = await rows(
      `select ordinal from ai_suggestions where batch_id = $1 order by ordinal`,
      [BATCH],
    );
    check(
      "deleting a channel deletes its waiting suggestions only",
      JSON.stringify(afterChannel.map((r) => r.ordinal)) ===
        JSON.stringify([1, 2]),
      { afterChannel },
    );

    // Suggested tasks from minutes (20261112190000, #4313).
    const MTG = "a4309000-0000-4000-8000-0000000000d1";
    await db.query(
      `insert into meetings (id, chapter_id, event_name, event_start_time, meeting_type)
       values ($1, $2, 'Chapter meeting', now(), 'chapter')`,
      [MTG, CH],
    );
    const keyed = (ordinal, key, status = "pending") =>
      db.query(
        `insert into ai_suggestions
           (chapter_id, batch_id, ordinal, kind, source_type, source_id, payload,
            quote, required_permission, status, decided_at, expires_at, dedupe_key)
         values ($1, $2, $3, 'task', 'meeting', $4, $5::jsonb, $6, 'tasks:manage',
                 $7, $8, now() + interval '14 days', $9)`,
        [
          CH,
          BATCH,
          ordinal,
          MTG,
          status === "pending" ? '{"title":"Book the bus"}' : "{}",
          status === "pending" ? "Book the bus" : null,
          status,
          status === "pending" ? null : new Date(),
          key,
        ],
      );
    await keyed(10, "k-bus", "dismissed");
    await keyed(11, "k-invoice");
    check(
      "an action item already decided can't be proposed again",
      await refused(() => keyed(12, "k-bus")),
      {},
    );
    check(
      "the same action item can't wait twice",
      await refused(() => keyed(13, "k-invoice")),
      {},
    );
    await db.query(`delete from meetings where id = $1`, [MTG]);
    const afterMeeting = await rows(
      `select ordinal from ai_suggestions where batch_id = $1 and ordinal >= 10 order by ordinal`,
      [BATCH],
    );
    check(
      "deleting minutes deletes their waiting suggestions and keeps the decided one",
      JSON.stringify(afterMeeting.map((r) => r.ordinal)) ===
        JSON.stringify([10]),
      { afterMeeting },
    );

    const [grant] = await rows(
      `select has_function_privilege('authenticated',
         'public.ai_suggestions_drop_for_source()', 'execute') as ok`,
    );
    check(
      "a client role can't execute the trigger function",
      grant?.ok === false,
      { grant },
    );
  } catch (e) {
    check("the tier ran to the end", false, {
      error: String(e?.message ?? e).split("\n")[0],
    });
  } finally {
    await db.exec("rollback");
  }

  for (const r of results) {
    if (r.ok) {
      console.log(`OK    ${r.name}`);
    } else {
      miss();
      console.log(
        `MISS  ${r.name}\n        ↳ ${JSON.stringify(r.detail).slice(0, 600)}`,
      );
    }
  }
}
