#!/usr/bin/env node
// Clear a stuck run that is freezing a scheduled watchdog, and alert when a
// watchdog's runs keep getting cancelled (#3368).
//
// Every scheduled watchdog sets `concurrency: { cancel-in-progress: false }`,
// so a run is never cancelled mid-work (a half-uploaded dump is worse than a
// late one). The cost: one run that never finishes holds the group forever.
// GitHub keeps one pending run per group and cancels it when the next queues,
// so every later run is cancelled before it starts, and a cancelled run raises
// no alert. That happened: Production guardrails run 37337018741 started on
// 2026-10-05 with zero steps, ignored its `timeout-minutes`, and was failed by
// GitHub's 30-day limit on 2026-11-04. Staging conformance froze the same way.
// For 30 days neither watchdog checked anything, and nothing said so.
//
// A watchdog can't free itself: its own run is the one stuck in the queue. So
// this sweep runs from its own workflow, on its own schedule, and per watched
// workflow:
//
//   - Stuck: a run still `in_progress` or `queued` STUCK_AFTER_MINUTES after it
//     started is force-cancelled. That is far past every watched workflow's
//     total `timeout-minutes` (a test pins it), so the run is no longer doing
//     work and cancelling it can't cut one short. Force-cancel, not cancel,
//     because a run that outlived its own timeouts already ignored one stop;
//     GitHub documents force-cancel for a run that doesn't respond to cancel.
//     A cleared run is a warning, not an alert: the watchdog runs again next
//     time. A run that can't be cancelled is an alert.
//   - Streak: its newest CANCELLED_STREAK_ALERT_AT completed scheduled runs
//     were all cancelled. Whatever the cause (a stuck run this sweep can't
//     see or clear, or someone cancelling them), the watchdog is dark. Only
//     `schedule` runs count: a burst of `workflow_run` triggers legitimately
//     cancels pending runs, and a dispatch is a person who will see it.
//
// One alert covers both. A hidden marker in its body names what it was raised
// for, so it comments when that set changes, not on every sweep, and it closes
// when nothing is stuck and no streak remains. If any workflow's runs can't be
// read, it touches the alert not at all: a partial read can't tell "recovered"
// from "unread".
//
// This is not the meta-watch docs/ci-cd/agent-infra.md rejects (#2333): it
// asserts nothing about whether a watchdog ran recently, so it raises nothing
// when the schedules are disabled or GitHub's cron is down. It clears one
// deadlock a watchdog can't clear itself, and reports a symptom that has no
// other alert.
//
// Env inputs:
//   GITHUB_TOKEN          — required (actions: write to cancel, issues: write)
//   GITHUB_REPOSITORY     — required, owner/repo
//   RUN_URL               — optional, html_url of this run
//   GITHUB_STEP_SUMMARY   — optional, written when present
//
// Exit codes:
//   0 — every watched workflow was read, nothing is stuck past clearing, no
//       streak, and the alert's state is known to match
//   1 — a read failed, a stuck run couldn't be cancelled, a streak was found
//       (its alert is raised), or the alert couldn't be read or written
//
// Unit tests: scripts/ci/__tests__/scheduled-run-sweep.test.mjs
// (`npm run test:ci-scripts`).

import { appendFileSync } from "node:fs";

import { defineAlert, findAlertIssuesDetailed, markerLine, raiseAlert, resolveAlert } from "./lib/alert-issue.mjs";
import { ghRequest } from "./lib/github.mjs";
import { requireEnv } from "./lib/env.mjs";
import { isInvokedDirectly } from "./lib/invoked-directly.mjs";

/**
 * Every scheduled workflow that sets `cancel-in-progress: false`, and so can be
 * frozen by one stuck run. A test keeps this equal to what .github/workflows
 * holds.
 */
export const WATCHED_WORKFLOWS = [
  "check-migration-drift.yml",
  "db-backup.yml",
  "migration-snapshot.yml",
  "npm-audit-watch.yml",
  "production-auth-conformance.yml",
  "production-backup-env.yml",
  "production-backup-freshness.yml",
  "production-backup-storage-freshness.yml",
  "production-guardrails.yml",
  "production-release-pin.yml",
  "production-uptime.yml",
  "routine-heartbeat.yml",
  "staging-conformance.yml",
  "supabase-quota.yml",
];

/** A run this long after it started is stuck. Six hours, GitHub's default job timeout. */
export const STUCK_AFTER_MINUTES = 360;

