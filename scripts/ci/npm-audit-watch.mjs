#!/usr/bin/env node
// Daily npm audit of main (#3367).
//
// `dependency-audit` in ci.yml runs only on pull requests and pushes to main.
// An advisory published between merges therefore went unseen until some PR
// went red for a reason its own diff had nothing to do with: main had no push
// from 2026-10-10 to 2026-11-03, and the 19 advisories #3337 cleared, two
// Next.js criticals among them, surfaced only as Dependabot and routine PRs
// failing from about 2026-10-21. An allowlist entry's expiry behaved the same
// way: the first anyone heard of it was every PR failing the day after.
//
// So this runs the same gate, `scripts/check-npm-audit.mjs`, on main once a
// day, as a child process, and reads its exit code with the gate's own meaning:
// nothing in this file re-decides what counts as a finding. The one difference
// from the PR job is time: that job is capped at 5 minutes, this one lets the
// gate use its whole retry budget, so a slow registry can cut a PR's run short
// where it doesn't cut this one.
//
// Two alerts, each with its own title, because they clear on different facts:
//
//   - AUDIT_ALERT: the gate did not pass. Exit 1 is usually a finding (an
//     unallowlisted high or critical advisory, an expired entry still shielding
//     one, a malformed allowlist), but the gate also exits 1 on any other
//     error it throws, so the alert quotes its output rather than naming a
//     cause. Exit 2 is no verdict: npm never produced a report, after the
//     gate's own retries. Both raise it, fail closed, because
//     a registry that stays unreachable would otherwise turn this watch off
//     with every run looking quiet. It closes on a run the gate passes.
//   - EXPIRY_ALERT: an allowlist entry's `expires` is within
//     EXPIRY_WARNING_DAYS, or already past. A warning, so it never reds the run
//     on its own. It is raised once per set of expiring entries, not commented
//     on daily, and closes when no entry is in the window. An entry already
//     past its date whose advisory is gone is still listed: the gate only calls
//     it stale, but it should be pruned.
//
// Env inputs:
//   GITHUB_TOKEN          — required (issues: write), for the alert issues
//   GITHUB_REPOSITORY     — required, owner/repo
//   RUN_URL               — optional, html_url of this run
//   GITHUB_STEP_SUMMARY   — optional, written when present
//
// Exit codes:
//   0 — the gate passed, and both alerts' state is known to match
//   1 — the gate did not pass (its alert is raised), or an alert issue could
//       not be written, read or closed
//
// Unit tests: scripts/ci/__tests__/npm-audit-watch.test.mjs
// (`npm run test:ci-scripts`).

import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseAllowlistSource, validateAllowlist } from "../check-npm-audit.mjs";
import { defineAlert, findAlertIssuesDetailed, markerLine, raiseAlert, resolveAlert } from "./lib/alert-issue.mjs";
import { NPM_AUDIT_GATE_DOC } from "./lib/ops-docs.mjs";
import { requireEnv } from "./lib/env.mjs";
import { isInvokedDirectly } from "./lib/invoked-directly.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const GATE_PATH = join(ROOT, "scripts", "check-npm-audit.mjs");
export const ALLOWLIST_PATH = join(ROOT, "scripts", "npm-audit-allowlist.json");

/** How far ahead an allowlist entry's expiry is warned about. */
export const EXPIRY_WARNING_DAYS = 7;

/** How much of the gate's output an alert carries. The run log has all of it. */
export const OUTPUT_TAIL_LINES = 60;

// Titles are lookup keys: they must stay stable. The label and assignee come
// from lib/alert-issue.mjs, like every other watchdog's.
export const AUDIT_ALERT = defineAlert({
  title: "npm audit fails on main — a high or critical advisory needs handling",
  labels: ["area:ci", "P2"],
});
export const EXPIRY_ALERT = defineAlert({
  title: "An npm audit allowlist entry expires within 7 days",
  labels: ["area:ci", "P3"],
});

// ── The gate ────────────────────────────────────────────────────────────────

