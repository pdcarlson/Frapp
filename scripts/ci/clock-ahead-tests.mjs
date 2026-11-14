#!/usr/bin/env node
// Nightly API test run with the clock a week ahead.
//
// A test that reads the wall clock, directly or through a service default of
// `Date.now()`, passes on the day it merges and fails on some later day with
// no commit to blame. PR CI tests each PR merged with main, so the morning one
// starts failing, every open PR goes red with it. On 2026-11-14 two did:
// `dev-log.service.spec.ts` at 00:00 UTC (a pinned note aged past its fresh
// window) and `chat-scheduled-message-sweep.service.spec.ts` at 13:00 UTC (the
// sweep's budget clock left at `Date.now`). Each PR's session then patched the
// same spec on its own branch, and the copies conflicted.
//
// This runs the same API suites PR CI runs (`api-tests` in ci.yml), under
// libfaketime with the clock OFFSET_DAYS ahead, so a test like that fails here
// up to a week before it fails on main, and raises one `incident` alert, which
// emails the owner as the assignee. Against the two specs as they were before
// their fixes (#4974, #4986), a run dated 2026-11-10 fails dev-log, four days
// before main broke, and one dated 2026-11-13 fails the sweep spec, the night
// it merged.
//
// Two modes, one per job, so the job that installs dependencies and runs test
// code never holds a token that can write issues:
//
//   run    (job `tests`):  check the shift took, run each suite under it, and
//                          write one JSON result to $GITHUB_OUTPUT as `result`.
//                          Always exits 0 once it has a result to hand on.
//   alert  (job `alert`):  read that result from RESULT and raise or resolve
//                          the alert. An empty RESULT (the tests job died before
//                          writing one) is no verdict, and raises.
//
// The alert comments only when the set of failing tests changes, not nightly,
// so one clock bomb is one email until it is fixed. It closes on the first
// night every suite passes a week ahead.
//
// Env inputs (alert mode):
//   GITHUB_TOKEN          — required (issues: write)
//   GITHUB_REPOSITORY     — required, owner/repo
//   RESULT                — the tests job's `result` output (may be empty)
//   RUN_URL               — optional, html_url of this run
//   GITHUB_STEP_SUMMARY   — optional, written when present
//
// Exit codes (alert mode):
//   0 — every suite passed a week ahead and the alert's state is known to match
//   1 — a suite failed or nothing was established (the alert is raised), or the
//       alert could not be read, written or closed
//
// Unit tests: scripts/ci/__tests__/clock-ahead-tests.test.mjs
// (`npm run test:ci-scripts`).

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { defineAlert, findAlertIssuesDetailed, markerLine, raiseAlert, resolveAlert } from "./lib/alert-issue.mjs";
import { requireEnv } from "./lib/env.mjs";
import { isInvokedDirectly } from "./lib/invoked-directly.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** How far ahead the clock runs. A test that will break within this many days fails tonight. */
export const OFFSET_DAYS = 7;

/** The API suites `api-tests` in ci.yml runs, by their apps/api npm script. */
export const SUITES = [
  { name: "API unit tests", script: "test" },
  { name: "API E2E tests", script: "test:e2e" },
];

/** How many failing tests an alert lists. The run log has the rest. */
export const MAX_LISTED_FAILURES = 30;

/** How much of a crashed suite's output an alert carries. */
export const OUTPUT_TAIL_LINES = 40;

/**
 * libfaketime's knobs. An offset ("+7d") moves the wall clock only as far as
 * Date sees it; the monotonic clock is left alone, so timers, `performance.now`
 * and jest's own timeouts run at real speed.
 */
export function faketimeEnv(env = process.env) {
  return { ...env, FAKETIME_DONT_FAKE_MONOTONIC: "1" };
}

export function faketimeArgs(command) {
  return ["-f", `+${OFFSET_DAYS}d`, ...command];
}

export const ALERT = defineAlert({
  title: "API tests fail with the clock a week ahead — a test will break main soon",
  labels: ["area:ci", "P2"],
});

// ── Run mode ────────────────────────────────────────────────────────────────

