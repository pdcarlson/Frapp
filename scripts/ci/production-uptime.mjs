#!/usr/bin/env node

// Scheduled probe of live production readiness.
//
// Deploy smoke already hits `/health/ready` after a ship. Nothing watched it
// between deploys. `/health` is Render's `healthCheckPath` and is specified to
// always 2xx while the process is up, so an HTTP-status monitor on it only
// ever catches a dead process — not a degraded database or Storage. This
// script GETs `/health/ready` and treats anything other than HTTP 200 with
// JSON `status: "ok"` as an outage.
//
// It does **not** name GitHub `environment: production`. A `schedule:` job
// that did would suspend on ADR-19's required-reviewer gate and expire without
// probing (#1435).
//
// This is the in-repo monitor. A Sentry 60s check is finer-grained and still
// human (quota + dashboard). Do not create that from an agent session.
//
// Semantics: the pure functions below. Unit tests:
// `scripts/ci/__tests__/production-uptime.test.mjs`.

import { findAlertIssuesDetailed, raiseAlert, resolveAlert } from "./lib/alert-issue.mjs";
import { requireEnv } from "./lib/env.mjs";
import { DEFAULT_ATTEMPTS, fetchWithRetry } from "./lib/http.mjs";

export const DEFAULT_READY_URL = "https://api.frapp.live/health/ready";
export const READY_PATH = "/health/ready";

// Title is the lookup key. Rename only in a change that also closes every
// open alert carrying the old wording.
export const ALERT_ISSUE_TITLE = "Production /health/ready is failing";
export const ALERT_ISSUE_LOOKUP_LABEL = "routine-state";
export const ALERT_ISSUE_LABELS = [ALERT_ISSUE_LOOKUP_LABEL, "area:infra", "P1"];

const BODY_SNIPPET_CHARS = 500;

/**
 * The probe URL must be the readiness path, never `/health`.
 *
 * Tests may use `http:` and a non-production host. The scheduled workflow
 * pins `https://api.frapp.live/health/ready`.
 */
export function assertReadyUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "unparseable URL" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, reason: `unsupported scheme ${parsed.protocol}` };
  }
  if (parsed.pathname !== READY_PATH) {
    return {
      ok: false,
      reason: `pathname must be ${READY_PATH}, got ${parsed.pathname || "/"}`,
    };
  }
  if (parsed.search) {
    return { ok: false, reason: "query string not allowed" };
  }
  return { ok: true };
}

/**
 * Classify one HTTP response. Transport failures never reach here.
 *
 * `/health/ready` is specified to 503 when a dependency is degraded, with the
 * standard error envelope rather than `{status, database, storage, uptime}`.
 * A 200 whose JSON `status` is not `"ok"` is still a failure: that is the
 * `/health` liveness shape, and this monitor must not treat it as ready.
 */
export function evaluateReadyResponse({ httpStatus, bodyText }) {
  if (httpStatus !== 200) {
    return { ok: false, reason: `HTTP ${httpStatus}` };
  }
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return { ok: false, reason: "non-JSON body" };
  }
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, reason: "JSON body is not an object" };
  }
  if (body.status !== "ok") {
    return {
      ok: false,
      reason: `status ${body.status == null ? "missing" : JSON.stringify(body.status)}`,
    };
  }
  return { ok: true, reason: "ok" };
}

function snippet(bodyText) {
  const text = bodyText ?? "";
  if (text.length <= BODY_SNIPPET_CHARS) return text;
  return `${text.slice(0, BODY_SNIPPET_CHARS)}…`;
}

export async function probeReady({
  url,
  fetchImpl = fetch,
  timeoutMs = 10_000,
  attempts = DEFAULT_ATTEMPTS,
  sleep,
} = {}) {
  const urlCheck = assertReadyUrl(url);
  if (!urlCheck.ok) {
    return { ok: false, reason: urlCheck.reason, httpStatus: 0, bodyText: "" };
  }
  try {
    const response = await fetchWithRetry(
      url,
      { method: "GET" },
      {
        fetchImpl,
        timeoutMs,
        attempts,
        ...(sleep ? { sleep } : {}),
      },
    );
    const bodyText = await response.text();
    const verdict = evaluateReadyResponse({
      httpStatus: response.status,
      bodyText,
    });
    return { ...verdict, httpStatus: response.status, bodyText };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `network: ${message}`, httpStatus: 0, bodyText: "" };
  }
}

