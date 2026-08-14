#!/usr/bin/env node
// Scheduled conformance check for frapp-staging (#838).
//
// Every other verification in this repo is push-triggered. The failures that
// actually cost time were not caused by pushes — they were environment state
// drifting while nobody pushed:
//
//   * frapp-staging sat 38 migrations / ~5.5 months behind, all checks green.
//   * The Infisical credential was invalid for 71+ days; 46 of 90 Deploy API
//     runs skipped every job and reported success (#696, #763).
//   * Both Vercel staging secret syncs were pointed at a git branch named
//     `preview` that has never existed here, and failed on that for months
//     with nothing reporting it. (They deliver now, since the repoint to
//     `main` — see SECRETS_MANAGEMENT.md §5, which records the opposite
//     reading as a misreading not to repeat.)
//   * custom_access_token_hook was never enabled after #643 shipped, so
//     ChapterGuard silently fell back to the client-supplied x-chapter-id
//     header — the pre-#643 trust model (#805).
//
// None produced a failing check, because no check runs unless someone pushes.
// A quiet week was indistinguishable from a healthy one. This script is the
// thing that runs anyway.
//
// ── Why a skipped check is loud here ────────────────────────────────────────
// The failure mode above is *silence*, so a check that cannot run must never
// look like a check that passed. Three outcomes are reported distinctly:
//
//   pass       — asserted against the live environment, and it held
//   fail       — asserted, and it did not hold  → red run + alert issue
//   skipped    — could not assert (missing credential / not yet built)
//
// `skipped` never reds the run — an alert that fires on our own missing config
// gets muted, and a muted alert is worse than none. But it is rendered in the
// step summary as SKIPPED with the reason, never folded into the pass count.
//
// Env inputs:
//   GITHUB_TOKEN                — required (issues: write) for the alert upsert
//   GITHUB_REPOSITORY           — required, owner/repo
//   SUPABASE_ACCESS_TOKEN       — Management API token (account-scoped)
//   SUPABASE_PROJECT_REF        — staging project ref
//   SUPABASE_URL                — staging project URL, for the sign-in probe
//   SUPABASE_ANON_KEY           — staging anon key, for the sign-in probe
//   INFISICAL_CLIENT_ID         — machine identity Client ID (see note in
//   INFISICAL_CLIENT_SECRET       SECRETS_MANAGEMENT.md: Client ID, not identity ID)
//   INFISICAL_PROJECT_ID        — workspaceId from .infisical.json
//   STAGING_SMOKE_USER_EMAIL    — optional; enables the end-to-end sign-in probe
//   STAGING_SMOKE_USER_PASSWORD
//   RUN_URL                     — html_url of this run, for the alert body

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { findAlertIssues, raiseAlert, resolveAlert } from "./lib/alert-issue.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Infisical workspace id, read from the checked-in .infisical.json rather than
 * an env var — one source of truth, and it cannot drift from what the CLI uses.
 */
export function readWorkspaceId({ path = join(REPO_ROOT, ".infisical.json"), read = readFileSync } = {}) {
  try {
    return JSON.parse(read(path, "utf8"))?.workspaceId ?? null;
  } catch {
    return null;
  }
}

// ── Alert identity ──────────────────────────────────────────────────────────
// Title is the primary key — looked up by exact match, so it must stay stable.
// `routine-state` keeps /next §0.2 from claiming it as backlog work.
export const ALERT_ISSUE_TITLE =
  "Staging conformance is failing — frapp-staging has drifted";
export const ALERT_ISSUE_LOOKUP_LABEL = "routine-state";
export const ALERT_ISSUE_LABELS = [ALERT_ISSUE_LOOKUP_LABEL, "area:ci", "P1"];

export const PASS = "pass";
export const FAIL = "fail";
export const SKIPPED = "skipped";

/**
 * Sync states that mean "this sync is broken right now".
 *
 * Infisical's `SecretSyncStatus` enum is exactly `pending | running |
 * succeeded | failed` (plus `null` before a sync has ever run), so this set is
 * deliberately the single real failure state rather than a defensive list of
 * spellings that never occur.
 */
