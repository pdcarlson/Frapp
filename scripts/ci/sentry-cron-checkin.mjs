#!/usr/bin/env node

// Report one scheduled job's run to a Sentry cron monitor, so a nightly job
// that fails, overruns or never starts pages someone (#2505).
//
// ── Why a monitor, when the job already fails red ───────────────────────────
// A red scheduled run reaches nobody: GitHub mails the workflow's last editor,
// if anyone, and a run that never STARTS (a disabled workflow, a schedule that
// GitHub dropped, a job stuck behind the `db-backup` concurrency group) is not
// red at all. It is simply absent. Sentry's cron monitor is the one check
// here that notices absence: it expects a check-in on the job's schedule, and
// raises an issue when one is missed, fails, or runs past `max_runtime`.
//
// ── The protocol ────────────────────────────────────────────────────────────
// Sentry's HTTP check-in endpoint, derived from the project's DSN
// (docs.sentry.io/product/monitors-and-alerts/monitors/crons/getting-started/http):
//
//   POST https://<ingest host>/api/<project id>/cron/<monitor slug>/<public key>/
//   { "status": "in_progress" | "ok" | "error", "check_in_id": "<uuid>",
//     "environment": "production", "monitor_config": { … } }
//
// `monitor_config` makes each check-in an upsert: the first one creates the
// monitor, so no dashboard step is needed, and the schedule below stays the one
// place it is written. `check_in_id` ties a run's start and end together, and
// it is also what makes a re-sent POST safe to retry: a second POST with the
// same id updates that check-in instead of adding one.
//
// ── A check-in never fails the job it reports on ────────────────────────────
// Every failure here (no DSN, an unparsable one, Sentry down) is a warning and
// exit 0. The job's own work is the backup; failing it because Sentry did not
// answer would trade a real backup for a monitoring blip. The miss is still
// loud, just later: a run whose check-in never lands is reported missed by the
// monitor once `checkin_margin` passes.
//
// Usage:
//   node scripts/ci/sentry-cron-checkin.mjs --monitor <slug> --status in_progress
//   node scripts/ci/sentry-cron-checkin.mjs --monitor <slug> --status ok|error --check-in-id <uuid>
//
// Env inputs:
//   SENTRY_DSN    — the reporting project's DSN. Unset → warn and skip.
//   GITHUB_OUTPUT — when set, `check_in_id=<uuid>` is written there, so a later
//                   step can close the same check-in.
//
// Unit tests: `scripts/ci/__tests__/sentry-cron-checkin.test.mjs`.

import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { fetchWithRetry } from "./lib/http.mjs";
import { isInvokedDirectly } from "./lib/invoked-directly.mjs";

/**
 * Every monitored job, keyed by monitor slug. One entry per job: Sentry's free
 * plan includes a single cron monitor, and ADR-24's Team slice adds the rest.
 *
 * `schedule` and `maxRuntimeMinutes` restate the workflow's `cron:` and the
 * job's `timeout-minutes`; `sentry-cron-checkin.test.mjs` reads the workflow
 * and fails when either drifts, because a monitor on the wrong schedule pages
 * every night for a job that ran fine.
 */
export const MONITORS = {
  "production-db-backup": {
    workflow: ".github/workflows/db-backup.yml",
    job: "backup-production",
    schedule: "30 6 * * *",
    // GitHub starts scheduled runs late, sometimes by hours: #2505 measured
    // `production-uptime.yml`'s */15 schedule at a 3.1 h median gap. A margin
    // shorter than that pages for a backup that is merely queued.
    checkinMarginMinutes: 180,
    maxRuntimeMinutes: 30,
  },
};

export const STATUSES = new Set(["in_progress", "ok", "error"]);

/**
 * The check-in endpoint for a DSN, or null when the DSN is not one.
 *
 * A DSN is `https://<public key>@<host>[/<path prefix>]/<project id>`; the
 * endpoint keeps the scheme, host and any prefix, and inserts the cron path.
 */
