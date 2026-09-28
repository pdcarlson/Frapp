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
// What a database is judged against. Staging deploys on every merge, so it must
// hold everything on `main` (after the grace window). Production deploys only
// when the owner dispatches a ship, so a migration merged since the last ship is
// unreleased, not drift: judging production against `main` opened a P1 the day
// after any migration merged, every time, until the next ship. A target listed
// in DRIFT_RELEASED_TARGETS is judged against the migrations in the latest `v*`
// tag instead. `deploy-production.yml` mints that tag only after its migrate
// step succeeded; a tag minted any other way (a `release.yml` dispatch, or by
// hand) asserts the same thing without having proved it. Foreign rows are still
// judged against `main` alone: a version renamed or deleted there since the tag
// shipped blocks the next production `db push` all the same. The gap between
// the tag and `main` is reported, never alerted on; /needs-me owns "production
// is behind main".
//
// Env inputs:
//   GITHUB_TOKEN           — required (issues: write)
//   GITHUB_REPOSITORY      — required, owner/repo
//   DRIFT_TARGETS          — required, `label=ref` pairs, comma-separated
//   DRIFT_RELEASED_TARGETS — optional, comma-separated labels judged against the
//                            latest `v*` tag's migrations rather than `main`'s.
//                            Unset means `production` (when DRIFT_TARGETS names
//                            it), so a hand run judges production the way the
//                            schedule does; set it empty to judge every target
//                            against `main`. The checkout must hold the `v*` tags
//   SUPABASE_ACCESS_TOKEN_<LABEL>
//                          — each target's Supabase Management API token, e.g.
//                            SUPABASE_ACCESS_TOKEN_STAGING. Each Infisical
//                            environment's token reads only its own project
//                            (#2583). SUPABASE_ACCESS_TOKEN stands in for a
//                            missing one; every target needs one of the two
//   PENDING_GRACE_HOURS    — optional, default 24
//   RUN_URL                — optional, html_url of this run
//
// Exit codes:
//   0 — every target matched what it should hold (or pending only within the grace window)
//       and any open drift alert was closed
//   1 — drift found, a target could not be read, or every target matched but
//       the alert issues could not be read, or an open one could not be closed
//       (annotated ::error::)
//
// Unlike the sibling watchdogs (`ci-wake.mjs`, `deploy-alert.mjs`) this one DOES
// exit non-zero. Those annotate a run that is already red; this script *is* the
// run, so a green result has to mean "the databases were checked and match".

import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { appendFileSync } from "node:fs";
import { join } from "node:path";

import {
  ALERT_LOOKUP_LABEL,
  raiseAlert,
  resolveAlert,
} from "./lib/alert-issue.mjs";
import { requireEnv } from "./lib/env.mjs";
import { supabaseAccessTokenFor } from "./lib/environments.mjs";
import { isInvokedDirectly } from "./lib/invoked-directly.mjs";

// ── Constants ───────────────────────────────────────────────────────────────

export const SUPABASE_API_BASE = "https://api.supabase.com";

// Title is the primary key: it is looked up by exact match, so it must stay
// stable across releases. The lookup label, the assignee, and the create /
// reopen / close upsert all come from lib/alert-issue.mjs (#909), like every
// other watchdog's.
export const ALERT_ISSUE_TITLE =
  "Database schema drift — a deployed database no longer matches supabase/migrations/";
export const ALERT_ISSUE_LOOKUP_LABEL = ALERT_LOOKUP_LABEL;
export const ALERT_ISSUE_LABELS = [ALERT_ISSUE_LOOKUP_LABEL, "area:db", "P1"];

// A migration merged minutes ago is legitimately not applied yet. The grace
// window is measured from the migration's own 14-digit version timestamp, which
// is the only "when was this authored" signal available without a git or API
// round-trip. A migration back-dated below this window alerts immediately —
// deliberately conservative: this check may cry wolf, it may not stay silent.
export const DEFAULT_PENDING_GRACE_HOURS = 24;

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

// ── Release baseline ────────────────────────────────────────────────────────

const RELEASE_TAG_PATTERN = /^v\d+\.\d+\.\d+$/;