export const FAILING_SYNC_STATUSES = new Set(["failed"]);

/**
 * Every provider call is bounded. `fetch` has no default timeout, and the job
 * had none either, so one unresponsive socket — the exact condition
 * `checkProjectStatus` exists to detect — could hang the run for hours,
 * writing no summary and raising no alert.
 */
const FETCH_TIMEOUT_MS = 20_000;
const withTimeout = (init = {}) => ({
  ...init,
  signal: init.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS),
});

/**
 * Marker line carried in the alert issue body naming the assertions that were
 * failing when it was last raised.
 *
 * Recovery is decided against THIS list, not against a pass count. Without it,
 * an alert raised by `auth-hook` closes as "recovered" on a later run where
 * `auth-hook` merely SKIPPED (its credential vanished) and unrelated checks
 * passed — i.e. deleting a secret resolves the alert. Deliberately a visible
 * backticked line rather than an HTML comment: #800 proves HTML comments do not
 * survive round-tripping through the GitHub MCP that agents read issues with.
 */
export const FAILING_MARKER = "conformance-failing:";

const result = (id, label, status, detail) => ({ id, label, status, detail });

/** Reads the failing-assertion ids out of an alert issue body. */
export function parseFailingIds(body) {
  const match = String(body ?? "").match(
    new RegExp(`${FAILING_MARKER}\\s*([^\`\\n]*)`),
  );
  if (!match) return [];
  return match[1]
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

/**
 * Secrets must never reach an alert issue body. The job injects the whole
 * staging store (`secret-path: "/"`, `include-imports: true`), and GitHub's
 * log masking does NOT apply to issue bodies written through the REST API, so
 * any text originating outside this file — notably a delegated child process's
 * stderr — is scrubbed before it can be reported.
 */
export function redactSecrets(text, env = process.env) {
  let out = String(text ?? "");
  // Anything that looks like a URL password, first — it survives value-based
  // redaction when the password is not itself an env var we know about.
  out = out.replace(/\/\/([^\s:/@]+):([^\s@]+)@/g, "//$1:***@");
  const values = Object.entries(env)
    .filter(([name, value]) =>
      typeof value === "string" &&
      value.length >= 8 &&
      /KEY|SECRET|TOKEN|PASSWORD|DSN/i.test(name))
    .map(([, value]) => value)
    // Longest first, so a value containing another is not partly replaced.
    .sort((a, b) => b.length - a.length);
  for (const value of values) out = out.split(value).join("***");
  return out;
}

// ── Assertions ──────────────────────────────────────────────────────────────

/**
 * Supabase project is ACTIVE_HEALTHY.
 *
 * Catches the paused-project surprise. A paused project answers reads with
 * errors that read like network flakes, so asserting the status directly is
 * what turns "staging is weird today" into a named cause.
 */
export async function checkProjectStatus({ accessToken, projectRef, fetchImpl = fetch }) {
  const label = "Supabase project is ACTIVE_HEALTHY";
  if (!accessToken || !projectRef) {
    return result("project-status", label, SKIPPED, "SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF not set");
  }
  const response = await fetchImpl(
    `https://api.supabase.com/v1/projects/${projectRef}`,
    withTimeout({ headers: { Authorization: `Bearer ${accessToken}` } }),
  );
  if (!response.ok) {
    return result("project-status", label, FAIL, `Management API returned HTTP ${response.status}`);
  }
  const data = await response.json();
  const status = data?.status ?? "unknown";
  return status === "ACTIVE_HEALTHY"
    ? result("project-status", label, PASS, `status=${status}`)
    : result("project-status", label, FAIL, `status=${status}, expected ACTIVE_HEALTHY`);
}

/**
 * custom_access_token_hook is enabled.
 *
 * This is the assertion that would have caught #805. Enabling the hook is a
 * dashboard toggle that no migration performs, so it can silently revert (or
 * never be set) while every workflow stays green — and when it is off,
 * ChapterGuard falls back to trusting a client-supplied header.
 */
export async function checkAuthHook({ accessToken, projectRef, fetchImpl = fetch }) {
  const label = "custom_access_token_hook is enabled";
  if (!accessToken || !projectRef) {
    return result("auth-hook", label, SKIPPED, "SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF not set");
  }
  const response = await fetchImpl(
    `https://api.supabase.com/v1/projects/${projectRef}/config/auth`,
    withTimeout({ headers: { Authorization: `Bearer ${accessToken}` } }),
  );
  if (!response.ok) {
    return result("auth-hook", label, FAIL, `Management API returned HTTP ${response.status}`);
  }
  const data = await response.json();
  if (data?.hook_custom_access_token_enabled !== true) {
    return result(
      "auth-hook",
      label,
      FAIL,
      "hook_custom_access_token_enabled is not true — ChapterGuard is falling back to the " +
        "client-supplied x-chapter-id header (the pre-#643 trust model). See #805.",
    );
  }
  const uri = data?.hook_custom_access_token_uri ?? "";
  // Enabled-but-pointed-elsewhere is a real state and is not a pass.
  if (!uri.includes("custom_access_token_hook")) {
    return result("auth-hook", label, FAIL, `enabled, but URI points at "${uri}"`);
  }
  return result("auth-hook", label, PASS, `enabled, uri=${uri}`);
}

/**
 * Every Infisical secret sync reports a succeeded status.
 *
 * Catches the #834 class: a sync failing *now*. It deliberately does not claim
 * more than that — SECRETS_MANAGEMENT.md records the hard-won caveat that "a
 * sync that reports Failed today tells you nothing about what it delivered
 * before it broke — check the destination, not the sync status." So a green
 * here means "no sync is currently broken", not "the destinations are correct".
 */
export async function checkInfisicalSyncs({
  clientId,
  clientSecret,
  projectId,
  fetchImpl = fetch,
  redact = redactSecrets,
}) {
  const label = "Every Infisical secret sync reports succeeded";
  if (!clientId || !clientSecret || !projectId) {
    return result("infisical-syncs", label, SKIPPED, "INFISICAL_CLIENT_ID / _CLIENT_SECRET / INFISICAL_PROJECT_ID not set");
  }

  const loginResponse = await fetchImpl(
    "https://app.infisical.com/api/v1/auth/universal-auth/login",
    withTimeout({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, clientSecret }),
    }),
  );
  if (!loginResponse.ok) {
    // 401 here is the #696 signature. Say which of the two causes it is not,
    // because "invalid credentials" reads as revoked when it is usually the
    // wrong ID pasted in (identity ID vs Client ID).
    return result(
      "infisical-syncs",
      label,
      FAIL,
      `universal-auth login returned HTTP ${loginResponse.status}. The credential is present but ` +
        "rejected: revoked, rotated, expired, or INFISICAL_CLIENT_ID holds the identity ID " +
        "rather than the Universal Auth Client ID. See SECRETS_MANAGEMENT.md and #696.",
    );
  }
  const { accessToken } = await loginResponse.json();

  const syncResponse = await fetchImpl(
    `https://app.infisical.com/api/v1/secret-syncs?projectId=${encodeURIComponent(projectId)}`,
    withTimeout({ headers: { Authorization: `Bearer ${accessToken}` } }),
  );
  if (!syncResponse.ok) {
    return result("infisical-syncs", label, FAIL, `secret-syncs returned HTTP ${syncResponse.status}`);
  }
  const payload = await syncResponse.json();
  const syncs = payload?.secretSyncs ?? null;
  if (!Array.isArray(syncs)) {
    // Fail closed. An unrecognised shape must not read as "no failing syncs" —
    // that is precisely the silent-green this whole workflow exists to end.
    return result(
      "infisical-syncs",
      label,
      FAIL,
      "could not interpret the secret-syncs response; expected { secretSyncs: [...] }",
    );
  }
  if (syncs.length === 0) {
    return result(
      "infisical-syncs",
      label,
      FAIL,
      "no secret syncs returned — the project is expected to have several (SECRETS_MANAGEMENT.md §5)",
    );
  }

  // Infisical's SecretSyncStatus is exactly pending | running | succeeded |
  // failed, plus null for a sync that has never run (auto-sync off, or newly
  // created). Only `failed` means broken.
  //
  // Treating "not succeeded" as broken raised a P1 for two routine states: a
  // sync mid-window at 07:00, and the morning after Infisical's daily retry
  // sweep flips failed -> pending. A workflow whose own premise is that a muted
  // alert is worse than none must not cry wolf on a healthy store.
  const statusOf = (sync) => String(sync?.syncStatus ?? "").toLowerCase();
  const failedSyncs = syncs.filter((sync) => FAILING_SYNC_STATUSES.has(statusOf(sync)));
  const settled = syncs.filter((sync) => statusOf(sync) === "succeeded");

  if (failedSyncs.length > 0) {
    const names = failedSyncs.map(
      (s) =>
        `${s?.name ?? "unnamed"}=${s?.syncStatus}` +
        // lastSyncMessage carries the provider's actual error text — the thing
        // that says WHICH branch or scope broke.
        (s?.lastSyncMessage ? ` (${redact(String(s.lastSyncMessage))})` : ""),
    );
    return result("infisical-syncs", label, FAIL, `failing syncs: ${names.join(", ")}`);
  }
  if (settled.length === 0) {
    // Nothing has completed a sync, so there is no sync state to assert. That
    // is a skip, not a pass — and a skip cannot close an open alert.
    return result(
      "infisical-syncs",
      label,
      SKIPPED,
      `all ${syncs.length} syncs are pending/running/never-run — no settled sync state to assert`,
    );
  }
  const inFlight = syncs.length - settled.length;
  return result(
    "infisical-syncs",
    label,
    PASS,
    `${settled.length} succeeded, none failing` + (inFlight ? `, ${inFlight} pending/running` : ""),
  );
}

