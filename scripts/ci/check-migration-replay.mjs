#!/usr/bin/env node

// Production migration REPLAY gate.
//
// The question this answers is the one no other check in this repo asks:
// "will these migrations apply to the database they are actually about to be
// applied to?"
//
// ── Why `pglite-migrations` is not this ─────────────────────────────────────
// `scripts/check-pglite-migrations.mjs` applies every migration to an EMPTY
// database. That proves the corpus is internally consistent from zero. It
// cannot prove an INCREMENTAL apply works, and those are different questions:
// production is not an empty database, it is a database sitting at some
// specific applied version, and `supabase db push` only ever runs the tail.
//
// A migration can pass from-zero and fail incrementally — it is the ordinary
// case, not an exotic one. Two examples that a from-zero run is structurally
// blind to:
//
//   * A back-dated migration. Its version sorts before versions production has
//     already applied, so from zero it runs in the middle of the corpus, where
//     the object it needs does not exist yet — or does. Against production it
//     runs LAST, after everything. Same file, different neighbours.
//   * A migration written against the schema as the corpus leaves it, when
//     production is behind and does not have that shape yet.
//
// So this gate reconstructs production's CURRENT applied state on a disposable
// database, and then applies only what is actually pending — the same set, in
// the same order, through the same Supabase CLI code path that
// `run-migration.mjs` will use against the real thing.
//
// ── What "reconstructs" means, and its one honest limit ─────────────────────
// The reconstruction is built from the REPO's copies of the migrations
// production reports as applied. That is faithful exactly as long as every
// applied version still exists in the repo and its file has not been edited
// since it was applied.
//
// The first condition is checkable and IS checked: a version applied on
// production that exists in no repo file is `foreign`, and a foreign version is
// a hard failure here. It has happened (`20260228000000_enable_rls_on_
// remaining_tables`, hand-applied in February 2026, since reconciled), it also
// blocks `supabase db push` outright, and a gate that quietly replayed 51 of 52
// migrations and called it a pass would be worse than no gate.
//
// The second condition is NOT checkable from here — nothing records the bytes
// production applied — and this gate does not claim otherwise. It is the same
// assumption the whole migrations-as-files model already rests on.
//
// ── Read-only against production ────────────────────────────────────────────
// The only production access is a GET to the Management API's migration-history
// endpoint, borrowed wholesale from `check-migration-drift.mjs`. No SQL is sent
// to production, ever. Every apply in this file targets the disposable local
// database.
//
// Semantics: the pure functions below. Unit tests:
// `scripts/ci/__tests__/check-migration-replay.test.mjs`.

import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";

import { fetchAppliedMigrations, readLocalMigrations } from "./check-migration-drift.mjs";
import { resilientFetch } from "./lib/http.mjs";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");
// Files are moved here, not copied and deleted: a rename inside one filesystem
// is atomic and cannot half-finish, so an interrupted run leaves every
// migration in exactly one of the two directories rather than in neither.
const PARKED_DIR = join(process.cwd(), "supabase", ".migrations-replay-parked");

// ── Pure semantics ──────────────────────────────────────────────────────────

