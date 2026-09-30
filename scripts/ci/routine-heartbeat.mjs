#!/usr/bin/env node

// Scheduled watch: every scheduled routine must leave a run record.
//
// The five routines (docs/ci-cd/routines.md) run as Claude Code Routines, whose
// run status nothing in this repo can read. That status also says less than it
// looks: on 2026-09-17 three routines died about 7 seconds after firing and
// wrote nothing anywhere, and on 2026-09-30 Hygiene Scan read SUCCEEDED while
// its session had stopped at Phase 0 on a sandbox bringup failure (#2358). Both
// were silent on the board.
//
// So each routine ends its run by commenting one run record on the heartbeat
// issue (routines.md § Run record, the canonical statement of the format):
//
//   routine-run: v1 routine=<slug> outcome=<done|stopped>
//
// This script GETs those comments and judges each routine's most recent
// scheduled fire: no record after it (the 09-17 shape) or a `stopped` one (the
// 09-30 shape) raises one alert, and a `done` record for every routine's latest
// fire closes it. Only comments from the repository owner count, because the
// repository is public and anyone can comment. Timestamps are the server's
// `created_at`, never a date written in a comment.
//
// It judges nothing before its own first run on `main`: until the skills that
// write records have merged, a missing record means nothing. That start comes
// from this workflow's oldest run on `main`, so it needs no date edited in.
//
// It never PUTs a Routine, a workflow or a comment on the heartbeat issue; its
// only write is the alert. Tests: scripts/ci/__tests__/routine-heartbeat.test.mjs.

import {
  ALERT_LOOKUP_LABEL,
  raiseAlert,
  resolveAlert,
} from "./lib/alert-issue.mjs";
import { requireEnv } from "./lib/env.mjs";
import { ghRequest } from "./lib/github.mjs";
import { isInvokedDirectly } from "./lib/invoked-directly.mjs";

export const WORKFLOW_FILE = "routine-heartbeat.yml";
export const DEFAULT_BRANCH = "main";

/** The `routine-state` issue the routines comment their run records on. */
export const HEARTBEAT_ISSUE = 2966;

const HOUR = 60 * 60 * 1000;

/**
 * Each routine's schedule as `list_triggers` stores it: UTC, from the ET times
 * entered in the Routines UI. `weekday` is 0 (Sunday) to 6, or absent for a
 * daily routine. routines.md § Settings links here; a schedule change there
 * moves this row too.
 */
export const ROUTINES = [
  {
    slug: "issue-curator",
    name: "Issue Curator",
    minute: 7,
    hour: 12,
    weekday: 5,
  },
  { slug: "issue-triage", name: "Issue Triage", minute: 7, hour: 13 },
  {
    slug: "pr-followups",
    name: "PR Follow-ups",
    minute: 7,
    hour: 11,
    weekday: 1,
  },
  { slug: "docs-upkeep", name: "Docs Upkeep", minute: 7, hour: 11, weekday: 3 },
  { slug: "hygiene-scan", name: "Hygiene Scan", minute: 7, hour: 3 },
];

// A stored schedule may or may not follow daylight saving (routines.md
// § Settings says the docs don't say), so a real fire can land an hour either
// side of the one computed from the stored cron. The half hour on top covers a
// late start.
export const SCHEDULE_SLACK_MS = 1.5 * HOUR;
// How long a run gets to finish and post its record before its fire is judged.
// Hygiene Scan, the longest, has taken about an hour.
export const RUN_ALLOWANCE_MS = 4 * HOUR;

export const RECORD_PATTERN =
  /^routine-run: v1 routine=([a-z-]+) outcome=(done|stopped)\b/;

// Pages of heartbeat comments to read. Five routines post about nine records a
// week, so a hundred-comment page covers months; the cap only bounds a runaway.
const MAX_COMMENT_PAGES = 10;

export const ALERT_ISSUE_TITLE =
  "A scheduled routine missed or stopped its run — the board is grooming itself less than it looks";
export const ALERT_ISSUE_LOOKUP_LABEL = ALERT_LOOKUP_LABEL;
// P2, not P1: nothing a member sees breaks, but the backlog quietly stops
// being curated, triaged and swept.
export const ALERT_ISSUE_LABELS = [ALERT_ISSUE_LOOKUP_LABEL, "area:ci", "P2"];

/**
 * The latest instant at or before `at` that matches the schedule, in UTC.
 */
export function lastScheduledFire(routine, at) {
  const day = new Date(at);
  const fire = Date.UTC(
    day.getUTCFullYear(),
    day.getUTCMonth(),
    day.getUTCDate(),
    routine.hour,
    routine.minute,
  );
  let candidate = fire <= at ? fire : fire - 24 * HOUR;
  if (routine.weekday === undefined) return candidate;
  while (new Date(candidate).getUTCDay() !== routine.weekday)
    candidate -= 24 * HOUR;
  return candidate;
}

