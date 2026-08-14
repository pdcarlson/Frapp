#!/usr/bin/env node
// Scheduled drift detector for .github/workflows/check-migration-drift.yml.
// Closes the gap recorded in issue #833: CI proves that code compiles and tests
// pass, but **nothing verifies that a deployed database matches
// `supabase/migrations/`**. A database can be dozens of migrations behind, or
// carry migrations that exist nowhere in the repo, and every workflow stays
// green.
//
// This is a different failure than #763 (deploy jobs failing unnoticed). #763 is
// "the pipeline is broken"; this is "the pipeline is fine and the database is
// still wrong". Both were live on 2026-08-10, and only the first had a signal.
//
// Two drift modes, both observed for real:
//
//   1. BEHIND  — `frapp-staging` held 2 rows in `supabase_migrations.schema_migrations`
//                while `supabase/migrations/` held 39 files (~5.5 months / 38
//                migrations behind). Public tables 29 vs 44, functions 1 vs 15,
//                storage buckets 0 vs 7. Remediated 2026-08-10.
//   2. FOREIGN — the history carried `20260228000000_enable_rls_on_remaining_tables`,
//                a version that has never existed in this repository on any branch
//                (hand-applied in February). `supabase db push` refuses to run at
//                all in this state, and the error's suggested fix
//                (`migration repair --status reverted`) is destructive if applied
//                without first reading what the row did.
//
// As of 2026-08-14 staging is clean and **production exhibits both modes at once**
// (37 pending + the same foreign February row) — see #832, which owns the
// remediation. This script only ever *reports*; it never repairs. Repairing a
// hosted database is a human, E2-class action.
//
// Why a schedule and not just a post-deploy assertion: for 71 days no deploy
// succeeded at all, so a check that only runs after a successful deploy would
// have stayed silent for exactly the period it was needed. A dead pipeline must
// not be able to hide drift.
//
// Data source: `GET /v1/projects/{ref}/database/migrations` (Supabase Management
// API — the stable, purpose-built endpoint, not the Beta `database/query` ones).
// Read-only by construction: no SQL is sent, so this script cannot mutate a
// database even if it is wrong.
//
// Env inputs:
//   GITHUB_TOKEN           — required (issues: write)
//   GITHUB_REPOSITORY      — required, owner/repo
//   SUPABASE_ACCESS_TOKEN  — required, Supabase Management API token
//   DRIFT_TARGETS          — required, `label=ref` pairs, comma-separated
//   PENDING_GRACE_HOURS    — optional, default 24
//   RUN_URL                — optional, html_url of this run
//
// Exit codes:
//   0 — every target matched the repo (or pending only within the grace window)
//   1 — drift found, or a target could not be read
//
// Unlike the sibling watchdogs (`ci-wake.mjs`, `deploy-alert.mjs`) this one DOES
// exit non-zero. Those annotate a run that is already red; this script *is* the
// run, so a green result has to mean "the databases were checked and match".

import { readdirSync } from "node:fs";
import { appendFileSync } from "node:fs";
import { join } from "node:path";

import { ghRequest } from "./ci-wake.mjs";

// ── Constants ───────────────────────────────────────────────────────────────

export const SUPABASE_API_BASE = "https://api.supabase.com";

// Title is the primary key: it is looked up by exact match, so it must stay
// stable across releases. `routine-state` marks it as routine infrastructure —
// `/next` §0.2 treats that label as never-claimable, which is what keeps agent
// sessions from picking the alert up as if it were backlog work.
export const ALERT_ISSUE_TITLE =
  "Database schema drift — a deployed database no longer matches supabase/migrations/";
export const ALERT_ISSUE_LOOKUP_LABEL = "routine-state";
export const ALERT_ISSUE_LABELS = [ALERT_ISSUE_LOOKUP_LABEL, "area:db", "P1"];

// A migration merged minutes ago is legitimately not applied yet. The grace
// window is measured from the migration's own 14-digit version timestamp, which
// is the only "when was this authored" signal available without a git or API
// round-trip. A migration back-dated below this window alerts immediately —
// deliberately conservative: this check may cry wolf, it may not stay silent.
export const DEFAULT_PENDING_GRACE_HOURS = 24;