/**
 * Sign in as a seeded staging user and assert the decoded access token carries
 * a top-level `active_chapter_id`.
 *
 * The highest-value row: the only one that exercises behaviour rather than
 * configuration. It covers the whole chain at once — migration applied, grants
 * present, RLS policies intact, hook enabled and resolving.
 *
 * The trap, recorded in #838 and DB_PROMOTION_RUNBOOK.md:154 — a correctly
 * working hook returns a token with NO claim when the user resolves to no
 * chapter. So a claimless token is reported as a FAIL naming that cause, never
 * as a pass, and the seeded user must have exactly one membership.
 */
export async function checkAuthSignIn({
  supabaseUrl,
  anonKey,
  email,
  password,
  fetchImpl = fetch,
  decode = decodeJwtPayload,
}) {
  const label = "Staging sign-in yields a JWT carrying active_chapter_id";
  if (!email || !password) {
    return result(
      "auth-signin",
      label,
      SKIPPED,
      "STAGING_SMOKE_USER_EMAIL / STAGING_SMOKE_USER_PASSWORD not provisioned — see the [human] " +
        "issue linked from #838. The user must have exactly ONE chapter membership.",
    );
  }
  if (!supabaseUrl || !anonKey) {
    return result("auth-signin", label, SKIPPED, "SUPABASE_URL / SUPABASE_ANON_KEY not set");
  }

  const response = await fetchImpl(
    `${supabaseUrl}/auth/v1/token?grant_type=password`,
    withTimeout({
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: anonKey },
      body: JSON.stringify({ email, password }),
    }),
  );
  if (!response.ok) {
    return result("auth-signin", label, FAIL, `sign-in returned HTTP ${response.status}`);
  }
  const body = await response.json();
  const token = body?.access_token;
  if (!token) return result("auth-signin", label, FAIL, "sign-in succeeded but returned no access_token");

  const claims = decode(token);
  if (!claims) return result("auth-signin", label, FAIL, "access_token could not be decoded");
  if (!claims.active_chapter_id) {
    return result(
      "auth-signin",
      label,
      FAIL,
      "token carries no top-level active_chapter_id. Either the hook is disabled, or the smoke " +
        "user resolves to no chapter — a claimless token is what a correctly-working hook returns " +
        "for a user with no membership, so confirm the user has exactly one before blaming the hook.",
    );
  }
  return result("auth-signin", label, PASS, "active_chapter_id present");
}

