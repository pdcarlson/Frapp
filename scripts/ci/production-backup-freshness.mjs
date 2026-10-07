#!/usr/bin/env node

// Scheduled watches: the nightly production backup jobs must keep succeeding.
//
// Launch bar 2 needs both halves of a restore: the Postgres dump
// (`backup-production`) and the Storage mirror (`backup-production-storage`),
// two jobs of Nightly Backup (`db-backup.yml`). Nothing inside that workflow
// fails closed if either job stops, skips, hangs, or ages out. The reviewer
// watch (1956) only sees GitHub environment `production-backup`. A job that
// never starts, or concludes anything other than success, would leave
// recoverability looking covered.
//
// One script, two watches (#2328). `WATCHES` below holds what differs between
// them: the job, its timeout, its alert and the alert's copy. Each workflow
// names its watch in `BACKUP_WATCH`, and an unknown or missing name throws, so
// a mis-wired workflow is loud rather than silently watching the other job:
//   production-backup-freshness.yml          BACKUP_WATCH=dump
//   production-backup-storage-freshness.yml  BACKUP_WATCH=storage
// When each runs: docs/ci-cd/agent-infra.md § Scheduled conformance.
//
// This script GETs recent `db-backup.yml` runs and their jobs and judges the
// watch's job by the rules in `lib/backup-job-freshness.mjs`. That header is
// the canonical statement, so it isn't restated here.
//
// It does not name any GitHub `environment:` itself. A schedule job that
// named `production` would hang on the ADR-19 reviewer gate (#1435). It
// never PUTs an environment, a workflow, or a backup.
//
// Each watch has its own alert title. A recovered pin, uptime, backup-env run
// or the other watch must not close it. The hosted restore leftover stays on
// its own issue (1861).
//
// What the Storage job's `success` proves: the job verifies content, not just
// that no command failed (#2335). It refuses a prefix with no manifest or one
// recording another destination, a listing that would tombstone every object,
// and a mirror whose manifest names objects missing offsite
// (`scripts/storage-backup.mjs`, "Proving the mirror is where we think"). So a
// job that mirrored nothing, or mirrored into the wrong bucket, concludes
// failure and the Storage watch raises its alert the same day. The check lives
// in the job because it holds the R2 credentials; this script holds only
// GITHUB_TOKEN on purpose (#2518). Two gaps are deliberate. A mirror with no
// live objects passes with a warning in the job log (production had no
// uploads when this landed, and a P1 open until launch would teach everyone to
// ignore it), which also covers one emptied by a run someone allowed with
// `storage_allow_mass_delete`. And below 20 objects only a total wipe is
// refused, not a partial drop (#2702).
//
// Semantics: `lib/backup-job-freshness.mjs`. Tests: its own suite, and
// `scripts/ci/__tests__/production-backup-freshness.test.mjs` for both watches.

import { basename } from "node:path";

import {
  defineAlert,
  raiseAlert,
  resolveAlert,
  selectAlertConfig,
} from "./lib/alert-issue.mjs";
import {
  RUNS_PER_PAGE,
  readJobFreshness,
  verdictLogLine,
} from "./lib/backup-job-freshness.mjs";
import { requireEnv } from "./lib/env.mjs";
import { ghGetWithFallback } from "./lib/github.mjs";
import { isInvokedDirectly } from "./lib/invoked-directly.mjs";
import { ROLLBACK_PLAYBOOK } from "./lib/ops-docs.mjs";

export const WORKFLOW_FILE = "db-backup.yml";
export const DEFAULT_BRANCH = "main";
export const STALE_AFTER_MS = 36 * 60 * 60 * 1000;
export const HUNG_AFTER_MS = 3 * 60 * 60 * 1000;