function defaultGit(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * The versioned migrations in the tree at `ref`, in ONE git call. The drift
 * gate's `readMigrationsAtRef` is the same query plus a per-file `git log` for
 * its grace window, which a caller that needs only `version` and `file` must
 * not pay for.
 */
export function readMigrationVersionsAtRef({ ref, runGit = defaultGit }) {
  const listing = runGit(["ls-tree", "-r", "--name-only", ref, "--", "supabase/migrations"]);
  return listing
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((path) => {
      const parsed = parseMigrationFilename(path.split("/").pop());
      return parsed ? { ...parsed, path } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.version.localeCompare(b.version));
}

/**
 * The migrations in the latest `v*` tag, as { ok, tag, migrations, error }.
 *
 * "Latest" is `release.yml`'s own rule (`git tag --list 'v*'
 * --sort=-version:refname | head -n1`), so both agree on what production's
 * release is. That tag must be a plain `vX.Y.Z`, which is all `release.yml`
 * mints; anything else is an error rather than a quiet step past it.
 *
 * Never throws. A missing tag, an unreadable tree or a tag with no migrations is
 * an error, never an empty list: an empty baseline would pass every database.
 */
export function readReleaseBaseline({ git = defaultGit } = {}) {
  let tag;
  try {
    tag = git(["tag", "--list", "v*", "--sort=-version:refname"])
      .split("\n")
      .map((t) => t.trim())
      .find(Boolean);
  } catch (error) {
    return { ok: false, tag: null, migrations: [], error: `listing the v* tags failed: ${error.message}` };
  }
  if (!tag) {
    return { ok: false, tag: null, migrations: [], error: "the checkout holds no v* tag" };
  }
  if (!RELEASE_TAG_PATTERN.test(tag)) {
    return { ok: false, tag, migrations: [], error: `the latest v* tag, ${tag}, is not a vX.Y.Z release` };
  }

  let migrations;
  try {
    migrations = readMigrationVersionsAtRef({ ref: `refs/tags/${tag}`, runGit: git });
  } catch (error) {
    return { ok: false, tag, migrations: [], error: `reading ${tag}'s migrations failed: ${error.message}` };
  }
  if (migrations.length === 0) {
    return { ok: false, tag, migrations: [], error: `${tag} holds no migrations in supabase/migrations/` };
  }
  return { ok: true, tag, migrations, error: null };
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

/** Labels judged against the release when DRIFT_RELEASED_TARGETS is unset. */
export const DEFAULT_RELEASED_TARGETS = ["production"];

/**
 * Marks each target named in `releasedSpec` (DRIFT_RELEASED_TARGETS) with the
 * release baseline it is judged against: `released` when the tag was read,
 * `releaseError` when it was not, which leaves that target unverified rather
 * than judged against `main`. An unset spec means DEFAULT_RELEASED_TARGETS,
 * among the targets present; an explicit one must name only real targets.
 * Returns { ok, error }; mutates the targets.
 */
export function attachReleaseBaselines({ targets, releasedSpec, readBaseline = readReleaseBaseline }) {
  const explicit = releasedSpec !== undefined;
  const labels = explicit
    ? releasedSpec
        .split(",")
        .map((label) => label.trim())
        .filter(Boolean)
    : DEFAULT_RELEASED_TARGETS.filter((label) => targets.some((target) => target.label === label));

  const unknown = labels.filter((label) => !targets.some((target) => target.label === label));
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `DRIFT_RELEASED_TARGETS names ${unknown.join(", ")}, which DRIFT_TARGETS does not.`,
    };
  }
  if (labels.length === 0) return { ok: true, error: null };

  const release = readBaseline();
  for (const target of targets) {
    if (!labels.includes(target.label)) continue;
    if (release.ok) target.released = { tag: release.tag, migrations: release.migrations };
    else target.releaseError = release.error;
  }
  return { ok: true, error: null };
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

  // Reading the body and parsing it fail for different reasons, and the error
  // names which: a body that stalls or resets mid-read (with `resilientFetch`,
  // its timeout also covers the body) is not a malformed answer.
  let text;
  try {
    text = await response.text();
  } catch (error) {
    return { ok: false, migrations: [], error: `reading the response failed: ${error.message}` };
  }
  let payload;
  try {
    payload = JSON.parse(text);
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
 *   pending    — expected, not applied       (split into overdue / withinGrace)
 *   foreign    — applied, absent from `main` (always wrong, never graced)
 *   unreleased — on `main`, not in the release baseline, not applied (reported only)
 *   matched    — applied and on `main`
 *
 * "Expected" is `main`'s migrations, or the release baseline's when `released`
 * is given. `foreign` is judged against `main` either way and is never subject
 * to the grace window: a version `main` does not hold blocks the next
 * `db push` outright, including one the release shipped and `main` later
 * renamed or deleted.
 */
export function classifyDrift({ local, released = null, remote, nowMs, graceMs }) {
  const expected = released ?? local;
  const remoteVersions = new Set(remote.map((m) => m.version));
  const expectedVersions = new Set(expected.map((m) => m.version));
  const localVersions = new Set(local.map((m) => m.version));

  const matched = remote.filter((m) => localVersions.has(m.version));
  const pending = expected.filter((m) => !remoteVersions.has(m.version));
  const foreign = remote.filter((m) => !localVersions.has(m.version));
  const unreleased = released
    ? local.filter((m) => !expectedVersions.has(m.version) && !remoteVersions.has(m.version))
    : [];

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
  return { matched, pending, overdue, withinGrace, foreign, unreleased, status };
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
  if (result.baselineUnread) return `not checked — its release baseline could not be read: ${result.error}`;
  if (result.status === "unknown") return `could not be read — ${result.error}`;
  const against = result.baseline ? ` with \`${result.baseline}\`` : "";
  if (result.status === "clean") {
    const notes = [];
    if (result.withinGrace.length > 0) notes.push(`${result.withinGrace.length} pending within grace`);
    if (result.unreleased?.length > 0) notes.push(`${result.unreleased.length} on main, not released yet`);
    return `in sync${against}${notes.length > 0 ? ` (${notes.join("; ")})` : ""}`;
  }
  const parts = [];
  if (result.overdue.length > 0) parts.push(`${result.overdue.length} pending`);
  if (result.foreign.length > 0) parts.push(`${result.foreign.length} foreign`);
  return `DRIFTING${result.baseline ? ` from \`${result.baseline}\`` : ""} — ${parts.join(", ")}`;
}

/** Where a target's pending migrations came from, for the pending headings. */
function pendingSource(result) {
  return result.baseline ? `\`${result.baseline}\`` : "this repository";
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
    "| Environment | Applied | Expected | Verdict |",
    "| --- | --- | --- | --- |",
    ...results.map(
      (r) =>
        `| \`${r.label}\` | ${r.status === "unknown" ? "—" : r.remoteCount} | ${r.expectedCount ?? "—"} | ${describeTarget(r)} |`,
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
        `**Pending — in ${pendingSource(result)}, not applied (${result.overdue.length}):**`,
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
    `Pending migrations are tolerated for ${graceHours}h after their version timestamp. ` +
      "A target judged against a `v*` tag does not alert on migrations merged since that tag.",
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
    `Do not claim this issue as backlog work — it carries \`${ALERT_ISSUE_LOOKUP_LABEL}\` and tracks live state,`,
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
          `- **Pending (${result.overdue.length}${result.baseline ? `, from \`${result.baseline}\`` : ""}):** ${migrationList(result.overdue)}`,
        );
      }
      section.push("");
      return section;
    }),
    "### How to act on this",
    "",
    "**Pending** rows mean migrations the environment should hold never reached its database. For",
    "staging that is everything on `main`: check whether `Deploy API` is running at all (#763) before",
    "assuming a migration problem. For production it is the latest `v*` tag's migrations, which",
    "`deploy-production.yml` applies before it mints the tag. A pending row there means the tag was",
    "minted some other way (a `release.yml` dispatch, or by hand) on a commit whose migrations never",
    "shipped, or the history was changed by hand after the ship. Check how the tag was made first.",
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
    "| Environment | Applied | Expected |",
    "| --- | --- | --- |",
    ...results.map((r) => `| \`${r.label}\` | ${r.remoteCount} | ${r.expectedCount} |`),
  ];
  if (runUrl) lines.push("", `- Run: ${runUrl}`);
  lines.push(
    "",
    "_Closed automatically by `scripts/ci/check-migration-drift.mjs`._",
  );
  return lines.join("\n");
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
    const baseline = target.released?.tag ?? null;
    const expectedCount = target.releaseError ? null : (target.released?.migrations.length ?? local.length);
    const unread = (error) => ({
      label: target.label,
      ref: target.ref,
      status: "unknown",
      error,
      baseline,
      expectedCount,
      remoteCount: 0,
      matched: [],
      pending: [],
      overdue: [],
      withinGrace: [],
      foreign: [],
      unreleased: [],
    });

    // A target that must be judged against a release, but whose release could
    // not be read, is unverified. Falling back to `main` would raise the very
    // alert the baseline exists to stop; passing it would hide real drift.
    if (target.releaseError) {
      results.push({ ...unread(target.releaseError), baselineUnread: true });
      continue;
    }

    const remote = await fetchAppliedMigrations({
      accessToken: target.accessToken,
      projectRef: target.ref,
      fetchImpl,
    });

    if (!remote.ok) {
      results.push(unread(remote.error));
      continue;
    }

    const drift = classifyDrift({
      local,
      released: target.released?.migrations ?? null,
      remote: remote.migrations,
      nowMs,
      graceMs,
    });
    results.push({
      label: target.label,
      ref: target.ref,
      error: null,
      baseline,
      expectedCount,
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

  const alertIdentity = {
    token,
    repo,
    fetchImpl,
    title: ALERT_ISSUE_TITLE,
    lookupLabel: ALERT_ISSUE_LOOKUP_LABEL,
  };
  let alert = { action: "none" };
  if (status === "drift") {
    alert = await raiseAlert({
      ...alertIdentity,
      labels: ALERT_ISSUE_LABELS,
      buildIssueBody: () => buildAlertIssueBody({ results, graceHours, runUrl }),
      buildCommentBody: ({ reopened }) =>
        buildAlertCommentBody({ results, graceHours, runUrl, reopened }),
    });
    logger.log?.(
      alert.action === "failed"
        ? "::error::[migration-drift] could not write the alert issue"
        : `[migration-drift] alert issue #${alert.issueNumber} ${alert.action}`,
    );
  } else if (status === "clean") {
    alert = await resolveAlert({
      ...alertIdentity,
      buildRecoveryBody: () => buildRecoveryCommentBody({ results, runUrl }),
    });
    if (alert.action === "closed") {
      logger.log?.(`[migration-drift] closed alert issue(s): ${alert.closed.join(", ")}`);
    } else if (alert.action === "unread") {
      // "I could not look" is not "nothing is open": the run cannot say the
      // alert state is clean, so it fails rather than report nothing to close.
      logger.log?.("::error::[migration-drift] could not read the alert issues; none closed");
    } else if (alert.action === "failed") {
      logger.log?.("::error::[migration-drift] could not close the open alert issue");
    }
  } else {
    // unknown: never raise (nothing was observed to be drifting) and never
    // resolve (an unreadable database is not a database that matches).
    logger.log?.("[migration-drift] a target could not be read; alert issue left as-is");
  }

  // A clean run whose alert could not be read or closed still fails: a green
  // job would hide a P1 left open on a healthy environment, every day.
  const exitCode =
    status === "clean" && alert.action !== "failed" && alert.action !== "unread" ? 0 : 1;
  return { status, results, alert, exitCode };
}

// ── CLI entry ───────────────────────────────────────────────────────────────

async function main() {
  const token = requireEnv("GITHUB_TOKEN");
  const repo = requireEnv("GITHUB_REPOSITORY");
  const targets = parseTargets(requireEnv("DRIFT_TARGETS")).map((target) => ({
    ...target,
    accessToken: supabaseAccessTokenFor(target.label),
  }));

  if (targets.length === 0) {
    console.error("Error: DRIFT_TARGETS parsed to zero targets. Expected `label=ref` pairs.");
    process.exit(1);
  }

  const released = attachReleaseBaselines({
    targets,
    releasedSpec: process.env.DRIFT_RELEASED_TARGETS,
  });
  if (!released.ok) {
    console.error(`Error: ${released.error}`);
    process.exit(1);
  }
  const untokened = targets.filter((target) => !target.accessToken);
  if (untokened.length > 0) {
    for (const { label } of untokened) {
      console.error(
        `Error: no Supabase token for ${label}: set SUPABASE_ACCESS_TOKEN_${label.toUpperCase()} ` +
          "or SUPABASE_ACCESS_TOKEN.",
      );
    }
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
    targets,
    local,
    nowMs: Date.now(),
    graceHours,
    runUrl: process.env.RUN_URL ?? "",
  });

  process.exit(exitCode);
}

if (isInvokedDirectly(import.meta.url)) {
  main().catch((error) => {
    console.error(`Unhandled error: ${error.stack ?? error.message}`);
    process.exit(1);
  });
}
