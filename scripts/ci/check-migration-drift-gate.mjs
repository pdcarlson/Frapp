#!/usr/bin/env node
// Migration-drift report for the `migration-drift` job in migration-drift-gate.yml.
//
// This is the SECOND drift check in this repo and the two are not redundant:
//
//   check-migration-drift.mjs   — scheduled (daily), covers staging AND
//                                 production, files/closes a tracking issue,
//                                 24h grace. Answers "is a deployed database
//                                 drifting right now?" on a timer.
//   check-migration-drift-gate  — this file. Runs on every PR and every push to
//                                 main, staging only, no issue, short grace.
//                                 Answers "has main's schema actually reached
//                                 staging?" at the one moment a human is
//                                 looking at a red X.
//
// The daily one is a smoke alarm; this one is the same alarm wired to the panel
// people already watch. The incident that motivated it — two migrations merged
// to main and never applied to staging — was invisible for as long as it was
// because the only signal was an issue nobody had reason to open. A check on
// every PR cannot be not-noticed.
//
// ── NOT a required check, deliberately ──────────────────────────────────────
// This was required once and was demoted (see `lib/required-checks.mjs`,
// which names it as excluded on purpose). It compares main against staging, so
// it asserts something the PR in front of it neither contains nor can change:
// as a required check that is a repo-wide merge-freeze switch rather than a
// gate, and #1373 used it as one. `migration-order` is the required gate now,
// asking the same failure class scoped to what a change introduces. This file
// reports; it does not block.
//
// ── Why it compares MAIN and not the PR head ────────────────────────────────
// A PR that ADDS a migration has, by definition, a migration that staging has
// not applied — it has not merged yet. Comparing the PR head to staging would
// fail every migration PR on its own contents, which teaches people to ignore
// the check. So the comparison is always `origin/main` vs staging, on PRs and
// pushes alike. A PR's own new migrations are invisible to this gate; what it
// asserts is that the branch you are about to merge INTO is in sync.
//
// ── Why grace is measured from merge time, not the version timestamp ────────
// The sibling script graces a pending migration for 24h from its own 14-digit
// version, which is the authoring time. That is the right signal for a daily
// timer and the wrong one here: a migration authored last week and merged two
// minutes ago is instantly "24h overdue" by that measure, so every PR opened in
// the minutes after a migration merge would go red while the apply is still
// running. This gate instead asks git when the file actually landed on main
// (`git log -1 --first-parent --format=%ct`), which is precisely "how long has
// staging had to catch up". Default grace is 30 minutes, far shorter than a
// working day. In CI it has to cover the whole chain from merge to snapshot:
// CI on main, `Deploy API` (whose `migrate-staging` applies it) and the publish
// that run triggers. From a CI push run's creation to the end of the Deploy
// API run it triggered took 256 to 599 seconds across the 12 most recent
// Deploy API runs on main before 16:32Z on 2026-09-23 (each paired with the CI run that
// finished just before it was created: a `workflow_run` run's `head_sha` is
// main's tip when it fired, not the commit that triggered it). The publish leg
// is unmeasured until the publisher runs on main.
//
// `--first-parent` is what makes that true rather than merely intended: see
// the comment at the call site. Without it the grace was measured from the
// feature-branch commit, so a PR that sat in review longer than the window got
// no grace at all — which is every agent-authored migration PR.
//
// ── Read-only, and credential-free in CI ────────────────────────────────────
// Same data source as the sibling: `GET /v1/projects/{ref}/database/migrations`
// on the Supabase Management API. No SQL is sent, so this cannot mutate a
// database even if its logic is wrong.
//
// In CI the answer comes from the published migration snapshot (`--snapshot`),
// not from a credential. This job runs on `pull_request`, and a same-repository
// PR runs its own branch's workflow, so a credential here is a credential every
// branch holds (#2518). The staging ref then comes from
// `.github/environments.json`. See `lib/migration-snapshot.mjs`. A snapshot can
// be older than staging's real state: a `Deploy API` run may have finished (or
// still be running) after it, its publish not landed yet. The download action
// says what Deploy API has done since (`MIGRATION_SNAPSHOT_STAGING_DEPLOY`), and
// `classifyGateDrift` then reports a missing migration as `stale`, not drift.
//
// ── Availability trade ──────────────────────────────────────────────────────
// A required check that calls a third-party API makes repo-wide merge
// availability depend on that API. That is a real cost and it was taken
// knowingly: a transient blip is absorbed by bounded retries below, and a
// sustained Supabase outage fails LOUDLY (with an error naming the cause)
// rather than passing a check that proved nothing. "Could not verify" is the
// exact failure mode that let the original incident run; it must never be
// spelled green. Since the demotion above this costs a red report rather than a
// merge freeze, so no escape hatch is needed: the outage is visible and merges
// keep moving.
//
// Flags:
//   --snapshot <file>          — read staging's applied state from a published
//                                snapshot; the two live-read env inputs below are
//                                then unused
//
// Env inputs:
//   SUPABASE_ACCESS_TOKEN      — live read only: Supabase Management API token
//   SUPABASE_PROJECT_REF       — live read only: the STAGING project ref
//   MIGRATION_SNAPSHOT_STAGING_DEPLOY — snapshot only, set by
//                                `.github/actions/download-migration-snapshot`:
//                                `none` when no Deploy API run has finished
//                                since the snapshot or is in progress, else a
//                                finish time, `running` or `unknown`. Anything
//                                but `none`, unset included, counts as overtaken.
//   DRIFT_GATE_MAIN_REF        — optional, default "origin/main"
//   DRIFT_GATE_GRACE_MINUTES   — optional, default 30
//   GITHUB_STEP_SUMMARY        — optional, written when present
//
// Exit codes:
//   0 — staging holds every migration on main (or the stragglers are in grace)
//   1 — drift; or `stale` (a migration is past grace, and a Deploy API run
//       since the snapshot may have applied it, or what Deploy API did could
//       not be read); or staging could not be read

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