// Pages of issues to scan when locating the alert issue.
const MAX_ISSUE_PAGES = 5;

const MIGRATION_FILENAME_PATTERN = /^(\d{14})_(.+)\.sql$/;

// ── Local migrations ────────────────────────────────────────────────────────

/**
 * Parses `20260809120000_chapter_document_folders.sql` into its version and
 * name. Returns null for anything that is not a versioned migration file, so a
 * stray README or a `.sql.bak` is ignored rather than reported as drift.
 */
export function parseMigrationFilename(file) {
  const match = MIGRATION_FILENAME_PATTERN.exec(file);
  if (!match) return null;
  return { version: match[1], name: match[2], file };
}

/** Every versioned migration in `supabase/migrations/`, sorted by version. */
export function readLocalMigrations(dir) {
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .map(parseMigrationFilename)
    .filter(Boolean)
    .sort((a, b) => a.version.localeCompare(b.version));
}

/**
 * The UTC epoch-ms a 14-digit version encodes, or null when the version is not
 * a real timestamp. `00000000000000` (the initial schema) is a real version but
 * not a real date — it maps to 0, which is always outside any grace window.
 *
 * A null return is treated by the caller as "outside the grace window": an
 * unparseable version must not buy a migration indefinite tolerance.
 */
export function versionToEpochMs(version) {
  if (!/^\d{14}$/.test(version)) return null;
  if (version === "00000000000000") return 0;

  const year = Number(version.slice(0, 4));
  const month = Number(version.slice(4, 6));
  const day = Number(version.slice(6, 8));
  const hour = Number(version.slice(8, 10));
  const minute = Number(version.slice(10, 12));
  const second = Number(version.slice(12, 14));

  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  return Date.UTC(year, month - 1, day, hour, minute, second);
}

// ── Targets ─────────────────────────────────────────────────────────────────

/**
 * Parses `staging=abcdef…,production=ghijkl…` into [{ label, ref }].
 * Malformed entries are dropped rather than throwing — a typo in one target
 * must not stop the other target from being checked.
 */
export function parseTargets(spec) {
  if (!spec) return [];
  const targets = [];
  for (const chunk of spec.split(",")) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const label = trimmed.slice(0, eq).trim();
    const ref = trimmed.slice(eq + 1).trim();
    if (!label || !ref) continue;
    targets.push({ label, ref });
  }
  return targets;
}

// ── Remote migrations ───────────────────────────────────────────────────────

/**
 * Applied migration versions for one project.
 *
 * Returns { ok, migrations, error }. Never throws: a transient Management API
 * failure must not be reportable as drift, so the caller degrades that target to
 * "unknown" instead of alerting. Accepts both the bare-array and
 * `{ migrations: [...] }` response shapes so a wrapper change upstream does not
 * silently read as "zero migrations applied" — which would look exactly like
 * catastrophic drift.
 */
export async function fetchAppliedMigrations({
  accessToken,
  projectRef,
  fetchImpl = fetch,
}) {
  let response;
  try {
    response = await fetchImpl(
      `${SUPABASE_API_BASE}/v1/projects/${projectRef}/database/migrations`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      },
    );
  } catch (error) {
    return { ok: false, migrations: [], error: `request failed: ${error.message}` };
  }

  if (!response.ok) {
    return {
      ok: false,
      migrations: [],
      error: `Supabase Management API returned HTTP ${response.status}`,
    };
  }

  let payload;
  try {
    payload = JSON.parse(await response.text());
  } catch {
    return { ok: false, migrations: [], error: "response was not valid JSON" };
  }

  const rows = Array.isArray(payload) ? payload : payload?.migrations;
  if (!Array.isArray(rows)) {
    return { ok: false, migrations: [], error: "response contained no migration list" };
  }

  const migrations = rows
    .filter((row) => typeof row?.version === "string")
    .map((row) => ({ version: row.version, name: row.name ?? "" }))
    .sort((a, b) => a.version.localeCompare(b.version));

  return { ok: true, migrations, error: null };
}

// ── Classification ──────────────────────────────────────────────────────────

