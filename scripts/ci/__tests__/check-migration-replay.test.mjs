import { test } from "node:test";
import assert from "node:assert/strict";

import {
  decideOutcome,
  describePartition,
  guessFailedFile,
  partitionMigrations,
  runReplayGate,
} from "../check-migration-replay.mjs";
import { makeFetchMock } from "./helpers.mjs";

// ── Fixtures ────────────────────────────────────────────────────────────────
// Modeled on the real incident: production sat at 51 applied migrations with
// exactly one pending (`20260827190000_secdef_search_path_pg_temp`) while the
// `migrate-production` job waited 29m52s on a human click that added nothing
// the dry run had not already established.

const m = (version, name) => ({ version, name, file: `${version}_${name}.sql` });

const APPLIED = [
  m("00000000000000", "initial_schema"),
  m("20260823120000", "chat_message_authors"),
  m("20260824150000", "discord_connect_confirm"),
];
const PENDING_ONE = m("20260827190000", "secdef_search_path_pg_temp");
const LOCAL = [...APPLIED, PENDING_ONE];

// ── partitionMigrations ─────────────────────────────────────────────────────

test("partition splits the repo against what production reports as applied", () => {
  const p = partitionMigrations({ local: LOCAL, applied: APPLIED });
  assert.equal(p.baseline.length, 3);
  assert.deepEqual(
    p.pending.map((x) => x.version),
    ["20260827190000"],
  );
  assert.deepEqual(p.foreign, []);
  assert.deepEqual(p.backDated, []);
  assert.equal(p.newestApplied, "20260824150000");
});

test("a version applied on production but absent from the repo is foreign", () => {
  // The real one: 20260228000000_enable_rls_on_remaining_tables, hand-applied
  // in February and present in no branch.
  const applied = [...APPLIED, m("20260228000000", "enable_rls_on_remaining_tables")];
  const p = partitionMigrations({ local: LOCAL, applied });
  assert.deepEqual(
    p.foreign.map((x) => x.version),
    ["20260228000000"],
  );
});

test("a pending migration older than the newest applied one is flagged back-dated", () => {
  // The case a from-zero run is structurally blind to: from zero this file runs
  // in the middle of the corpus, against production it runs last.
  const backDated = m("20260101000000", "back_dated_fix");
  const p = partitionMigrations({ local: [...LOCAL, backDated], applied: APPLIED });
  assert.deepEqual(
    p.backDated.map((x) => x.version),
    ["20260101000000"],
  );
  // Still pending, not excluded — it will be applied for real.
  assert.ok(p.pending.some((x) => x.version === "20260101000000"));
});

test("nothing is back-dated when the remote has applied nothing", () => {
  const p = partitionMigrations({ local: LOCAL, applied: [] });
  assert.deepEqual(p.backDated, []);
  assert.equal(p.pending.length, LOCAL.length);
});

// ── decideOutcome — the false-green decision table ──────────────────────────

test("a foreign migration fails the gate before any replay is attempted", () => {
  const partition = partitionMigrations({
    local: LOCAL,
    applied: [...APPLIED, m("20260228000000", "enable_rls_on_remaining_tables")],
  });
  const outcome = decideOutcome({ partition, replay: null });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "foreign-migrations");
});

test("nothing pending passes without a replay", () => {
  const partition = partitionMigrations({ local: APPLIED, applied: APPLIED });
  const outcome = decideOutcome({ partition, replay: null });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.code, "nothing-pending");
});

test("pending work with NO replay result fails — an unrun gate is not a pass", () => {
  // The regression that matters most here. If this ever returns ok:true, the
  // check reports green having verified nothing, which is the exact failure
  // shape #1331 fixed three of.
  const partition = partitionMigrations({ local: LOCAL, applied: APPLIED });
  const outcome = decideOutcome({ partition, replay: null });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "replay-not-run");
});

test("a failed replay fails the gate and names the file", () => {
  const partition = partitionMigrations({ local: LOCAL, applied: APPLIED });
  const outcome = decideOutcome({
    partition,
    replay: { ok: false, failedFile: PENDING_ONE.file, error: 'relation "x" does not exist' },
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "replay-failed");
  assert.match(outcome.message, /secdef_search_path_pg_temp/);
});

test("a clean replay passes", () => {
  const partition = partitionMigrations({ local: LOCAL, applied: APPLIED });
  const outcome = decideOutcome({ partition, replay: { ok: true } });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.code, "replay-clean");
});

