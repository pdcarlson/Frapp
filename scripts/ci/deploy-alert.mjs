#!/usr/bin/env node
// Terminal reporting job for .github/workflows/deploy-api.yml (see the
// `deploy-outcome` job). Closes the visibility gap recorded in issue #763:
// `Deploy API` failed 44 of 44 executing runs for 71 days and nobody noticed,
// because three things compounded —
//
//   1. A skipped run is a GREEN run. The `check-changes` path gate skips the
//      deploy/migrate jobs when a push touches neither `apps/api/` nor
//      `supabase/migrations/`; 46 of the last 90 runs were green-because-empty,
//      so the Actions list read "healthy" while the deploy path was 100% dead.
//   2. `workflow_run` failures never land on a commit or a PR the way `CI`
//      does, so nothing turned red anywhere a human normally looks.
//   3. There was no notification of any kind.
//
// This script answers (1) and (3). It runs after every deploy/migrate job in
// the run and:
//
//   * writes a step summary + annotation that states plainly whether the run
//     DEPLOYED something or DECLINED to deploy, so green stops being ambiguous;
//   * on failure, upserts ONE tracking issue (create / reopen / comment) rather
//     than filing a fresh issue per failure — alert spam is how alerting gets
//     muted;
//   * on a later successful deploy, closes that issue, so "alert issue open"
//     reliably means "the deploy path is broken right now".
//
// Channel choice: GitHub Issues, matching `ci-wake.mjs` / `pr-base-sync.mjs`
// (which post to PRs) and the tracker itself (#680 retired Linear). `Deploy API`
// is push-driven with no PR to comment on, so an issue is the equivalent target.
// No new service, no new token — `GITHUB_TOKEN` with job-scoped `issues: write`.
//
// Env inputs:
//   GITHUB_TOKEN       — required (issues: write)
//   GITHUB_REPOSITORY  — required, owner/repo
//   DEPLOY_NEEDS       — required, `toJSON(needs)` from the workflow
//   RUN_URL            — required, html_url of this Deploy API run
//   HEAD_BRANCH        — the deployed ref (always `main` since #1340)
//   HEAD_SHA           — the deployed commit
//
// Exits 0 on every handled outcome — a watchdog that reds the run creates the
// noise it exists to remove, and the underlying deploy job is already red.
// Exits 1 only on unexpected errors.

import { appendFileSync } from "node:fs";

import {
  findAlertIssues as findAlertIssuesByTitle,
  raiseAlert as raiseAlertIssue,
  resolveAlert as resolveAlertIssue,
} from "./lib/alert-issue.mjs";

// ── Alert issue identity ────────────────────────────────────────────────────
// Title is the primary key: it is looked up by exact match, so it must stay
// stable across releases. `routine-state` marks it as routine infrastructure —
// `/next` §0.2 treats that label as never-claimable, which is what keeps agent
// sessions from picking the alert up as if it were backlog work.
export const ALERT_ISSUE_TITLE =
  "Deploy API is failing — pushes are not reaching the environment";
export const ALERT_ISSUE_LOOKUP_LABEL = "routine-state";
export const ALERT_ISSUE_LABELS = [ALERT_ISSUE_LOOKUP_LABEL, "area:ci", "P1"];

// The gate job, and the jobs that actually migrate or deploy. Order is the
// order they are reported in.
//
// `migrate-production` and `deploy-production` used to be here. They were
// deleted from deploy-api.yml with the `production` branch (#1340) — production
// now deploys through `deploy-production.yml`, a manual dispatch that does its
// own terminal reporting in its `report` job. A name left here that no workflow
// emits would report as a permanently missing job.
//
// NOTE: `ALERT_ISSUE_TITLE` above is deliberately NOT rescoped to "staging"
// even though this now only watches staging. The title is the issue LOOKUP KEY,
// so renaming it orphans any alert issue currently open — it could never be
// found again, and so never self-close.
export const GATE_JOB_NAME = "check-changes";
export const DEPLOY_JOB_NAMES = ["migrate-staging", "deploy-staging"];

// Results that mean the job did not do its work. `cancelled` and `timed_out`
// are included deliberately: a cancelled deploy is not a deploy, and treating it
// as benign is precisely the "green history" failure this script exists to end.
export const FAILED_RESULTS = new Set(["failure", "cancelled", "timed_out"]);