/** Run `check-npm-audit.mjs` as CI does. The gate bounds its own retries; the job's `timeout-minutes` bounds the rest. */
export function runGate() {
  const result = spawnSync(process.execPath, [GATE_PATH], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: [result.stderr ?? "", result.error ? `spawn failed: ${result.error.message}` : ""].filter(Boolean).join("\n"),
  };
}

/**
 * The gate's exit code, read with its own meaning (check-npm-audit.mjs header):
 * 0 passed; 1 failed, which is a finding to act on unless the gate itself
 * threw; 2 no report. Anything else (a signal, a spawn failure) also
 * established nothing.
 */
export function classifyGate(status) {
  if (status === 0) return "passed";
  if (status === 1) return "failed";
  return "no-verdict";
}

/** The last `limit` lines of the gate's stdout then stderr, safe inside a fenced block. */
export function outputTail({ stdout, stderr }, limit = OUTPUT_TAIL_LINES) {
  const lines = [stdout, stderr]
    .map((text) => text.trimEnd())
    .filter(Boolean)
    .join("\n")
    .split("\n");
  const kept = lines.slice(-limit);
  const dropped = lines.length - kept.length;
  // A run of three backticks in npm's text would close the fence early.
  const text = kept.join("\n").replaceAll("```", "'''");
  return dropped > 0 ? `… ${dropped} earlier lines in the run log\n${text}` : text;
}

function runLine(runUrl) {
  return runUrl ? `Run: ${runUrl}` : "";
}

function verdictLine(verdict) {
  return verdict === "failed"
    ? "The gate **failed** (exit 1). That is usually something to act on: an unallowlisted high or critical advisory, an " +
        "expired allowlist entry still shielding one, or a malformed allowlist. The gate also exits 1 when it throws, so " +
        "read its output below for which."
    : "The gate reached **no verdict**: npm never produced an audit report, after the gate's own retries. Nothing about the dependency tree is known, so this is not a clean bill either.";
}

function whyLine(verdict) {
  return verdict === "failed"
    ? "**Why it matters.** A finding fails every PR's `dependency-audit` check the same way, whatever its diff, and it is a real " +
        "advisory in what we ship."
    : "**Why it matters.** While npm can't produce a report, nothing watches for new advisories. PRs may hit the same failure, " +
        "and their job gives up sooner than this one.";
}

function fenced(gate) {
  return ["```text", outputTail(gate), "```"].join("\n");
}

export function buildAuditIssueBody({ verdict, gate, runUrl }) {
  return [
    "The daily npm audit of `main` (`npm-audit-watch.yml`) ran `scripts/check-npm-audit.mjs`, the gate every PR's " +
      "`dependency-audit` job runs, and it did not pass.",
    "",
    verdictLine(verdict),
    "",
    fenced(gate),
    "",
    whyLine(verdict),
    "",
    `**What to do.** Follow \`${NPM_AUDIT_GATE_DOC}\` § Prevention: for a finding, fix it ` +
      "(`npm audit fix`, or a targeted bump), or, only when a fix can't land now, add an allowlist entry with a reason, " +
      "a tracking issue and an expiry. For no verdict, read the run log: a lasting registry or network failure, or a " +
      "broken lockfile, are the usual causes.",
    "",
    runLine(runUrl),
  ]
    .join("\n")
    .trim();
}

export function buildAuditCommentBody({ verdict, gate, runUrl, reopened }) {
  return [
    reopened ? "**Reopened.** The npm audit of `main` fails again." : "Still failing.",
    "",
    verdictLine(verdict),
    "",
    fenced(gate),
    "",
    runLine(runUrl),
  ]
    .join("\n")
    .trim();
}

export function buildAuditRecoveryBody({ runUrl }) {
  return ["**Recovered.** The npm audit gate passes on `main` again.", "", runLine(runUrl)].join("\n").trim();
}

// ── Allowlist expiry ────────────────────────────────────────────────────────