/**
 * Schema drift — delegated to #833, deliberately not reimplemented here.
 *
 * #838 says: "Build #833 first as a standalone `npm run check:*` script, then
 * have this workflow call it alongside the other assertions. Do not reimplement
 * it here." #833 is a separate unit of work. Until it lands, this reports
 * SKIPPED naming the issue; when it lands, the row lights up with no change to
 * this file.
 */
export async function checkSchemaDrift({
  scriptPath = join(REPO_ROOT, "scripts", "check-schema-drift.mjs"),
  exists = existsSync,
  run = (path) => execFileSync(process.execPath, [path], { encoding: "utf8", stdio: "pipe" }),
  redact = redactSecrets,
} = {}) {
  const label = "Applied migrations match supabase/migrations/";
  if (!exists(scriptPath)) {
    return result(
      "schema-drift",
      label,
      SKIPPED,
      `not wired yet — expects #833 to provide ${scriptPath.replace(REPO_ROOT + "/", "")}, ` +
        "runnable with no arguments and targeting staging",
    );
  }
  try {
    run(scriptPath);
    return result("schema-drift", label, PASS, "check-schema-drift.mjs reported no drift");
  } catch (error) {
    // Both streams, concatenated. `stdout || stderr` short-circuited, so any
    // progress chatter on stdout suppressed the stderr line that actually
    // names the drift — losing the diagnostic in the alert AND (with
    // stdio: "pipe") from the run log.
    const raw = [error?.stdout, error?.stderr, error?.message]
      .filter(Boolean)
      .map(String)
      .join("\n")
      .trim();
    // Scrubbed: this text is written verbatim into a GitHub issue body, and
    // the delegated script inherits the full staging secret store.
    const detail = redact(raw).split("\n").slice(-3).join(" ").trim();
    return result(
      "schema-drift",
      label,
      FAIL,
      detail || "check-schema-drift.mjs exited non-zero",
    );
  }
}