/**
 * Pure classifier over the `needs` context's job results.
 * Returns { outcome, failed, deployed } where outcome is one of:
 *   "failed"   — at least one gate/migrate/deploy job did not succeed
 *   "deployed" — nothing failed and at least one migrate/deploy job succeeded
 *   "no-op"    — nothing failed and nothing ran (the green-because-empty case)
 */
export function classifyDeployOutcome({ jobResults }) {
  const failed = [];
  const deployed = [];

  for (const name of [GATE_JOB_NAME, ...DEPLOY_JOB_NAMES]) {
    const result = jobResults[name];
    if (FAILED_RESULTS.has(result)) {
      failed.push(name);
    } else if (result === "success" && name !== GATE_JOB_NAME) {
      // The gate succeeding is not a deploy — only the four real jobs count.
      deployed.push(name);
    }
  }

  if (failed.length > 0) return { outcome: "failed", failed, deployed };
  if (deployed.length > 0) return { outcome: "deployed", failed, deployed };
  return { outcome: "no-op", failed, deployed };
}

/**
 * Flattens `toJSON(needs)` into { jobName: result }. A job absent from the
 * context (renamed or removed) reads as "skipped" rather than throwing, so a
 * future edit to deploy-api.yml degrades to silence instead of a red run.
 */
export function readJobResults(needs) {
  const results = {};
  for (const name of [GATE_JOB_NAME, ...DEPLOY_JOB_NAMES]) {
    results[name] = needs?.[name]?.result ?? "skipped";
  }
  return results;
}

/** Human-readable one-liner used in the annotation and the issue body. */
export function buildHeadline({ outcome, failed, deployed, headBranch }) {
  const ref = headBranch ? `\`${headBranch}\`` : "this ref";
  if (outcome === "failed") {
    return `Deploy API FAILED on ${ref} — ${failed.join(", ")} did not succeed. Nothing was deployed by this run.`;
  }
  if (outcome === "deployed") {
    return `Deploy API succeeded on ${ref} — ${deployed.join(", ")} completed.`;
  }
  return `Deploy API deployed NOTHING on ${ref} — the changed-path gate skipped every migrate and deploy job. This run is green because it declined to deploy, not because a deploy succeeded.`;
}

/**
 * The step summary. This is the answer to "is it possible to tell at a glance
 * whether a green run deployed anything" — before this, you had to open four
 * skipped jobs and infer it.
 */
export function buildRunSummary({
  outcome,
  failed,
  deployed,
  jobResults,
  headBranch,
  headSha,
  runUrl,
  apiChanged,
  migrationsChanged,
  gateSucceeded,
}) {
  const badge = {
    failed: "❌ **FAILED — nothing deployed**",
    deployed: "✅ **DEPLOYED**",
    "no-op": "⏭️ **NO-OP — nothing deployed**",
  }[outcome];

  // When the gate job itself did not succeed, its outputs are empty — which is
  // NOT the same as "no paths changed". Reporting the absent output as "no"
  // would state an unmeasured value as fact.
  const changed = (value) => (gateSucceeded ? (value ? "yes" : "no") : "unknown");

  const lines = [
    "## Deploy API outcome",
    "",
    badge,
    "",
    buildHeadline({ outcome, failed, deployed, headBranch }),
    "",
    "| | |",
    "| --- | --- |",
    `| Ref | \`${headBranch ?? "unknown"}\` |`,
    `| Commit | \`${headSha ?? "unknown"}\` |`,
    `| API paths changed | ${changed(apiChanged)} |`,
    `| Migration paths changed | ${changed(migrationsChanged)} |`,
    "",
    "### Job results",
    "",
    "| Job | Result |",
    "| --- | --- |",
    ...[GATE_JOB_NAME, ...DEPLOY_JOB_NAMES].map(
      (name) => `| \`${name}\` | ${jobResults[name]} |`,
    ),
  ];

  if (outcome === "no-op") {
    lines.push(
      "",
      "The changed-path gate (`check-changes`) found no changes under `apps/api/`, " +
        "`packages/validation/`, `packages/typescript-config/`, or `supabase/migrations/`, " +
        "so every migrate and deploy job was skipped. **A green run of this shape is not " +
        "evidence that deploys work** — see issue #763.",
    );
  }

  if (runUrl) lines.push("", `- Run: ${runUrl}`);
  return lines.join("\n");
}