// The test suite pins each key to its `jobName` on the source text, and checks
// each watch's job, timeout, title and alert copy against literals of its own,
// so crossing the two watches fails it. `timeoutMs` is the job's `timeout-minutes` in db-backup.yml: GitHub
// reports a job its timeout stopped as `cancelled`, and this is how the
// verdict tells that from a cancelled dispatch. The suite checks it against
// the workflow. Alert titles are the stable lookup keys of open alerts; never
// edit one, or the open alert is orphaned and a duplicate filed.
export const WATCHES = {
  dump: {
    jobName: "backup-production",
    timeoutMs: 30 * 60 * 1000,
    // "The nightly production <subject> is missing, failed, ..."
    subject: "Postgres dump",
    // "Nightly production <noun> is fresh again", "the nightly <noun> is ..."
    noun: "dump",
    recoverWhat: "the dump",
    alert: defineAlert({
      title: "Nightly production dump is stale or failed — recoverability is unproven",
      labels: ["area:ci", "P1"],
    }),
    whyLines: [
      "Launch bar 2 needs a recoverable production dump. Nightly Backup (`db-backup.yml`) `backup-production` is the only copy of `frapp-prod` outside Supabase: Supabase's own daily backups (7 days, Pro) are deleted with the project and hold no Storage files. The reviewer watch (1956) only sees GitHub environment `production-backup`. The hosted restore leftover stays on its own issue (1861).",
    ],
  },
  storage: {
    jobName: "backup-production-storage",
    timeoutMs: 60 * 60 * 1000,
    subject: "Storage mirror",
    noun: "Storage mirror",
    recoverWhat: "the mirror",
    alert: defineAlert({
      title: "Nightly production Storage mirror is stale or failed — recoverability is unproven",
      labels: ["area:ci", "P1"],
    }),
    whyLines: [
      "Launch bar 2 needs both halves of a restore. Nightly Backup (`db-backup.yml`) `backup-production-storage` is the Storage half for `frapp-prod`. The Postgres freshness watch (1963) does not see this job. The reviewer watch (1956) only sees GitHub environment `production-backup`. The hosted restore leftover stays on its own issue (1861).",
      "",
      `A failed job may be the job refusing bad content rather than crashing: no manifest under the prefix (BACKUP_S3_BUCKET or the prefix changed), a manifest recording another destination, a listing that would tombstone every object, or objects the manifest lists missing offsite. Read the job's \`::error::\` first, then [\`${basename(ROLLBACK_PLAYBOOK)}\` § If the backup job fails](https://github.com/pdcarlson/Frapp/blob/main/${ROLLBACK_PLAYBOOK}#if-the-backup-job-fails), which says which re-run input, if any, is the fix.`,
    ],
  },
};

/**
 * The watch a workflow named in `BACKUP_WATCH`. Throws on a missing or unknown
 * name, through `selectAlertConfig`: there is no default, because a default
 * would let a workflow that dropped the line watch the other job, and comment
 * on and close the other job's alert.
 */
export function resolveWatch(name) {
  return selectAlertConfig(WATCHES, name, "BACKUP_WATCH");
}

/** Prefer the job token: Actions reads work with GITHUB_TOKEN. */
export function resolveActionsReadToken(env = process.env) {
  return env.GITHUB_TOKEN || env.GITHUB_PAT || "";
}

/** Actions job-scoped `issues: write` is on GITHUB_TOKEN. */
export function resolveAlertToken(env = process.env) {
  return env.GITHUB_TOKEN || env.GITHUB_PAT || "";
}

export function resolveActionsFallbackToken(env = process.env) {
  const primary = resolveActionsReadToken(env);
  if (env.GITHUB_PAT && env.GITHUB_PAT !== primary) return env.GITHUB_PAT;
  return "";
}

function runsPath(repo) {
  return (
    `/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/runs` +
    `?branch=${encodeURIComponent(DEFAULT_BRANCH)}&per_page=${RUNS_PER_PAGE}`
  );
}

function jobsPath(repo, runId) {
  return `/repos/${repo}/actions/runs/${runId}/jobs?filter=latest&per_page=100`;
}

/**
 * GET recent Nightly Backup runs on `main` and their jobs, and judge the
 * watch's job as `readJobFreshness` in `lib/backup-job-freshness.mjs`
 * describes. A feature-branch dispatch is not the production backup. Schedule
 * and workflow_dispatch on `main` both count: a failed backup on `main` is a
 * failed backup. Retry with the fallback token only on 401/403, and only when
 * the fallback token is different. A transport failure is retried on the same
 * token first (`ghGetWithFallback` in `lib/github.mjs`). Never PUT.
 */
export async function readBackupFreshness({
  watch,
  token,
  repo,
  fetchImpl,
  fallbackToken,
  now = Date.now(),
  // Passed to `ghGetWithFallback` (backoff, sleep, timeout) so tests stay offline.
  retryOptions,
}) {
  return readJobFreshness({
    jobName: watch.jobName,
    workflowFile: WORKFLOW_FILE,
    staleAfterMs: STALE_AFTER_MS,
    hungAfterMs: HUNG_AFTER_MS,
    timeoutMs: watch.timeoutMs,
    runsPath: runsPath(repo),
    jobsPath: (runId) => jobsPath(repo, runId),
    get: (path) => ghGetWithFallback({ token, fallbackToken, fetchImpl, path, retryOptions }),
    now,
  });
}

