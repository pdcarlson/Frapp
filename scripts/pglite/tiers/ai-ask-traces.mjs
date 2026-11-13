import { db, miss } from "../harness.mjs";

// ─── Functional: Ask traces and thumbs (20261113203728, #4902) ───────────────
//
// A trace of every Ask turn and the asker's thumbs on it, with no text in
// either. It checks:
//
//   - a text column takes a code and refuses a sentence, column by column;
//   - a trace can't be kept longer than 90 days;
//   - one thumbs per answer, a reason only on a down and only from the list;
//   - steps and thumbs go with their trace;
//   - an asker who leaves the chapter takes their traces with them, and
//     `anonymize_user` (account deletion) does the same;
//   - RLS is on with no policies, so no client role reads any of the three.
//
// Everything runs inside one transaction and is rolled back.
console.log("\n=== Functional: Ask traces and thumbs (20261113203728) ===");
{
  const CH = "a4902000-0000-4000-8000-00000000000a";
  const U1 = "a4902000-0000-4000-8000-0000000000a1";
  const U2 = "a4902000-0000-4000-8000-0000000000a2";
  const U3 = "a4902000-0000-4000-8000-0000000000a3";
  const ASK = (n) => `a4902000-0000-4000-8000-0000000000f${n}`;
  const SENTENCE = "When is the formal? Ask Jordan.";
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  const rows = async (text, params = []) => (await db.query(text, params)).rows;
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
  const trace = (id, user, over = {}) => {
    const row = {
      door: "ask",
      prompt_version: "ask.answer@v4",
      model: "claude-sonnet-5-5",
      effort: "default",
      outcome: "answered",
      limit_kind: null,
      error_kind: null,
      days: 90,
      ...over,
    };
    return db.query(
      `insert into ai_ask_traces
         (id, chapter_id, member_id, user_id, door, prompt_version, model, effort,
          outcome, limit_kind, error_kind, started_at, expires_at)
       select $1, m.chapter_id, m.id, m.user_id, $3, $4, $5, $6, $7, $8, $9,
              now(), now() + make_interval(days => $10)
         from members m where m.user_id = $2 and m.chapter_id = $11`,
      [
        id,
        user,
        row.door,
        row.prompt_version,
        row.model,
        row.effort,
        row.outcome,
        row.limit_kind,
        row.error_kind,
        row.days,
        CH,
      ],
    );
  };
  const step = (id, seq, over = {}) => {
    const row = { kind: "tool", tool: "search_messages", outcome: "ok", ...over };
    return db.query(
      `insert into ai_ask_trace_steps (trace_id, seq, round, kind, tool, outcome)
       values ($1, $2, 0, $3, $4, $5)`,
      [id, seq, row.kind, row.tool, row.outcome],
    );
  };
  const thumbs = (id, user, rating, reason = null) =>
    db.query(
      `insert into ai_ask_feedback (ask_id, chapter_id, user_id, rating, reason)
       values ($1, $2, $3, $4, $5)`,
      [id, CH, user, rating, reason],
    );
  const kept = async (table, column) =>
    (await rows(`select ${column} as v from ${table} order by 1`)).map((r) => r.v);

  try {
    await db.exec(`
      begin;
      insert into chapters (id, name, university) values ('${CH}', 'A', 'U');
      insert into users (id, supabase_auth_id, email, display_name) values
        ('${U1}', gen_random_uuid(), 't1@example.com', 'One'),
        ('${U2}', gen_random_uuid(), 't2@example.com', 'Two'),
        ('${U3}', gen_random_uuid(), 't3@example.com', 'Three');
      insert into members (user_id, chapter_id) values
        ('${U1}', '${CH}'), ('${U2}', '${CH}'), ('${U3}', '${CH}');
    `);

    const sentences = {};
    for (const column of [
      "door",
      "prompt_version",
      "model",
      "effort",
      "outcome",
      "limit_kind",
      "error_kind",
    ]) {
      sentences[column] = await refused(() =>
        trace(ASK(9), U1, { [column]: SENTENCE }),
      );
    }
    check(
      "no text column on a trace takes a sentence",
      Object.values(sentences).every(Boolean),
      { sentences },
    );
    check(
      "a trace can't be kept longer than 90 days",
      await refused(() => trace(ASK(9), U1, { days: 91 })),
      {},
    );

    await trace(ASK(1), U1);
    await trace(ASK(2), U2);
    await trace(ASK(3), U3);
    check(
      "an ask has one trace",
      await refused(() => trace(ASK(1), U1)),
      {},
    );

    await step(ASK(1), 0, { kind: "model", tool: null });
    await step(ASK(1), 1);
    await step(ASK(2), 0);
    await step(ASK(3), 0, { tool: null, outcome: "unknown_tool" });
    await step(ASK(3), 1, { outcome: "over_limit" });
    check(
      "a step's tool is a name, never a sentence",
      await refused(() => step(ASK(1), 2, { tool: SENTENCE })),
      {},
    );
    check(
      "a step's outcome is one of the list",
      await refused(() => step(ASK(1), 2, { outcome: SENTENCE })),
      {},
    );
    check(
      "a model round names no tool",
      await refused(() => step(ASK(1), 2, { kind: "model" })),
      {},
    );

    check(
      "a reason is one of the four",
      await refused(() => thumbs(ASK(1), U1, "down", SENTENCE)),
      {},
    );
    check(
      "a reason goes with a thumbs down only",
      await refused(() => thumbs(ASK(1), U1, "up", "wrong")),
      {},
    );
    check(
      "a rating is up or down",
      await refused(() => thumbs(ASK(1), U1, SENTENCE)),
      {},
    );
    await thumbs(ASK(1), U1, "down", "missed");
    await thumbs(ASK(2), U2, "up");
    await thumbs(ASK(3), U3, "down");
    check(
      "one thumbs per answer",
      await refused(() => thumbs(ASK(1), U1, "up")),
      {},
    );
    check(
      "a thumbs needs a trace to stand on",
      await refused(() => thumbs(ASK(8), U1, "up")),
      {},
    );

    await db.query(`delete from members where user_id = $1 and chapter_id = $2`, [
      U2,
      CH,
    ]);
    const afterLeave = {
      traces: await kept("ai_ask_traces", "user_id"),
      steps: await kept("ai_ask_trace_steps", "distinct trace_id"),
      thumbs: await kept("ai_ask_feedback", "user_id"),
    };
    check(
      "an asker who leaves the chapter takes their traces, steps and thumbs with them",
      JSON.stringify(afterLeave) ===
        JSON.stringify({
          traces: [U1, U3],
          steps: [ASK(1), ASK(3)],
          thumbs: [U1, U3],
        }),
      { afterLeave },
    );

    await db.query(`select anonymize_user($1)`, [U3]);
    const afterDelete = {
      traces: await kept("ai_ask_traces", "user_id"),
      steps: await kept("ai_ask_trace_steps", "distinct trace_id"),
      thumbs: await kept("ai_ask_feedback", "user_id"),
    };
    check(
      "deleting an account deletes the person's traces, steps and thumbs",
      JSON.stringify(afterDelete) ===
        JSON.stringify({ traces: [U1], steps: [ASK(1)], thumbs: [U1] }),
      { afterDelete },
    );

    // What the sweep and a No on the AI sheet both do: delete the trace.
    await db.query(`delete from ai_ask_traces where user_id = $1`, [U1]);
    const afterSweep = {
      steps: await kept("ai_ask_trace_steps", "trace_id"),
      thumbs: await kept("ai_ask_feedback", "user_id"),
    };
    check(
      "deleting a trace deletes its steps and its thumbs",
      afterSweep.steps.length === 0 && afterSweep.thumbs.length === 0,
      { afterSweep },
    );

    const security = await rows(
      `select c.relname, c.relrowsecurity,
              (select count(*)::int from pg_policies p where p.tablename = c.relname) as policies
         from pg_class c
        where c.relname in ('ai_ask_traces', 'ai_ask_trace_steps', 'ai_ask_feedback')
        order by c.relname`,
    );
    check(
      "all three tables have RLS on and no policies",
      security.length === 3 &&
        security.every((r) => r.relrowsecurity === true && r.policies === 0),
      { security },
    );

    // Every text column on the three is held to a code by a check, so the
    // list in `ai-reports.mjs` can call each one bookkeeping.
    const unchecked = await rows(
      `select c.table_name || '.' || c.column_name as col
         from information_schema.columns c
        where c.table_schema = 'public'
          and c.table_name in ('ai_ask_traces', 'ai_ask_trace_steps', 'ai_ask_feedback')
          and c.data_type in ('text', 'jsonb', 'json', 'character varying', 'ARRAY')
          and not exists (
            select 1
              from pg_constraint k
              join pg_class t on t.oid = k.conrelid
             where t.relname = c.table_name
               and k.contype = 'c'
               and pg_get_constraintdef(k.oid) like '%' || c.column_name || '%'
          )
        order by 1`,
    );
    check(
      "every text column on the three tables has a check holding it to a code",
      unchecked.length === 0,
      { unchecked },
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