/**
 * Whether a process started under faketime sees the clock OFFSET_DAYS ahead,
 * within an hour. Without this, a runner where libfaketime didn't load would
 * make this a plain rerun of CI that passes every night and proves nothing.
 */
export function checkShift({ spawn = spawnSync, now = Date.now } = {}) {
  const before = now();
  const result = spawn("faketime", faketimeArgs([process.execPath, "-e", "process.stdout.write(String(Date.now()))"]), {
    encoding: "utf8",
    env: faketimeEnv(),
  });
  const seen = Number(String(result.stdout ?? "").trim());
  if (result.status !== 0 || !Number.isFinite(seen) || seen <= 0) {
    return { ok: false, detail: `faketime did not run (exit ${result.status}): ${(result.stderr || result.error?.message || "").trim()}` };
  }
  const shiftHours = (seen - before) / 3_600_000;
  const ok = Math.abs(shiftHours - OFFSET_DAYS * 24) <= 1;
  return { ok, shiftedTo: new Date(seen).toISOString(), detail: ok ? "" : `the clock moved ${shiftHours.toFixed(1)} hours, not ${OFFSET_DAYS * 24}` };
}

/**
 * The failing tests in a jest `--json` report, as `{ file, test }`. A file that
 * failed to run at all (no assertion failed, the file did) is one entry with
 * `test: null` and the first line of its message.
 */
export function failuresFromReport(report, root = ROOT) {
  const out = [];
  for (const file of report?.testResults ?? []) {
    if (file.status === "passed") continue;
    const path = relative(root, file.name ?? file.testFilePath ?? "");
    const failed = (file.assertionResults ?? []).filter((a) => a.status === "failed");
    if (failed.length === 0) {
      const firstLine = String(file.message ?? "")
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line && !line.startsWith("●"));
      out.push({ file: path, test: null, message: firstLine ?? "" });
    } else {
      for (const assertion of failed) out.push({ file: path, test: assertion.fullName });
    }
  }
  return out;
}

/** The last `limit` lines of a suite's output, safe inside a fenced block. */
export function outputTail(text, limit = OUTPUT_TAIL_LINES) {
  const lines = String(text ?? "").trimEnd().split("\n");
  const kept = lines.slice(-limit).join("\n").replaceAll("```", "'''");
  return lines.length > limit ? `… ${lines.length - limit} earlier lines in the run log\n${kept}` : kept;
}