import {
  fetchAppliedMigrations,
  parseMigrationFilename,
} from "./check-migration-drift.mjs";
import { requireEnv, SECRETS_RUNBOOK } from "./lib/env.mjs";
import { DEFAULT_ATTEMPTS, DEFAULT_BACKOFF_MS } from "./lib/http.mjs";
import { openSnapshot } from "./lib/migration-snapshot.mjs";
import { isInvokedDirectly } from "./lib/invoked-directly.mjs";

export const DEFAULT_MAIN_REF = "origin/main";
export const DEFAULT_GRACE_MINUTES = 30;
export const MIGRATIONS_PREFIX = "supabase/migrations";

// Bounded retry for the one network call. Three attempts over ~6s absorbs the
// blips that would otherwise redden every open PR; anything longer-lived is a
// real outage and should surface as one rather than be waited out in CI.
// Re-exported from `lib/http.mjs` rather than redeclared: the numbers had
// already drifted into agreement with `resilientFetch`'s defaults, which is
// exactly the silent-duplication risk this module's own header warns about
// for the rest of the CI script layer.
export const FETCH_ATTEMPTS = DEFAULT_ATTEMPTS;
export const FETCH_BACKOFF_MS = DEFAULT_BACKOFF_MS;

// ── git ─────────────────────────────────────────────────────────────────────