// ── Reporting ───────────────────────────────────────────────────────────────

/**
 * Pure classifier. Any FAIL reds the run; SKIPPED never does.
 *
 * The third outcome is the important one. If nothing failed but nothing passed
 * either — every assertion skipped because its credential vanished — that is
 * NOT health, and it must never close an open alert. `deploy-alert.mjs` draws
 * the same line for the same reason: a run that proved nothing is not evidence
 * of recovery, and treating it as one silences a live outage. This is the
 * silent-green failure mode the whole workflow exists to end, so it would be
 * particularly bad to reintroduce it here.
 */
export function classifyConformance(results) {
  const failed = results.filter((r) => r.status === FAIL);
  const skipped = results.filter((r) => r.status === SKIPPED);
  const passed = results.filter((r) => r.status === PASS);
  let outcome = "healthy";
  if (failed.length > 0) outcome = "failed";
  else if (passed.length === 0) outcome = "inconclusive";
  return { outcome, failed, skipped, passed };
}

/**
 * May a clean-looking run close this open alert?
 *
 * Only if every assertion the alert was raised for is now actually PASSing.
 * Aggregate counts are not enough: an alert raised by `auth-hook` would
 * otherwise close on a run where `auth-hook` merely SKIPPED — its credential
 * deleted or renamed — while unrelated checks passed. Deleting a secret would
 * resolve the alert and staging would go unwatched.
 *
 * An alert with no parseable marker (hand-filed, or written by an older
 * version) falls back to "close it", matching the previous behaviour rather
 * than stranding an issue nobody can clear.
 */
export function canResolveAlert({ results, failingIds }) {
  if (!failingIds || failingIds.length === 0) return true;
  const passing = new Set(
    results.filter((r) => r.status === PASS).map((r) => r.id),
  );
  return failingIds.every((id) => passing.has(id));
}