/**
 * Pure set comparison between the repo and one database.
 *
 *   pending  — in the repo, not applied      (split into overdue / withinGrace)
 *   foreign  — applied, absent from the repo (always wrong, never graced)
 *   matched  — present in both
 *
 * `foreign` is never subject to the grace window: a version the repo has never
 * contained is wrong the moment it appears, and it blocks `db push` outright.
 */
export function classifyDrift({ local, remote, nowMs, graceMs }) {
  const remoteVersions = new Set(remote.map((m) => m.version));
  const localVersions = new Set(local.map((m) => m.version));

  const matched = local.filter((m) => remoteVersions.has(m.version));
  const pending = local.filter((m) => !remoteVersions.has(m.version));
  const foreign = remote.filter((m) => !localVersions.has(m.version));

  const overdue = [];
  const withinGrace = [];
  for (const migration of pending) {
    const authoredMs = versionToEpochMs(migration.version);
    if (authoredMs === null || nowMs - authoredMs >= graceMs) {
      overdue.push(migration);
    } else {
      withinGrace.push(migration);
    }
  }

  const status = foreign.length > 0 || overdue.length > 0 ? "drift" : "clean";
  return { matched, pending, overdue, withinGrace, foreign, status };
}

/**
 * Rolls per-target results into the run's verdict.
 *   "drift"   — at least one target is drifting (raises the alert)
 *   "unknown" — no drift found, but at least one target could not be read
 *   "clean"   — every target was read and matches (clears the alert)
 *
 * "unknown" deliberately outranks "clean" and is deliberately outranked by
 * "drift": an unreadable target must never close an open alert (that is how a
 * live outage gets silenced by an API blip), and must never raise one either
 * (the alert means "a database is drifting", which is not what was observed).
 */
export function overallStatus(results) {
  // Zero results is zero evidence. Reporting "clean" here would close an open
  // alert on the strength of having checked nothing — the CLI guards against an
  // empty target list, and this is the same guarantee for any other caller.
  if (results.length === 0) return "unknown";
  if (results.some((r) => r.status === "drift")) return "drift";
  if (results.some((r) => r.status === "unknown")) return "unknown";
  return "clean";
}

// ── Reporting ───────────────────────────────────────────────────────────────

function migrationList(migrations, limit = 10) {
  const shown = migrations.slice(0, limit).map((m) => `\`${m.version}_${m.name}\``);
  const extra = migrations.length - shown.length;
  return extra > 0 ? `${shown.join(", ")} … and ${extra} more` : shown.join(", ");
}

/** One-line verdict per target, used in the summary table and the issue body. */
export function describeTarget(result) {
  if (result.status === "unknown") return `could not be read — ${result.error}`;
  if (result.status === "clean") {
    return result.withinGrace.length > 0
      ? `in sync (${result.withinGrace.length} pending within grace)`
      : "in sync";
  }
  const parts = [];
  if (result.overdue.length > 0) parts.push(`${result.overdue.length} pending`);
  if (result.foreign.length > 0) parts.push(`${result.foreign.length} foreign`);
  return `DRIFTING — ${parts.join(", ")}`;
}

export function buildRunSummary({ status, results, graceHours, runUrl }) {
  const badge = {
    drift: "❌ **DRIFT DETECTED**",
    unknown: "⚠️ **COULD NOT VERIFY**",
    clean: "✅ **IN SYNC**",
  }[status];

  const lines = [
    "## Migration drift check",
    "",
    badge,
    "",
    "| Environment | Applied | In repo | Verdict |",
    "| --- | --- | --- | --- |",
    ...results.map(
      (r) =>
        `| \`${r.label}\` | ${r.status === "unknown" ? "—" : r.remoteCount} | ${r.localCount} | ${describeTarget(r)} |`,
    ),
  ];

  for (const result of results) {
    if (result.status !== "drift") continue;
    lines.push("", `### \`${result.label}\``);
    if (result.foreign.length > 0) {
      lines.push(
        "",
        `**Foreign — applied but absent from this repository (${result.foreign.length}):**`,
        "",
        migrationList(result.foreign),
        "",
        "`supabase db push` refuses to run while a foreign version is present. Read what the row " +
          "actually did before removing it — see `docs/internal/ops/DB_PROMOTION_RUNBOOK.md` " +
          "§ reconciling a foreign migration row. **Do not** blind-run `migration repair`.",
      );
    }
    if (result.overdue.length > 0) {
      lines.push(
        "",
        `**Pending — in this repository, not applied (${result.overdue.length}):**`,
        "",
        migrationList(result.overdue),
      );
    }
  }

  for (const result of results) {
    if (result.status !== "unknown") continue;
    lines.push("", `### \`${result.label}\``, "", `Not verified: ${result.error}`);
  }

  lines.push(
    "",
    `Pending migrations are tolerated for ${graceHours}h after their version timestamp.`,
  );
  if (runUrl) lines.push("", `- Run: ${runUrl}`);
  return lines.join("\n");
}

