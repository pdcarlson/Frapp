#!/usr/bin/env node
// Scheduled quota watch for the Supabase organization (#2531).
//
// Both projects share one organization, and the organization's plan sets the
// quotas. The spend cap is on (Pro's default), so neither quota here is billed
// past its limit. Past an organization quota such as Storage, Supabase emails
// the billing address, starts a grace period, and then restricts EVERY project
// in the organization, production included. The first real Discord import on
// staging went over Free's storage quota that way, which is why the
// organization moved to Pro. A project whose disk fills goes read-only on its
// own, with no grace period. docs/ops/deployment/supabase.md
// § Plan and quotas owns the quotas, and DISK_QUOTA_BYTES and
// STORAGE_QUOTA_BYTES below copy them. Supabase's own email arrives only once a
// quota is already exceeded. This watch pages at 70%, while there is room to
// act.
//
// What it reads, per project in .github/environments.json:
//
//   - Disk: `GET /v1/projects/{ref}/config/disk/util`. On Pro the database's
//     limit is its disk, not Free's 500 MB database size, and with the spend cap
//     on the disk doesn't grow past what Pro includes (supabase.md, as above).
//     `fs_used_bytes` includes the database, its WAL and system files, and is
//     judged against the included size, not the provisioned one.
//   - Storage: the sum of `storage.objects` sizes, Supabase's own definition of
//     storage size, read with `POST /v1/projects/{ref}/database/query/read-only`
//     (runs as `supabase_read_only_user`). The quota is organization-wide, so
//     the two projects' sums are added before comparing.
//
// What it can't read: egress and Realtime peak connections. Supabase shows both
// only on the organization's Usage page; the Management API has no usage
// endpoint for either, and edge logs carry no response bytes. A daily snapshot
// couldn't see a Realtime peak anyway.
//
// ── Fail closed ─────────────────────────────────────────────────────────────
// A figure that can't be read raises the same alert as one over the threshold.
// Each project's token is read-only, scoped to that project, and expires
// (ENV_REFERENCE.md § CD Secrets); a revoked, expired or under-scoped token would
// otherwise turn this watch off with every run green. The alert closes only on
// a run that read every figure and found each one under the threshold.
//
// ── The test page ───────────────────────────────────────────────────────────
// `SUPABASE_QUOTA_THRESHOLD_PERCENT` lowers the threshold for one run (the
// workflow's dispatch input). At 0 every figure is "over", so the run files the
// alert: that is how to prove the page reaches the owner. The next scheduled
// run, back at 70%, closes it. The threshold can only be lowered, so a dispatch
// can never close an alert the default threshold would keep open.
//
// Env inputs:
//   GITHUB_TOKEN          — required (issues: write), for the alert issue
//   GITHUB_REPOSITORY     — required, owner/repo
//   SUPABASE_ACCESS_TOKEN_STAGING, SUPABASE_ACCESS_TOKEN_PRODUCTION
//                         — each project's read-only Management API token.
//                           SUPABASE_ACCESS_TOKEN stands in for a missing one
//                           (a person's own token, on a hand run)
//   SUPABASE_QUOTA_THRESHOLD_PERCENT
//                         — optional, 0 to 70; empty means 70
//   RUN_URL               — optional, html_url of this run
//   GITHUB_STEP_SUMMARY   — optional, written when present
//
// Exit codes:
//   0 — every figure was read and is under the threshold, and no alert is open
//       (any that was is now closed)
//   1 — a figure is over the threshold or unreadable (the alert is raised), or
//       the alert issue could not be written, read or closed
//   2 — the invocation is wrong (a threshold outside 0 to 70)
//
// Unit tests: scripts/ci/__tests__/supabase-quota.test.mjs
// (`npm run test:ci-scripts`).

import { appendFileSync } from "node:fs";