/**
 * Split the repo's migrations against what a database reports as applied.
 *
 *   baseline    — in the repo AND applied remotely. The state to reconstruct.
 *   pending     — in the repo, NOT applied remotely. The set under test.
 *   foreign     — applied remotely, in no repo file. Fatal (see header).
 *   backDated   — pending, but sorting BEFORE the newest applied version.
 *
 * `backDated` is FATAL, and used to be merely reported. The comment that
 * justified staying silent said "`supabase db push` applies such a migration at
 * the END regardless of where its version sorts". That is false, and it is the
 * reason #1373 shipped. Measured against the pinned CLI 2.77.0 on 2026-08-29,
 * applying `20260102000000` to a database already holding `20260103000000`:
 *
 *   $ supabase migration up --db-url ...
 *   Connecting to local database...
 *   Found local migration files to be inserted before the last migration on remote database.
 *
 *   Rerun the command with --include-all flag to apply these migrations:
 *   supabase/migrations/20260102000000_b.sql
 *   $ echo $?
 *   1
 *
 * Exit 1, nothing applied, ledger unchanged — and `db push` carries the same
 * `--include-all` flag with the same description, so it refuses identically.
 * The CLI does not reorder; it stops.
 *
 * `db push` and `migration up` are not merely similar here: `internal/db/push`
 * calls `up.GetPendingMigrations`, the same entry point, and both bind
 * `--include-all` to the same flag. So the replay's phase 2 DOES reproduce the
 * refusal — this gate is not covering a hole in the rehearsal.
 *
 * It is decided here for three smaller reasons that still add up. The verdict
 * needs no Docker and no database rebuild. It carries the remedy, where the
 * replay path surfaces the CLI's own text with no repo-specific advice. And it
 * names the fault as an ordering fault rather than as a failure "applying" some
 * file, which is what the replay's file attribution reports.
 *
 * Two scope limits worth stating, because both shape what the message can
 * honestly advise. This gate reads the PENDING set — every local migration the
 * target has not applied — not the set a change introduces, so a back-dated
 * migration already merged on `main` fails it for an author who did not cause
 * it. And it reads ONE database, so it cannot know whether the offending file
 * has been applied elsewhere, which is exactly what decides between "rename it"
 * and "renaming it stalls another environment". `check-migration-order.mjs` has
 * neither limit: it reads head-minus-base against both environments and has a
 * `stranded` clause for the applied-elsewhere case. That is why this gate's
 * message leads with "check whether this is yours" rather than with a remedy.
 *
 * What it does NOT do is close #1373. That incident was invisible here for a
 * structural reason: this gate reconstructs PRODUCTION's applied state, and
 * production had not yet applied the newer migration — staging had, and staging
 * is where the apply refused. Relative to production, `backDated` was empty and
 * the gate passed correctly. The check that covers that class is
 * `scripts/ci/check-migration-order.mjs`, which reads staging and production
 * both. Keep both; neither subsumes the other.
 */
export function partitionMigrations({ local, applied }) {
  const appliedVersions = new Set(applied.map((m) => m.version));
  const localVersions = new Set(local.map((m) => m.version));

  const baseline = local.filter((m) => appliedVersions.has(m.version));
  const pending = local.filter((m) => !appliedVersions.has(m.version));
  const foreign = applied.filter((m) => !localVersions.has(m.version));

  // Highest version the remote has actually applied. Empty remote => no
  // migration can be back-dated relative to nothing.
  const newestApplied = applied.reduce(
    (max, m) => (max === null || m.version.localeCompare(max) > 0 ? m.version : max),
    null,
  );
  const backDated =
    newestApplied === null
      ? []
      : pending.filter((m) => m.version.localeCompare(newestApplied) < 0);

  return { baseline, pending, foreign, backDated, newestApplied };
}

/** Human summary of a partition, for the log and the step summary. */
export function describePartition({ baseline, pending, foreign, backDated }, label = "production") {
  const lines = [];
  lines.push(`Applied on ${label} and present in the repo (baseline): ${baseline.length}`);
  lines.push(`Pending — the set this gate replays: ${pending.length}`);
  for (const m of pending) lines.push(`  + ${m.file}`);
  if (backDated.length > 0) {
    lines.push(
      `Back-dated — version sorts before the newest applied version, which the CLI refuses` +
        ` outright and a from-zero run cannot see (FATAL): ${backDated.length}`,
    );
    for (const m of backDated) lines.push(`  ~ ${m.file}`);
  }
  if (foreign.length > 0) {
    lines.push(`Applied on ${label} but in NO repo file (foreign): ${foreign.length}`);
    for (const m of foreign) lines.push(`  ! ${m.version} ${m.name}`);
  }
  return lines.join("\n");
}

/**
 * The gate's verdict, given a partition and whether the replay applies cleanly.
 *
 * Split out from the I/O so the decision table is unit-testable without a
 * database: the failure that matters most here is a gate that reports success
 * having verified nothing, and that is a logic bug, not a SQL bug.
 */