export function buildAlertIssueBody({ results, graceHours, runUrl }) {
  const drifting = results.filter((r) => r.status === "drift");
  // Built with push, never with a trailing `.filter(line => line !== "")` —
  // that idiom drops the intentional blank lines too, and Markdown collapses
  // the result into one run-together paragraph.
  const lines = [
    "## A deployed database no longer matches `supabase/migrations/`",
    "",
    "This issue is **opened and closed automatically** by",
    "`.github/workflows/check-migration-drift.yml` (`scripts/ci/check-migration-drift.mjs`).",
    "While it is open, at least one deployed database is drifting from this repository right now.",
    "It closes itself as soon as a later run finds every environment in sync.",
    "",
    "Do not claim this issue as backlog work — it carries `routine-state` and tracks live state,",
    "not a unit of work. Fix the underlying drift and it resolves on its own.",
    "",
    "### Current state",
    "",
    "| Environment | Verdict |",
    "| --- | --- |",
    ...results.map((r) => `| \`${r.label}\` | ${describeTarget(r)} |`),
    "",
    ...drifting.flatMap((result) => {
      const section = [`#### \`${result.label}\``, ""];
      if (result.foreign.length > 0) {
        section.push(
          `- **Foreign (${result.foreign.length}):** ${migrationList(result.foreign)}`,
        );
      }
      if (result.overdue.length > 0) {
        section.push(
          `- **Pending (${result.overdue.length}):** ${migrationList(result.overdue)}`,
        );
      }
      section.push("");
      return section;
    }),
    "### How to act on this",
    "",
    "**Pending** rows mean migrations merged to the repo never reached the database — check whether",
    "`Deploy API` is running at all (#763) before assuming a migration problem.",
    "",
    "**Foreign** rows mean the database carries a version this repository has never contained.",
    "`supabase db push` refuses to run in that state. The CLI suggests",
    "`migration repair --status reverted`; **do not run it blind** — read the row's recorded",
    "`statements` first. Full procedure:",
    "`docs/internal/ops/DB_PROMOTION_RUNBOOK.md` § reconciling a foreign migration row.",
    "",
    `_Pending migrations are tolerated for ${graceHours}h after their version timestamp._`,
  ];

  if (runUrl) lines.push("", `- Run: ${runUrl}`);
  lines.push(
    "",
    "Background: #833 (this detector), #832 (production migration backlog), #763 (deploy visibility).",
  );
  return lines.join("\n");
}

export function buildAlertCommentBody({ results, graceHours, runUrl, reopened }) {
  const lines = [
    reopened
      ? "**Schema drift detected again** — reopening."
      : "**Schema drift is still present.**",
    "",
    "| Environment | Verdict |",
    "| --- | --- |",
    ...results.map((r) => `| \`${r.label}\` | ${describeTarget(r)} |`),
  ];
  if (runUrl) lines.push("", `- Run: ${runUrl}`);
  lines.push(
    "",
    `_Posted automatically by \`scripts/ci/check-migration-drift.mjs\`. Pending migrations are tolerated for ${graceHours}h. This issue closes itself when every environment is back in sync._`,
  );
  return lines.join("\n");
}

export function buildRecoveryCommentBody({ results, runUrl }) {
  const lines = [
    "**Every environment is back in sync.** Closing.",
    "",
    "| Environment | Applied | In repo |",
    "| --- | --- | --- |",
    ...results.map((r) => `| \`${r.label}\` | ${r.remoteCount} | ${r.localCount} |`),
  ];
  if (runUrl) lines.push("", `- Run: ${runUrl}`);
  lines.push(
    "",
    "_Closed automatically by `scripts/ci/check-migration-drift.mjs`._",
  );
  return lines.join("\n");
}

