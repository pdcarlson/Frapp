import { db, miss } from "../harness.mjs";

// ─── Functional: a deleted chat message takes its notifications (20261112140000)
//
// 20261112140000 ties a chat notification row to the message it quotes
// (`notifications.chat_message_id`) and adds two triggers (#4418). Replay only
// proves they compile; this tier drives them against seeded rows:
//
//   - soft-deleting a message deletes every recipient's row that quotes it,
//     and no other row (another message's, a bundle's, a non-chat row);
//   - an update that is not the delete (an edit, a pin) deletes nothing;
//   - a row inserted for a message that is already deleted is dropped, and the
//     insert does not fail;
//   - a row inserted for a live message lands;
//   - a hard delete of the message cascades to its rows.
//
// Everything runs inside one transaction and is rolled back.
console.log(
  "\n=== Functional: deleted chat message takes its notifications (20261112140000) ===",
);
{
  const id = (n) => `c4418000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const CH = id(1);
  const U1 = id(2);
  const U2 = id(3);
  const GEN = id(4);
  const M1 = id(11);
  const M2 = id(12);
  const M3 = id(13);
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  const bodies = async () =>
    (
      await db.query(
        `select body from notifications where chapter_id = $1 order by body`,
        [CH],
      )
    ).rows.map((r) => r.body);

  try {
    await db.exec(`
      begin;
      insert into chapters (id, name, university) values ('${CH}', 'C4418', 'U');
      insert into users (id, supabase_auth_id, email) values
        ('${U1}', gen_random_uuid(), 'c4418a@x.test'),
        ('${U2}', gen_random_uuid(), 'c4418b@x.test');
      insert into chat_channels (id, chapter_id, name, type, member_ids) values
        ('${GEN}', '${CH}', 'general', 'PUBLIC', '{}'::uuid[]);
      insert into chat_messages (id, channel_id, sender_id, content, kind) values
        ('${M1}', '${GEN}', '${U1}', 'harassing words', 'text'),
        ('${M2}', '${GEN}', '${U1}', 'kept words', 'text'),
        ('${M3}', '${GEN}', '${U1}', 'cascade words', 'text');
      insert into notifications (chapter_id, user_id, title, body, data, chat_message_id) values
        ('${CH}', '${U2}', 'A', 'm1 to u2', '{"target":{"screen":"chat"}}', '${M1}'),
        ('${CH}', '${U1}', 'A', 'm1 to u1', '{"target":{"screen":"chat"}}', '${M1}'),
        ('${CH}', '${U2}', 'A', 'm2 to u2', '{"target":{"screen":"chat"}}', '${M2}'),
        ('${CH}', '${U2}', 'A', 'm3 to u2', '{"target":{"screen":"chat"}}', '${M3}'),
        ('${CH}', '${U2}', 'A', 'bundle', '{"target":{"screen":"chat"},"bundled":true}', null),
        ('${CH}', '${U2}', 'A', 'dues', '{}', null);
    `);

    await db.exec(
      `update chat_messages set content = 'edited', is_pinned = true where id = '${M1}';`,
    );
    const afterEdit = await bodies();
    check(
      "an edit or a pin deletes no notification",
      afterEdit.length === 6,
      afterEdit,
    );

    await db.exec(
      `update chat_messages set content = '[message deleted]', is_deleted = true where id = '${M1}';`,
    );
    const afterDelete = await bodies();
    check(
      "a soft delete removes every recipient's row about that message, and only those",
      JSON.stringify(afterDelete) ===
        JSON.stringify(["bundle", "dues", "m2 to u2", "m3 to u2"]),
      afterDelete,
    );

    const late = await db.query(
      `insert into notifications (chapter_id, user_id, title, body, data, chat_message_id)
       values ($1, $2, 'A', 'late m1', '{}', $3) returning id`,
      [CH, U2, M1],
    );
    check(
      "a row for a message already deleted is dropped without an error",
      late.rows.length === 0 && !(await bodies()).includes("late m1"),
      late.rows,
    );

    const live = await db.query(
      `insert into notifications (chapter_id, user_id, title, body, data, chat_message_id)
       values ($1, $2, 'A', 'late m2', '{}', $3) returning id`,
      [CH, U2, M2],
    );
    check("a row for a live message lands", live.rows.length === 1, live.rows);

    await db.exec(`delete from chat_messages where id = '${M3}';`);
    const afterHard = await bodies();
    check(
      "a hard delete of the message cascades to its rows",
      !afterHard.includes("m3 to u2") && afterHard.includes("m2 to u2"),
      afterHard,
    );
  } catch (e) {
    check(
      "deleted chat message notifications scenario ran",
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