/**
 * How many newest completed scheduled runs, all cancelled, raise the alert.
 * Three, not two: `production-uptime.yml` is scheduled every 15 minutes, and a
 * burst of late cron starts can cancel two pending runs in a row while one
 * healthy run finishes. For a daily watchdog three is three days dark, against
 * the 30 that went unseen.
 */
export const CANCELLED_STREAK_ALERT_AT = 3;

/** Statuses of a run that holds its concurrency group. A `pending` run is waiting for it. */
export const HOLDING_STATUSES = ["in_progress", "queued"];

// The title is the lookup key: it must stay stable.
export const ALERT = defineAlert({
  title: "A scheduled watchdog is frozen: a stuck run, or its runs keep getting cancelled",
  labels: ["area:ci", "P2"],
});

// ── Runs ────────────────────────────────────────────────────────────────────

/** When a run's current attempt started, as epoch ms, or null. */
export function runStartMs(run) {
  const stamp = run?.run_started_at ?? run?.created_at;
  const ms = typeof stamp === "string" ? Date.parse(stamp) : Number.NaN;
  return Number.isFinite(ms) ? ms : null;
}

/** Runs that still hold the group `limitMinutes` after they started, oldest first. */
export function stuckRuns(runs, now, limitMinutes = STUCK_AFTER_MINUTES) {
  const cutoff = now.getTime() - limitMinutes * 60_000;
  return runs
    .filter((run) => HOLDING_STATUSES.includes(run.status))
    .filter((run) => {
      const started = runStartMs(run);
      return started !== null && started <= cutoff;
    })
    .sort((a, b) => runStartMs(a) - runStartMs(b));
}

/**
 * The newest completed runs, newest first, that were cancelled, up to the
 * first that wasn't. The API lists newest first already; sorting again keeps
 * that from being an assumption.
 */
export function cancelledStreak(runs) {
  const completed = runs
    .filter((run) => run.status === "completed")
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const streak = [];
  for (const run of completed) {
    if (run.conclusion !== "cancelled") break;
    streak.push(run);
  }
  return streak;
}

async function readRuns({ token, repo, fetchImpl, workflow, query }) {
  const result = await ghRequest({
    token,
    fetchImpl,
    path: `/repos/${repo}/actions/workflows/${workflow}/runs?${query}`,
    retry: true,
  });
  const runs = result.data?.workflow_runs;
  if (!result.ok || !Array.isArray(runs)) return { ok: false, status: result.status, runs: [] };
  return { ok: true, status: result.status, runs };
}

/**
 * Read one workflow's runs, force-cancel its stuck ones, and measure its
 * cancelled streak. Returns `{ workflow, ok, cleared, uncancellable, streak }`;
 * `ok` is false when any read failed, and then nothing was cancelled.
 */
export async function sweepWorkflow({ token, repo, fetchImpl, workflow, now }) {
  const reads = await Promise.all([
    ...HOLDING_STATUSES.map((status) =>
      readRuns({ token, repo, fetchImpl, workflow, query: `status=${status}&per_page=100` }),
    ),
    // Enough to see a streak, plus room for runs that completed some other way.
    readRuns({ token, repo, fetchImpl, workflow, query: "event=schedule&status=completed&per_page=10" }),
  ]);
  const failed = reads.find((read) => !read.ok);
  if (failed) return { workflow, ok: false, status: failed.status, cleared: [], uncancellable: [], streak: [] };

  const holding = reads.slice(0, HOLDING_STATUSES.length).flatMap((read) => read.runs);
  const streak = cancelledStreak(reads.at(-1).runs);

  const cleared = [];
  const uncancellable = [];
  for (const run of stuckRuns(holding, now)) {
    const result = await ghRequest({
      token,
      fetchImpl,
      method: "POST",
      path: `/repos/${repo}/actions/runs/${run.id}/force-cancel`,
    });
    // 202 accepted. 409 means it is no longer running, which is what we wanted.
    if (result.ok || result.status === 409) cleared.push(run);
    else uncancellable.push({ run, status: result.status });
  }
  return { workflow, ok: true, cleared, uncancellable, streak };
}

// ── The alert ───────────────────────────────────────────────────────────────