// ── Issue lookup / mutation ─────────────────────────────────────────────────
// Same shape as scripts/ci/deploy-alert.mjs: exact-title lookup within the
// `routine-state` label, prefer an open issue, otherwise reopen the most recent
// closed one. Kept as a separate implementation rather than shared because the
// two alerts have independent titles, labels and bodies, and coupling them
// would mean a change to one alert's copy could silently move the other's.

export async function findAlertIssues({ token, repo, fetchImpl }) {
  const found = [];
  for (let page = 1; page <= MAX_ISSUE_PAGES; page += 1) {
    const { ok, data } = await ghRequest({
      token,
      fetchImpl,
      path:
        `/repos/${repo}/issues?state=all&labels=${encodeURIComponent(ALERT_ISSUE_LOOKUP_LABEL)}` +
        `&sort=created&direction=desc&per_page=100&page=${page}`,
    });
    if (!ok || !Array.isArray(data)) break;
    for (const issue of data) {
      // The issues endpoint returns PRs too; they are never this alert.
      if (!issue.pull_request && issue.title === ALERT_ISSUE_TITLE) found.push(issue);
    }
    if (data.length < 100) break;
  }
  return found;
}

export async function raiseAlert({ token, repo, fetchImpl, results, graceHours, runUrl }) {
  const existing = await findAlertIssues({ token, repo, fetchImpl });
  const open = existing.find((issue) => issue.state === "open");
  const target = open ?? existing[0];

  if (!target) {
    const { ok, data } = await ghRequest({
      token,
      fetchImpl,
      method: "POST",
      path: `/repos/${repo}/issues`,
      body: {
        title: ALERT_ISSUE_TITLE,
        labels: ALERT_ISSUE_LABELS,
        body: buildAlertIssueBody({ results, graceHours, runUrl }),
      },
    });
    return ok
      ? { action: "created", issueNumber: data?.number ?? null }
      : { action: "failed", issueNumber: null };
  }

  const reopened = target.state !== "open";
  if (reopened) {
    await ghRequest({
      token,
      fetchImpl,
      method: "PATCH",
      path: `/repos/${repo}/issues/${target.number}`,
      body: { state: "open" },
    });
  }

  const { ok } = await ghRequest({
    token,
    fetchImpl,
    method: "POST",
    path: `/repos/${repo}/issues/${target.number}/comments`,
    body: { body: buildAlertCommentBody({ results, graceHours, runUrl, reopened }) },
  });

  if (!ok) return { action: "failed", issueNumber: target.number };
  return { action: reopened ? "reopened" : "commented", issueNumber: target.number };
}

/**
 * Closes every open drift alert once all targets are in sync. Closing them all
 * (not just the first) is what makes a duplicate created during an API blip
 * self-heal.
 */
export async function resolveAlert({ token, repo, fetchImpl, results, runUrl }) {
  const openIssues = (await findAlertIssues({ token, repo, fetchImpl })).filter(
    (issue) => issue.state === "open",
  );
  if (openIssues.length === 0) return { action: "none", closed: [] };

  const closed = [];
  for (const issue of openIssues) {
    await ghRequest({
      token,
      fetchImpl,
      method: "POST",
      path: `/repos/${repo}/issues/${issue.number}/comments`,
      body: { body: buildRecoveryCommentBody({ results, runUrl }) },
    });
    const { ok } = await ghRequest({
      token,
      fetchImpl,
      method: "PATCH",
      path: `/repos/${repo}/issues/${issue.number}`,
      body: { state: "closed", state_reason: "completed" },
    });
    if (ok) closed.push(issue.number);
  }
  return { action: "closed", closed };
}

// ── Orchestration ───────────────────────────────────────────────────────────

function defaultWriteSummary(summary) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (path) appendFileSync(path, `${summary}\n`);
}

/**
 * Full flow for one scheduled run. Everything network-bound goes through
 * fetchImpl and the summary write through writeSummary, so tests run offline
 * with no filesystem side effects.
 */
