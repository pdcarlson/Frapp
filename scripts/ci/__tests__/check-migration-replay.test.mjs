import { test } from "node:test";
import assert from "node:assert/strict";

import {
  decideOutcome,
  describePartition,
  guessFailedFile,
  partitionMigrations,
  runReplayGate,
} from "../check-migration-replay.mjs";
import { readLocalMigrations } from "../check-migration-drift.mjs";
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

// ── back-dated is FATAL (#1373) ─────────────────────────────────────────────
// The class: `20260829000000_rollover_promote_new_members` merged AFTER
// `20260829002000` had already been applied, and `supabase db push` refused.
// The gate computed `backDated`, logged it, and passed — its stated reason
// being that the CLI "applies such a migration at the END regardless of where
// its version sorts", which is not what the CLI does. Measured on 2026-08-29
// against the pinned 2.77.0: it exits 1, applies nothing, and prints
// "Found local migration files to be inserted before the last migration on
// remote database."

test("a back-dated pending migration fails the gate", () => {
  const backDated = m("20260101000000", "back_dated_fix");
  const partition = partitionMigrations({
    local: [...LOCAL, backDated],
    applied: APPLIED,
  });
  const outcome = decideOutcome({ partition, replay: { ok: true } });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "back-dated-migrations");
  assert.match(outcome.message, /20260101000000_back_dated_fix\.sql/);
  // The newest applied version, which is what the file must be renamed past.
  assert.match(outcome.message, /20260824150000/);
  // The message must NOT lead with "rename it". This gate reads one database
  // and the whole pending set, so it cannot know whether the file is the
  // author's, nor whether another environment has already applied it — and a
  // rename in that case strands a foreign row and blocks `db push` there.
  const remedyAt = outcome.message.search(/rename it to a version after/i);
  const warningAt = outcome.message.search(/may already be merged and may not be yours/i);
  const strandAt = outcome.message.search(/strands a `schema_migrations` row/i);
  assert.ok(warningAt !== -1, "must say the file may not be the author's");
  assert.ok(strandAt !== -1, "must warn that renaming an applied migration strands it");
  assert.ok(remedyAt !== -1, "must still give the remedy for the ordinary case");
  assert.ok(warningAt < remedyAt, "the caveat must come before the remedy");
  assert.ok(strandAt < remedyAt, "the stranding warning must come before the remedy");
  // And where to go when renaming is the wrong move.
  assert.match(outcome.message, /DB_PROMOTION_RUNBOOK\.md/);
  // The check that has neither scope limit, so the reader knows where to look.
  assert.match(outcome.message, /migration-order/);
});

test("back-dated beats a clean replay — a passing rehearsal cannot excuse it", () => {
  // The regression that would restore the old behaviour: if the replay's
  // verdict were consulted first, a rehearsal that happened to pass would
  // report the gate green on a migration the real apply refuses.
  const partition = partitionMigrations({
    local: [...LOCAL, m("20260101000000", "back_dated_fix")],
    applied: APPLIED,
  });
  assert.equal(decideOutcome({ partition, replay: { ok: true } }).ok, false);
  assert.equal(decideOutcome({ partition, replay: null }).code, "back-dated-migrations");
});

test("foreign still outranks back-dated", () => {
  // Both are fatal, but a foreign row means production's state cannot be
  // reconstructed at all, so it is the more fundamental complaint and must be
  // the one reported.
  const partition = partitionMigrations({
    local: [...LOCAL, m("20260101000000", "back_dated_fix")],
    applied: [...APPLIED, m("20260228000000", "enable_rls_on_remaining_tables")],
  });
  assert.equal(decideOutcome({ partition, replay: null }).code, "foreign-migrations");
});

test("an ordinary forward migration is still not back-dated", () => {
  // The false-positive guard. Every normal migration PR adds a version newer
  // than anything applied, and none of them may go red.
  const partition = partitionMigrations({ local: LOCAL, applied: APPLIED });
  assert.deepEqual(partition.backDated, []);
  assert.equal(decideOutcome({ partition, replay: { ok: true } }).code, "replay-clean");
});

test("the replay is not run at all when a migration is back-dated", async () => {
  // Reaching a known verdict costs no Docker: the CLI would refuse anyway, so
  // rebuilding a database to watch it refuse is minutes spent to learn nothing.
  //
  // The applied set is derived from REAL repo versions, every one of them minus
  // the earliest. An invented version like `99999999999999` would be FOREIGN,
  // and the foreign guard skips the replay first — so the test would pass with
  // the back-dated guard deleted, which is the one line it exists to protect.
  const local = "supabase/migrations";
  const repo = readLocalMigrations(local);
  const applied = repo.slice(1).map((m) => ({ version: m.version, name: m.name }));
  const partition = partitionMigrations({ local: repo, applied });
  assert.deepEqual(partition.foreign, [], "fixture must contain no foreign version");
  assert.ok(partition.backDated.length > 0, "fixture must be back-dated");

  const code = await runReplayGate({
    accessToken: "t",
    projectRef: "ref",
    migrationsDir: local,
    fetchImpl: makeFetchMock(appliedRoute(applied)).fetchImpl,
    replayImpl: () => {
      throw new Error("the replay must not run for a back-dated partition");
    },
  });
  assert.equal(code, 1);
});