/** What the alert is for: `{ kind: "streak" | "stuck", workflow, ... }`, in a stable order. */
export function problemsIn(results) {
  const problems = [];
  for (const result of results) {
    if (result.streak.length >= CANCELLED_STREAK_ALERT_AT) {
      problems.push({ kind: "streak", workflow: result.workflow, runs: result.streak });
    }
    for (const { run, status } of result.uncancellable) {
      problems.push({ kind: "stuck", workflow: result.workflow, run, status });
    }
  }
  return problems.sort((a, b) => problemKey(a).localeCompare(problemKey(b)));
}

function problemKey(problem) {
  return problem.kind === "streak" ? `streak:${problem.workflow}` : `stuck:${problem.run.id}`;
}

const MARKER_PREFIX = "<!-- scheduled-run-sweep:";

/**
 * The hidden line the alert's body records its problems in. A streak is keyed
 * by workflow alone, so a streak that grows by one run a day changes nothing.
 */
export function sweepMarker(problems) {
  return `${MARKER_PREFIX} ${problems.map(problemKey).join(",")} -->`;
}

/** The marker line in an issue body, or null. */
export function markerIn(body) {
  return markerLine(body, MARKER_PREFIX);
}

function runLink(run) {
  return run.html_url ? `[run ${run.id}](${run.html_url})` : `run ${run.id}`;
}

function describeProblem(problem) {
  if (problem.kind === "streak") {
    return (
      `- \`${problem.workflow}\`: its last ${problem.runs.length} scheduled runs were cancelled ` +
      `(newest: ${runLink(problem.runs[0])}). Usually a run of it is holding its concurrency group.`
    );
  }
  const started = problem.run.run_started_at ?? problem.run.created_at;
  return (
    `- \`${problem.workflow}\`: ${runLink(problem.run)} has held its concurrency group since ${started}, ` +
    `more than ${STUCK_AFTER_MINUTES / 60} hours, and force-cancelling it failed (HTTP ${problem.status}).`
  );
}

function runLine(runUrl) {
  return runUrl ? `Run: ${runUrl}` : "";
}

export function buildIssueBody({ problems, runUrl }) {
  return [
    "The scheduled-run sweep (`scheduled-run-sweep.yml`) found scheduled watchdogs that are not running:",
    "",
    ...problems.map(describeProblem),
    "",
    "**Why it matters.** These workflows set `cancel-in-progress: false`, so one run that never finishes holds the " +
      "group, and every later run is cancelled before it starts. A cancelled run raises no alert of its own, so the " +
      "watchdog checks nothing and nothing else says so (#3368).",
    "",
    "**What to do.** In the workflow's Actions tab, find the run that is in progress or queued and cancel it (if " +
      "Cancel does nothing, `POST /repos/{owner}/{repo}/actions/runs/{run_id}/force-cancel`). Then dispatch the " +
      "workflow once and check it runs. If nothing is holding it, find what is cancelling its runs.",
    "",
    runLine(runUrl),
    "",
    sweepMarker(problems),
  ]
    .join("\n")
    .trim();
}

export function buildCommentBody({ problems, reopened }) {
  return [
    reopened ? "**Reopened.** A scheduled watchdog is frozen again." : "What is frozen changed. Now:",
    "",
    ...problems.map(describeProblem),
  ].join("\n");
}

export function buildRecoveryBody({ runUrl }) {
  return [
    "**Cleared.** No watched workflow has a run stuck past clearing, and none has its last " +
      `${CANCELLED_STREAK_ALERT_AT} scheduled runs cancelled.`,
    "",
    runLine(runUrl),
  ]
    .join("\n")
    .trim();
}

/**
 * Raise, leave or clear the alert for this sweep's `results`. Returns
 * `{ action, ... }`: a raise or resolve action from lib/alert-issue.mjs,
 * "unchanged" (an open alert already names exactly these problems), or
 * "unread" (a workflow's runs or the alert itself couldn't be read).
 */