const ICON = { [PASS]: "✅", [FAIL]: "❌", [SKIPPED]: "⏭️" };

export function buildRunSummary({ outcome, results, runUrl }) {
  const { failed, skipped, passed } = classifyConformance(results);
  const headline = {
    failed: `**frapp-staging has drifted** — ${failed.length} of ${results.length} assertions failed.`,
    healthy: `**frapp-staging is conformant** — ${passed.length} of ${results.length} assertions passed.`,
    inconclusive:
      `**Inconclusive — nothing was asserted.** All ${results.length} assertions skipped, so this run ` +
      "proves nothing about staging. Any open alert is left open deliberately.",
    "unproven-recovery":
      `**Nothing failed, but the open alert is not cleared.** ${passed.length} of ${results.length} ` +
      "assertions passed; the ones this alert was raised for could not be asserted, so closing it " +
      "would report a recovery nobody proved.",
  }[outcome] ??
    `**frapp-staging is conformant** — ${passed.length} of ${results.length} assertions passed.`;
  const lines = [
    "## Staging conformance",
    "",
    headline,
    "",
    "| | Assertion | Detail |",
    "| --- | --- | --- |",
    ...results.map((r) => `| ${ICON[r.status]} ${r.status.toUpperCase()} | ${r.label} | ${r.detail} |`),
  ];
  if (skipped.length > 0) {
    lines.push(
      "",
      `⏭️ **${skipped.length} assertion(s) could not run.** A skipped check is not a passing check — ` +
        "it is reported separately on purpose, because silence is the failure mode this workflow exists to end.",
    );
  }
  if (runUrl) lines.push("", `- Run: ${runUrl}`);
  return lines.join("\n");
}

export function buildAlertIssueBody({ results, runUrl }) {
  const { failed } = classifyConformance(results);
  const lines = [
    "## Staging conformance is failing",
    "",
    "This issue is **opened and closed automatically** by `.github/workflows/staging-conformance.yml`",
    "(`scripts/ci/staging-conformance.mjs`). While it is open, `frapp-staging` has drifted from the",
    "state the repository expects. It closes itself on the next clean scheduled run.",
    "",
    "Do not claim this issue as backlog work — it carries `routine-state` and tracks live state, not a",
    "unit of work. Fix the underlying drift and it resolves on its own.",
    "",
    "### Failing assertions",
    "",
    ...failed.map((r) => `- **${r.label}** — ${r.detail}`),
    "",
    "### Why this workflow exists",
    "",
    "Every other check in this repo is push-triggered, so environment drift was invisible until",
    "someone happened to push: staging sat 38 migrations behind with all checks green, the Infisical",
    "credential was dead for 71 days (#696/#763), and `custom_access_token_hook` was never enabled",
    "after #643 shipped (#805). See #838.",
    "",
    "### Recovery state",
    "",
    "This alert closes only when the assertions listed below pass again — not merely when nothing",
    "fails, since an assertion that stops being *runnable* would otherwise read as a recovery.",
    "",
    // Machine-readable and deliberately visible: HTML comments do not survive
    // the GitHub MCP round-trip that agents read issues through (#800).
    `\`${FAILING_MARKER} ${failed.map((r) => r.id).join(",")}\``,
  ];
  // Only the optional trailing run link is conditional. A blanket
  // `.filter(line => line !== "")` stripped every intentional blank line and
  // collapsed the whole body into one paragraph — burying the "do not claim
  // this issue" warning that stops agents picking the alert up as backlog.
  if (runUrl) lines.push("", `- Run: ${runUrl}`);
  return lines.join("\n");
}

export function buildAlertCommentBody({ results, runUrl, reopened }) {
  const { failed } = classifyConformance(results);
  const lines = [
    reopened ? "**Staging conformance is failing again** — reopening." : "**Staging conformance failed again.**",
    "",
    ...failed.map((r) => `- **${r.label}** — ${r.detail}`),
  ];
  if (runUrl) lines.push("", `- Run: ${runUrl}`);
  lines.push("", "_Posted automatically by `scripts/ci/staging-conformance.mjs`. Closes itself on the next clean run._");
  return lines.join("\n");
}

