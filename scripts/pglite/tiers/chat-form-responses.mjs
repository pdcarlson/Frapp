import { db, miss } from "../harness.mjs";

console.log(
  "\n=== Functional: form answers are saved privately, changed in place, and stop once closed (#3926 step 3) ===",
);
{
  // `save_chat_form_response` is the only writer of a form's answers, and
  // every API test mocks it. This proves its rules: a member's save inserts
  // their one row and a second save replaces it, a card that isn't a form or
  // is deleted is refused, a closed form or one past its end time refuses
  // every save, nobody but the API may call it or read the table, no answer
  // is broadcast over Realtime, and a deleted account's answers go with it.
  const CHAPTER = "b3926000-0000-4000-8000-00000000000c";
  const CHANNEL = "b3926000-0000-4000-8000-0000000000c1";
  const FORM = "b3926000-0000-4000-8000-0000000000d1";
  const TEXT = "b3926000-0000-4000-8000-0000000000d2";
  const GONE = "b3926000-0000-4000-8000-0000000000d3";
  const [A, B] = ["a1", "a2"].map(
    (s) => `b3926000-0000-4000-8000-0000000000${s}`,
  );
  const card = {
    title: "Room picks",
    questions: [{ id: "q1", type: "short_answer", title: "Name" }],
  };

  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  const save = async (user, answers, messageId = FORM) => {
    await db.exec("savepoint s3926f;");
    try {
      const { rows } = await db.query(
        `select (save_chat_form_response($1, $2, $3::jsonb)).*`,
        [messageId, user, JSON.stringify(answers)],
      );
      await db.exec("release savepoint s3926f;");
      return { ok: rows[0] };
    } catch (e) {
      await db.exec("rollback to savepoint s3926f;");
      return { error: String(e?.message ?? e) };
    }
  };

  try {
    await db.exec(`
      begin;
      insert into chapters (id, name, university) values ('${CHAPTER}', 'C', 'U');
      insert into users (id, supabase_auth_id, email, display_name) values
        ('${A}', gen_random_uuid(), 'b3926a@example.test', 'A'),
        ('${B}', gen_random_uuid(), 'b3926b@example.test', 'B');
      insert into chat_channels (id, chapter_id, name, type, member_ids) values
        ('${CHANNEL}', '${CHAPTER}', 'general', 'PUBLIC', '{}'::uuid[]);
      insert into chat_messages (id, channel_id, sender_id, content, kind, payload, is_deleted) values
        ('${FORM}', '${CHANNEL}', '${A}', 'Room picks', 'form', '${JSON.stringify(card)}', false),
        ('${TEXT}', '${CHANNEL}', '${A}', 'hi', 'text', null, false),
        ('${GONE}', '${CHANNEL}', '${A}', 'Old form', 'form', null, true);
    `);

    const first = await save(B, { q1: "Sam" });
    const second = await save(B, { q1: "Sam B" });
    const rows = (
      await db.query(
        `select count(*)::int as n, max(answers->>'q1') as q1,
                bool_and(updated_at >= created_at) as ordered
           from chat_form_responses where message_id = $1 and user_id = $2`,
        [FORM, B],
      )
    ).rows[0];
    check(
      "a save inserts the member's one row, and a second save replaces its answers",
      !!first.ok && !!second.ok && rows.n === 1 && rows.q1 === "Sam B" &&
        rows.ordered === true,
      { first, second, rows },
    );

    const notForm = await save(B, {}, TEXT);
    const deleted = await save(B, {}, GONE);
    check(
      "a card that isn't a form, or is deleted, is refused",
      /form_card_missing/.test(notForm.error ?? "") &&
        /form_card_missing/.test(deleted.error ?? ""),
      { notForm, deleted },
    );

    await db.exec(
      `update chat_messages set payload = payload || jsonb_build_object('closes_at', (now() - interval '1 minute')::text) where id = '${FORM}';`,
    );
    const pastEnd = await save(A, { q1: "A" });
    await db.exec(
      `update chat_messages set payload = (payload - 'closes_at') || jsonb_build_object('closed_at', now()::text) where id = '${FORM}';`,
    );
    const closedEarly = await save(B, { q1: "late change" });
    await db.exec(
      `update chat_messages set payload = (payload - 'closed_at') || '{"closes_at":"not a time"}'::jsonb where id = '${FORM}';`,
    );
    const oddEnd = await save(A, { q1: "A" });
    check(
      "a form past its end time or closed early refuses every save; an end time that doesn't parse is none",
      /form_closed/.test(pastEnd.error ?? "") &&
        /form_closed/.test(closedEarly.error ?? "") &&
        !!oddEnd.ok,
      { pastEnd, closedEarly, oddEnd },
    );

    const def = (
      await db.query(
        `select pg_get_functiondef('public.save_chat_form_response(uuid, uuid, jsonb)'::regprocedure) as d`,
      )
    ).rows[0].d;
    check(
      "a save waits for a close: the card's row is locked first",
      /from public\.chat_messages m[\s\S]*for share/i.test(def),
      null,
    );

    const access = (
      await db.query(
        `select
           has_function_privilege('authenticated', 'public.save_chat_form_response(uuid, uuid, jsonb)', 'execute') as authed,
           has_function_privilege('service_role', 'public.save_chat_form_response(uuid, uuid, jsonb)', 'execute') as service,
           (select relrowsecurity from pg_class where oid = 'public.chat_form_responses'::regclass) as rls,
           (select count(*)::int from pg_policies where tablename = 'chat_form_responses') as policies,
           (select count(*)::int from pg_publication_tables where tablename = 'chat_form_responses') as published`,
      )
    ).rows[0];
    check(
      "only the API may save or read answers, and none is broadcast",
      access.authed === false && access.service === true &&
        access.rls === true && access.policies === 0 &&
        access.published === 0,
      access,
    );

    await db.exec(`update users set deleted_at = now() where id = '${B}';`);
    const left = (
      await db.query(
        `select user_id from chat_form_responses where message_id = $1`,
        [FORM],
      )
    ).rows.map((r) => r.user_id);
    check(
      "a deleted account's answers are deleted, and nobody else's",
      left.length === 1 && left[0] === A,
      { left },
    );
  } catch (e) {
    check(
      "chat-form-responses scenario ran",
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
      console.log(
        `MISS  ${r.name}\n        ↳ ${JSON.stringify(r.detail ?? null).slice(0, 300)}`,
      );
    }
  }
}