export async function runMigrationDriftCheck({
  token,
  repo,
  accessToken,
  targets,
  local,
  nowMs,
  graceHours = DEFAULT_PENDING_GRACE_HOURS,
  runUrl = "",
  fetchImpl = fetch,
  writeSummary = defaultWriteSummary,
  logger = console,
}) {
  const graceMs = graceHours * 60 * 60 * 1000;
  const results = [];

  for (const target of targets) {
    const remote = await fetchAppliedMigrations({
      accessToken,
      projectRef: target.ref,
      fetchImpl,
    });

    if (!remote.ok) {
      results.push({
        label: target.label,
        ref: target.ref,
        status: "unknown",
        error: remote.error,
        localCount: local.length,
        remoteCount: 0,
        matched: [],
        pending: [],
        overdue: [],
        withinGrace: [],
        foreign: [],
      });
      continue;
    }

    const drift = classifyDrift({ local, remote: remote.migrations, nowMs, graceMs });
    results.push({
      label: target.label,
      ref: target.ref,
      error: null,
      localCount: local.length,
      remoteCount: remote.migrations.length,
      ...drift,
    });
  }

  const status = overallStatus(results);
  writeSummary(buildRunSummary({ status, results, graceHours, runUrl }));

  for (const result of results) {
    const line = `[migration-drift] ${result.label}: ${describeTarget(result)}`;
    logger.log?.(result.status === "clean" ? `::notice::${line}` : `::error::${line}`);
  }

  let alert = { action: "none" };
  if (status === "drift") {
    alert = await raiseAlert({ token, repo, fetchImpl, results, graceHours, runUrl });
    logger.log?.(
      alert.action === "failed"
        ? "[migration-drift] could not write the alert issue"
        : `[migration-drift] alert issue #${alert.issueNumber} ${alert.action}`,
    );
  } else if (status === "clean") {
    alert = await resolveAlert({ token, repo, fetchImpl, results, runUrl });
    if (alert.action === "closed") {
      logger.log?.(`[migration-drift] closed alert issue(s): ${alert.closed.join(", ")}`);
    }
  } else {
    // unknown: never raise (nothing was observed to be drifting) and never
    // resolve (an unreadable database is not a database that matches).
    logger.log?.("[migration-drift] a target could not be read; alert issue left as-is");
  }

  return { status, results, alert, exitCode: status === "clean" ? 0 : 1 };
}

// ── CLI entry ───────────────────────────────────────────────────────────────

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Error: ${name} environment variable is required.`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const token = requireEnv("GITHUB_TOKEN");
  const repo = requireEnv("GITHUB_REPOSITORY");
  const accessToken = requireEnv("SUPABASE_ACCESS_TOKEN");
  const targets = parseTargets(requireEnv("DRIFT_TARGETS"));

  if (targets.length === 0) {
    console.error("Error: DRIFT_TARGETS parsed to zero targets. Expected `label=ref` pairs.");
    process.exit(1);
  }

  // `||` not `??`: an env var set to the empty string must fall back to the
  // default, not coerce to a 0-hour grace window that alerts on every migration
  // the moment it merges.
  const graceHours = Number(process.env.PENDING_GRACE_HOURS || DEFAULT_PENDING_GRACE_HOURS);
  if (!Number.isFinite(graceHours) || graceHours < 0) {
    console.error("Error: PENDING_GRACE_HOURS must be a non-negative number.");
    process.exit(1);
  }

  const local = readLocalMigrations(join(process.cwd(), "supabase", "migrations"));
  if (local.length === 0) {
    // Zero local migrations would make every applied row read as "foreign" and
    // open a maximally alarming alert. That is a broken checkout, not drift.
    console.error(
      "Error: no migrations found in supabase/migrations/. Refusing to report drift against an empty repository.",
    );
    process.exit(1);
  }

  const { exitCode } = await runMigrationDriftCheck({
    token,
    repo,
    accessToken,
    targets,
    local,
    nowMs: Date.now(),
    graceHours,
    runUrl: process.env.RUN_URL ?? "",
  });

  process.exit(exitCode);
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`Unhandled error: ${error.stack ?? error.message}`);
    process.exit(1);
  });
}