export function decideOutcome({ partition, replay }) {
  const { foreign, pending, backDated = [], newestApplied = null } = partition;

  if (foreign.length > 0) {
    return {
      ok: false,
      code: "foreign-migrations",
      message:
        `${foreign.length} migration(s) are applied on production but exist in no repo file. ` +
        `Production's state cannot be faithfully reconstructed, so this gate cannot certify ` +
        `anything — and \`supabase db push\` will refuse to run in this state anyway. ` +
        `Reconcile first: docs/internal/ops/DB_ROLLBACK_PLAYBOOK.md.`,
    };
  }

  // Decided BEFORE the replay, on purpose. The replay would fail too — phase 2
  // runs `migration up`, and `db push` calls that same `GetPendingMigrations`,
  // so both refuse identically (CLI 2.77.0, pkg/migration/apply.go, whose own
  // comment reads "Enforce migrations are applied in chronological order by
  // default"). Deciding here spends no Docker and no database rebuild to reach
  // a verdict already known, and reports an ordering fault as one — with the
  // rename remedy attached — rather than as a failure "applying" a file.
  if (backDated.length > 0) {
    const files = backDated.map((m) => `  ~ ${m.file}`).join("\n");
    return {
      ok: false,
      code: "back-dated-migrations",
      message:
        `${backDated.length} pending migration(s) sort BEFORE \`${newestApplied}\`, the newest ` +
        `version this database has already applied. The Supabase CLI refuses this outright — ` +
        `"Found local migration files to be inserted before the last migration on remote ` +
        `database" — so the apply would halt, not reorder:\n${files}\n\n` +
        `IMPORTANT — this gate reads the PENDING SET, not what your change introduced, so a file ` +
        `listed here may already be merged and may not be yours. Check that first: if it is ` +
        `already on the base branch, the fault is in the deploy path, not in your PR, and the ` +
        `person to tell is whoever owns the next production release.\n\n` +
        `Do NOT reach for a rename until you know where the file has been applied. This gate ` +
        `reads ONE database; another environment may already hold it, and renaming it there ` +
        `strands a \`schema_migrations\` row no file explains — a foreign row, which blocks ` +
        `\`db push\` to that environment entirely. \`migration-order\` is the check that reads ` +
        `both and can tell you.\n\n` +
        `If it is unapplied everywhere — the ordinary case for a migration still in review — ` +
        `rename it to a version after \`${newestApplied}\`, keeping its name. Otherwise read ` +
        `docs/internal/ops/DB_PROMOTION_RUNBOOK.md § \`--include-all\` first.`,
    };
  }

  if (pending.length === 0) {
    return {
      ok: true,
      code: "nothing-pending",
      message: "No migrations are pending against production — nothing to replay.",
    };
  }

  // A replay result is REQUIRED once there is something to replay. Defaulting a
  // missing result to "fine" is the exact false-green this gate is meant not to
  // be, so its absence is a failure.
  if (!replay) {
    return {
      ok: false,
      code: "replay-not-run",
      message:
        `${pending.length} migration(s) are pending but the replay did not run. ` +
        `Refusing to report success for an unverified apply.`,
    };
  }

  if (!replay.ok) {
    return {
      ok: false,
      code: "replay-failed",
      message:
        `Replay FAILED applying \`${replay.failedFile ?? "unknown"}\` against a database ` +
        `reconstructed at production's current state. This migration would fail the same way ` +
        `against production.\n\n${replay.error ?? ""}`.trim(),
    };
  }

  return {
    ok: true,
    code: "replay-clean",
    message:
      `${pending.length} pending migration(s) applied cleanly to a disposable database ` +
      `reconstructed at production's current applied state.`,
  };
}

// ── Disposable database ─────────────────────────────────────────────────────

function run(command, args, { allowFailure = false, quiet = false } = {}) {
  if (!quiet) console.log(`  $ ${command} ${args.join(" ")}`);
  try {
    return {
      ok: true,
      out: execFileSync(command, args, { encoding: "utf8", stdio: quiet ? "pipe" : "inherit" }),
    };
  } catch (error) {
    if (!allowFailure) throw error;
    return {
      ok: false,
      out: `${error.stdout ?? ""}${error.stderr ?? ""}` || String(error.message),
    };
  }
}

/**
 * Move the pending migrations out of the migrations directory, so that the
 * Supabase CLI's own reset applies exactly the baseline and nothing else.
 *
 * The alternative — hand-inserting rows into `supabase_migrations.schema_
 * migrations` — reconstructs the LEDGER without reconstructing the SCHEMA, so
 * the replay would then run against an empty database wearing production's
 * version numbers. That is a gate that always passes.
 */