/** Default git runner. Injected in tests so no fixture repo is needed. */
export function defaultRunGit(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

/**
 * Every versioned migration present at `ref`, with the commit time at which it
 * landed there.
 *
 * `landedMs` is null when git cannot date the file. That is treated by
 * `classifyGateDrift` as "outside grace" — deliberately conservative. An
 * undatable migration is reported rather than silently forgiven, because the
 * whole failure this gate exists to prevent is a migration nobody remembers.
 */
export function readMigrationsAtRef({ ref, runGit = defaultRunGit }) {
  const listing = runGit([
    "ls-tree",
    "-r",
    "--name-only",
    ref,
    "--",
    MIGRATIONS_PREFIX,
  ]);

  const files = listing
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const migrations = [];
  for (const path of files) {
    const parsed = parseMigrationFilename(path.split("/").pop());
    if (!parsed) continue;

    let landedMs = null;
    try {
      // `--first-parent` is load-bearing, not a stylistic flag. Without it
      // `git log` walks into the merged branch and returns the commit that
      // AUTHORED the file, which is the moment someone started the PR — not
      // the moment the migration reached `ref`. The grace window above is
      // specified as "how long has staging had to catch up", so it has to run
      // from the landing. Restricted to the first-parent chain, the answer is
      // the merge commit on `ref`'s own history; under a squash merge the
      // squash commit is already that same commit, so this is correct for both
      // merge styles this repo has used.
      const stamp = runGit([
        "log",
        "-1",
        "--first-parent",
        "--format=%ct",
        ref,
        "--",
        path,
      ]).trim();
      if (/^\d+$/.test(stamp)) landedMs = Number(stamp) * 1000;
    } catch {
      // Leave null — see the conservative-null note above.
    }

    migrations.push({ ...parsed, path, landedMs });
  }

  return migrations.sort((a, b) => a.version.localeCompare(b.version));
}

// ── Classification ──────────────────────────────────────────────────────────

/**
 * Pure set comparison between main and staging.
 *
 *   pending — on main, not applied to staging (split overdue / withinGrace)
 *   foreign — applied to staging, absent from main
 *
 * Grace always runs from now, exactly as it does for a live read. A pending
 * migration past it is one of two things:
 *
 *   overdue      — the applied list is current: a live read, or a snapshot no
 *                  Deploy API run has finished since or is running after. Its
 *                  absence is staging's real state, a failed or missing apply.
 *   unverifiable — `snapshotBehind`: a Deploy API run finished after the
 *                  snapshot was taken and its publish has not landed, or one is
 *                  still running, or what Deploy API did could not be read. That
 *                  run may have applied it, so the snapshot cannot say. The
 *                  verdict is `stale`, which is red and says why. Called drift,
 *                  it would blame staging for a lagging publisher. Left in
 *                  grace, it would read green for a day. Once a newer snapshot
 *                  lands, a real failed apply shows as overdue.
 *
 * Deploy API is the only workflow that migrates staging, and it triggers a
 * publish when it finishes, so "no Deploy API run since" is what makes a
 * snapshot's absence current. The capture time cannot: a snapshot taken
 * minutes before a migration's own deploy finished is overtaken, while one
 * taken right after a failed apply is current, and both may predate the
 * migration's grace window.
 *
 * `foreign` is never graced and is always drift. A version staging holds that
 * main does not is not just untidy: `supabase db push` refuses to run at all in
 * that state, so the next legitimate migration cannot be applied either. That
 * is a live outage of the promotion path, and it is exactly the shape of the
 * February row still sitting on production (#832).
 */
export function classifyGateDrift({ main, applied, nowMs, graceMs, snapshotBehind = false }) {
  const appliedVersions = new Set(applied.map((m) => m.version));
  const mainVersions = new Set(main.map((m) => m.version));

  const pending = main.filter((m) => !appliedVersions.has(m.version));
  const foreign = applied.filter((m) => !mainVersions.has(m.version));

  const overdue = [];
  const withinGrace = [];
  const unverifiable = [];
  for (const migration of pending) {
    const late = migration.landedMs === null || nowMs - migration.landedMs >= graceMs;
    if (!late) withinGrace.push(migration);
    else if (snapshotBehind) unverifiable.push(migration);
    else overdue.push(migration);
  }

  const status =
    foreign.length > 0 || overdue.length > 0 ? "drift" : unverifiable.length > 0 ? "stale" : "clean";
  return { pending, overdue, withinGrace, unverifiable, foreign, status };
}

// ── Reporting ───────────────────────────────────────────────────────────────

function bullets(migrations, describe) {
  return migrations.map((m) => `- ${describe(m)}`).join("\n");
}

function describeLanded(m) {
  return `\`${m.version}_${m.name}\`${
    m.landedMs === null ? " (merge time unknown)" : ` (merged ${new Date(m.landedMs).toISOString()})`
  }`;
}

function isTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

/**
 * Why the snapshot cannot vouch for a missing migration, and what to do. From
 * `stagingDeploy`, the download action's export: a Deploy API run's finish
 * time, `running`, or anything else when that could not be read.
 */
function staleReason({ capturedMs, stagingDeploy }) {
  const snapshot = `the migration snapshot${
    capturedMs === null ? "" : ` (captured ${new Date(capturedMs).toISOString()})`
  }`;
  if (isTimestamp(stagingDeploy)) {
    return {
      because: `a Deploy API run on main finished at ${stagingDeploy}, after ${snapshot} was taken, and the publish it triggers has not succeeded yet`,
      advice:
        "If Migration snapshot (`.github/workflows/migration-snapshot.yml`) is still running, re-run this " +
        "check when it finishes. If it failed, fix it and re-run it on `main`. If a migration is still " +
        "missing after a fresh publish, that run reports it as drift.",
    };
  }
  if (stagingDeploy === "running") {
    return {
      because: `a Deploy API run on main is still in progress, and ${snapshot} was taken before it could show what that run applies`,
      advice:
        "Re-run this check once that run and the Migration snapshot publish it triggers " +
        "(`.github/workflows/migration-snapshot.yml`) have finished.",
    };
  }
  return {
    because: `what Deploy API has done since ${snapshot} was taken could not be read (the download step's log names the Actions API error)`,
    advice: "Re-run this check. This is not a verdict on staging or on the publisher.",
  };
}

const sentence = (clause) => `${clause[0].toUpperCase()}${clause.slice(1)}.`;

export function buildGateSummary({
  result,
  graceMinutes,
  projectRef,
  mainRef,
  capturedMs = null,
  stagingDeploy = null,
}) {
  const ref = projectRef ? `\`${projectRef.slice(0, 8)}…\`` : "(unknown)";
  const lines = [`## Migration drift gate — staging ${ref}`, ""];

  if (result.status === "clean") {
    lines.push(
      `Staging holds every migration on \`${mainRef}\`. ${result.withinGrace.length} pending within the ${graceMinutes}m grace window.`,
    );
    if (result.withinGrace.length > 0) {
      lines.push(
        "",
        "Applying now (not yet overdue):",
        bullets(result.withinGrace, (m) => `\`${m.version}_${m.name}\``),
      );
    }
    return lines.join("\n");
  }

  const unverifiable = result.unverifiable ?? [];
  if (result.status === "stale") {
    const { because, advice } = staleReason({ capturedMs, stagingDeploy });
    lines.push(
      `**Cannot verify.** ${sentence(because)} So the snapshot cannot say whether staging has`,
      `${unverifiable.length} migration(s) now past the ${graceMinutes}m grace window. This says nothing against staging yet.`,
      "",
      advice,
      "",
      bullets(unverifiable, describeLanded),
    );
    return lines.join("\n");
  }

  lines.push(
    `**Drift detected.** \`${mainRef}\` and staging disagree, so the schema behind every open PR is not the schema on staging.`,
    "",
  );

  if (result.overdue.length > 0) {
    lines.push(
      `### ${result.overdue.length} migration(s) on \`${mainRef}\` never reached staging`,
      "",
      bullets(result.overdue, describeLanded),
      "",
      "Fix: re-run the `Deploy API` workflow against the latest commit on main —",
      "`migrate-staging` applies whatever is pending. See",
      "`docs/internal/ops/DB_PROMOTION_RUNBOOK.md`.",
      "",
    );
  }

  if (unverifiable.length > 0) {
    const { because, advice } = staleReason({ capturedMs, stagingDeploy });
    lines.push(
      `### ${unverifiable.length} migration(s) the snapshot cannot vouch for`,
      "",
      bullets(unverifiable, describeLanded),
      "",
      `${sentence(because)} ${advice}`,
      "",
    );
  }

  if (result.foreign.length > 0) {
    lines.push(
      `### ${result.foreign.length} migration(s) on staging that do not exist on \`${mainRef}\``,
      "",
      bullets(result.foreign, (m) => `\`${m.version}_${m.name || "(unnamed)"}\``),
      "",
      "This blocks `supabase db push` outright — no further migration can be",
      "applied to staging until it is reconciled. Do NOT run",
      "`migration repair` without first reading what the row did; see",
      "`docs/internal/ops/DB_ROLLBACK_PLAYBOOK.md`.",
      "",
    );
  }

  return lines.join("\n");
}

function writeSummary(summary) {
  const target = process.env.GITHUB_STEP_SUMMARY;
  if (!target) return;
  try {
    appendFileSync(target, `${summary}\n`);
  } catch {
    // A summary that cannot be written must not fail the gate.
  }
}

// ── Orchestration ───────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchAppliedWithRetry({
  accessToken,
  projectRef,
  fetchImpl = fetch,
  attempts = FETCH_ATTEMPTS,
  backoffMs = FETCH_BACKOFF_MS,
  sleepImpl = sleep,
  log = console.log,
}) {
  let last = { ok: false, migrations: [], error: "not attempted" };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    last = await fetchAppliedMigrations({ accessToken, projectRef, fetchImpl });
    if (last.ok) return last;
    if (attempt < attempts) {
      const wait = backoffMs[attempt - 1] ?? backoffMs[backoffMs.length - 1] ?? 1000;
      log(`  Attempt ${attempt}/${attempts} failed (${last.error}); retrying in ${wait}ms.`);
      await sleepImpl(wait);
    }
  }
  return last;
}