function buildAlertIssueBody({ result, url, runUrl }) {
  return [
    "Live production readiness failed.",
    "",
    `\`${url}\` returned **${result.reason}**.`,
    "",
    "Watch `/health/ready`, not `/health`. `/health` is Render's `healthCheckPath` and is specified to always 2xx while the process is up, so a 200 there does not clear a degraded dependency.",
    "",
    "See `docs/internal/ops/incident-response.md` § API down.",
    "",
    result.bodyText ? `Body:\n\n\`\`\`\n${snippet(result.bodyText)}\n\`\`\`` : "",
    runUrl ? `Run: ${runUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function runWatchdog({
  result,
  url,
  token,
  repo,
  runUrl = "",
  fetchImpl,
}) {
  if (!result.ok) {
    const raised = await raiseAlert({
      token,
      repo,
      fetchImpl,
      title: ALERT_ISSUE_TITLE,
      labels: ALERT_ISSUE_LABELS,
      lookupLabel: ALERT_ISSUE_LOOKUP_LABEL,
      buildIssueBody: () => buildAlertIssueBody({ result, url, runUrl }),
      buildCommentBody: ({ reopened }) =>
        `${reopened ? "Reopened — " : ""}still failing: ${result.reason}${runUrl ? `\n\nRun: ${runUrl}` : ""}`,
      refreshBodyOnRaise: true,
    });
    return { outcome: "fail", alert: raised };
  }

  const { lookupOk } = await findAlertIssuesDetailed({
    token,
    repo,
    fetchImpl,
    title: ALERT_ISSUE_TITLE,
    lookupLabel: ALERT_ISSUE_LOOKUP_LABEL,
  });
  if (!lookupOk) {
    return { outcome: "pass", resolved: false, lookupOk: false };
  }
  const resolved = await resolveAlert({
    token,
    repo,
    fetchImpl,
    title: ALERT_ISSUE_TITLE,
    lookupLabel: ALERT_ISSUE_LOOKUP_LABEL,
    buildRecoveryBody: () =>
      `Production /health/ready returned 200 status=ok again.${runUrl ? `\n\nRun: ${runUrl}` : ""}`,
  });
  // `action: "failed"` is not recovery. Treating anything other than "none"
  // as closed used to green the job while the P1 stayed open (the same
  // false-closure `alert-issue.mjs` already refuses to report as `closed`).
  if (resolved.action === "failed") {
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
  const url = process.env.HEALTH_URL ?? DEFAULT_READY_URL;
  const urlCheck = assertReadyUrl(url);
  if (!urlCheck.ok) {
    console.error(`Error: HEALTH_URL ${urlCheck.reason}`);
    process.exit(2);
  }

  // Credentials before the probe when this run will file or close an alert.
  // A missing token must not print "✅ … status=ok" and then die — that log
  // reads as a successful watch of production. `--probe-only` skips GitHub.
  let token;
  let repo;
  if (!probeOnly) {
    token = requireEnv("GITHUB_TOKEN");
    repo = requireEnv("GITHUB_REPOSITORY");
  }

  const result = await probeReady({ url });
  if (result.ok) {
    console.log(`✅ ${url} HTTP ${result.httpStatus} status=ok`);
  } else {
    console.error(`::error::${url} ${result.reason}`);
  }

  if (probeOnly) {
    process.exit(result.ok ? 0 : 1);
  }

  const runUrl = process.env.RUN_URL ?? "";
  const watchdog = await runWatchdog({ result, url, token, repo, runUrl });
  if (result.ok && watchdog.outcome === "fail") {
    console.error("::error::production is ready but the alert issue could not be closed");
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
