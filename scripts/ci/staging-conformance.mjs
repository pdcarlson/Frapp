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
//   * vercel-landing-staging / vercel-web-staging syncs failed for their entire
//     existence and only surfaced when a new secret forced a write (#834).
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

import { raiseAlert, resolveAlert } from "./lib/alert-issue.mjs";

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

const result = (id, label, status, detail) => ({ id, label, status, detail });

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
  const response = await fetchImpl(`https://api.supabase.com/v1/projects/${projectRef}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
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
    { headers: { Authorization: `Bearer ${accessToken}` } },
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
}) {
  const label = "Every Infisical secret sync reports succeeded";
  if (!clientId || !clientSecret || !projectId) {
    return result("infisical-syncs", label, SKIPPED, "INFISICAL_CLIENT_ID / _CLIENT_SECRET / INFISICAL_PROJECT_ID not set");
  }

  const loginResponse = await fetchImpl(
    "https://app.infisical.com/api/v1/auth/universal-auth/login",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, clientSecret }),
    },
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
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!syncResponse.ok) {
    return result("infisical-syncs", label, FAIL, `secret-syncs returned HTTP ${syncResponse.status}`);
  }
  const payload = await syncResponse.json();
  const syncs = Array.isArray(payload) ? payload : (payload?.secretSyncs ?? null);
  if (!Array.isArray(syncs)) {
    // Fail closed. An unrecognised shape must not read as "no failing syncs" —
    // that is precisely the silent-green this whole workflow exists to end.
    return result(
      "infisical-syncs",
      label,
      FAIL,
      "could not interpret the secret-syncs response; expected an array or { secretSyncs: [...] }",
    );
  }
  if (syncs.length === 0) {
    return result("infisical-syncs", label, FAIL, "no secret syncs returned — expected 6 (see SECRETS_MANAGEMENT.md §5)");
  }

  const broken = syncs.filter((sync) => {
    const status = String(sync?.syncStatus ?? sync?.status ?? "").toLowerCase();
    return status !== "succeeded" && status !== "success" && status !== "synced";
  });
  if (broken.length > 0) {
    const names = broken.map((s) => `${s?.name ?? "unnamed"}=${s?.syncStatus ?? s?.status ?? "unknown"}`);
    return result("infisical-syncs", label, FAIL, `failing syncs: ${names.join(", ")}`);
  }
  return result("infisical-syncs", label, PASS, `${syncs.length} syncs succeeded`);
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

  const response = await fetchImpl(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: anonKey },
    body: JSON.stringify({ email, password }),
  });
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
} = {}) {
  const label = "Applied migrations match supabase/migrations/";
  if (!exists(scriptPath)) {
    return result("schema-drift", label, SKIPPED, "not wired yet — provided by #833, which is not merged");
  }
  try {
    run(scriptPath);
    return result("schema-drift", label, PASS, "check-schema-drift.mjs reported no drift");
  } catch (error) {
    const detail = (error?.stdout || error?.stderr || error?.message || "").toString().trim();
    return result("schema-drift", label, FAIL, detail.split("\n").slice(-3).join(" ") || "check-schema-drift.mjs exited non-zero");
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

const ICON = { [PASS]: "✅", [FAIL]: "❌", [SKIPPED]: "⏭️" };

export function buildRunSummary({ outcome, results, runUrl }) {
  const { failed, skipped, passed } = classifyConformance(results);
  const headline = {
    failed: `**frapp-staging has drifted** — ${failed.length} of ${results.length} assertions failed.`,
    healthy: `**frapp-staging is conformant** — ${passed.length} of ${results.length} assertions passed.`,
    inconclusive:
      `**Inconclusive — nothing was asserted.** All ${results.length} assertions skipped, so this run ` +
      "proves nothing about staging. Any open alert is left open deliberately.",
  }[outcome];
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
  return [
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
    runUrl ? `\n- Run: ${runUrl}` : "",
  ]
    .filter((line) => line !== "")
    .join("\n");
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
  const toRun = checks ?? [
    () => checkProjectStatus({
      accessToken: env.SUPABASE_ACCESS_TOKEN,
      projectRef: env.SUPABASE_PROJECT_REF,
      fetchImpl,
    }),
    () => checkAuthHook({
      accessToken: env.SUPABASE_ACCESS_TOKEN,
      projectRef: env.SUPABASE_PROJECT_REF,
      fetchImpl,
    }),
    () => checkInfisicalSyncs({
      clientId: env.INFISICAL_CLIENT_ID,
      clientSecret: env.INFISICAL_CLIENT_SECRET,
      projectId: env.INFISICAL_PROJECT_ID ?? readWorkspaceId(),
      fetchImpl,
    }),
    () => checkSchemaDrift(),
    () => checkAuthSignIn({
      supabaseUrl: env.SUPABASE_URL,
      anonKey: env.SUPABASE_ANON_KEY,
      email: env.STAGING_SMOKE_USER_EMAIL,
      password: env.STAGING_SMOKE_USER_PASSWORD,
      fetchImpl,
    }),
  ];

  const results = [];
  for (const check of toRun) {
    try {
      results.push(await check());
    } catch (error) {
      results.push(
        result("unknown", "assertion threw", FAIL, `${error?.message ?? error}`),
      );
    }
  }

  const { outcome, failed, skipped } = classifyConformance(results);
  writeSummary(buildRunSummary({ outcome, results, runUrl }));

  // Annotations surface at the top of the run page. `::error::` here only
  // annotates — the exit code below is what reds the run.
  for (const r of failed) logger.log?.(`::error::${r.label} — ${r.detail}`);
  for (const r of skipped) logger.log?.(`::warning::SKIPPED ${r.label} — ${r.detail}`);

  if (outcome === "failed") {
    const alert = await raiseAlert({
      token,
      repo,
      fetchImpl,
      title: ALERT_ISSUE_TITLE,
      labels: ALERT_ISSUE_LABELS,
      lookupLabel: ALERT_ISSUE_LOOKUP_LABEL,
      buildIssueBody: () => buildAlertIssueBody({ results, runUrl }),
      buildCommentBody: ({ reopened }) => buildAlertCommentBody({ results, runUrl, reopened }),
    });
    logger.log?.(
      alert.action === "failed"
        ? "[staging-conformance] could not write the alert issue"
        : `[staging-conformance] alert issue #${alert.issueNumber} ${alert.action}`,
    );
    return { outcome, results, alert };
  }

  if (outcome === "inconclusive") {
    // Nothing was asserted, so nothing was proved. Deliberately does NOT close
    // an open alert — see classifyConformance.
    logger.log?.(
      "::warning::Staging conformance asserted nothing — every check skipped. " +
        "Any open alert is left open.",
    );
    return { outcome, results, alert: { action: "none", closed: [] } };
  }

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