function parkPending(pending) {
  if (pending.length === 0) return [];
  mkdirSync(PARKED_DIR, { recursive: true });
  const parked = [];
  for (const m of pending) {
    const from = join(MIGRATIONS_DIR, m.file);
    const to = join(PARKED_DIR, m.file);
    renameSync(from, to);
    parked.push(m.file);
  }
  return parked;
}

function restoreParked() {
  if (!existsSync(PARKED_DIR)) return 0;
  let restored = 0;
  for (const file of readdirSync(PARKED_DIR)) {
    renameSync(join(PARKED_DIR, file), join(MIGRATIONS_DIR, file));
    restored += 1;
  }
  rmSync(PARKED_DIR, { recursive: true, force: true });
  return restored;
}

/**
 * Two-phase replay against the local Supabase stack.
 *
 * Phase 1 rebuilds production's state; phase 2 is the actual test. Both go
 * through the real Supabase CLI rather than raw psql, because the CLI is what
 * runs against production — its transaction handling and its migration ledger
 * are part of what is under test.
 */
export function replayAgainstDisposable({
  pending,
  // In CI the Supabase CLI is installed on PATH by `supabase/setup-cli`, which
  // pins the version; `npx` is the local-developer fallback. Reading it from
  // the environment keeps the pinned CI binary from being silently replaced by
  // whatever `npx` decides to fetch.
  supabaseBin = process.env.REPLAY_SUPABASE_CLI ? process.env.REPLAY_SUPABASE_CLI : "npx",
  supabaseArgs = process.env.REPLAY_SUPABASE_CLI ? [] : ["--yes", "supabase"],
}) {
  const cli = (args, opts) => run(supabaseBin, [...supabaseArgs, ...args], opts);

  let parked = [];
  try {
    parked = parkPending(pending);
    console.log(`\n── Phase 1: rebuild production's applied state (${pending.length} pending file(s) parked)`);
    const reset = cli(["db", "reset", "--local"], { allowFailure: true, quiet: true });
    if (!reset.ok) {
      return {
        ok: false,
        phase: "baseline",
        failedFile: null,
        error:
          `Could not rebuild production's applied state — the BASELINE failed to apply, which ` +
          `is a problem with the reconstruction, not with the pending migrations.\n${reset.out}`,
      };
    }

    restoreParked();
    parked = [];

    console.log(`\n── Phase 2: apply the ${pending.length} pending migration(s)`);
    const up = cli(["migration", "up", "--local"], { allowFailure: true, quiet: true });
    if (!up.ok) {
      return {
        ok: false,
        phase: "pending",
        failedFile: guessFailedFile(up.out, pending),
        error: up.out,
      };
    }
    return { ok: true, phase: "pending", applied: pending.map((m) => m.file), log: up.out };
  } finally {
    // Unconditional, and deliberately not `if (parked.length > 0)`. If
    // `parkPending` throws partway through — three files moved, then a write
    // error — it never returns, so the outer `parked` is still `[]` and a
    // guarded restore would skip exactly the case that needs it, leaving
    // migrations stranded in the parked directory and the working tree short.
    // `restoreParked` is a no-op when the directory is absent, so calling it
    // always costs nothing and cannot get this wrong.
    restoreParked();
  }
}

/**
 * Which pending file did the CLI die on?
 *
 * The CLI logs `Applying migration <file>...` for EVERY file it starts, so the
 * failing one is the LAST one it announced, never the first. Scanning forwards
 * for any mentioned filename always answers with the earliest pending
 * migration, which is a confidently wrong answer — it sends whoever reads the
 * failure to debug a file that applied fine. Caught by the negative test on
 * 2026-08-28, where a broken `20260828120000` was reported as a failure in
 * `20260827190000`.
 */
export function guessFailedFile(output, pending) {
  if (!output) return null;
  const byName = new Map(pending.map((m) => [m.file, m.file]));

  const announced = [...output.matchAll(/Applying migration (\S+\.sql)/g)]
    .map((match) => match[1])
    .filter((file) => byName.has(file));
  if (announced.length > 0) return announced[announced.length - 1];

  // Fallback for a CLI whose wording changes: last mention wins, same reasoning.
  for (let i = pending.length - 1; i >= 0; i -= 1) {
    const m = pending[i];
    if (output.includes(m.file) || output.includes(m.version)) return m.file;
  }
  return null;
}