export async function runDriftGate({
  accessToken,
  projectRef,
  mainRef = DEFAULT_MAIN_REF,
  graceMinutes = DEFAULT_GRACE_MINUTES,
  nowMs = Date.now(),
  capturedMs = null,
  snapshotBehind = false,
  stagingDeploy = null,
  runGit = defaultRunGit,
  fetchImpl = fetch,
  sleepImpl = sleep,
  log = console.log,
  error = console.error,
  onSummary = writeSummary,
}) {
  const main = readMigrationsAtRef({ ref: mainRef, runGit });
  log(`  ${main.length} migration(s) on ${mainRef}.`);

  // Zero migrations on main is not a legitimate state for this repo, and
  // treating it as one produces actively misleading output: every migration
  // staging holds would be reported as FOREIGN, i.e. "51 hand-applied
  // migrations, db push is blocked", when the truth is a bad ref or a checkout
  // without the migrations directory. `git ls-tree` answers a path that does
  // not exist with an empty list and exit 0, so this cannot be caught by
  // checking git's exit code.
  if (main.length === 0) {
    error(
      `::error::No migrations found at ${mainRef}. That is a broken checkout or a bad ref, not drift — the gate refuses to interpret it as "staging has N foreign migrations". Ensure the workflow fetches main with fetch-depth: 0.`,
    );
    onSummary(
      [
        "## Migration drift gate — staging",
        "",
        `**No migrations found at \`${mainRef}\`.**`,
        "",
        "This is a checkout problem, not a database problem. `supabase/migrations/`",
        "is never empty on `main`, so the gate stops here rather than reporting every",
        "migration on staging as foreign.",
      ].join("\n"),
    );
    return 1;
  }

  const applied = await fetchAppliedWithRetry({
    accessToken,
    projectRef,
    fetchImpl,
    sleepImpl,
    log,
  });

  if (!applied.ok) {
    // Unreadable is NOT clean. See the availability-trade note at the top.
    error(
      `::error::Could not read staging migration history after ${FETCH_ATTEMPTS} attempts: ${applied.error}. The gate cannot prove staging matches main, so it fails rather than passing unverified.`,
    );
    onSummary(
      [
        "## Migration drift gate — staging",
        "",
        `**Could not read staging migration history.** ${applied.error}`,
        "",
        "This is a failure, not a pass: an unverifiable database is the exact",
        "state the gate exists to catch. `migration-drift` reports and does not",
        "block, so a Supabase outage leaves this red without holding up merges.",
      ].join("\n"),
    );
    return 1;
  }

  log(`  ${applied.migrations.length} migration(s) applied to staging.`);

  const result = classifyGateDrift({
    main,
    applied: applied.migrations,
    nowMs,
    graceMs: graceMinutes * 60 * 1000,
    snapshotBehind,
  });

  onSummary(
    buildGateSummary({ result, graceMinutes, projectRef, mainRef, capturedMs, stagingDeploy }),
  );

  if (result.unverifiable.length > 0) {
    // Reported beside drift too, so a stuck publisher is not hidden behind it.
    const { because, advice } = staleReason({ capturedMs, stagingDeploy });
    error(
      `::error::Cannot verify ${result.unverifiable.length} migration(s) on ${mainRef} past grace (${result.unverifiable
        .map((m) => `${m.version}_${m.name}`)
        .join(", ")}): ${because}. ${advice}`,
    );
  }
  if (result.status === "drift") {
    if (result.overdue.length > 0) {
      error(
        `::error::${result.overdue.length} migration(s) on ${mainRef} have not been applied to staging: ${result.overdue
          .map((m) => `${m.version}_${m.name}`)
          .join(", ")}`,
      );
    }
    if (result.foreign.length > 0) {
      error(
        `::error::${result.foreign.length} migration(s) applied to staging do not exist on ${mainRef}: ${result.foreign
          .map((m) => `${m.version}_${m.name || "(unnamed)"}`)
          .join(", ")}. This blocks all further db push runs.`,
      );
    }
    return 1;
  }
  if (result.status === "stale") return 1;

  log(
    `  Staging matches ${mainRef}. ${result.withinGrace.length} pending within the ${graceMinutes}m grace window.`,
  );
  return 0;
}

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
 * Where staging's applied state comes from: the published snapshot when
 * `--snapshot` is given (CI), else a live read with a token (a laptop).
 *
 * For a snapshot, `snapshotBehind` says whether a Deploy API run may have
 * changed staging since it was taken, from `MIGRATION_SNAPSHOT_STAGING_DEPLOY`,
 * which the download action exports. Only `none` counts as current: an unset
 * value (a run outside that action) is not evidence that nothing deployed.
 * `capturedMs` and `stagingDeploy` only word the report. Grace runs from now
 * either way.
 */
