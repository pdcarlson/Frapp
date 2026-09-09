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
//     with nothing reporting it. (See SECRETS_MANAGEMENT.md §5 before drawing
//     conclusions: `frapp-web` was read directly on 2026-08-12 and does hold
//     the backend store; `frapp-landing` was never inspected variable-by-
//     variable, so its contents remain inferred. The doc records "staging got
//     nothing, so it was accidentally protective" as a misreading not to
//     repeat.)
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
//   RENDER_API_KEY             — optional; enables the Render healthCheckPath assertion
//   RENDER_SERVICE_ID          — frapp-api-staging service id (same as verify-deployments.yml)
//   RUN_URL                     — html_url of this run, for the alert body

import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { findAlertIssuesDetailed, raiseAlert, resolveAlert } from "./lib/alert-issue.mjs";
import { ghRequest } from "./lib/github.mjs";
import { requireEnv } from "./lib/env.mjs";
import {
  EXPECTED_HEALTH_CHECK_PATH,
  readHealthCheckPath,
} from "./lib/render-health-check-path.mjs";

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
 * A property this workflow deliberately does not check, because another
 * watchdog owns it end to end.
 *
 * Distinct from SKIPPED on purpose. SKIPPED means "should be asserted here and
 * could not be", and it is rendered loudly so nobody mistakes it for health.
 * A permanent delegation rendered that way would fire that warning every day
 * forever, and a signal that is always on is one nobody reads — so the day a
 * real assertion degrades to SKIPPED it would look like the usual noise. That
 * is the alert fatigue this file exists to prevent, so DELEGATED is reported
 * as an inventory line and counted separately.
 */
export const DELEGATED = "delegated";

/**
 * Sync states that mean "this sync is broken right now".
 *
 * Infisical's `SecretSyncStatus` enum is `pending | running | succeeded |
 * failed` (plus `null` before a sync has ever run). That was read from the
 * open-source backend's `secret-sync-types.ts`, NOT observed against the live
 * API — no call has been made from this branch. The classifier is written so
 * that an unrecognised status skips rather than passes, which is what keeps a
 * wrong enum from becoming a silent green.
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
 * Scrubs provider-supplied text — Infisical sync messages, thrown-assertion
 * reasons — before it can reach an alert issue body. The job injects the whole
 * staging store (`secret-path: "/"`, `include-imports: true`), and GitHub's log
 * masking does NOT apply to issue bodies written via the REST API.
 *
 * Know what this does and does not cover. It masks (a) values of env vars whose
 * NAME matches the pattern below and are at least 8 characters, and (b)
 * `//user:password@` credentials in a URL. It is therefore **name-driven, not
 * content-driven**: a secret whose variable name matches none of those words
 * passes through verbatim. This is a reduction in blast radius, not a
 * guarantee — the durable rule is that nothing this script reports should be
 * carrying credentials in the first place.
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
      /KEY|SECRET|TOKEN|PASSWORD|DSN|HOOK_URL|WEBHOOK|CREDENTIAL/i.test(name))
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
 * Render `frapp-api-staging` `serviceDetails.healthCheckPath` is `/health`.
 *
 * Staging auto-deploys `main` on commit, so this path is the only HTTP gate on
 * those deploys. Empty is a TCP socket check (documented 2026-09-06).
 * `/health/ready` would cancel a deploy when a dependency is degraded.
 * Production's copy of this assertion lives in production-guardrails.mjs —
 * do not fold production auto-deploy into this suite (alert title is the
 * lookup key). Staging auto-deploy *on* is this suite: `checkRenderAutoDeploy`.
 */
export async function checkRenderHealthCheckPath({
  apiKey,
  serviceId,
  fetchImpl = fetch,
  serviceLabel = "frapp-api-staging",
} = {}) {
  const id = "health-check-path";
  const label = `${serviceLabel} healthCheckPath is /health`;
  if (!apiKey || !serviceId) {
    return result(id, label, SKIPPED, "RENDER_API_KEY / RENDER_SERVICE_ID not set");
  }
  const response = await fetchImpl(
    `https://api.render.com/v1/services/${serviceId}`,
    withTimeout({ headers: { Authorization: `Bearer ${apiKey}` } }),
  );
  if (!response.ok) {
    return result(id, label, FAIL, `Render API returned HTTP ${response.status}`);
  }
  const service = await response.json();
  const path = readHealthCheckPath(service);
  if (path === EXPECTED_HEALTH_CHECK_PATH) {
    return result(id, label, PASS, `healthCheckPath=${path}`);
  }
  if (path === "") {
    return result(
      id,
      label,
      FAIL,
      `healthCheckPath is empty (TCP-only probe on the open port; expected ${EXPECTED_HEALTH_CHECK_PATH})`,
    );
  }
  if (typeof path === "string") {
    return result(
      id,
      label,
      FAIL,
      `healthCheckPath='${path}' (expected ${EXPECTED_HEALTH_CHECK_PATH}; /health/ready would cancel a deploy when a dependency is degraded)`,
    );
  }
  return result(
    id,
    label,
    FAIL,
    `healthCheckPath is unreadable (expected ${EXPECTED_HEALTH_CHECK_PATH} on serviceDetails)`,
  );
}