import { defineAlert, raiseAlert, resolveAlert } from "./lib/alert-issue.mjs";
import { ENVIRONMENTS, loadEnvironments, supabaseAccessTokenFor } from "./lib/environments.mjs";
import { requireEnv } from "./lib/env.mjs";
import { fetchWithRetry } from "./lib/http.mjs";
import { isInvokedDirectly } from "./lib/invoked-directly.mjs";

export const SUPABASE_API_BASE = "https://api.supabase.com";

/** The default, and the highest threshold a run may use. */
export const DEFAULT_THRESHOLD_PERCENT = 70;

// Pro's quotas, from supabase.md § Plan and quotas. Decimal gigabytes, the
// smaller reading of "GB", so the page comes early rather than late.
export const DISK_QUOTA_BYTES = 8e9;
export const STORAGE_QUOTA_BYTES = 100e9;

// Title is the lookup key: it must stay stable. The label and assignee come
// from lib/alert-issue.mjs, like every other watchdog's.
export const ALERT = defineAlert({
  title: "Supabase usage is near a plan quota, or could not be read",
  labels: ["area:infra", "P2"],
});

/** Supabase's definition of storage size. Every name is schema-qualified, as the endpoint requires. */
export const STORAGE_SIZE_SQL =
  "select coalesce(sum((metadata->>'size')::bigint), 0)::text as bytes from storage.objects";

const MESSAGE_LIMIT = 200;

// ── Threshold ───────────────────────────────────────────────────────────────

/**
 * The threshold as a fraction. Empty means the default. Anything that is not a
 * number from 0 to the default throws: a raised threshold could close an alert
 * the default keeps open, and a typo must not silently watch at some other level.
 */
export function parseThresholdPercent(raw) {
  const text = String(raw ?? "").trim();
  if (text === "") return DEFAULT_THRESHOLD_PERCENT / 100;
  const value = Number(text);
  if (!/^\d+(\.\d+)?$/.test(text) || !Number.isFinite(value) || value > DEFAULT_THRESHOLD_PERCENT) {
    throw new Error(
      `SUPABASE_QUOTA_THRESHOLD_PERCENT must be a number from 0 to ${DEFAULT_THRESHOLD_PERCENT} ` +
        `(got ${JSON.stringify(text)}). It can only lower the threshold.`,
    );
  }
  return value / 100;
}

// ── Reads ───────────────────────────────────────────────────────────────────

/**
 * Text from outside, made one line. A reason lands in a markdown table cell and
 * in a `::error::` workflow command, and a newline ends both: a multi-line
 * Postgres error would split the row and push its status onto a stray line.
 */
export function oneLine(text) {
  return String(text).replace(/\s+/g, " ").trim();
}

/** A short reason from a Management API error body, which is JSON with a `message` when there is one. */
function describeFailure(status, text) {
  let message = "";
  try {
    message = JSON.parse(text)?.message ?? "";
  } catch {
    message = "";
  }
  const detail = typeof message === "string" && message ? `: ${oneLine(message).slice(0, MESSAGE_LIMIT)}` : "";
  return `Management API returned HTTP ${status}${detail}`;
}

async function managementApi({ path, token, fetchImpl, sleep, method = "GET", body }) {
  const init = {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
  let response;
  let text;
  try {
    // The read-only query is a POST that changes nothing, so it may be re-sent.
    response = await fetchWithRetry(`${SUPABASE_API_BASE}${path}`, init, {
      fetchImpl,
      sleep,
      retryMethods: new Set(["GET", "POST"]),
    });
    // Inside the try: the timeout also covers the body, and a body that stalls
    // rejects here (lib/http.mjs), which is a failed read, not a crash.
    text = await response.text();
  } catch (error) {
    return { ok: false, detail: `request failed: ${oneLine(error?.message ?? String(error))}` };
  }
  if (!response.ok) return { ok: false, detail: describeFailure(response.status, text) };
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, detail: "Management API answered with something that is not JSON" };
  }
}