/** `today` (YYYY-MM-DD, UTC) plus `days`, as YYYY-MM-DD. */
export function addDays(today, days) {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Entries whose `expires` is on or before `today + days`, soonest first. The
 * gate fails an entry once `expires < today`, so an entry dated today still
 * holds today and fails tomorrow.
 */
export function expiringEntries({ entries, today, days = EXPIRY_WARNING_DAYS }) {
  const horizon = addDays(today, days);
  return entries
    .filter((entry) => entry.expires <= horizon)
    .sort((a, b) => a.expires.localeCompare(b.expires) || a.ghsa.localeCompare(b.ghsa));
}

const MARKER_PREFIX = "<!-- npm-audit-expiring:";

/** The hidden line an expiry alert's body records its entries in, so a later run can tell whether they changed. */
export function expiryMarker(expiring) {
  const key = expiring.map((entry) => `${entry.ghsa.toUpperCase()}@${entry.expires}`).join(",");
  return `${MARKER_PREFIX} ${key} -->`;
}

/** The marker line in an issue body, or null. */
export function markerIn(body) {
  return markerLine(body, MARKER_PREFIX);
}

function describeExpiry(entry, today) {
  const when = entry.expires < today ? `expired ${entry.expires}` : `expires ${entry.expires}`;
  const pkg = entry.package ? ` (\`${entry.package}\`)` : "";
  return `- \`${entry.ghsa}\`${pkg}: ${when}, tracked by ${entry.trackedBy}`;
}

export function buildExpiryIssueBody({ expiring, today, runUrl }) {
  return [
    `These \`scripts/npm-audit-allowlist.json\` entries expire within ${EXPIRY_WARNING_DAYS} days, or already have. ` +
      "The day after an entry's `expires`, the npm audit gate fails every PR whose tree still has its advisory.",
    "",
    ...expiring.map((entry) => describeExpiry(entry, today)),
    "",
    "**What to do, per entry.** Fix the advisory and delete the entry; or re-triage it and renew `expires` with the " +
      "reason it still can't be fixed; or, when the gate already lists it as stale (its advisory no longer applies), " +
      `delete it. Policy: \`${NPM_AUDIT_GATE_DOC}\` § The gate.`,
    "",
    runLine(runUrl),
    "",
    expiryMarker(expiring),
  ]
    .join("\n")
    .trim();
}

export function buildExpiryCommentBody({ expiring, today, reopened }) {
  return [
    reopened
      ? `**Reopened.** An allowlist entry is within ${EXPIRY_WARNING_DAYS} days of its expiry.`
      : "The expiring entries changed. Now:",
    "",
    ...expiring.map((entry) => describeExpiry(entry, today)),
  ].join("\n");
}

export function buildExpiryRecoveryBody() {
  return `**Cleared.** No allowlist entry expires within ${EXPIRY_WARNING_DAYS} days.`;
}

function defaultReadAllowlist() {
  return parseAllowlistSource(readFileSync(ALLOWLIST_PATH, "utf8"));
}

/**
 * Raise, leave or clear the expiry alert. Returns `{ action, ... }`, where
 * action is a raise or resolve action from lib/alert-issue.mjs, "unchanged"
 * (an open alert already lists exactly these entries), or "skipped" (the
 * allowlist can't be read; the gate fails on that and raises its own alert).
 */
export async function runExpiryWatch({ token, repo, fetchImpl, today, runUrl, readAllowlist = defaultReadAllowlist, logger }) {
  let entries;
  try {
    entries = readAllowlist();
  } catch (error) {
    logger.log?.(`::warning::Allowlist expiry not checked: ${error.message}`);
    return { action: "skipped" };
  }
  if (validateAllowlist(entries).length > 0) {
    logger.log?.("::warning::Allowlist expiry not checked: the allowlist is malformed (the gate reports how).");
    return { action: "skipped" };
  }

  const expiring = expiringEntries({ entries, today });
  const lookup = await findAlertIssuesDetailed({ token, repo, fetchImpl, alert: EXPIRY_ALERT });
  // Without the open alert's marker, a raise could say "changed" about entries
  // that didn't, and a resolve would read again anyway. Try tomorrow.
  if (!lookup.lookupOk) return { action: "unread" };

  if (expiring.length === 0) {
    return resolveAlert({ token, repo, fetchImpl, alert: EXPIRY_ALERT, lookup, buildRecoveryBody: buildExpiryRecoveryBody });
  }

  for (const entry of expiring) logger.log?.(`::warning::${describeExpiry(entry, today).slice(2)}`);

  // One notice per set of expiring entries, not one a day: the alert already
  // says what to do, and a daily "still expiring" comment is noise.
  const open = lookup.issues.find((issue) => issue.state === "open");
  if (open && markerIn(open.body) === expiryMarker(expiring)) {
    return { action: "unchanged", issueNumber: open.number };
  }
  const raised = await raiseAlert({
    token,
    repo,
    fetchImpl,
    alert: EXPIRY_ALERT,
    lookup,
    buildIssueBody: () => buildExpiryIssueBody({ expiring, today, runUrl }),
    buildCommentBody: ({ reopened }) => buildExpiryCommentBody({ expiring, today, reopened }),
    // The body holds the marker, so it has to track the current set.
    refreshBodyOnRaise: true,
  });
  if (raised.bodyRefreshFailed) {
    logger.log?.("::warning::The expiry comment was posted, but the issue body still lists an earlier set, so tomorrow's run comments again.");
  }
  return raised;
}

// ── Run ─────────────────────────────────────────────────────────────────────

function defaultWriteSummary(markdown) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (path) appendFileSync(path, `${markdown}\n`);
}