export function buildRecoveryCommentBody({ results, runUrl }) {
  const { passed, skipped } = classifyConformance(results);
  const lines = [
    "**Staging conformance recovered.** Closing.",
    "",
    `${passed.length} assertion(s) passed${skipped.length > 0 ? `, ${skipped.length} skipped` : ""}.`,
  ];
  if (runUrl) lines.push("", `- Run: ${runUrl}`);
  lines.push("", "_Closed automatically by `scripts/ci/staging-conformance.mjs` after a clean run._");
  return lines.join("\n");
}

// ── Orchestration ───────────────────────────────────────────────────────────

function defaultWriteSummary(summary) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (path) appendFileSync(path, `${summary}\n`);
}

/**
 * Runs every assertion, reports, and upserts/resolves the alert issue.
 *
 * Assertions are run through a try/catch each: one provider throwing (DNS blip,
 * TLS error) must not prevent the other four from reporting. A thrown assertion
 * is a FAIL, not a skip — we could not prove the property held.
 */
export async function runStagingConformance({
  token,
  repo,
  env = process.env,
  fetchImpl = fetch,
  checks,
  writeSummary = defaultWriteSummary,
  logger = console,
  runUrl = env.RUN_URL ?? "",
}) {
  // Labelled, not anonymous thunks. When a check throws, the catch below needs
  // to say WHICH provider blew up — an alert whose whole body reads
  // "assertion threw — fetch failed" names nothing, which is the opposite of
  // this script's purpose.
  const toRun = checks ?? [
    { id: "project-status", label: "Supabase project is ACTIVE_HEALTHY", run: () =>
      checkProjectStatus({
        accessToken: env.SUPABASE_ACCESS_TOKEN,
        projectRef: env.SUPABASE_PROJECT_REF,
        fetchImpl,
      }) },
    { id: "auth-hook", label: "custom_access_token_hook is enabled", run: () =>
      checkAuthHook({
        accessToken: env.SUPABASE_ACCESS_TOKEN,
        projectRef: env.SUPABASE_PROJECT_REF,
        fetchImpl,
      }) },
    { id: "infisical-syncs", label: "Every Infisical secret sync reports succeeded", run: () =>
      checkInfisicalSyncs({
        clientId: env.INFISICAL_CLIENT_ID,
        clientSecret: env.INFISICAL_CLIENT_SECRET,
        // `||`, not `??`: GitHub renders an unset secret as "", which `??`
        // would keep, silently defeating the .infisical.json fallback and
        // downgrading this assertion to SKIPPED.
        projectId: env.INFISICAL_PROJECT_ID || readWorkspaceId(),
        fetchImpl,
      }) },
    { id: "schema-drift", label: "Applied migrations match supabase/migrations/", run: () =>
      checkSchemaDrift() },
    { id: "auth-signin", label: "Staging sign-in yields a JWT carrying active_chapter_id", run: () =>
      checkAuthSignIn({
        supabaseUrl: env.SUPABASE_URL,
        anonKey: env.SUPABASE_ANON_KEY,
        email: env.STAGING_SMOKE_USER_EMAIL,
        password: env.STAGING_SMOKE_USER_PASSWORD,
        fetchImpl,
      }) },
  ];

  const results = [];
  for (const check of toRun) {
    // Accepts a bare thunk too, so tests can pass plain functions.
    const run = typeof check === "function" ? check : check.run;
    const id = typeof check === "function" ? "unknown" : check.id;
    const label = typeof check === "function" ? "assertion threw" : check.label;
    try {
      results.push(await run());
    } catch (error) {
      // undici puts the real reason (ENOTFOUND, ECONNRESET) on `cause`; the
      // message alone is just "fetch failed".
      const reason = [error?.message ?? String(error), error?.cause?.message]
        .filter(Boolean)
        .join(": ");
      results.push(result(id, label, FAIL, `assertion threw — ${redactSecrets(reason)}`));
    }
  }

  const { outcome, failed, skipped } = classifyConformance(results);

  // Annotations surface at the top of the run page. `::error::` here only
  // annotates — the exit code below is what reds the run.
  for (const r of failed) logger.log?.(`::error::${r.label} — ${r.detail}`);
  for (const r of skipped) logger.log?.(`::warning::SKIPPED ${r.label} — ${r.detail}`);

  if (outcome === "failed") {
    writeSummary(buildRunSummary({ outcome, results, runUrl }));
    const alert = await raiseAlert({
      token,
      repo,
      fetchImpl,
      title: ALERT_ISSUE_TITLE,
      labels: ALERT_ISSUE_LABELS,
      lookupLabel: ALERT_ISSUE_LOOKUP_LABEL,
      buildIssueBody: () => buildAlertIssueBody({ results, runUrl }),
      buildCommentBody: ({ reopened }) => buildAlertCommentBody({ results, runUrl, reopened }),
      // The body carries the failing-assertion marker that gates recovery, so
      // it must track the CURRENT failure set, not the first one ever seen.
      refreshBodyOnRaise: true,
    });
    logger.log?.(
      alert.action === "failed"
        ? "[staging-conformance] could not write the alert issue"
        : `[staging-conformance] alert issue #${alert.issueNumber} ${alert.action}`,
    );
    return { outcome, results, alert };
  }

  if (outcome === "inconclusive") {
    writeSummary(buildRunSummary({ outcome, results, runUrl }));
    // Nothing was asserted, so nothing was proved. Deliberately does NOT close
    // an open alert — see classifyConformance.
    logger.log?.(
      "::warning::Staging conformance asserted nothing — every check skipped. " +
        "Any open alert is left open.",
    );
    return { outcome, results, alert: { action: "none", closed: [] } };
  }

  // Recovery is gated on the assertions the OPEN alert names, not on this
  // run's pass count. Read them before deciding to close.
  const openAlerts = (
    await findAlertIssues({
      token,
      repo,
      fetchImpl,
      title: ALERT_ISSUE_TITLE,
      lookupLabel: ALERT_ISSUE_LOOKUP_LABEL,
    })
  ).filter((issue) => issue.state === "open");

  const failingIds = openAlerts.flatMap((issue) => parseFailingIds(issue.body));
  if (openAlerts.length > 0 && !canResolveAlert({ results, failingIds })) {
    const unresolved = failingIds.filter(
      (id) => !results.some((r) => r.id === id && r.status === PASS),
    );
    // Summary written here, with the real outcome — a run that leaves the
    // alert open must not print "conformant" at the top of the page.
    writeSummary(buildRunSummary({ outcome: "unproven-recovery", results, runUrl }));
    logger.log?.(
      `::warning::Nothing failed, but ${unresolved.join(", ")} could not be asserted — ` +
        "leaving the alert open.",
    );
    return {
      outcome: "unproven-recovery",
      results,
      alert: { action: "none", closed: [] },
    };
  }

  writeSummary(buildRunSummary({ outcome, results, runUrl }));
  const alert = await resolveAlert({
    token,
    repo,
    fetchImpl,
    title: ALERT_ISSUE_TITLE,
    lookupLabel: ALERT_ISSUE_LOOKUP_LABEL,
    buildRecoveryBody: () => buildRecoveryCommentBody({ results, runUrl }),
  });
  if (alert.action === "closed") {
    logger.log?.(`[staging-conformance] closed alert issue(s): ${alert.closed.join(", ")}`);
  }
  return { outcome, results, alert };
}

/** Base64url JWT payload decode. Returns null on anything malformed. */
export function decodeJwtPayload(token) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
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
  const { outcome } = await runStagingConformance({ token, repo });
  // Unlike deploy-alert (a watchdog over an already-red job), this script IS
  // the check, so a drifted environment must red the run.
  if (outcome === "failed") process.exit(1);
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`Unhandled error: ${error.stack ?? error.message}`);
    process.exit(1);
  });
}
