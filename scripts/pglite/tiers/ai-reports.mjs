import { db, miss } from "../harness.mjs";

// ─── Functional: Report this (20261112220000, #4315) ─────────────────────────
//
// The one place AI text is stored on purpose. It checks:
//
//   - a report can't be kept longer than 30 days, and holds ciphertext only;
//   - one report per member per thing;
//   - deleting an account (`anonymize_user`) deletes the reports that member
//     made, and every report quoting them, and no other;
//   - RLS is on with no policies, so no client role reads the table;
//   - the AI tables' text columns are the ones the spec allows. A new text
//     or JSON column on an AI table fails here until it is added to the list
//     below with the reason it may hold what it holds (`ai.md` § Stored AI
//     text: nothing else stores prompt or answer text).
//
// Everything runs inside one transaction and is rolled back.
console.log("\n=== Functional: Report this (20261112220000) ===");
{
  const CH = "b4315000-0000-4000-8000-00000000000a";
  const U1 = "b4315000-0000-4000-8000-0000000000a1";
  const U2 = "b4315000-0000-4000-8000-0000000000a2";
  const U3 = "b4315000-0000-4000-8000-0000000000a3";
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
  const report = (
    by,
    quoted,
    { days = 30, sealed = "v1.k.n.t.c", subject } = {},
  ) =>
    db.query(
      `insert into ai_reports
         (chapter_id, reported_by, subject_type, subject_id, reason, sealed,
          quoted_user_ids, created_at, expires_at)
       values ($1, $2, 'ask_answer', coalesce($6::uuid, gen_random_uuid()), 'wrong', $3,
               $4::uuid[], now(), now() + make_interval(days => $5))`,
      [CH, by, sealed, quoted, days, subject ?? null],
    );
  const reporters = async () =>
    (await rows(`select reported_by from ai_reports order by reported_by`)).map(
      (r) => r.reported_by,
    );

  // Each AI table's text and JSON columns, and why each may hold what it
  // holds. Anything not listed fails the last check: a new column that could
  // hold prompt or answer text is a decision, written down here.
  const MAY_HOLD_TEXT = {
    "ai_reports.sealed": "the report itself, ciphertext only (#4315)",
    "ai_reports.note": "the reporter's own words",
    "ai_diagnostics_exchanges.sealed":
      "the diagnostics window, ciphertext only",
    "meeting_drafts.notes":
      "the officer's notes, kept only while the minutes are a draft",
    "meeting_drafts.result":
      "the draft, kept only while the minutes are a draft",
    "ai_suggestions.payload": "the proposal, emptied once decided",
    "ai_suggestions.quote": "the source's words, nulled once decided",
    "corpus_chunks.content":
      "the chapter's own records, indexed (not AI output)",
    "corpus_chunks.heading": "a heading from the chapter's own records",
    "corpus_sources.title": "the name of the chapter's own record",
  };
  // Ids, codes, statuses, model and prompt names: never text a person or a
  // model wrote. Explicit, so a new column is never waved through by name.
  const BOOKKEEPING = new Set([
    "ai_reports.model",
    "ai_reports.prompt_version",
    "ai_reports.quoted_user_ids",
    "ai_reports.reason",
    "ai_reports.subject_type",
    "ai_runs.dedupe_key",
    "ai_runs.failure_reason",
    "ai_runs.input_ref",
    "ai_runs.kind",
    "ai_runs.locked_by",
    "ai_runs.result_ref",
    "ai_runs.status",
    "ai_suggestions.dedupe_key",
    "ai_suggestions.kind",
    "ai_suggestions.required_permission",
    "ai_suggestions.source_type",
    "ai_suggestions.status",
    "ai_usage_events.error_kind",
    "ai_usage_events.family",
    "ai_usage_events.model",
    "ai_usage_events.outcome",
    "ai_usage_events.prompt_version",
    "ai_usage_events.provider",
    "ai_usage_events.status",
    "ai_usage_events.task",
    "corpus_chunks.author_ids",
    "corpus_chunks.embedding_model",
    "corpus_sources.index_fingerprint",
    "corpus_sources.left_out_author_ids",
    "corpus_sources.skip_reason",
    "corpus_sources.source_type",
    "corpus_sources.status",
    "meeting_drafts.failure_code",
    "meeting_drafts.status",
  ]);

  try {
    await db.exec(`
      begin;
      insert into chapters (id, name, university) values ('${CH}', 'A', 'U');
      insert into users (id, supabase_auth_id, email, display_name) values
        ('${U1}', gen_random_uuid(), 'r1@example.com', 'One'),
        ('${U2}', gen_random_uuid(), 'r2@example.com', 'Two'),
        ('${U3}', gen_random_uuid(), 'r3@example.com', 'Three');
      insert into members (user_id, chapter_id) values
        ('${U1}', '${CH}'), ('${U2}', '${CH}'), ('${U3}', '${CH}');
    `);

    check(
      "a report can't be kept longer than 30 days",
      await refused(() => report(U1, [], { days: 31 })),
      {},
    );
    check(
      "a report holds ciphertext only",
      await refused(() =>
        report(U1, [], { sealed: "the answer in the clear" }),
      ),
      {},
    );
    const SAME = "b4315000-0000-4000-8000-0000000000f1";
    await report(U1, [], { subject: SAME });
    check(
      "a member reports the same thing once",
      await refused(() => report(U1, [], { subject: SAME })),
      {},
    );

    // U1 reported something quoting U2; U3 reported something quoting nobody.
    await report(U1, [U2]);
    await report(U3, []);
    await db.query(`select anonymize_user($1)`, [U2]);
    const afterQuoted = await reporters();
    check(
      "deleting an account deletes every report quoting it",
      JSON.stringify(afterQuoted) === JSON.stringify([U1, U3]),
      { afterQuoted },
    );
    await db.query(`select anonymize_user($1)`, [U1]);
    const afterReporter = await reporters();
    check(
      "deleting an account deletes the reports it made, and no other",
      JSON.stringify(afterReporter) === JSON.stringify([U3]),
      { afterReporter },
    );

    const security = await rows(
      `select c.relrowsecurity,
              (select count(*)::int from pg_policies p where p.tablename = c.relname) as policies
         from pg_class c where c.relname = 'ai_reports'`,
    );
    check(
      "ai_reports has RLS on and no policies",
      security.length === 1 &&
        security[0].relrowsecurity === true &&
        security[0].policies === 0,
      { security },
    );

    const columns = await rows(
      `select table_name || '.' || column_name as col
         from information_schema.columns
        where table_schema = 'public'
          and (table_name like 'ai\\_%' or table_name like 'corpus\\_%'
               or table_name in ('meeting_drafts', 'user_ai_consents', 'chapter_ai_settings'))
          and data_type in ('text', 'jsonb', 'json', 'character varying', 'ARRAY')
        order by 1`,
    );
    const unexplained = columns
      .map((r) => r.col)
      .filter((col) => !(col in MAY_HOLD_TEXT) && !BOOKKEEPING.has(col));
    check(
      "every text column on an AI table is one the spec allows",
      unexplained.length === 0,
      { unexplained },
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
        `MISS  ${r.name}\n        ↳ ${JSON.stringify(r.detail).slice(0, 1200)}`,
      );
    }
  }
}