// ── Entry point ─────────────────────────────────────────────────────────────

function writeSummary(text) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  try {
    appendFileSync(path, `${text}\n`);
  } catch {
    /* a summary that cannot be written must not fail the gate */
  }
}

export async function runReplayGate({
  accessToken = process.env.SUPABASE_ACCESS_TOKEN,
  projectRef = process.env.SUPABASE_PROJECT_REF,
  migrationsDir = MIGRATIONS_DIR,
  fetchImpl = resilientFetch,
  replayImpl = replayAgainstDisposable,
  label = "production",
} = {}) {
  const local = readLocalMigrations(migrationsDir);
  if (local.length === 0) {
    console.error(`No migrations found in ${migrationsDir}.`);
    return 2;
  }

  const remote = await fetchAppliedMigrations({ accessToken, projectRef, fetchImpl });
  if (!remote.ok) {
    // Deliberately fatal, matching `migration-drift`'s posture: an unreadable
    // production state means this gate verified nothing, and "verified nothing"
    // must never render as a green check.
    console.error(`::error::Could not read ${label}'s applied migrations: ${remote.error}`);
    return 1;
  }

  const partition = partitionMigrations({ local, applied: remote.migrations });
  console.log(describePartition(partition, label));

  // Back-dated is decided without a replay for the same reason foreign is: the
  // apply cannot proceed in that state, so rebuilding a database to prove it
  // would spend several minutes of Docker to reach a verdict already known.
  let replay = null;
  if (
    partition.foreign.length === 0 &&
    partition.backDated.length === 0 &&
    partition.pending.length > 0
  ) {
    replay = replayImpl({ pending: partition.pending });
  }

  const outcome = decideOutcome({ partition, replay });
  const heading = outcome.ok ? "### Migration replay: PASS" : "### Migration replay: FAIL";
  writeSummary(`${heading}\n\n${outcome.message}\n\n\`\`\`\n${describePartition(partition, label)}\n\`\`\``);

  // Machine-readable, on purpose. A caller needs to distinguish "rehearsed the
  // pending set" from "there was nothing to rehearse" — both exit 0, and only
  // one of them verified anything. deploy-production.yml reads this line for its
  // run summary; parsing the human message instead is how that summary silently
  // started claiming a rehearsal that never happened.
  console.log(`replay_outcome=${outcome.code}`);

  if (!outcome.ok) {
    console.error(`::error::${outcome.message.split("\n")[0]}`);
    console.error(outcome.message);
    return 1;
  }
  console.log(`\n✅ ${outcome.message}`);
  return 0;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function getArg(name) {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  if (v === undefined || v.startsWith("--")) {
    console.error(`Error: ${name} requires a value.`);
    process.exit(2);
  }
  return v;
}

/**
 * `--applied-from <file>` replaces the Management API call with a recorded
 * applied-migration list.
 *
 * This is what makes an incident reproducible. The production state that
 * produced a failure is a moment in time; once production moves on, the run
 * that failed can never be re-run against the real API. A recorded state
 * replays it exactly, offline, with no production credentials and no network —
 * which is also how this gate is exercised in the repo's own test suite.
 */
function fetchFromFile(path) {
  const rows = JSON.parse(readFileSync(path, "utf8"));
  const migrations = Array.isArray(rows) ? rows : rows.migrations;
  return async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ migrations }),
  });
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith("check-migration-replay.mjs");
if (isDirectRun) {
  const appliedFrom = getArg("--applied-from");
  process.exit(
    await runReplayGate({
      fetchImpl: appliedFrom ? fetchFromFile(appliedFrom) : fetch,
      label: getArg("--label") ?? (appliedFrom ? `recorded state (${appliedFrom})` : "production"),
      // A recorded state needs no credentials; the fetch is stubbed out.
      accessToken: appliedFrom ? "offline" : process.env.SUPABASE_ACCESS_TOKEN,
      projectRef: appliedFrom ? "offline" : process.env.SUPABASE_PROJECT_REF,
    }),
  );
}