/** Body for the alert issue when it is first created. */
export function buildAlertIssueBody({ headline, failed, headBranch, headSha, runUrl }) {
  return [
    "## Deploy API is failing",
    "",
    headline,
    "",
    "This issue is **opened and closed automatically** by the `deploy-outcome` job in",
    "`.github/workflows/deploy-api.yml` (`scripts/ci/deploy-alert.mjs`). While it is open, the",
    "deploy path is broken: the most recent `Deploy API` run that actually tried to deploy did",
    "not succeed. It closes itself as soon as a later run deploys successfully.",
    "",
    "Do not claim this issue as backlog work — it carries `routine-state` and tracks live state,",
    "not a unit of work. Fix the underlying failure and it resolves on its own.",
    "",
    "### Latest failure",
    "",
    `- Failed jobs: ${failed.map((name) => `\`${name}\``).join(", ")}`,
    `- Ref: \`${headBranch ?? "unknown"}\``,
    `- Commit: \`${headSha ?? "unknown"}\``,
    runUrl ? `- Run: ${runUrl}` : "",
    "",
    "### Why this issue exists",
    "",
    "`Deploy API` is triggered by `workflow_run`, so its failures never appear as a PR check or a",
    "commit status, and runs that skip every job report green. That combination hid a 100% deploy",
    "failure rate for 71 days (#763). This issue is the notification that was missing.",
    "",
    "Background on the original outage: #696.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/** Body for the comment appended to an already-open (or reopened) alert. */
export function buildAlertCommentBody({
  headline,
  failed,
  headBranch,
  headSha,
  runUrl,
  reopened,
}) {
  const lines = [
    reopened
      ? "**Deploy API is failing again** — reopening."
      : "**Deploy API failed again.**",
    "",
    headline,
    "",
    `- Failed jobs: ${failed.map((name) => `\`${name}\``).join(", ")}`,
    `- Ref: \`${headBranch ?? "unknown"}\``,
    `- Commit: \`${headSha ?? "unknown"}\``,
  ];
  if (runUrl) lines.push(`- Run: ${runUrl}`);
  lines.push(
    "",
    "_Posted automatically by `scripts/ci/deploy-alert.mjs`. This issue closes itself when a later run deploys successfully._",
  );
  return lines.join("\n");
}

/** Body for the comment posted when a deploy succeeds and the alert resolves. */
export function buildRecoveryCommentBody({ deployed, headBranch, headSha, runUrl }) {
  const lines = [
    "**Deploy API recovered.** Closing.",
    "",
    `\`${deployed.join("`, `")}\` succeeded on \`${headBranch ?? "unknown"}\`.`,
    "",
    `- Commit: \`${headSha ?? "unknown"}\``,
  ];
  if (runUrl) lines.push(`- Run: ${runUrl}`);
  lines.push(
    "",
    "_Closed automatically by `scripts/ci/deploy-alert.mjs` after a successful deploy._",
  );
  return lines.join("\n");
}

// ── Issue lookup / mutation ─────────────────────────────────────────────────

/**
 * Every issue (open or closed) that is this alert. Matched on exact title within
 * the `routine-state` label, so a human renaming the issue detaches it rather
 * than causing surprise writes. Returns [] when the lookup fails — a failed
 * lookup then falls through to "create", because a duplicate alert is a better
 * failure mode than silence, and the resolve path closes every match.
 */
export async function findAlertIssues({ token, repo, fetchImpl }) {
  return findAlertIssuesByTitle({
    token,
    repo,
    fetchImpl,
    title: ALERT_ISSUE_TITLE,
    lookupLabel: ALERT_ISSUE_LOOKUP_LABEL,
  });
}

/**
 * Create / reopen / comment, whichever the current state calls for.
 * Returns { action, issueNumber } where action is "created" | "commented" |
 * "reopened" | "failed".
 */
