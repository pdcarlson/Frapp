#!/usr/bin/env node

// Scheduled watch: GitHub environment `production-backup` must never gain a
// required-reviewer or wait-timer gate.
//
// Nightly `db-backup.yml` production jobs run under that environment so they
// do not name `environment: production` (ADR-19 / #1435). Required reviewers
// on `production-backup` would reintroduce the trap: a `schedule:` job
// suspends on the gate and expires, so dumps look covered and write nothing.
// A check *inside* `db-backup.yml` cannot see that — once reviewers exist
// those jobs never start.
//
// This script GETs the environment and fails if `protection_rules` contains
// `required_reviewers` or `wait_timer`. Unreadable or missing is FAIL, not
// pass. `deployment_branch_policy: null` is not a failure — locking branches
// to `main` stays on #1827 and must not trip this watch.
//
// It does not name any GitHub `environment:` itself. A schedule job that
// named `production-backup` would hang on the same trap it is watching for.
// It never PUTs the environment.
//
// Own alert title. A recovered uptime or guardrail run must not close this.
//
// Semantics: the pure functions below. Unit tests:
// `scripts/ci/__tests__/production-backup-env.test.mjs`.

import { findAlertIssuesDetailed, raiseAlert, resolveAlert } from "./lib/alert-issue.mjs";
import { requireEnv } from "./lib/env.mjs";
import { ghRequest } from "./lib/github.mjs";

export const ENV_NAME = "production-backup";

export const ALERT_ISSUE_TITLE =
  "production-backup has required reviewers — nightly dumps will expire";
export const ALERT_ISSUE_LOOKUP_LABEL = "routine-state";
export const ALERT_ISSUE_LABELS = [ALERT_ISSUE_LOOKUP_LABEL, "area:ci", "P1"];

/** Prefer the PAT: GET /environments needs Administration; GITHUB_TOKEN often 403s. */
export function resolveEnvReadToken(env = process.env) {
  return env.GITHUB_PAT || env.GITHUB_TOKEN || "";
}

/** Actions job-scoped `issues: write` is on GITHUB_TOKEN. */
export function resolveAlertToken(env = process.env) {
  return env.GITHUB_TOKEN || env.GITHUB_PAT || "";
}

function ruleType(rule) {
  if (typeof rule === "string") return rule;
  if (rule && typeof rule.type === "string") return rule.type;
  return "";
}

function hasWaitTimer(rule) {
  if (!rule || typeof rule === "string") return rule === "wait_timer";
  if (rule.type === "wait_timer") return true;
  return typeof rule.wait_timer === "number" && rule.wait_timer > 0;
}

function hasRequiredReviewers(rule) {
  if (!rule || typeof rule === "string") return rule === "required_reviewers";
  if (rule.type === "required_reviewers") return true;
  return Array.isArray(rule.reviewers) && rule.reviewers.length > 0;
}

/**
 * Classify one Environments API response. `deployment_branch_policy` is
 * ignored — null or a `main`-only lock must both pass.
 */
export function evaluateBackupEnv({ status, body }) {
  if (status === 404) {
    return { ok: false, reason: `${ENV_NAME} environment is missing` };
  }
  if (status !== 200) {
    return {
      ok: false,
      reason: `${ENV_NAME} environment unreadable (HTTP ${status || "no response"})`,
    };
  }
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, reason: `${ENV_NAME} environment unreadable` };
  }
  const rules = body.protection_rules;
  if (!Array.isArray(rules)) {
    return { ok: false, reason: `${ENV_NAME} protection_rules unreadable` };
  }

  const types = rules.map(ruleType).filter(Boolean);
  const reviewers = rules.some(hasRequiredReviewers);
  const waitTimer = rules.some(hasWaitTimer);
  if (reviewers || waitTimer) {
    const named = types.length > 0 ? types.join(", ") : "untyped protection";
    return { ok: false, reason: `${ENV_NAME} has protection: ${named}` };
  }

  return {
    ok: true,
    reason: `${ENV_NAME} has no required reviewers or wait timer`,
  };
}

function envPath(repo) {
  return `/repos/${repo}/environments/${encodeURIComponent(ENV_NAME)}`;
}

/**
 * GET the environment. A present-but-unusable PAT must not hide a working
 * GITHUB_TOKEN. Retry only on 401/403/404 (GitHub hides unauthorized
 * envs as 404) and only when the fallback token is different.
 */