/** A byte count, or null. Only a finite, non-negative number is one. */
function byteCount(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/** One project's used disk, from `config/disk/util`. */
export async function readDiskBytes({ projectRef, token, fetchImpl, sleep }) {
  if (!token) return { ok: false, detail: "no Supabase access token for this project" };
  const result = await managementApi({ path: `/v1/projects/${projectRef}/config/disk/util`, token, fetchImpl, sleep });
  if (!result.ok) return result;
  const used = byteCount(result.data?.metrics?.fs_used_bytes);
  if (used === null) return { ok: false, detail: "disk utilization has no numeric metrics.fs_used_bytes" };
  return { ok: true, bytes: used };
}

/** One project's stored bytes: the sum of `storage.objects` sizes. */
export async function readStorageBytes({ projectRef, token, fetchImpl, sleep }) {
  if (!token) return { ok: false, detail: "no Supabase access token for this project" };
  const result = await managementApi({
    path: `/v1/projects/${projectRef}/database/query/read-only`,
    token,
    fetchImpl,
    sleep,
    method: "POST",
    body: { query: STORAGE_SIZE_SQL },
  });
  if (!result.ok) return result;
  const rows = result.data;
  // The sum is cast to text so a bigint survives JSON; anything else is not this query's answer.
  const bytes = Array.isArray(rows) && rows.length === 1 ? rows[0]?.bytes : undefined;
  if (typeof bytes !== "string" || !/^\d+$/.test(bytes)) {
    return { ok: false, detail: "the storage size query did not return one row with a numeric `bytes`" };
  }
  return { ok: true, bytes: Number(bytes) };
}

/** Every figure for every project. Never throws: a failed read is a result. */
export async function readUsage({ env = process.env, fetchImpl, environments = loadEnvironments() } = {}) {
  const projects = [];
  for (const name of ENVIRONMENTS) {
    const { supabaseProjectRef: projectRef, supabaseProjectName: projectName } = environments[name];
    const token = supabaseAccessTokenFor(name, env);
    projects.push({
      name,
      projectName,
      disk: await readDiskBytes({ projectRef, token, fetchImpl }),
      storage: await readStorageBytes({ projectRef, token, fetchImpl }),
    });
  }
  return projects;
}

// ── Judgement ───────────────────────────────────────────────────────────────

/**
 * One row per quota reading: each project's disk, and the organization's
 * storage. The organization row is unread when either project's storage is,
 * because a partial sum can't prove the total is under the quota.
 */
export function evaluateUsage({ projects, threshold }) {
  const row = (quota, scope, reading, limitBytes) => {
    if (!reading.ok) return { quota, scope, status: "unread", detail: reading.detail, limitBytes };
    const ratio = reading.bytes / limitBytes;
    return {
      quota,
      scope,
      status: reading.bytes >= threshold * limitBytes ? "over" : "ok",
      usedBytes: reading.bytes,
      limitBytes,
      ratio,
    };
  };

  const rows = projects.map((p) => row("Disk", p.projectName, p.disk, DISK_QUOTA_BYTES));

  const unreadStorage = projects.filter((p) => !p.storage.ok);
  const storageScope = `organization (${projects.map((p) => p.projectName).join(" + ")})`;
  rows.push(
    unreadStorage.length > 0
      ? row(
          "Storage",
          storageScope,
          {
            ok: false,
            detail: unreadStorage.map((p) => `${p.projectName}: ${p.storage.detail}`).join("; "),
          },
          STORAGE_QUOTA_BYTES,
        )
      : row(
          "Storage",
          storageScope,
          { ok: true, bytes: projects.reduce((sum, p) => sum + p.storage.bytes, 0) },
          STORAGE_QUOTA_BYTES,
        ),
  );

  return {
    rows,
    over: rows.filter((r) => r.status === "over"),
    unread: rows.filter((r) => r.status === "unread"),
  };
}

// ── Reporting ───────────────────────────────────────────────────────────────

export function formatBytes(bytes) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} KB`;
  return `${bytes} B`;
}

function percent(ratio) {
  return `${(ratio * 100).toFixed(1)}%`;
}

function describeRow(r) {
  if (r.status === "unread") return `could not be read (${r.detail})`;
  return `${formatBytes(r.usedBytes)} of ${formatBytes(r.limitBytes)} (${percent(r.ratio)})`;
}

export function buildTable({ rows }) {
  const status = { ok: "ok", over: "**over**", unread: "**unread**" };
  return [
    "| Quota | Scope | Usage | Status |",
    "| --- | --- | --- | --- |",
    // A reason quotes the API, so a `|` in it is escaped, or it would open a cell.
    ...rows.map((r) => `| ${r.quota} | ${r.scope} | ${describeRow(r).replaceAll("|", "\\|")} | ${status[r.status]} |`),
  ].join("\n");
}

export function thresholdLine(threshold) {
  // Compared unrounded, so 69.99% is never labelled as the default; printed to
  // four decimals at most, which drops the float noise of `threshold * 100`.
  if (threshold === DEFAULT_THRESHOLD_PERCENT / 100) return `Threshold: ${DEFAULT_THRESHOLD_PERCENT}% of each quota.`;
  const pct = Number((threshold * 100).toFixed(4));
  return `Threshold: **${pct}%** of each quota, lowered for this run (the default is ${DEFAULT_THRESHOLD_PERCENT}%).`;
}

function runLine(runUrl) {
  return runUrl ? `Run: ${runUrl}` : "";
}

export function buildAlertIssueBody({ rows, threshold, runUrl }) {
  return [
    "The daily Supabase quota watch (`supabase-quota.yml`) found a quota at or over its threshold, or " +
      "could not read one.",
    "",
    thresholdLine(threshold),
    "",
    buildTable({ rows }),
    "",
    "**Why it matters.** Both projects share the organization's plan, and its spend cap is on, so " +
      "neither quota is billed past its limit. Past the Storage quota, Supabase emails the billing " +
      "address, then restricts **every** project after a grace period, production included. A project " +
      "whose disk fills goes read-only on its own, with no grace period. The quotas, and the plan's cost " +
      "control: `docs/ops/deployment/supabase.md` § Plan and quotas. An over-quota figure is " +
      "also one of ADR-24's triggers to revisit (`spec/architecture/adr/adr-24.md`).",
    "",
    "**Over.** Find what grew in the organization's **Usage** page (per project from its dropdown), then " +
      "free space or decide on the plan. The owner decides; agents report (see the note below).",
    "",
    "**Unread.** The figure is unknown, not fine. Each project's `SUPABASE_ACCESS_TOKEN` in Infisical is a " +
      "read-only token for that project alone, and it expires " +
      "(`docs/internal/environment/ENV_REFERENCE.md` § CD Secrets). An HTTP 401 means revoked or " +
      "expired, and a 403 means the token lacks the permission.",
    "",
    "Not covered: egress and Realtime peak connections, which only the Usage page shows.",
    "",
    runLine(runUrl),
  ]
    .join("\n")
    .trim();
}

export function buildAlertCommentBody({ rows, threshold, runUrl, reopened }) {
  return [
    reopened ? "**Reopened.** A quota is at or over its threshold again, or could not be read." : "Still failing.",
    "",
    thresholdLine(threshold),
    "",
    buildTable({ rows }),
    "",
    runLine(runUrl),
  ]
    .join("\n")
    .trim();
}

export function buildRecoveryCommentBody({ rows, threshold, runUrl }) {
  return [
    "**Recovered.** Every figure was read, and each is under its threshold.",
    "",
    thresholdLine(threshold),
    "",
    buildTable({ rows }),
    "",
    runLine(runUrl),
  ]
    .join("\n")
    .trim();
}

function defaultWriteSummary(markdown) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (path) appendFileSync(path, `${markdown}\n`);
}

// ── Run ─────────────────────────────────────────────────────────────────────

/**
 * Read, judge, and raise or resolve the alert. Returns `{ outcome, rows, alert }`,
 * where `outcome` is "ok" (everything read, all under) or "alert" (something
 * over or unread).
 */
export async function runSupabaseQuota({
  token,
  repo,
  env = process.env,
  fetchImpl = fetch,
  threshold = parseThresholdPercent(env.SUPABASE_QUOTA_THRESHOLD_PERCENT),
  environments,
  writeSummary = defaultWriteSummary,
  logger = console,
  runUrl = env.RUN_URL ?? "",
} = {}) {
  const projects = await readUsage({ env, fetchImpl, ...(environments ? { environments } : {}) });
  const { rows, over, unread } = evaluateUsage({ projects, threshold });

  writeSummary(["## Supabase quota watch", "", thresholdLine(threshold), "", buildTable({ rows })].join("\n"));
  for (const r of over) logger.log?.(`::error::${r.quota} (${r.scope}) is at ${describeRow(r)}`);
  for (const r of unread) logger.log?.(`::error::${r.quota} (${r.scope}) ${describeRow(r)}`);

  if (over.length > 0 || unread.length > 0) {
    const alert = await raiseAlert({
      token,
      repo,
      fetchImpl,
      alert: ALERT,
      buildIssueBody: () => buildAlertIssueBody({ rows, threshold, runUrl }),
      buildCommentBody: ({ reopened }) => buildAlertCommentBody({ rows, threshold, runUrl, reopened }),
      // The body is this run's table. Without a refresh, a reopen would keep the
      // body of whichever run first filed the issue, which may be a test page.
      refreshBodyOnRaise: true,
    });
    logger.log?.(
      alert.action === "failed"
        ? "::error::A Supabase quota needs attention, and the alert issue could not be written."
        : `[supabase-quota] alert issue #${alert.issueNumber} ${alert.action}`,
    );
    if (alert.bodyRefreshFailed) {
      logger.log?.("::warning::The alert comment was posted, but the issue body still shows an earlier run's table.");
    }
    return { outcome: "alert", rows, alert };
  }

  const alert = await resolveAlert({
    token,
    repo,
    fetchImpl,
    alert: ALERT,
    buildRecoveryBody: () => buildRecoveryCommentBody({ rows, threshold, runUrl }),
  });
  if (alert.action === "closed") {
    logger.log?.(`[supabase-quota] closed alert issue(s): ${alert.closed.join(", ")}`);
  } else if (alert.action === "failed") {
    logger.log?.(
      "::error::Every quota is under its threshold, but the alert issue could not be closed. " +
        "The next run tries again.",
    );
  } else if (alert.action === "unread") {
    logger.log?.(
      "::error::Every quota is under its threshold, but the alert issues could not be read, " +
        "so none was closed this run.",
    );
  }
  return { outcome: "ok", rows, alert };
}

/** 0 only when everything was read, all of it is under, and the alert state is known to match. */
export function exitCodeFor({ outcome, alert }) {
  if (outcome !== "ok") return 1;
  return alert.action === "none" || alert.action === "closed" ? 0 : 1;
}

/**
 * The CLI. Returns the exit code rather than exiting, so a test can check that
 * the workflow's threshold input reaches the run: that path is the only way the
 * test page happens.
 */
export async function main({ env = process.env, run = runSupabaseQuota, log = console.error } = {}) {
  const token = requireEnv("GITHUB_TOKEN", { env });
  const repo = requireEnv("GITHUB_REPOSITORY", { env });
  let threshold;
  try {
    threshold = parseThresholdPercent(env.SUPABASE_QUOTA_THRESHOLD_PERCENT);
  } catch (error) {
    log(`::error::${error.message}`);
    return 2;
  }
  return exitCodeFor(await run({ token, repo, env, threshold }));
}

if (isInvokedDirectly(import.meta.url)) {
  main()
    .then((code) => {
      if (code !== 0) process.exit(code);
    })
    .catch((error) => {
      console.error(`Unhandled error: ${error.stack ?? error.message}`);
      process.exit(1);
    });
}