/** Run the gate, then raise or resolve both alerts. Returns `{ verdict, audit, expiry }`. */
export async function runNpmAuditWatch({
  token,
  repo,
  fetchImpl = fetch,
  gate = runGate,
  readAllowlist,
  now = new Date(),
  runUrl = process.env.RUN_URL ?? "",
  writeSummary = defaultWriteSummary,
  logger = console,
} = {}) {
  const today = now.toISOString().slice(0, 10);
  const result = gate();
  const verdict = classifyGate(result.status);
  // The gate's own output, so the run log reads like the PR job's.
  if (result.stdout) logger.log?.(result.stdout.trimEnd());
  if (result.stderr) logger.log?.(result.stderr.trimEnd());

  let audit;
  if (verdict === "passed") {
    audit = await resolveAlert({
      token,
      repo,
      fetchImpl,
      alert: AUDIT_ALERT,
      buildRecoveryBody: () => buildAuditRecoveryBody({ runUrl }),
    });
    if (audit.action === "failed") logger.log?.("::error::The audit passes, but its alert issue could not be closed.");
    if (audit.action === "unread") logger.log?.("::error::The audit passes, but the alert issues could not be read, so none was closed.");
  } else {
    logger.log?.(`::error::npm audit gate on main: ${verdict === "failed" ? "failed" : "no verdict"} (exit ${result.status}).`);
    audit = await raiseAlert({
      token,
      repo,
      fetchImpl,
      alert: AUDIT_ALERT,
      buildIssueBody: () => buildAuditIssueBody({ verdict, gate: result, runUrl }),
      buildCommentBody: ({ reopened }) => buildAuditCommentBody({ verdict, gate: result, runUrl, reopened }),
    });
    logger.log?.(
      audit.action === "failed"
        ? "::error::The audit fails, and its alert issue could not be written."
        : `[npm-audit-watch] audit alert #${audit.issueNumber} ${audit.action}`,
    );
  }

  const expiry = await runExpiryWatch({ token, repo, fetchImpl, today, runUrl, readAllowlist, logger });
  if (expiry.action === "failed") logger.log?.("::error::The allowlist expiry alert could not be written or closed.");
  if (expiry.action === "unread") logger.log?.("::error::The allowlist expiry alert could not be read, so it was not closed.");

  writeSummary(
    [
      "## npm audit watch",
      "",
      `Gate: **${verdict}** (exit ${result.status}). Audit alert: ${audit.action}. Expiry alert: ${expiry.action}.`,
    ].join("\n"),
  );
  return { verdict, audit, expiry };
}

/** 0 only when the gate passed and both alerts' state is known to match what this run found. */
export function exitCodeFor({ verdict, audit, expiry }) {
  if (verdict !== "passed") return 1;
  if (audit.action !== "none" && audit.action !== "closed") return 1;
  return expiry.action === "failed" || expiry.action === "unread" ? 1 : 0;
}

export async function main({ env = process.env, run = runNpmAuditWatch } = {}) {
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