function buildAlertIssueBody({ watch, verdict, runUrl }) {
  return [
    `The nightly production ${watch.subject} is missing, failed, hung, or older than 36 hours.`,
    "",
    `**${verdict.reason}**`,
    "",
    ...watch.whyLines,
    "",
    `Do not change the dump cron to clear a red run. Inspect the latest \`${watch.jobName}\` job and recover ${watch.recoverWhat}, then wait for a later freshness run.`,
    "",
    runUrl ? `Run: ${runUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function runWatchdog({
  watch,
  verdict,
  token,
  repo,
  runUrl = "",
  fetchImpl,
}) {
  if (!verdict.ok) {
    const raised = await raiseAlert({
      token,
      repo,
      fetchImpl,
      alert: watch.alert,
      buildIssueBody: () => buildAlertIssueBody({ watch, verdict, runUrl }),
      buildCommentBody: ({ reopened }) =>
        `${reopened ? "Reopened — " : ""}still stale or failed: ${verdict.reason}${runUrl ? `\n\nRun: ${runUrl}` : ""}`,
      refreshBodyOnRaise: true,
    });
    return { outcome: "fail", alert: raised };
  }

  if (!verdict.fresh) {
    return { outcome: "pass", resolved: false, pending: true };
  }

  const resolved = await resolveAlert({
    token,
    repo,
    fetchImpl,
    alert: watch.alert,
    buildRecoveryBody: () =>
      `Nightly production ${watch.noun} is fresh again: ${verdict.reason}${runUrl ? `\n\nRun: ${runUrl}` : ""}`,
  });
  // A clean run that cannot read or close its alert is red. One failed read is
  // usually transient, but a lasting one means the job's token lost issues
  // access, and then the next real failure cannot raise its alert either; this
  // daily run is the only early signal of that. A close that left the alert
  // open is red too: a green run would hide a P1 open on a healthy system.
  if (resolved.action === "unread") {
    return { outcome: "fail", resolved: false, lookupOk: false };
  }
  return {
    outcome: resolved.action === "failed" ? "fail" : "pass",
    resolved: resolved.action === "closed",
    lookupOk: true,
  };
}

async function main() {
  const probeOnly = process.argv.includes("--probe-only");
  const watch = resolveWatch(process.env.BACKUP_WATCH);

  const actionsToken = resolveActionsReadToken();
  if (!actionsToken) {
    const message = "GITHUB_TOKEN or GITHUB_PAT is required.";
    console.error(process.env.GITHUB_ACTIONS ? `::error::${message}` : `Error: ${message}`);
    process.exit(1);
  }
  const repo = requireEnv("GITHUB_REPOSITORY");

  const fallbackToken = resolveActionsFallbackToken();
  const verdict = await readBackupFreshness({
    watch,
    token: actionsToken,
    repo,
    fallbackToken,
  });
  // A pass resting on an earlier success prints as a warning, not green.
  (verdict.ok ? console.log : console.error)(verdictLogLine(verdict));

  if (probeOnly) {
    process.exit(verdict.ok ? 0 : 1);
  }

  const alertToken = resolveAlertToken();
  if (!alertToken) {
    console.error("::error::GITHUB_TOKEN or GITHUB_PAT is required to write the alert");
    process.exit(1);
  }

  const runUrl = process.env.RUN_URL ?? "";
  const watchdog = await runWatchdog({
    watch,
    verdict,
    token: alertToken,
    repo,
    runUrl,
  });
  if (!verdict.ok && watchdog.alert?.action === "failed") {
    console.error(`::error::the nightly ${watch.noun} is stale or failed and the alert issue could not be written`);
  }
  if (verdict.fresh && watchdog.lookupOk === false) {
    console.error("::error::Could not read the alert issues, so no alert was closed this run");
  } else if (verdict.fresh && watchdog.outcome === "fail") {
    console.error(`::error::the nightly ${watch.noun} is fresh but the alert issue could not be closed`);
  }
  process.exit(watchdog.outcome === "pass" ? 0 : 1);
}

if (isInvokedDirectly(import.meta.url)) {
  main().catch((error) => {
    console.error(`Unhandled error: ${error.stack ?? error.message}`);
    process.exit(1);
  });
}