export function resolveSource(snapshotPath, env = process.env) {
  if (!snapshotPath) {
    return {
      accessToken: requireEnv("SUPABASE_ACCESS_TOKEN", { hint: SECRETS_RUNBOOK }),
      projectRef: requireEnv("SUPABASE_PROJECT_REF", { hint: SECRETS_RUNBOOK }),
      fetchImpl: fetch,
      capturedMs: null,
      snapshotBehind: false,
      stagingDeploy: null,
      description: "live Management API read",
    };
  }
  try {
    const opened = openSnapshot(snapshotPath, ["staging"]);
    const stagingDeploy = env.MIGRATION_SNAPSHOT_STAGING_DEPLOY ?? null;
    const snapshotBehind = stagingDeploy !== "none";
    return {
      accessToken: "snapshot",
      projectRef: opened.refs.staging,
      fetchImpl: opened.fetchImpl,
      capturedMs: opened.capturedMs,
      snapshotBehind,
      stagingDeploy,
      description: !snapshotBehind
        ? `${opened.description}; no Deploy API run since`
        : `${opened.description}; ${
            isTimestamp(stagingDeploy)
              ? `a Deploy API run finished since, at ${stagingDeploy}`
              : stagingDeploy === "running"
                ? "a Deploy API run is in progress"
                : "what Deploy API has done since is unknown"
          }, so a migration past grace reads as stale, not drift`,
    };
  } catch (thrown) {
    // Unreadable is not clean, the same posture as a failed live read below.
    console.error(`::error::Could not read staging's applied migrations: ${thrown.message}.`);
    writeSummary(
      [
        "## Migration drift gate — staging",
        "",
        `**Could not read staging's applied migrations.** ${thrown.message}.`,
      ].join("\n"),
    );
    process.exit(1);
  }
}