export async function readBackupEnv({ token, repo, fetchImpl, fallbackToken }) {
  const first = await ghRequest({
    token,
    fetchImpl,
    path: envPath(repo),
  });
  const authish = first.status === 401 || first.status === 403 || first.status === 404;
  if (
    authish &&
    typeof fallbackToken === "string" &&
    fallbackToken &&
    fallbackToken !== token
  ) {
    const second = await ghRequest({
      token: fallbackToken,
      fetchImpl,
      path: envPath(repo),
    });
    return evaluateBackupEnv({ status: second.status, body: second.data });
  }
  return evaluateBackupEnv({ status: first.status, body: first.data });
}

function buildAlertIssueBody({ verdict, runUrl }) {
  return [
    "GitHub environment `production-backup` gained a protection that will starve nightly dumps.",
    "",
    `**${verdict.reason}**`,
    "",
    "The production jobs in `db-backup.yml` run under this environment so they do not name `environment: production` (ADR-19). Required reviewers or a wait timer on `production-backup` reintroduce that trap: a `schedule:` job suspends and expires, so dumps look covered and write nothing.",
    "",
    "Remove the protection from Settings → Environments → production-backup. Do not add required reviewers to clear a red run. The `main`-only branch lock is a separate leftover and is not a failure here.",
    "",
    runUrl ? `Run: ${runUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function runWatchdog({
  verdict,
  token,
  repo,
  runUrl = "",
  fetchImpl,
}) {
  const lookup = await findAlertIssuesDetailed({
    token,
    repo,
    fetchImpl,
    title: ALERT_ISSUE_TITLE,
    lookupLabel: ALERT_ISSUE_LOOKUP_LABEL,
  });
  const open = lookup.lookupOk
    ? lookup.issues.find((issue) => issue.state === "open")
    : null;

  if (!verdict.ok) {
    const raised = await raiseAlert({
      token,
      repo,
      fetchImpl,
      title: ALERT_ISSUE_TITLE,
      labels: ALERT_ISSUE_LABELS,
      lookupLabel: ALERT_ISSUE_LOOKUP_LABEL,
      buildIssueBody: () => buildAlertIssueBody({ verdict, runUrl }),
      buildCommentBody: ({ reopened }) =>
        `${reopened ? "Reopened — " : ""}still protected: ${verdict.reason}${runUrl ? `\n\nRun: ${runUrl}` : ""}`,
      refreshBodyOnRaise: true,
    });
    return { outcome: "fail", alert: raised, lookupOk: lookup.lookupOk, open };
  }

  if (!lookup.lookupOk) {
    return { outcome: "pass", resolved: false, lookupOk: false };
  }

  const hadOpen = lookup.issues.some((issue) => issue.state === "open");
  const resolved = await resolveAlert({
    token,
    repo,
    fetchImpl,
    title: ALERT_ISSUE_TITLE,
    lookupLabel: ALERT_ISSUE_LOOKUP_LABEL,
    buildRecoveryBody: () =>
      `production-backup has no required reviewers or wait timer again: ${verdict.reason}${runUrl ? `\n\nRun: ${runUrl}` : ""}`,
  });
  if (resolved.action === "failed") {
    return { outcome: "fail", resolved: false, lookupOk: true };
  }
  if (hadOpen && resolved.action === "none") {
    return { outcome: "fail", resolved: false, lookupOk: true };
  }
  return {
    outcome: "pass",
    resolved: resolved.action === "closed",
    lookupOk: true,
  };
}

async function main() {
  const probeOnly = process.argv.includes("--probe-only");

  const envToken = resolveEnvReadToken();
  if (!envToken) {
    const message = "GITHUB_PAT or GITHUB_TOKEN is required.";
    console.error(process.env.GITHUB_ACTIONS ? `::error::${message}` : `Error: ${message}`);
    process.exit(1);
  }
  const repo = requireEnv("GITHUB_REPOSITORY");

  const fallbackToken =
    process.env.GITHUB_TOKEN && process.env.GITHUB_TOKEN !== envToken
      ? process.env.GITHUB_TOKEN
      : "";
  const verdict = await readBackupEnv({
    token: envToken,
    repo,
    fallbackToken,
  });
  if (verdict.ok) {
    console.log(`✅ ${verdict.reason}`);
  } else {
    console.error(`::error::${verdict.reason}`);
  }

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
    verdict,
    token: alertToken,
    repo,
    runUrl,
  });
  if (!verdict.ok && watchdog.alert?.action === "failed") {
    console.error("::error::production-backup is protected and the alert issue could not be written");
  }
  if (verdict.ok && watchdog.lookupOk === false) {
    console.error("::warning::Could not read the alert issues, so no alert was closed this run");
  }
  if (verdict.ok && watchdog.outcome === "fail") {
    console.error("::error::production-backup is clear but the alert issue could not be closed");
  }
  process.exit(watchdog.outcome === "pass" ? 0 : 1);
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`Unhandled error: ${error.stack ?? error.message}`);
    process.exit(1);
  });
}