function defaultRunSuite(suite, outputFile) {
  const result = spawnSync(
    "faketime",
    faketimeArgs(["npm", "run", suite.script, "-w", "apps/api", "--", "--ci", "--json", `--outputFile=${outputFile}`]),
    { cwd: ROOT, encoding: "utf8", env: faketimeEnv(), maxBuffer: 256 * 1024 * 1024 },
  );
  // Streamed after the fact, so the run log reads like ci.yml's.
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  let report = null;
  try {
    report = JSON.parse(readFileSync(outputFile, "utf8"));
  } catch {
    // No report: jest crashed before writing one. The exit code and output say why.
  }
  return { status: result.status, output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`, report };
}

/** Run every suite under the shifted clock. Returns the result the alert job reads. */
export function runSuites({ shift = checkShift, runSuite = defaultRunSuite } = {}) {
  const checked = shift();
  if (!checked.ok) return { offsetDays: OFFSET_DAYS, shiftOk: false, shiftDetail: checked.detail, suites: [] };

  const dir = mkdtempSync(join(tmpdir(), "clock-ahead-"));
  try {
    const suites = SUITES.map((suite, index) => {
      const ran = runSuite(suite, join(dir, `report-${index}.json`));
      const failures = failuresFromReport(ran.report);
      return {
        name: suite.name,
        script: suite.script,
        status: ran.status,
        tests: ran.report?.numTotalTests ?? null,
        failures: failures.slice(0, MAX_LISTED_FAILURES),
        failureCount: failures.length,
        // Only a suite that failed without naming a test needs its output in the alert.
        tail: ran.status !== 0 && failures.length === 0 ? outputTail(ran.output) : "",
      };
    });
    return { offsetDays: OFFSET_DAYS, shiftOk: true, shiftedTo: checked.shiftedTo, suites };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function writeOutput(result, path = process.env.GITHUB_OUTPUT) {
  // JSON.stringify escapes every newline, so the value is one line.
  const line = `result=${JSON.stringify(result)}\n`;
  if (path) appendFileSync(path, line);
  else process.stdout.write(line);
}

// ── Alert mode ──────────────────────────────────────────────────────────────

/** Read the tests job's output: "passed", "failed" or "no-verdict", with the parsed result. */
export function classify(raw) {
  let result = null;
  try {
    result = raw ? JSON.parse(raw) : null;
  } catch {
    result = null;
  }
  if (!result || !Array.isArray(result.suites)) return { verdict: "no-verdict", result, why: "the tests job wrote no result; it failed before the suites ran" };
  if (!result.shiftOk) return { verdict: "no-verdict", result, why: `the clock shift did not take: ${result.shiftDetail || "unknown"}` };
  if (result.suites.length !== SUITES.length) return { verdict: "no-verdict", result, why: "the result does not cover every suite" };
  if (result.suites.some((suite) => suite.status !== 0)) return { verdict: "failed", result, why: "" };
  return { verdict: "passed", result, why: "" };
}

function failureLine({ file, test, message }) {
  return test ? `- \`${file}\`: ${test}` : `- \`${file}\` failed to run${message ? `: ${message}` : ""}`;
}

/** A stable key for what is failing, so the alert comments when it changes and not every night. */
export function failureKey({ verdict, result, why }) {
  if (verdict === "no-verdict") return `no-verdict:${why.split(":")[0]}`;
  const ids = result.suites
    .filter((suite) => suite.status !== 0)
    .flatMap((suite) =>
      suite.failures.length > 0
        ? suite.failures.map((f) => `${suite.script}|${f.file}|${f.test ?? ""}`)
        : [`${suite.script}|exit ${suite.status}`],
    )
    .sort();
  return createHash("sha256").update(ids.join("\n")).digest("hex").slice(0, 16);
}

const MARKER_PREFIX = "<!-- clock-ahead-failing:";

export function marker(classified) {
  return `${MARKER_PREFIX} ${failureKey(classified)} -->`;
}

function describeResult({ verdict, result, why }) {
  if (verdict === "no-verdict") {
    return [
      `The nightly run reached **no verdict**: ${why}. Nothing is known about how the tests behave ${OFFSET_DAYS} days from now, ` +
        "so this is not a clean bill either. Read the run log; a runner or install failure that doesn't repeat tomorrow closes this.",
    ];
  }
  const lines = [];
  for (const suite of result.suites.filter((s) => s.status !== 0)) {
    lines.push(`**${suite.name}** (\`npm run ${suite.script} -w apps/api\`), exit ${suite.status}:`, "");
    if (suite.failures.length > 0) {
      lines.push(...suite.failures.map(failureLine));
      if (suite.failureCount > suite.failures.length) lines.push(`- … and ${suite.failureCount - suite.failures.length} more in the run log`);
    } else {
      lines.push("No test was named, so the suite itself failed. Its output ends:", "", "```text", suite.tail, "```");
    }
    lines.push("");
  }
  return lines;
}

export function buildIssueBody(classified, { runUrl = "" } = {}) {
  const shifted = classified.result?.shiftedTo ? ` (the tests saw ${classified.result.shiftedTo.slice(0, 10)})` : "";
  return [
    `The nightly API test run (\`clock-ahead-tests.yml\`) ran the suites PR CI runs with the clock ${OFFSET_DAYS} days ahead${shifted}, and they did not pass.`,
    "",
    ...describeResult(classified),
    "**Why it matters.** These tests pass today and will fail on some day this week with no commit to blame. " +
      "PR CI tests every PR merged with `main`, so that morning every open PR goes red at once, as on 2026-11-14.",
    "",
    "**What to do.** Fix it once, on `main`, before that day: pin the clock the test reads (pass a fixed `now`, or " +
      "`jest.useFakeTimers({ now })`), the way #4974 and #4986 fixed the two that broke main on 2026-11-14. " +
      "Don't patch it on each PR's branch. To reproduce: `faketime -f +7d npm run test -w apps/api -- <spec>` " +
      "(`apt-get install faketime`). This alert closes on the first night every suite passes a week ahead.",
    "",
    runUrl ? `Run: ${runUrl}` : "",
    "",
    marker(classified),
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function buildCommentBody(classified, { runUrl = "", reopened = false } = {}) {
  return [
    reopened ? `**Reopened.** The API tests fail again with the clock ${OFFSET_DAYS} days ahead.` : "What fails changed. Now:",
    "",
    ...describeResult(classified),
    runUrl ? `Run: ${runUrl}` : "",
  ]
    .join("\n")
    .trim();
}

export function buildRecoveryBody({ runUrl = "" } = {}) {
  return [`**Recovered.** Every API suite passes with the clock ${OFFSET_DAYS} days ahead.`, "", runUrl ? `Run: ${runUrl}` : ""].join("\n").trim();
}

function defaultWriteSummary(markdown) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (path) appendFileSync(path, `${markdown}\n`);
}

/** Raise, leave or close the alert for one night's result. Returns `{ verdict, alert }`. */
export async function runAlert({
  token,
  repo,
  raw,
  fetchImpl = fetch,
  runUrl = "",
  writeSummary = defaultWriteSummary,
  logger = console,
}) {
  const classified = classify(raw);
  const { verdict } = classified;
  let alert;
  if (verdict === "passed") {
    alert = await resolveAlert({ token, repo, fetchImpl, alert: ALERT, buildRecoveryBody: () => buildRecoveryBody({ runUrl }) });
  } else {
    logger.log?.(`::error::API tests a week ahead: ${verdict === "failed" ? "failed" : `no verdict (${classified.why})`}.`);
    const lookup = await findAlertIssuesDetailed({ token, repo, fetchImpl, alert: ALERT });
    const open = lookup.lookupOk ? lookup.issues.find((issue) => issue.state === "open") : null;
    // One email per change in what fails, not one a night.
    if (open && markerLine(open.body, MARKER_PREFIX) === marker(classified)) {
      alert = { action: "unchanged", issueNumber: open.number };
    } else {
      alert = await raiseAlert({
        token,
        repo,
        fetchImpl,
        alert: ALERT,
        lookup,
        buildIssueBody: () => buildIssueBody(classified, { runUrl }),
        buildCommentBody: ({ reopened }) => buildCommentBody(classified, { runUrl, reopened }),
        // The body holds the marker, so it has to track what fails now.
        refreshBodyOnRaise: true,
      });
    }
  }
  logger.log?.(`[clock-ahead-tests] verdict ${verdict}; alert ${alert.action}${alert.issueNumber ? ` #${alert.issueNumber}` : ""}`);
  writeSummary(
    [
      `## API tests, clock ${OFFSET_DAYS} days ahead`,
      "",
      `Verdict: **${verdict}**. Alert: ${alert.action}.`,
      ...(classified.result?.suites ?? []).map((s) => `- ${s.name}: exit ${s.status}, ${s.tests ?? "?"} tests, ${s.failureCount} failing`),
    ].join("\n"),
  );
  return { verdict, alert };
}

/** 0 only when every suite passed and the alert's state is known to match. */
export function exitCodeFor({ verdict, alert }) {
  if (verdict !== "passed") return 1;
  return alert.action === "none" || alert.action === "closed" ? 0 : 1;
}

export async function main({ argv = process.argv.slice(2), env = process.env, run = runSuites, alert = runAlert } = {}) {
  const [mode] = argv;
  if (mode === "run") {
    writeOutput(run());
    return 0;
  }
  if (mode === "alert") {
    const token = requireEnv("GITHUB_TOKEN", { env });
    const repo = requireEnv("GITHUB_REPOSITORY", { env });
    return exitCodeFor(await alert({ token, repo, raw: env.RESULT ?? "", runUrl: env.RUN_URL ?? "" }));
  }
  console.error("usage: clock-ahead-tests.mjs run|alert");
  return 2;
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