/**
 * What `main()` hands `runDriftGate`, from a resolved source and the env.
 * Exported so the wiring is tested: a snapshot's capture time must never
 * become `nowMs`, the gate's clock, and whether Deploy API has overtaken it must
 * reach the classifier (#2518).
 */
export function driftGateOptions(source, env = process.env) {
  return {
    accessToken: source.accessToken,
    projectRef: source.projectRef,
    fetchImpl: source.fetchImpl,
    capturedMs: source.capturedMs,
    snapshotBehind: source.snapshotBehind,
    stagingDeploy: source.stagingDeploy,
    mainRef: env.DRIFT_GATE_MAIN_REF || DEFAULT_MAIN_REF,
    graceMinutes: Number(env.DRIFT_GATE_GRACE_MINUTES || DEFAULT_GRACE_MINUTES),
  };
}

async function main() {
  const source = resolveSource(getArg("--snapshot"));
  const options = driftGateOptions(source);
  const { projectRef, mainRef, graceMinutes } = options;

  if (!Number.isFinite(graceMinutes) || graceMinutes < 0) {
    console.error("::error::DRIFT_GATE_GRACE_MINUTES must be a non-negative number.");
    process.exit(1);
  }

  console.log("══════════════════════════════════════════════════════════");
  console.log("  Migration drift gate (staging)");
  console.log(`  Comparing: ${mainRef} → staging ${projectRef.slice(0, 8)}…`);
  console.log(`  Grace: ${graceMinutes} minute(s) from merge time`);
  console.log(`  Source: ${source.description}`);
  console.log("══════════════════════════════════════════════════════════");

  process.exit(
    await runDriftGate(options),
  );
}

// Only run when executed directly, so tests can import the pure helpers.
// Same guard form as check-migration-drift.mjs — keep them identical.
if (isInvokedDirectly(import.meta.url)) {
  main().catch((err) => {
    console.error(`::error::Migration drift gate crashed: ${err.stack ?? err.message}`);
    process.exit(1);
  });
}