// ── guessFailedFile ─────────────────────────────────────────────────────────

test("the failing file is recovered from the CLI's error text", () => {
  const out = `Applying migration 20260827190000_secdef_search_path_pg_temp.sql...\nERROR: syntax error`;
  assert.equal(guessFailedFile(out, [PENDING_ONE]), PENDING_ONE.file);
  assert.equal(guessFailedFile("", [PENDING_ONE]), null);
  assert.equal(guessFailedFile("something unrelated", [PENDING_ONE]), null);
});

test("with several pending files the LAST one announced is the one that failed", () => {
  // Regression: the CLI announces every migration it starts, so a
  // forward scan for "any pending filename mentioned" always answers with the
  // FIRST pending file regardless of which one broke. Observed 2026-08-28 —
  // a deliberately broken 20260828120000 was reported as a failure in
  // 20260827190000, which is a wrong answer, not a vague one.
  const second = m("20260828120000", "replay_gate_negative_test");
  const out = [
    "Connecting to local database...",
    "Applying migration 20260827190000_secdef_search_path_pg_temp.sql...",
    "Applying migration 20260828120000_replay_gate_negative_test.sql...",
    'ERROR: relation "public.this_table_does_not_exist" does not exist (SQLSTATE 42P01)',
  ].join("\n");
  assert.equal(guessFailedFile(out, [PENDING_ONE, second]), second.file);
});

// ── runReplayGate — end to end, no database ─────────────────────────────────

const MIGRATIONS_PATH = "/database/migrations";
const appliedRoute = (migrations, status = 200) => [
  { method: "GET", path: MIGRATIONS_PATH, status, body: { migrations } },
];

test("an unreadable production state fails rather than passing unverified", async () => {
  const code = await runReplayGate({
    accessToken: "t",
    projectRef: "ref",
    migrationsDir: "supabase/migrations",
    fetchImpl: makeFetchMock(appliedRoute([], 500)).fetchImpl,
    replayImpl: () => {
      throw new Error("replay must not run when production state is unknown");
    },
  });
  assert.equal(code, 1);
});

test("the replay result drives the exit code", async () => {
  const local = "supabase/migrations";
  // Report every real repo migration as applied except none -> everything
  // pending; the stub replay decides the verdict.
  const failing = await runReplayGate({
    accessToken: "t",
    projectRef: "ref",
    migrationsDir: local,
    fetchImpl: makeFetchMock(appliedRoute([])).fetchImpl,
    replayImpl: () => ({ ok: false, failedFile: "x.sql", error: "nope" }),
  });
  assert.equal(failing, 1);

  const passing = await runReplayGate({
    accessToken: "t",
    projectRef: "ref",
    migrationsDir: local,
    fetchImpl: makeFetchMock(appliedRoute([])).fetchImpl,
    replayImpl: () => ({ ok: true }),
  });
  assert.equal(passing, 0);
});

// ── describePartition ───────────────────────────────────────────────────────

test("the summary names the pending files and any foreign versions", () => {
  const partition = partitionMigrations({
    local: LOCAL,
    applied: [...APPLIED, m("20260228000000", "enable_rls_on_remaining_tables")],
  });
  const text = describePartition(partition);
  assert.match(text, /20260827190000_secdef_search_path_pg_temp\.sql/);
  assert.match(text, /20260228000000/);
});

// `deploy-production.yml` parses `replay_outcome=<code>` out of this script's
// stdout to tell "rehearsed the pending set" from "there was nothing to
// rehearse" — both exit 0, and only one verified anything. The first cut of
// that step grepped the human message instead and silently reported every
// nothing-pending run as a real rehearsal. These pin the codes the workflow
// reads, so renaming one fails here rather than in a production run summary.
test("decideOutcome codes are the ones deploy-production.yml parses", () => {
  const nothingPending = decideOutcome({
    partition: { baseline: [{ version: "1" }], pending: [], foreign: [], backDated: [] },
    replay: null,
  });
  assert.equal(nothingPending.ok, true);
  assert.equal(nothingPending.code, "nothing-pending");

  const replayed = decideOutcome({
    partition: { baseline: [{ version: "1" }], pending: [{ version: "2" }], foreign: [], backDated: [] },
    replay: { ok: true },
  });
  assert.equal(replayed.ok, true);
  assert.notEqual(replayed.code, "nothing-pending");
});