/**
 * The fire this run judges: the latest one old enough to have finished, given
 * the schedule slack and the run allowance.
 */
export function dueFire(routine, now) {
  return lastScheduledFire(routine, now - SCHEDULE_SLACK_MS - RUN_ALLOWANCE_MS);
}

/**
 * The run records in a page of issue comments, oldest first. A comment counts
 * only when the repository owner wrote it and a line of it is a record; the
 * first non-empty line after the record (outside a code fence marker) is its
 * reason.
 */
export function parseRecords(comments) {
  const records = [];
  for (const comment of comments ?? []) {
    if (comment?.author_association !== "OWNER") continue;
    const createdAt = Date.parse(comment.created_at);
    if (!Number.isFinite(createdAt) || typeof comment.body !== "string")
      continue;
    const lines = comment.body.split("\n").map((line) => line.trim());
    const at = lines.findIndex((line) => RECORD_PATTERN.test(line));
    if (at === -1) continue;
    const [, routine, outcome] = lines[at].match(RECORD_PATTERN);
    const reason =
      lines.slice(at + 1).find((line) => line && !line.startsWith("```")) ?? "";
    records.push({
      routine,
      outcome,
      reason: reason.slice(0, 300),
      createdAt,
      url: comment.html_url ?? "",
    });
  }
  return records.sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Each routine's verdict for its due fire.
 *
 * - `not-judged`: the fire is before `judgeFrom`, the watch's first run.
 * - `missing`: no record since the fire (less the schedule slack).
 * - `stopped` / `done`: the newest record since then says so.
 *
 * `ok` is false when any routine is `missing` or `stopped`.
 */
export function evaluateHeartbeat({ records, now, judgeFrom }) {
  const routines = ROUTINES.map((routine) => {
    const fire = dueFire(routine, now);
    const base = { slug: routine.slug, name: routine.name, fire };
    if (fire < judgeFrom) return { ...base, status: "not-judged" };
    const since = fire - SCHEDULE_SLACK_MS;
    const latest = records
      .filter((r) => r.routine === routine.slug && r.createdAt >= since)
      .at(-1);
    if (!latest) return { ...base, status: "missing" };
    return {
      ...base,
      status: latest.outcome,
      reason: latest.reason,
      url: latest.url,
    };
  });
  const failing = routines.filter(
    (r) => r.status === "missing" || r.status === "stopped",
  );
  return {
    ok: failing.length === 0,
    readable: true,
    routines,
    failing,
    reason:
      failing.length === 0
        ? "every judged routine left a done record for its latest scheduled run"
        : failing.map(describeRoutine).join("; "),
  };
}

function iso(ms) {
  return new Date(ms).toISOString().replace(/:\d\d\.\d{3}Z$/, "Z");
}

export function describeRoutine(r) {
  if (r.status === "missing")
    return `${r.name}: no run record since its ${iso(r.fire)} run`;
  if (r.status === "stopped")
    return `${r.name}: its ${iso(r.fire)} run stopped${r.reason ? ` (${r.reason})` : ""}`;
  if (r.status === "done") return `${r.name}: done`;
  return `${r.name}: not judged (its ${iso(r.fire)} run predates this watch)`;
}

function unreadable(reason) {
  return { ok: false, readable: false, routines: [], failing: [], reason };
}

/**
 * When judging starts: the created_at of this workflow's oldest run on `main`,
 * or null when it can't be read. The list is newest first, so the oldest is the
 * last page at one run per page.
 */
export async function readJudgeFrom({ token, repo, fetchImpl }) {
  const base = `/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/runs?branch=${encodeURIComponent(DEFAULT_BRANCH)}&per_page=1`;
  const first = await ghRequest({ token, fetchImpl, path: base });
  const total = first.data?.total_count;
  if (!first.ok || !Number.isInteger(total)) return null;
  // The run executing this script is on the list, so an empty one is a misread.
  if (total === 0) return null;
  const last =
    total === 1
      ? first
      : await ghRequest({ token, fetchImpl, path: `${base}&page=${total}` });
  const createdAt = Date.parse(last.data?.workflow_runs?.[0]?.created_at ?? "");
  return last.ok && Number.isFinite(createdAt) ? createdAt : null;
}

/** Every heartbeat comment updated since `since`, or null when a page can't be read. */
export async function readHeartbeatComments({ token, repo, fetchImpl, since }) {
  const comments = [];
  for (let page = 1; page <= MAX_COMMENT_PAGES; page += 1) {
    const { ok, data } = await ghRequest({
      token,
      fetchImpl,
      path:
        `/repos/${repo}/issues/${HEARTBEAT_ISSUE}/comments` +
        `?since=${encodeURIComponent(new Date(since).toISOString())}&per_page=100&page=${page}`,
    });
    if (!ok || !Array.isArray(data)) return null;
    comments.push(...data);
    if (data.length < 100) return comments;
  }
  return comments;
}

export async function readHeartbeat({
  token,
  repo,
  fetchImpl,
  now = Date.now(),
}) {
  const judgeFrom = await readJudgeFrom({ token, repo, fetchImpl });
  if (judgeFrom === null) {
    return unreadable(
      `could not read ${WORKFLOW_FILE}'s runs on ${DEFAULT_BRANCH}, so the watch can't tell which runs to judge`,
    );
  }
  // A week back from the oldest fire judged covers every routine's due fire.
  const since =
    Math.min(...ROUTINES.map((routine) => dueFire(routine, now))) -
    SCHEDULE_SLACK_MS;
  const comments = await readHeartbeatComments({
    token,
    repo,
    fetchImpl,
    since,
  });
  if (comments === null) {
    return unreadable(`could not read the run records on #${HEARTBEAT_ISSUE}`);
  }
  return evaluateHeartbeat({ records: parseRecords(comments), now, judgeFrom });
}

export function buildAlertIssueBody({ verdict, repo, runUrl }) {
  const heartbeat = `https://github.com/${repo}/issues/${HEARTBEAT_ISSUE}`;
  const routinesDoc = `https://github.com/${repo}/blob/main/docs/ci-cd/routines.md#run-record-all-routines`;
  const lines = verdict.readable
    ? verdict.routines.map(
        (r) => `- ${describeRoutine(r)}${r.url ? ` ([record](${r.url}))` : ""}`,
      )
    : [`- ${verdict.reason}`];
  const body = [
    "At least one scheduled routine's latest run left no run record, or left one saying it stopped before doing its job.",
    "",
    ...lines,
    "",
    `Each routine ends its run by commenting a run record on [the heartbeat issue](${heartbeat}) ([format](${routinesDoc})). No record usually means the session died at startup, which the Routine may still report as a failed or even a succeeded run; a \`stopped\` record says why in its next line.`,
    "",
    "Open the routine at claude.ai/code/routines, read its last session, and fix the cause. Running the routine again posts a fresh record, and the next heartbeat run closes this. Don't post a record by hand to clear it.",
  ];
  if (runUrl) body.push("", `Run: ${runUrl}`);
  return body.join("\n");
}

export async function runWatchdog({
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
      title: ALERT_ISSUE_TITLE,
      labels: ALERT_ISSUE_LABELS,
      lookupLabel: ALERT_ISSUE_LOOKUP_LABEL,
      buildIssueBody: () => buildAlertIssueBody({ verdict, repo, runUrl }),
      buildCommentBody: ({ reopened }) =>
        `${reopened ? "Reopened — " : ""}still failing: ${verdict.reason}${runUrl ? `\n\nRun: ${runUrl}` : ""}`,
      refreshBodyOnRaise: true,
    });
    return { outcome: "fail", alert: raised };
  }

  const resolved = await resolveAlert({
    token,
    repo,
    fetchImpl,
    title: ALERT_ISSUE_TITLE,
    lookupLabel: ALERT_ISSUE_LOOKUP_LABEL,
    buildRecoveryBody: () =>
      `Every routine's latest scheduled run left a done record.${runUrl ? `\n\nRun: ${runUrl}` : ""}`,
  });
  // As the other daily watchdogs: a clean run that can't read its alert is red,
  // because a lasting read failure means the next real failure can't raise one
  // either, and a close that left the alert open is red too.
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
  const token = process.env.GITHUB_TOKEN || process.env.GITHUB_PAT || "";
  if (!token) {
    const message = "GITHUB_TOKEN or GITHUB_PAT is required.";
    console.error(
      process.env.GITHUB_ACTIONS ? `::error::${message}` : `Error: ${message}`,
    );
    process.exit(1);
  }
  const repo = requireEnv("GITHUB_REPOSITORY");

  const verdict = await readHeartbeat({ token, repo });
  for (const routine of verdict.routines) console.log(describeRoutine(routine));
  (verdict.ok ? console.log : console.error)(
    `${verdict.ok ? "PASS" : "FAIL"}: ${verdict.reason}`,
  );
  if (probeOnly) process.exit(verdict.ok ? 0 : 1);

  const runUrl = process.env.RUN_URL ?? "";
  const watchdog = await runWatchdog({ verdict, token, repo, runUrl });
  if (!verdict.ok && watchdog.alert?.action === "failed") {
    console.error(
      "::error::a routine missed or stopped its run and the alert issue could not be written",
    );
  }
  if (verdict.ok && watchdog.lookupOk === false) {
    console.error(
      "::error::Could not read the alert issues, so no alert was closed this run",
    );
  } else if (verdict.ok && watchdog.outcome === "fail") {
    console.error(
      "::error::every routine is recording its runs but the alert issue could not be closed",
    );
  }
  process.exit(watchdog.outcome === "pass" ? 0 : 1);
}

if (isInvokedDirectly(import.meta.url)) {
  main().catch((error) => {
    console.error(`Unhandled error: ${error.stack ?? error.message}`);
    process.exit(1);
  });
}