export async function raiseAlert({
  token,
  repo,
  fetchImpl,
  headline,
  failed,
  headBranch,
  headSha,
  runUrl,
}) {
  return raiseAlertIssue({
    token,
    repo,
    fetchImpl,
    title: ALERT_ISSUE_TITLE,
    labels: ALERT_ISSUE_LABELS,
    lookupLabel: ALERT_ISSUE_LOOKUP_LABEL,
    buildIssueBody: () =>
      buildAlertIssueBody({ headline, failed, headBranch, headSha, runUrl }),
    buildCommentBody: ({ reopened }) =>
      buildAlertCommentBody({ headline, failed, headBranch, headSha, runUrl, reopened }),
  });
}

/**
 * Closes every open alert issue after a successful deploy. Closing them all
 * (not just the first) is what makes a duplicate created during an API blip
 * self-heal.
 */
export async function resolveAlert({
  token,
  repo,
  fetchImpl,
  deployed,
  headBranch,
  headSha,
  runUrl,
}) {
  return resolveAlertIssue({
    token,
    repo,
    fetchImpl,
    title: ALERT_ISSUE_TITLE,
    lookupLabel: ALERT_ISSUE_LOOKUP_LABEL,
    buildRecoveryBody: () =>
      buildRecoveryCommentBody({ deployed, headBranch, headSha, runUrl }),
  });
}

// ── Orchestration ───────────────────────────────────────────────────────────

function defaultWriteSummary(summary) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (path) appendFileSync(path, `${summary}\n`);
}

/**
 * Full flow for one completed Deploy API run. Everything network-bound goes
 * through fetchImpl, and the summary write through writeSummary, so tests run
 * offline with no filesystem side effects.
 */
export async function runDeployAlert({
  token,
  repo,
  needs,
  runUrl,
  headBranch,
  headSha,
  fetchImpl = fetch,
  writeSummary = defaultWriteSummary,
  logger = console,
}) {
  const jobResults = readJobResults(needs);
  const { outcome, failed, deployed } = classifyDeployOutcome({ jobResults });
  const apiChanged = needs?.[GATE_JOB_NAME]?.outputs?.["api-changed"] === "true";
  const migrationsChanged =
    needs?.[GATE_JOB_NAME]?.outputs?.["migrations-changed"] === "true";
  const headline = buildHeadline({ outcome, failed, deployed, headBranch });

  writeSummary(
    buildRunSummary({
      outcome,
      failed,
      deployed,
      jobResults,
      headBranch,
      headSha,
      runUrl,
      apiChanged,
      migrationsChanged,
      gateSucceeded: jobResults[GATE_JOB_NAME] === "success",
    }),
  );

  // Annotations surface at the top of the run page, above the job list.
  // `::error::` here does NOT fail the job — it only annotates.
  logger.log?.(`${outcome === "failed" ? "::error::" : "::notice::"}${headline}`);

  if (outcome === "failed") {
    const alert = await raiseAlert({
      token,
      repo,
      fetchImpl,
      headline,
      failed,
      headBranch,
      headSha,
      runUrl,
    });
    logger.log?.(
      alert.action === "failed"
        ? "[deploy-alert] could not write the alert issue"
        : `[deploy-alert] alert issue #${alert.issueNumber} ${alert.action}`,
    );
    return { outcome, failed, deployed, alert };
  }

  if (outcome === "deployed") {
    const alert = await resolveAlert({
      token,
      repo,
      fetchImpl,
      deployed,
      headBranch,
      headSha,
      runUrl,
    });
    if (alert.action === "closed") {
      logger.log?.(`[deploy-alert] closed alert issue(s): ${alert.closed.join(", ")}`);
    }
    return { outcome, failed, deployed, alert };
  }

  // no-op: the summary and annotation above are the entire point. Deliberately
  // does NOT close an open alert — skipping every job proves nothing about
  // whether deploys work, and closing on a no-op would silence a live outage.
  logger.log?.("[deploy-alert] nothing deployed; alert issue left as-is");
  return { outcome, failed, deployed, alert: { action: "none" } };
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
  const needs = JSON.parse(requireEnv("DEPLOY_NEEDS"));
  await runDeployAlert({
    token,
    repo,
    needs,
    runUrl: process.env.RUN_URL ?? "",
    headBranch: process.env.HEAD_BRANCH ?? "",
    headSha: process.env.HEAD_SHA ?? "",
  });
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`Unhandled error: ${error.stack ?? error.message}`);
    process.exit(1);
  });
}