export function checkInUrlFor(dsn, monitorSlug) {
  let url;
  try {
    url = new URL(dsn);
  } catch {
    return null;
  }
  const publicKey = url.username;
  const segments = url.pathname.split("/").filter(Boolean);
  const projectId = segments.pop();
  if (!publicKey || !projectId || !/^\d+$/.test(projectId)) return null;
  const prefix = segments.length > 0 ? `/${segments.join("/")}` : "";
  return (
    `${url.protocol}//${url.host}${prefix}/api/${projectId}/cron/` +
    `${encodeURIComponent(monitorSlug)}/${encodeURIComponent(publicKey)}/`
  );
}

/** The check-in body, including the upsert config for the monitor. */
export function checkInPayload({ monitor, status, checkInId, environment = "production" }) {
  return {
    check_in_id: checkInId,
    status,
    environment,
    monitor_config: {
      schedule: { type: "crontab", value: monitor.schedule },
      timezone: "UTC",
      checkin_margin: monitor.checkinMarginMinutes,
      max_runtime: monitor.maxRuntimeMinutes,
      // One missed or failed night is a backup that does not exist.
      failure_issue_threshold: 1,
      recovery_threshold: 1,
    },
  };
}

/**
 * Send one check-in. Resolves to `{ sent, checkInId, reason? }` and never
 * throws: a check-in must not fail the job it reports on (see the header).
 */
export async function sendCheckIn({
  dsn,
  monitorSlug,
  status,
  checkInId = randomUUID(),
  fetchImpl = fetch,
  sleep,
  logger = console,
}) {
  const monitor = MONITORS[monitorSlug];
  const skip = (reason) => {
    logger.warn(`::warning::Sentry cron check-in skipped for ${monitorSlug}: ${reason}`);
    return { sent: false, checkInId, reason };
  };

  if (!monitor) return skip(`no monitor named "${monitorSlug}" in MONITORS`);
  if (!STATUSES.has(status)) return skip(`status "${status}" is not one of ${[...STATUSES].join(", ")}`);
  if (!dsn) return skip("SENTRY_DSN is not set, so the monitor will report this run as missed");
  const url = checkInUrlFor(dsn, monitorSlug);
  if (!url) return skip("SENTRY_DSN is not a DSN (https://<key>@<host>/<project id>)");

  try {
    const response = await fetchWithRetry(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(checkInPayload({ monitor, status, checkInId })),
      },
      // The stable check_in_id makes a re-sent POST an update, not a second
      // check-in, so this POST may retry like a GET.
      { fetchImpl, retryMethods: new Set(["POST"]), ...(sleep ? { sleep } : {}) },
    );
    if (!response.ok) return skip(`Sentry answered HTTP ${response.status}`);
  } catch (error) {
    return skip(`request failed (${error?.message ?? String(error)})`);
  }

  // The URL carries the DSN's public key; log the host, never the URL.
  logger.log(`Sentry cron check-in sent: ${monitorSlug} ${status} (${new URL(url).host}).`);
  return { sent: true, checkInId };
}

// ── CLI entry ───────────────────────────────────────────────────────────────

async function main() {
  const { values } = parseArgs({
    options: {
      monitor: { type: "string" },
      status: { type: "string" },
      "check-in-id": { type: "string" },
    },
  });

  // An empty id (the start step never ran) opens a fresh check-in rather than
  // sending none: the run's outcome still reaches the monitor.
  const result = await sendCheckIn({
    dsn: process.env.SENTRY_DSN,
    monitorSlug: values.monitor ?? "",
    status: values.status ?? "",
    ...(values["check-in-id"] ? { checkInId: values["check-in-id"] } : {}),
  });

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `check_in_id=${result.checkInId}\n`);
  }
}

if (isInvokedDirectly(import.meta.url)) {
  main().catch((error) => {
    // Still exit 0: see "A check-in never fails the job it reports on".
    console.warn(`::warning::Sentry cron check-in crashed: ${error.stack ?? error.message}`);
  });
}