export async function updateAlert({ token, repo, fetchImpl, results, runUrl }) {
  if (results.some((result) => !result.ok)) return { action: "unread" };
  const problems = problemsIn(results);
  const lookup = await findAlertIssuesDetailed({ token, repo, fetchImpl, alert: ALERT });
  if (!lookup.lookupOk) return { action: "unread" };

  if (problems.length === 0) {
    return resolveAlert({ token, repo, fetchImpl, alert: ALERT, lookup, buildRecoveryBody: () => buildRecoveryBody({ runUrl }) });
  }
  const open = lookup.issues.find((issue) => issue.state === "open");
  if (open && markerIn(open.body) === sweepMarker(problems)) {
    return { action: "unchanged", issueNumber: open.number };
  }
  return raiseAlert({
    token,
    repo,
    fetchImpl,
    alert: ALERT,
    lookup,
    buildIssueBody: () => buildIssueBody({ problems, runUrl }),
    buildCommentBody: ({ reopened }) => buildCommentBody({ problems, reopened }),
    // The body holds the marker, so it has to track the current set.
    refreshBodyOnRaise: true,
  });
}

// ── Run ─────────────────────────────────────────────────────────────────────

function defaultWriteSummary(markdown) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (path) appendFileSync(path, `${markdown}\n`);
}

function summaryRow(result) {
  if (!result.ok) return `| \`${result.workflow}\` | unread (HTTP ${result.status}) | | |`;
  const cleared = result.cleared.map(runLink).join(", ") || "none";
  const stuck = result.uncancellable.map(({ run }) => runLink(run)).join(", ") || "none";
  return `| \`${result.workflow}\` | ${result.streak.length} | ${cleared} | ${stuck} |`;
}

/** Sweep every watched workflow, then raise or clear the alert. Returns `{ results, alert }`. */
export async function runSweep({
  token,
  repo,
  fetchImpl = fetch,
  workflows = WATCHED_WORKFLOWS,
  now = new Date(),
  runUrl = process.env.RUN_URL ?? "",
  writeSummary = defaultWriteSummary,
  logger = console,
} = {}) {
  const results = [];
  // One workflow at a time: the reads are few, and a cancel is easier to follow in order.
  for (const workflow of workflows) {
    const result = await sweepWorkflow({ token, repo, fetchImpl, workflow, now });
    results.push(result);
    if (!result.ok) {
      logger.log?.(`::error::${workflow}: its runs could not be read (HTTP ${result.status}), so nothing of it was cancelled.`);
      continue;
    }
    for (const run of result.cleared) {
      logger.log?.(
        `::warning::${workflow}: force-cancelled ${run.html_url ?? `run ${run.id}`}, ${run.status} since ` +
          `${run.run_started_at ?? run.created_at}. It held the concurrency group, so later runs could not start.`,
      );
    }
    for (const { run, status } of result.uncancellable) {
      logger.log?.(`::error::${workflow}: run ${run.id} is stuck and force-cancel failed (HTTP ${status}).`);
    }
    if (result.streak.length >= CANCELLED_STREAK_ALERT_AT) {
      logger.log?.(`::error::${workflow}: its last ${result.streak.length} scheduled runs were cancelled.`);
    }
  }

  const alert = await updateAlert({ token, repo, fetchImpl, results, runUrl });
  if (alert.action === "failed") logger.log?.("::error::The frozen-watchdog alert could not be written or closed.");
  if (alert.action === "unread") logger.log?.("::error::Something could not be read, so the frozen-watchdog alert was left as it was.");
  if (alert.issueNumber) logger.log?.(`[scheduled-run-sweep] alert #${alert.issueNumber} ${alert.action}`);

  writeSummary(
    [
      "## Scheduled run sweep",
      "",
      `Alert: ${alert.action}.`,
      "",
      "| Workflow | Cancelled streak | Force-cancelled | Stuck, not cancelled |",
      "| --- | --- | --- | --- |",
      ...results.map(summaryRow),
    ].join("\n"),
  );
  return { results, alert };
}

/** 0 only when every workflow was read, nothing is left frozen, and the alert's state matches. */
export function exitCodeFor({ results, alert }) {
  if (results.some((result) => !result.ok)) return 1;
  if (problemsIn(results).length > 0) return 1;
  return alert.action === "none" || alert.action === "closed" ? 0 : 1;
}

export async function main({ env = process.env, run = runSweep } = {}) {
  const token = requireEnv("GITHUB_TOKEN", { env });
  const repo = requireEnv("GITHUB_REPOSITORY", { env });
  return exitCodeFor(await run({ token, repo, runUrl: env.RUN_URL ?? "" }));
}

if (isInvokedDirectly(import.meta.url)) {
  main()
    .then((code) => {
      if (code !== 0) process.exitCode = code;
    })
    .catch((error) => {
      console.error(`Unhandled error: ${error.stack ?? error.message}`);
      process.exitCode = 1;
    });
}