/**
 * Render `frapp-api-staging` auto-deploys `main`.
 *
 * Staging is the only host that can prove Magic Link, invite, and join
 * without a production Deploy. `autoDeploy: "no"` (or a branch other than
 * `main`) freezes that host while this job keeps reading yesterday's
 * settings and staying green. Live GET `/v1/services/{id}` puts
 * `autoDeploy` and `branch` on the service root (2026-09-09), not under
 * `serviceDetails` — a nested decoy is not the live field.
 *
 * Production-guardrails asserts the inverse (`autoDeploy: "no"`) under a
 * different alert title. Do not copy that expected value here.
 */
export async function checkRenderAutoDeploy({
  apiKey,
  serviceId,
  fetchImpl = fetch,
  serviceLabel = "frapp-api-staging",
} = {}) {
  const id = "render-auto-deploy";
  const label = `${serviceLabel} auto-deploys main`;
  if (!apiKey || !serviceId) {
    return result(id, label, SKIPPED, "RENDER_API_KEY / RENDER_SERVICE_ID not set");
  }
  const response = await fetchImpl(
    `https://api.render.com/v1/services/${serviceId}`,
    withTimeout({ headers: { Authorization: `Bearer ${apiKey}` } }),
  );
  if (!response.ok) {
    return result(id, label, FAIL, `Render API returned HTTP ${response.status}`);
  }
  const service = await response.json();
  const autoDeploy = service?.autoDeploy;
  const branch = service?.branch;
  const findings = [];
  if (autoDeploy !== "yes") {
    findings.push(
      `autoDeploy='${autoDeploy ?? "unreadable"}' (expected 'yes'). ` +
        `With auto-deploy off, merges to main never reach staging and first-user ` +
        `rehearsal runs against a frozen host.`,
    );
  }
  if (branch !== "main") {
    findings.push(
      `branch='${branch ?? "unreadable"}' (expected 'main'). ` +
        `A service pointed at another branch never receives the commits this job watches main for.`,
    );
  }
  if (findings.length === 0) {
    return result(id, label, PASS, `autoDeploy=${autoDeploy} branch=${branch}`);
  }
  return result(id, label, FAIL, findings.join(" "));
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
 * The redirect allow list covers every URL the clients ask GoTrue to send a
 * member back to.
 *
 * GoTrue matches an allow-list entry as a glob, and a bare origin is a glob
 * that matches only itself: `https://app.frapp.live` admits exactly that
 * string, not `https://app.frapp.live/chat`. Every web `emailRedirectTo` is
 * `${origin}${redirectTo}` — `/chat` by default, `/join?token=…` from an
 * invite — so with only the bare origin listed, GoTrue silently swapped each of
 * those for the Site URL: the magic link still signed the member in, but at
 * `/`, and a sign-up made from an invite link arrived without its token. Both
 * hosted projects were in that state until 2026-09-06 (verified with
 * `GET /auth/v1/verify?…&redirect_to=<url>`, which redirects to `redirect_to`
 * when it is allowed and to the Site URL when it is not). The mobile app needs
 * `frapp://**` for the same reason (its callback is `frapp:///`). Both are
 * dashboard settings no migration performs, so like the hook above they can
 * revert, or be forgotten on a new project, while every workflow stays green.
 *
 * Read-only: the same GET `checkAuthHook` makes.
 *
 * `expectedSiteUrl` (optional): when set, `site_url` must equal that origin
 * (trailing slash ignored). Without this, a production project whose Site URL
 * is the staging origin can still PASS if its allow list holds matching
 * staging wildcards.
 */
export async function checkAuthRedirects({
  accessToken,
  projectRef,
  fetchImpl = fetch,
  expectedSiteUrl,
} = {}) {
  const label = "Redirect allow list covers the web app's paths and the mobile scheme";
  if (!accessToken || !projectRef) {
    return result("auth-redirects", label, SKIPPED, "SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF not set");
  }
  const response = await fetchImpl(
    `https://api.supabase.com/v1/projects/${projectRef}/config/auth`,
    withTimeout({ headers: { Authorization: `Bearer ${accessToken}` } }),
  );
  if (!response.ok) {
    return result("auth-redirects", label, FAIL, `Management API returned HTTP ${response.status}`);
  }
  const data = await response.json();
  const siteUrl = typeof data?.site_url === "string" ? data.site_url.replace(/\/+$/, "") : "";
  if (!siteUrl) {
    return result("auth-redirects", label, FAIL, "site_url is not set");
  }
  // Optional pin: a production project whose Site URL is the staging origin
  // can still hold matching wildcards for that staging origin, so matching
  // the allow list against whatever `site_url` happens to be is not enough.
  if (typeof expectedSiteUrl === "string" && expectedSiteUrl.trim()) {
    const expected = expectedSiteUrl.replace(/\/+$/, "");
    if (siteUrl !== expected) {
      return result(
        "auth-redirects",
        label,
        FAIL,
        `site_url is "${siteUrl}", expected "${expected}" — GoTrue would send members to the wrong host.`,
      );
    }
  }
  const allowed = String(data?.uri_allow_list ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const required = [`${siteUrl}/**`, "frapp://**"];
  const missing = required.filter((entry) => !allowed.includes(entry));
  if (missing.length > 0) {
    return result(
      "auth-redirects",
      label,
      FAIL,
      `uri_allow_list is missing ${missing.map((m) => `"${m}"`).join(" and ")} — a bare origin ` +
        "matches only itself, so GoTrue is dropping the web emailRedirectTo paths (and any invite " +
        "token in them) onto the Site URL. See docs/internal/ops/DEPLOYMENT.md § Auth settings.",
    );
  }
  return result("auth-redirects", label, PASS, `site_url=${siteUrl}; ${required.join(", ")} present`);
}

/**
 * Custom SMTP is on and the send cap is above the hosted 2/hour limit.
 *
 * Staging Auth SMTP is proven (Resend, From `no-reply@mail.staging.frapp.live`, 300/hour).
 * Those are dashboard settings no migration performs. If they revert, magic
 * link / confirm-signup / recovery fall back to the hosted mailer and the
 * third member in an hour gets "email rate limit exceeded" — the production
 * first-user gate, on the only host Paul can prove mail before flipping prod.
 * Same GET `checkAuthHook` makes. Never put `smtp_pass` in the detail string.
 *
 * `expectedAdminEmail` is the From this check requires (staging vs production
 * differ). `whenUnset`:
 * - `"fail"` (default, staging): empty `smtp_host` is a FAIL. Staging SMTP
 *   is already on; unset is a regression.
 * - `"skip"` (production until #1824): empty `smtp_host` is SKIPPED so the
 *   07:45 watchdog stays green on the hosted 2/hour cap. The moment SMTP is
 *   on, the same check FAILs a burned apex From.
 */
export const AUTH_SMTP_HOST = "smtp.resend.com";
export const AUTH_SMTP_ADMIN_EMAIL = "no-reply@mail.staging.frapp.live";
export const AUTH_SMTP_SENDER_NAME = "Signet";
export const AUTH_EMAIL_SENT_PER_HOUR_MIN = 300;

/**
 * GoTrue's `rate_limit_email_sent` is emails per hour when it is a number
 * (legacy), or `count/duration` (`300/1h`, `10/30m`) when it is a string.
 * Returns null when the value cannot be parsed.
 */
export function emailsPerHourFromRateLimit(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  const raw = String(value).trim();
  const match = raw.match(/^(\d+(?:\.\d+)?)(?:\/(\d+)(h|m|s))?$/i);
  if (!match) return null;
  const count = Number(match[1]);
  if (!Number.isFinite(count) || count < 0) return null;
  if (!match[2]) return count;
  const quantity = Number(match[2]);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  const unit = match[3].toLowerCase();
  const hours = unit === "h" ? quantity : unit === "m" ? quantity / 60 : quantity / 3600;
  return count / hours;
}

export async function checkAuthSmtp({
  accessToken,
  projectRef,
  fetchImpl = fetch,
  expectedAdminEmail = AUTH_SMTP_ADMIN_EMAIL,
  whenUnset = "fail",
} = {}) {
  const label =
    "Custom SMTP is Resend, the sender is Signet, and the send cap is at least 300/hour";
  const expectedFrom =
    typeof expectedAdminEmail === "string" && expectedAdminEmail.trim()
      ? expectedAdminEmail.trim().toLowerCase()
      : AUTH_SMTP_ADMIN_EMAIL;
  if (!accessToken || !projectRef) {
    return result("auth-smtp", label, SKIPPED, "SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF not set");
  }
  const response = await fetchImpl(
    `https://api.supabase.com/v1/projects/${projectRef}/config/auth`,
    withTimeout({ headers: { Authorization: `Bearer ${accessToken}` } }),
  );
  if (!response.ok) {
    return result("auth-smtp", label, FAIL, `Management API returned HTTP ${response.status}`);
  }
  const data = await response.json();
  const host = typeof data?.smtp_host === "string" ? data.smtp_host.trim().toLowerCase() : "";
  if (!host) {
    if (whenUnset === "skip") {
      return result(
        "auth-smtp",
        label,
        SKIPPED,
        `smtp_host is empty (hosted 2/hour cap). Skip until SMTP is on. Once on, this check fails unless smtp_sender_name=${AUTH_SMTP_SENDER_NAME} and smtp_admin_email=${expectedFrom}. See #1824.`,
      );
    }
    return result(
      "auth-smtp",
      label,
      FAIL,
      "smtp_host is empty — Auth is on the hosted mailer (2 messages/hour). See #1824.",
    );
  }
  if (host !== AUTH_SMTP_HOST) {
    return result("auth-smtp", label, FAIL, `smtp_host is "${host}", expected ${AUTH_SMTP_HOST}`);
  }
  const adminEmail =
    typeof data?.smtp_admin_email === "string" ? data.smtp_admin_email.trim().toLowerCase() : "";
  if (adminEmail !== expectedFrom) {
    return result(
      "auth-smtp",
      label,
      FAIL,
      `smtp_admin_email is "${adminEmail || "(empty)"}", expected ${expectedFrom}`,
    );
  }
  const senderName =
    typeof data?.smtp_sender_name === "string" ? data.smtp_sender_name.trim() : "";
  if (senderName !== AUTH_SMTP_SENDER_NAME) {
    return result(
      "auth-smtp",
      label,
      FAIL,
      `smtp_sender_name is "${senderName || "(empty)"}", expected ${AUTH_SMTP_SENDER_NAME}`,
    );
  }
  const perHour = emailsPerHourFromRateLimit(data?.rate_limit_email_sent);
  if (perHour == null) {
    return result(
      "auth-smtp",
      label,
      FAIL,
      `rate_limit_email_sent is unreadable (${JSON.stringify(data?.rate_limit_email_sent)})`,
    );
  }
  if (perHour < AUTH_EMAIL_SENT_PER_HOUR_MIN) {
    return result(
      "auth-smtp",
      label,
      FAIL,
      `rate_limit_email_sent is ${perHour}/hour; need at least ${AUTH_EMAIL_SENT_PER_HOUR_MIN}/hour ` +
        "(the hosted cap is 2/hour even after SMTP is on until this is raised). See #1824.",
    );
  }
  return result(
    "auth-smtp",
    label,
    PASS,
    `host=${host}; from=${adminEmail}; sender=${senderName}; rate_limit_email_sent=${perHour}/hour`,
  );
}

export const AUTH_MAGIC_LINK_SUBJECT = "Sign in to Signet";

/**
 * Magic Link template stays on the app host via `token_hash`.
 *
 * The hosted default href is `{{ .ConfirmationURL }}` → `*.supabase.co/auth/v1/verify`.
 * That From/link-domain mismatch is the leftover all-users spam shape after
 * SMTP and copy were already Signet (#1824, #1916). Dashboard-only; same GET
 * `checkAuthSmtp` makes. Never put `smtp_pass` or the full template HTML in
 * the detail string.
 *
 * `whenSmtpUnset`:
 * - `"fail"` (default, staging): empty `smtp_host` does not skip this check.
 *   Staging SMTP is on; a ConfirmationURL template is a FAIL.
 * - `"skip"` (production until #1824): empty `smtp_host` is SKIPPED so the
 *   07:45 watchdog stays green on today's hosted default. The moment SMTP is
 *   on, ConfirmationURL fails and the body must carry TokenHash +
 *   `type=magiclink`.
 */
export async function checkAuthMagicLink({
  accessToken,
  projectRef,
  fetchImpl = fetch,
  whenSmtpUnset = "fail",
} = {}) {
  const label = "Magic Link template uses token_hash on the app host";
  if (!accessToken || !projectRef) {
    return result(
      "auth-magic-link",
      label,
      SKIPPED,
      "SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF not set",
    );
  }
  const response = await fetchImpl(
    `https://api.supabase.com/v1/projects/${projectRef}/config/auth`,
    withTimeout({ headers: { Authorization: `Bearer ${accessToken}` } }),
  );
  if (!response.ok) {
    return result("auth-magic-link", label, FAIL, `Management API returned HTTP ${response.status}`);
  }
  const data = await response.json();
  const host = typeof data?.smtp_host === "string" ? data.smtp_host.trim() : "";
  if (!host && whenSmtpUnset === "skip") {
    return result(
      "auth-magic-link",
      label,
      SKIPPED,
      "smtp_host is empty; Magic Link template not asserted until SMTP is on. See #1824.",
    );
  }
  const subject =
    typeof data?.mailer_subjects_magic_link === "string"
      ? data.mailer_subjects_magic_link.trim()
      : "";
  if (subject !== AUTH_MAGIC_LINK_SUBJECT) {
    return result(
      "auth-magic-link",
      label,
      FAIL,
      `mailer_subjects_magic_link is "${subject || "(empty)"}", expected "${AUTH_MAGIC_LINK_SUBJECT}"`,
    );
  }
  const content =
    typeof data?.mailer_templates_magic_link_content === "string"
      ? data.mailer_templates_magic_link_content
      : "";
  if (!content.trim()) {
    return result(
      "auth-magic-link",
      label,
      FAIL,
      "mailer_templates_magic_link_content is empty — the hosted default href is ConfirmationURL on *.supabase.co",
    );
  }
  if (/ConfirmationURL/i.test(content)) {
    return result(
      "auth-magic-link",
      label,
      FAIL,
      "mailer_templates_magic_link_content still uses ConfirmationURL (href lands on *.supabase.co)",
    );
  }
  if (!/TokenHash/i.test(content)) {
    return result(
      "auth-magic-link",
      label,
      FAIL,
      "mailer_templates_magic_link_content is missing TokenHash",
    );
  }
  if (!/type=magiclink/i.test(content)) {
    return result(
      "auth-magic-link",
      label,
      FAIL,
      "mailer_templates_magic_link_content is missing type=magiclink",
    );
  }
  return result("auth-magic-link", label, PASS, `subject=${subject}; token_hash href`);
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

  // Infisical's SecretSyncStatus enum is `pending | running | succeeded |
  // failed` (read from the open-source backend's secret-sync-types.ts, not
  // observed live), plus null for a sync that has never run.
  //
  // Classification is deliberately three-way and closed at both ends:
  //   any `failed`            -> FAIL
  //   every sync `succeeded`  -> PASS
  //   anything else           -> SKIPPED (we cannot assert the property)
  //
  // The middle case matters twice over. Calling "not succeeded" broken would
  // open a P1 for a sync caught mid-window, or for one flipped back to
  // `pending` by the daily retry sweep in Infisical's queue worker (read from
  // its source, not observed here). But calling it PASS is worse: a status
  // this code does not recognise — or a sync wedged in `pending` because its
  // destination token was revoked — would report green while not delivering,
  // which is the #834 signature going undetected. A skip asserts nothing,
  // reds nothing, and cannot close an open alert, which is the honest answer.
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
  if (settled.length < syncs.length) {
    const unsettled = syncs
      .filter((sync) => statusOf(sync) !== "succeeded")
      .map((s) => `${s?.name ?? "unnamed"}=${s?.syncStatus ?? "never-run"}`);
    return result(
      "infisical-syncs",
      label,
      SKIPPED,
      `cannot assert every sync succeeded — ${unsettled.join(", ")}`,
    );
  }
  return result("infisical-syncs", label, PASS, `all ${settled.length} syncs succeeded`);
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
 *
 * `SUPABASE_URL` / `SUPABASE_ANON_KEY` are expected on the scheduled job
 * (Infisical injects them). A half-set pair, or a smoke user with neither, is
 * FAIL (#1767) — SKIPPED would keep 07:30 green after the anon key was
 * blanked. A fully unconfigured local run (no URL, no key, no smoke user)
 * still SKIPPED.
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
  const hasUrl = Boolean(supabaseUrl);
  const hasKey = Boolean(anonKey);
  const hasSmoke = Boolean(email) && Boolean(password);

  if (!hasUrl || !hasKey) {
    if (hasUrl || hasKey || hasSmoke) {
      return result(
        "auth-signin",
        label,
        FAIL,
        "SUPABASE_URL / SUPABASE_ANON_KEY is incomplete — the sign-in probe cannot run. " +
          "A missing anon key is a FAIL on staging (SKIPPED would keep the run green). See #1767.",
      );
    }
    return result(
      "auth-signin",
      label,
      SKIPPED,
      "STAGING_SMOKE_USER_EMAIL / STAGING_SMOKE_USER_PASSWORD not provisioned — see the [human] " +
        "issue linked from #838. The user must have exactly ONE chapter membership.",
    );
  }

  if (!hasSmoke) {
    return result(
      "auth-signin",
      label,
      SKIPPED,
      "STAGING_SMOKE_USER_EMAIL / STAGING_SMOKE_USER_PASSWORD not provisioned — see the [human] " +
        "issue linked from #838. The user must have exactly ONE chapter membership.",
    );
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
 * Migration parity — reported, NOT run here.
 *
 * #838 asked this workflow to call #833's drift script as one of its rows. What
 * #833 actually shipped is a complete sibling watchdog: its own daily schedule,
 * its own `routine-state` alert issue, and coverage of production as well as
 * staging (`.github/workflows/check-migration-drift.yml`). Invoking it from
 * here would run the same comparison twice a day and let one real drift open
 * two P1 alerts — and because that script upserts and closes its own alert as a
 * side effect, this workflow would be mutating another watchdog's incident
 * state. Neither is acceptable, so ownership sits entirely with that workflow.
 *
 * The row stays visible rather than being deleted so the conformance table
 * remains a complete inventory of what is watched, with a pointer to who
 * watches it. It reports SKIPPED, which by this file's rules asserts nothing
 * and cannot close an alert — the honest status for "someone else proves this".
 */
export function checkSchemaDrift() {
  return result(
    "schema-drift",
    "Applied migrations match supabase/migrations/",
    DELEGATED,
    "owned by check-migration-drift.yml (#833), which alerts separately — not duplicated here",
  );
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
  // Delegated rows are neither evidence nor a gap here — they are a pointer to
  // the watchdog that does assert them, so they never move this workflow's
  // outcome in either direction.
  const delegated = results.filter((r) => r.status === DELEGATED);
  let outcome = "healthy";
  if (failed.length > 0) outcome = "failed";
  else if (passed.length === 0) outcome = "inconclusive";
  return { outcome, failed, skipped, passed, delegated };
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
  // Ids the suite no longer emits at all — a check renamed or deleted since
  // the alert was raised — are not evidence of an unrecovered failure, and
  // nothing could ever mark them passing. Without this they are sticky
  // forever and the alert can never close.
  // Also exclude ids that structurally cannot ever PASS — a delegated row is
  // never asserted here, so requiring it to pass would strand the alert open
  // forever. Unreachable today (a delegated row cannot FAIL, so it cannot enter
  // the marker), but the gate should not depend on that staying true.
  const gateable = new Set(
    results.filter((r) => r.status !== DELEGATED).map((r) => r.id),
  );
  return failingIds.filter((id) => gateable.has(id)).every((id) => passing.has(id));
}

const ICON = { [PASS]: "✅", [FAIL]: "❌", [SKIPPED]: "⏭️", [DELEGATED]: "↗️" };

// Voice for the step summary and the alert issue/comments. Production Auth
// conformance calls these builders with PRODUCTION_AUTH_COPY rather than
// string-replacing staging prose after the fact — a missed replaceAll left
// "frapp-staging" in a production incident body.
export const STAGING_COPY = Object.freeze({
  summaryHeading: "## Staging conformance",
  drifted: (failedCount, ownedCount) =>
    `**frapp-staging has drifted** — ${failedCount} of ${ownedCount} assertions failed.`,
  healthy: (passedCount, ownedCount) =>
    `**frapp-staging is conformant** — ${passedCount} of ${ownedCount} assertions passed.`,
  inconclusive: (ownedCount) =>
    `**Inconclusive — nothing was asserted.** All ${ownedCount} assertions skipped, so this run ` +
    "proves nothing about staging. Any open alert is left open deliberately.",
  unprovenRecovery: (passedCount, resultsCount) =>
    `**Nothing failed, but the open alert is not cleared.** ${passedCount} of ${resultsCount} ` +
    "assertions passed; the ones this alert was raised for could not be asserted, so closing it " +
    "would report a recovery nobody proved.",
  issueHeading: "## Staging conformance is failing",
  issueWorkflow:
    "This issue is **opened and closed automatically** by `.github/workflows/staging-conformance.yml`",
  issueDriftLine:
    "(`scripts/ci/staging-conformance.mjs`). While it is open, `frapp-staging` has drifted from the",
  whySee: "after #643 shipped (#805). See #838.",
  commentReopened: "**Staging conformance is failing again** — reopening.",
  commentFailedAgain: "**Staging conformance failed again.**",
  commentFooter:
    "_Posted automatically by `scripts/ci/staging-conformance.mjs`. Closes itself on the next clean run._",
  recoveryHeadline: "**Staging conformance recovered.** Closing.",
  recoveryFooter:
    "_Closed automatically by `scripts/ci/staging-conformance.mjs` after a clean run._",
});

export function buildRunSummary({ outcome, results, runUrl, copy = STAGING_COPY }) {
  const { failed, skipped, passed, delegated } = classifyConformance(results);
  // Denominator counts assertions this workflow owns; delegated rows are listed
  // but never inflate or deflate the score.
  const owned = results.length - delegated.length;
  const headline = {
    failed: copy.drifted(failed.length, owned),
    healthy: copy.healthy(passed.length, owned),
    inconclusive: copy.inconclusive(owned),
    "unproven-recovery": copy.unprovenRecovery(passed.length, results.length),
  }[outcome] ?? copy.healthy(passed.length, owned);
  const lines = [
    copy.summaryHeading,
    "",
    headline,
    "",
    "| | Assertion | Detail |",
    "| --- | --- | --- |",
    ...results.map((r) => `| ${ICON[r.status]} ${r.status.toUpperCase()} | ${r.label} | ${r.detail} |`),
  ];
  if (delegated.length > 0) {
    lines.push(
      "",
      `↗️ **${delegated.length} row(s) are owned by another watchdog** and are not asserted here. ` +
        "They are listed so this table stays a complete inventory of what is watched.",
    );
  }
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

/**
 * @param previousBody the alert's existing body on a refresh, or null on create.
 *
 * The marker is the UNION of what is failing now and what the alert already
 * recorded but still cannot be shown to pass. Writing only the current failure
 * set reintroduced the very bug the marker exists to prevent, one run later:
 * an alert raised for `auth-hook` whose next run failed on something else would
 * drop `auth-hook` from the gate, and the run after that would close it while
 * the hook was still disabled. An id leaves the marker only by PASSing.
 */
export function buildAlertIssueBody({ results, runUrl, previousBody = null, copy = STAGING_COPY }) {
  const { failed } = classifyConformance(results);
  const passingNow = new Set(
    results.filter((r) => r.status === PASS).map((r) => r.id),
  );
  const carriedOver = parseFailingIds(previousBody).filter(
    (id) => !passingNow.has(id),
  );
  const markerIds = [...new Set([...failed.map((r) => r.id), ...carriedOver])];
  const lines = [
    copy.issueHeading,
    "",
    copy.issueWorkflow,
    copy.issueDriftLine,
    "state the repository expects. It closes itself on the next clean scheduled run.",
    "",
    "Do not claim this issue as backlog work — it carries `routine-state` and tracks live state, not a",
    "unit of work. Fix the underlying drift and it resolves on its own.",
    "",
    "### Failing assertions",
    "",
    ...(failed.length > 0
      ? failed.map((r) => `- **${r.label}** — ${r.detail}`)
      : ["_Nothing is failing right now._"]),
    "",
    ...(carriedOver.length > 0
      ? [
          "### Not yet shown to have recovered",
          "",
          "These were failing when this alert was last raised and still cannot be asserted, so the",
          "alert stays open. They are what is holding it open — not the list above.",
          "",
          ...carriedOver.map((id) => `- \`${id}\``),
          "",
        ]
      : []),
    "### Why this workflow exists",
    "",
    "Every other check in this repo is push-triggered, so environment drift was invisible until",
    "someone happened to push: staging sat 38 migrations behind with all checks green, the Infisical",
    "credential was dead for 71 days (#696/#763), and `custom_access_token_hook` was never enabled",
    copy.whySee,
    "",
    "### Recovery state",
    "",
    "This alert closes only when the assertions listed below pass again — not merely when nothing",
    "fails, since an assertion that stops being *runnable* would otherwise read as a recovery.",
    "",
    // Machine-readable and deliberately visible: HTML comments do not survive
    // the GitHub MCP round-trip that agents read issues through (#800).
    `\`${FAILING_MARKER} ${markerIds.join(",")}\``,
  ];
  // Only the optional trailing run link is conditional. A blanket
  // `.filter(line => line !== "")` stripped every intentional blank line and
  // collapsed the whole body into one paragraph — burying the "do not claim
  // this issue" warning that stops agents picking the alert up as backlog.
  if (runUrl) lines.push("", `- Run: ${runUrl}`);
  return lines.join("\n");
}

export function buildAlertCommentBody({ results, runUrl, reopened, copy = STAGING_COPY }) {
  const { failed } = classifyConformance(results);
  const lines = [
    reopened ? copy.commentReopened : copy.commentFailedAgain,
    "",
    ...failed.map((r) => `- **${r.label}** — ${r.detail}`),
  ];
  if (runUrl) lines.push("", `- Run: ${runUrl}`);
  lines.push("", copy.commentFooter);
  return lines.join("\n");
}

export function buildRecoveryCommentBody({ results, runUrl, copy = STAGING_COPY }) {
  const { passed, skipped } = classifyConformance(results);
  const lines = [
    copy.recoveryHeadline,
    "",
    `${passed.length} assertion(s) passed${skipped.length > 0 ? `, ${skipped.length} skipped` : ""}.`,
  ];
  if (runUrl) lines.push("", `- Run: ${runUrl}`);
  lines.push("", copy.recoveryFooter);
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
 * TLS error) must not prevent the rest of the assertions from reporting. A thrown assertion
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
    { id: "health-check-path", label: "frapp-api-staging healthCheckPath is /health", run: () =>
      checkRenderHealthCheckPath({
        apiKey: env.RENDER_API_KEY,
        serviceId: env.RENDER_SERVICE_ID,
        fetchImpl,
      }) },
    { id: "render-auto-deploy", label: "frapp-api-staging auto-deploys main", run: () =>
      checkRenderAutoDeploy({
        apiKey: env.RENDER_API_KEY,
        serviceId: env.RENDER_SERVICE_ID,
        fetchImpl,
      }) },
    { id: "auth-hook", label: "custom_access_token_hook is enabled", run: () =>
      checkAuthHook({
        accessToken: env.SUPABASE_ACCESS_TOKEN,
        projectRef: env.SUPABASE_PROJECT_REF,
        fetchImpl,
      }) },
    { id: "auth-redirects", label: "Redirect allow list covers the web app's paths and the mobile scheme", run: () =>
      checkAuthRedirects({
        accessToken: env.SUPABASE_ACCESS_TOKEN,
        projectRef: env.SUPABASE_PROJECT_REF,
        fetchImpl,
      }) },
    { id: "auth-smtp", label: "Custom SMTP is Resend, the sender is Signet, and the send cap is at least 300/hour", run: () =>
      checkAuthSmtp({
        accessToken: env.SUPABASE_ACCESS_TOKEN,
        projectRef: env.SUPABASE_PROJECT_REF,
        fetchImpl,
      }) },
    { id: "auth-magic-link", label: "Magic Link template uses token_hash on the app host", run: () =>
      checkAuthMagicLink({
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

  const { outcome, failed, skipped, delegated } = classifyConformance(results);

  // Annotations surface at the top of the run page. `::error::` here only
  // annotates — the exit code below is what reds the run.
  for (const r of failed) logger.log?.(`::error::${r.label} — ${r.detail}`);
  for (const r of skipped) logger.log?.(`::warning::SKIPPED ${r.label} — ${r.detail}`);
  // Notice, not warning: a delegation is the intended steady state.
  for (const r of delegated) logger.log?.(`::notice::DELEGATED ${r.label} — ${r.detail}`);

  if (outcome === "failed") {
    writeSummary(buildRunSummary({ outcome, results, runUrl }));
    const alert = await raiseAlert({
      token,
      repo,
      fetchImpl,
      title: ALERT_ISSUE_TITLE,
      labels: ALERT_ISSUE_LABELS,
      lookupLabel: ALERT_ISSUE_LOOKUP_LABEL,
      // previousBody is null on create and the existing body on refresh; the
      // builder merges its marker so an unresolved assertion is never dropped.
      buildIssueBody: (previousBody) =>
        buildAlertIssueBody({ results, runUrl, previousBody }),
      buildCommentBody: ({ reopened }) => buildAlertCommentBody({ results, runUrl, reopened }),
      // The body carries the failing-assertion marker that gates recovery, so
      // it must track the CURRENT failure set, not the first one ever seen.
      refreshBodyOnRaise: true,
    });
    logger.log?.(
      alert.action === "failed"
        ? "::error::Staging conformance failed and the alert issue could not be written."
        : `[staging-conformance] alert issue #${alert.issueNumber} ${alert.action}`,
    );
    if (alert.bodyRefreshFailed) {
      // The body carries the marker that gates recovery, so a stale one can let
      // a later run close the alert early.
      logger.log?.(
        "::warning::Alert comment posted, but its body could not be refreshed — " +
          "the failing-assertion marker may be stale.",
      );
    }
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
  const { issues: allAlerts, lookupOk } = await findAlertIssuesDetailed({
    token,
    repo,
    fetchImpl,
    title: ALERT_ISSUE_TITLE,
    lookupLabel: ALERT_ISSUE_LOOKUP_LABEL,
  });

  // A failed lookup returns an empty list, which is indistinguishable from
  // "no alert is open". Falling through on that would let a transient 5xx
  // close an alert whose gated assertion was never proven — and because the
  // unproven check is SKIPPED rather than FAIL, no later run would reopen it.
  // "I could not read the alerts" must never mean "there are none".
  if (!lookupOk) {
    writeSummary(buildRunSummary({ outcome, results, runUrl }));
    logger.log?.(
      "::warning::Could not read the alert issues, so no alert was closed this run. " +
        "Nothing failed; retrying tomorrow.",
    );
    return { outcome, results, alert: { action: "none", closed: [] } };
  }

  const openAlerts = allAlerts.filter((issue) => issue.state === "open");

  const failingIds = openAlerts.flatMap((issue) => parseFailingIds(issue.body));
  if (openAlerts.length > 0 && !canResolveAlert({ results, failingIds })) {
    const unresolved = failingIds.filter(
      (id) => !results.some((r) => r.id === id && r.status === PASS),
    );
    // Summary written here, with the real outcome — a run that leaves the
    // alert open must not print "conformant" at the top of the page.
    writeSummary(buildRunSummary({ outcome: "unproven-recovery", results, runUrl }));

    // Record what this run DID prove. The marker only ever narrows on a
    // failing raise, so without this an assertion proven passing today is
    // forgotten, and two gated assertions that pass on alternating days keep
    // the alert open forever even though each was individually shown healthy.
    for (const issue of openAlerts) {
      await ghRequest({
        token,
        fetchImpl,
        method: "PATCH",
        path: `/repos/${repo}/issues/${issue.number}`,
        body: { body: buildAlertIssueBody({ results, runUrl, previousBody: issue.body }) },
      });
    }
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
  } else if (alert.action === "failed") {
    // Surfaced, not swallowed. Silently dropping this leaves a P1 open on a
    // healthy environment, collecting one duplicate "recovered" comment a day,
    // while the run reports conformant.
    logger.log?.(
      "::error::Staging is conformant but the alert issue could not be closed. " +
        "It is still open; close it by hand if this persists.",
    );
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
