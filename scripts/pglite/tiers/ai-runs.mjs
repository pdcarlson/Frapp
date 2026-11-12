import { db, miss } from "../harness.mjs";
import { ANON_KEY, probeAs, signedIn } from "../probe.mjs";

// ─── AI runs (#4310) ─────────────────────────────────────────────────────────
//
// `ai_runs`, `enqueue_ai_run` and `claim_ai_run` are reached from the API only
// through a mocked client, so this is where their SQL runs. Each check calls
// the functions the way `SupabaseAiRunRepository` does, and the worker's later
// writes are the same compare-and-set it sends (`lock_token` and `running`).
// What each pins:
// - enqueueing a dedupe key twice makes one run and returns the first;
// - the row refuses text: the ids-only check on `input_ref` and `result_ref`;
// - two workers never hold the same run: a second claim inside the lease gets
//   nothing, and a worker whose lease was taken over writes nothing with its
//   old token (the race between two claims at the same instant is the
//   integration spec's, `test/integration/ai-run-claim.integration-spec.ts`,
//   since one PGlite connection cannot run two transactions at once);
// - a dead worker's run is claimed again once its lease runs out, and its
//   attempt count rises, on a clock the test sets;
// - a run that used its tries ends as failed (`attempts_exhausted`) on the
//   next claim, which moves on to the next run;
// - a pause before a retry holds the run until it ends;
// - a member reads no run by any client role, and no client role may call
//   the functions.
console.log("\n=== AI runs (#4310) ===");
try {
  const CH = "a1a1a1a1-0000-4000-8000-000000004310";
  const CH2 = "a1a1a1a1-0000-4000-8000-000000004311";
  const U = "a3a3a3a3-0000-4000-8000-000000004310";
  const MEETING = "a6a6a6a6-0000-4000-8000-000000004310";
  const T0 = "2026-11-12T10:00:00Z";
  const LEASE = 300;
  const at = (seconds) =>
    new Date(Date.parse(T0) + seconds * 1000).toISOString();

  await db.exec(`
    insert into chapters (id, name, university) values
      ('${CH}', 'AI runs', 'U'),
      ('${CH2}', 'AI runs two', 'U');
    insert into users (id, supabase_auth_id, email, display_name) values
      ('${U}', gen_random_uuid(), 'ai-runs@example.com', 'Officer');
  `);

  const rejects = async (sql, params = []) => {
    try {
      await db.query(sql, params);
      return false;
    } catch {
      return true;
    }
  };
  const enqueue = async (
    chapter,
    key,
    input = { meeting_id: MEETING },
    max = 3,
  ) =>
    (
      await db.query(
        `select * from enqueue_ai_run($1, 'minutes_draft', $2, $3, $3, $4::jsonb, $5)`,
        [chapter, key, U, JSON.stringify(input), max],
      )
    ).rows;
  // The kinds the calling API process serves, as an array literal.
  const claim = async (worker, now, kinds = ["minutes_draft"]) =>
    (
      await db.query(
        `select * from claim_ai_run($1, $2::timestamptz, $3, $4::text[])`,
        [worker, now, LEASE, `{${kinds.join(",")}}`],
      )
    ).rows;
  // What `SupabaseAiRunRepository.complete` sends.
  const complete = async (id, token, now) =>
    (
      await db.query(
        `update ai_runs
            set status = 'succeeded', result_ref = '{}'::jsonb, lock_token = null,
                locked_by = null, lease_expires_at = null, finished_at = $3, updated_at = $3
          where id = $1 and lock_token = $2 and status = 'running'
          returning id`,
        [id, token, now],
      )
    ).rows.length;
  // What `SupabaseAiRunRepository.retryLater` sends.
  const pause = async (id, token, until, now) =>
    (
      await db.query(
        `update ai_runs
            set status = 'queued', lock_token = null, locked_by = null,
                lease_expires_at = $3, updated_at = $4
          where id = $1 and lock_token = $2 and status = 'running'
          returning id`,
        [id, token, until, now],
      )
    ).rows.length;
  const row = async (id) =>
    (
      await db.query(
        `select status, attempt_count, failure_reason, lock_token, finished_at
           from ai_runs where id = $1`,
        [id],
      )
    ).rows[0];
  const checks = [];

  // Dedupe.
  const first = await enqueue(CH, `meeting:${MEETING}`);
  const second = await enqueue(CH, `meeting:${MEETING}`);
  const otherChapter = await enqueue(CH2, `meeting:${MEETING}`);
  checks.push([
    first.length === 1 &&
      second.length === 1 &&
      second[0].id === first[0].id &&
      otherChapter[0].id !== first[0].id &&
      (
        await db.query(
          `select count(*)::int as n from ai_runs where chapter_id = $1`,
          [CH],
        )
      ).rows[0].n === 1,
    "enqueueing a dedupe key twice makes one run and returns the first; another chapter's key is its own",
  ]);
  checks.push([
    first[0].status === "queued" && first[0].attempt_count === 0,
    "a new run is queued with no tries",
  ]);

  // Ids only.
  checks.push([
    await rejects(
      `select * from enqueue_ai_run($1, 'minutes_draft', 'text:1', null, null, $2::jsonb, 3)`,
      [CH, JSON.stringify({ notes: "Brother Smith moved to adjourn" })],
    ),
    "an input carrying text is refused",
  ]);
  checks.push([
    await rejects(
      `select * from enqueue_ai_run($1, 'minutes_draft', 'text:2', null, null, $2::jsonb, 3)`,
      [CH, JSON.stringify({ ids: [MEETING, "Smith"] })],
    ),
    "an input list carrying text is refused",
  ]);
  checks.push([
    await rejects(
      `update ai_runs set result_ref = '{"summary":"The chapter voted"}' where id = $1`,
      [first[0].id],
    ),
    "a result carrying text is refused",
  ]);
  checks.push([
    await rejects(
      `select * from enqueue_ai_run($1, 'minutes_draft', 'notes from tuesday', null, null, '{}'::jsonb, 3)`,
      [CH],
    ),
    "a dedupe key with spaces is refused",
  ]);

  // Clear the other chapter's run out of the claim order.
  await db.query(`delete from ai_runs where chapter_id = $1`, [CH2]);
  const runId = first[0].id;

  // Claim and lease.
  const a = await claim("worker-a", T0);
  const b = await claim("worker-b", at(LEASE - 1));
  checks.push([
    a.length === 1 &&
      a[0].id === runId &&
      a[0].status === "running" &&
      a[0].attempt_count === 1,
    "a claim leases the run and counts the try",
  ]);
  checks.push([
    b.length === 0,
    "a second worker inside the lease claims nothing",
  ]);

  // The lease runs out: the run is claimed again as try 2.
  const b2 = await claim("worker-b", at(LEASE));
  checks.push([
    b2.length === 1 &&
      b2[0].id === runId &&
      b2[0].attempt_count === 2 &&
      b2[0].lock_token !== a[0].lock_token,
    "a run whose lease ran out is claimed again, as try 2",
  ]);
  checks.push([
    (await complete(runId, a[0].lock_token, at(LEASE + 1))) === 0 &&
      (await row(runId)).status === "running",
    "the worker that lost the lease writes nothing with its old token",
  ]);
  checks.push([
    (await complete(runId, b2[0].lock_token, at(LEASE + 1))) === 1 &&
      (await row(runId)).status === "succeeded",
    "the worker holding the lease finishes the run",
  ]);
  checks.push([
    (await claim("worker-c", at(10 * LEASE))).length === 0,
    "a finished run is never claimed again",
  ]);

  // Pause before a retry.
  const paused = (await enqueue(CH, "meeting:paused"))[0];
  const p1 = await claim("worker-a", at(20 * LEASE));
  await pause(
    paused.id,
    p1[0].lock_token,
    at(20 * LEASE + 120),
    at(20 * LEASE),
  );
  checks.push([
    (await claim("worker-b", at(20 * LEASE + 119))).length === 0,
    "a paused run is not claimed before its pause ends",
  ]);
  const p2 = await claim("worker-b", at(20 * LEASE + 120));
  checks.push([
    p2.length === 1 && p2[0].id === paused.id && p2[0].attempt_count === 2,
    "a paused run is claimed when its pause ends",
  ]);
  await complete(paused.id, p2[0].lock_token, at(20 * LEASE + 121));

  // Out of tries: the next claim fails it and moves on.
  const doomed = (await enqueue(CH, "meeting:doomed", {}, 2))[0];
  const next = (await enqueue(CH, "meeting:next"))[0];
  const base = 40 * LEASE;
  const d1 = await claim("worker-a", at(base));
  const d2 = await claim("worker-a", at(base + LEASE));
  checks.push([
    d1[0]?.id === doomed.id &&
      d2[0]?.id === doomed.id &&
      d2[0].attempt_count === 2,
    "a dead worker's run keeps being claimed until its tries are used",
  ]);
  const afterTries = await claim("worker-a", at(base + 2 * LEASE));
  const doomedRow = await row(doomed.id);
  checks.push([
    doomedRow.status === "failed" &&
      doomedRow.failure_reason === "attempts_exhausted" &&
      doomedRow.lock_token === null &&
      doomedRow.finished_at !== null,
    "a run that used its tries ends as failed, attempts_exhausted",
  ]);
  checks.push([
    afterTries.length === 1 && afterTries[0].id === next.id,
    "the same claim moves on to the next run",
  ]);

  // Only the kinds the caller serves. `next` is held by now and `doomed` is
  // finished, so the only claimable run is the other kind's.
  const otherKind = (
    await db.query(
      `select * from enqueue_ai_run($1, 'document_index', 'document:1', null, null, '{}'::jsonb, 3)`,
      [CH],
    )
  ).rows[0];
  const kindsAt = at(base + 2 * LEASE + 1);
  checks.push([
    (await claim("worker-old", kindsAt)).length === 0 &&
      (await claim("worker-none", kindsAt, [])).length === 0 &&
      (await row(otherKind.id)).attempt_count === 0,
    "a worker claims only kinds it serves, and a run of another kind keeps its tries",
  ]);
  const newBuild = await claim("worker-new", kindsAt, [
    "minutes_draft",
    "document_index",
  ]);
  checks.push([
    newBuild[0]?.id === otherKind.id,
    "a worker that serves the kind claims it",
  ]);

  // Asking again.
  const again = (await enqueue(CH, "meeting:doomed"))[0];
  checks.push([
    again.id === doomed.id &&
      again.status === "queued" &&
      again.attempt_count === 0 &&
      again.failure_reason === null &&
      again.finished_at === null,
    "enqueueing a failed run's key again queues the same run afresh",
  ]);
  const done = (await enqueue(CH, `meeting:${MEETING}`))[0];
  checks.push([
    done.id === runId && done.status === "succeeded",
    "enqueueing a succeeded run's key again returns it as it is",
  ]);

  // The claim's lock. The race itself needs real connections
  // (`apps/api/test/integration/ai-run-claim.integration-spec.ts`); this
  // keeps the clause that makes it hold from being dropped unseen.
  const claimSource = (
    await db.query(
      `select prosrc from pg_proc where proname = 'claim_ai_run' and pronamespace = 'public'::regnamespace`,
    )
  ).rows[0]?.prosrc;
  checks.push([
    /for\s+update\s+skip\s+locked/i.test(claimSource ?? ""),
    "claim_ai_run takes its row with for update skip locked",
  ]);

  // Table invariants.
  checks.push([
    await rejects(`update ai_runs set status = 'failed' where id = $1`, [
      next.id,
    ]),
    "a failed run must say why",
  ]);
  checks.push([
    await rejects(
      `select * from claim_ai_run('w', now(), 0, '{minutes_draft}')`,
    ),
    "a lease shorter than 10 seconds is refused",
  ]);

  // Client roles.
  // In its own transaction, rolled back, so the per-reader `auth.*` stubs
  // `probeAs` writes do not outlive this tier.
  // The probe roles are made here, as `chat-black-box.mjs` makes them inside
  // its own rolled-back transaction, with a SELECT grant on the table so
  // "reads nothing" means RLS rather than a missing privilege.
  await db.exec(`
    begin;
    create role rls_probe nologin;
    grant authenticated to rls_probe;
    grant usage on schema public to rls_probe;
    grant select on public.ai_runs to rls_probe;
    create role rls_probe_anon nologin;
    grant anon to rls_probe_anon;
    grant usage on schema public to rls_probe_anon;
    grant select on public.ai_runs to rls_probe_anon;
  `);
  const readers = [
    await probeAs(signedIn(U), "select id from ai_runs"),
    await probeAs(ANON_KEY, "select id from ai_runs"),
  ];
  await db.exec("rollback;");
  checks.push([
    readers.every((probe) => probe.failure === null && probe.rows.length === 0),
    "no client role reads a run, not even the member who started it",
  ]);
  const execute = async (role, fn) =>
    (
      await db.query(`select has_function_privilege($1, $2, 'execute') as ok`, [
        role,
        fn,
      ])
    ).rows[0].ok;
  const fns = [
    "public.enqueue_ai_run(uuid, text, text, uuid, uuid, jsonb, integer)",
    "public.claim_ai_run(text, timestamptz, integer, text[])",
  ];
  let clientCanCall = false;
  for (const role of ["anon", "authenticated"]) {
    for (const fn of fns) {
      if (await execute(role, fn)) clientCanCall = true;
    }
  }
  checks.push([!clientCanCall, "no client role may enqueue or claim"]);

  for (const [ok, name] of checks) {
    if (ok) {
      console.log(`OK    ${name}`);
    } else {
      miss();
      console.log(`MISS  ${name} (#4310)`);
    }
  }

  await db.exec(`
    delete from chapters where id in ('${CH}', '${CH2}');
    delete from users where id = '${U}';
  `);
} catch (e) {
  miss();
  console.log(
    `MISS  AI runs (#4310)\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
  );
}
