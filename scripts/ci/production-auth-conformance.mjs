#!/usr/bin/env node
// Scheduled conformance check for frapp-prod Auth hook, redirect allow list,
// Auth SMTP (skip-until-on), and Magic Link template (skip until SMTP is on).
//
// Staging-conformance.yml watches these on frapp-staging. Production first
// users hit frapp-prod (`unttyvyfezddlyafcydh` in .github/environments.json).
// The same dashboard settings that stripped invite tokens and disabled
// `active_chapter_id` (#805 / 2026-09-06 redirect incident) have zero daily
// assertion on production unless this script runs.
//
// This is a sibling, not an extension of staging-conformance.yml: a shared
// alert title would let a recovered staging close a live production incident.
// Production SMTP is skip-until-on: empty host (hosted 2/hour cap) is
// SKIPPED so the 07:45 watchdog stays green until #1824. The moment SMTP
// is on, the same check FAILs a burned apex From (`invites@frapp.live`)
// and requires `no-reply@mail.frapp.live` at >=300/hour. Staging already
// FAILs on empty SMTP. Magic Link is the same gate: ConfirmationURL is
// SKIPPED while SMTP is unset; SMTP on FAILs a hosted default href.
//
// ── Why this job does NOT say `environment: production` ─────────────────────
// ADR-19 put Required reviewers on the `production` GitHub environment. A
// `schedule:` job that names it suspends on that gate and expires without
// probing (#1435). Infisical `env-slug: "prod"` is the folder name, not that
// GitHub environment.
//
// ── Why the project ref is NOT `SUPABASE_PROJECT_REF` ───────────────────────
// Infisical injects that name from whichever folder the workflow asked for.
// A copy-paste of staging-conformance.yml that forgot to change the slug
// would watch staging and report it as production. The committed ref in
// `.github/environments.json` cannot make that mistake.
//
// Env inputs:
//   GITHUB_TOKEN          — required (issues: write) for the alert upsert
//   GITHUB_REPOSITORY     — required, owner/repo
//   SUPABASE_ACCESS_TOKEN — Management API token (account-scoped)
//   RUN_URL               — html_url of this run, for the alert body

import { appendFileSync } from "node:fs";

import { findAlertIssuesDetailed, raiseAlert, resolveAlert } from "./lib/alert-issue.mjs";
import { getEnvironment } from "./lib/environments.mjs";
import { requireEnv } from "./lib/env.mjs";
import { ghRequest } from "./lib/github.mjs";
import {
  FAIL,
  PASS,
  buildAlertCommentBody as buildStagingAlertCommentBody,
  buildAlertIssueBody as buildStagingAlertIssueBody,
  buildRecoveryCommentBody as buildStagingRecoveryCommentBody,
  buildRunSummary as buildStagingRunSummary,
  canResolveAlert,
  checkAuthHook,
  checkAuthRedirects,
  checkAuthMagicLink,
  checkAuthSmtp,
  checkProjectStatus,
  classifyConformance,
  parseFailingIds,
  redactSecrets,
} from "./staging-conformance.mjs";

export const PRODUCTION_SITE_URL = "https://app.frapp.live";
export const PRODUCTION_AUTH_SMTP_ADMIN_EMAIL = "no-reply@mail.frapp.live";

export const DEFAULT_CHECK_IDS = Object.freeze([
  "project-status",
  "auth-hook",
  "auth-redirects",
  "auth-smtp",
  "auth-magic-link",
]);

// Title is the lookup key. Must not equal staging-conformance's title.
export const ALERT_ISSUE_TITLE = "Production Auth settings have drifted";
export const ALERT_ISSUE_LOOKUP_LABEL = "routine-state";
export const ALERT_ISSUE_LABELS = [ALERT_ISSUE_LOOKUP_LABEL, "area:ci", "P1"];

const result = (id, label, status, detail) => ({ id, label, status, detail });

// Own the production voice. Passing this into the shared builders is the
// contract; a post-hoc replaceAll of staging strings missed new phrases
// the moment staging-conformance.mjs changed them.
export const PRODUCTION_AUTH_COPY = Object.freeze({
  summaryHeading: "## Production Auth conformance",
  drifted: (failedCount, ownedCount) =>
    `**frapp-prod Auth settings have drifted** — ${failedCount} of ${ownedCount} assertions failed.`,
  healthy: (passedCount, ownedCount) =>
    `**frapp-prod Auth settings are conformant** — ${passedCount} of ${ownedCount} assertions passed.`,
  inconclusive: (ownedCount) =>
    `**Inconclusive — nothing was asserted.** All ${ownedCount} assertions skipped, so this run ` +
    "proves nothing about production Auth. Any open alert is left open deliberately.",
  unprovenRecovery: (passedCount, resultsCount) =>
    `**Nothing failed, but the open alert is not cleared.** ${passedCount} of ${resultsCount} ` +
    "assertions passed; the ones this alert was raised for could not be asserted, so closing it " +
    "would report a recovery nobody proved.",
  issueHeading: "## Production Auth settings have drifted",
  issueWorkflow:
    "This issue is **opened and closed automatically** by `.github/workflows/production-auth-conformance.yml`",
  issueDriftLine:
    "(`scripts/ci/production-auth-conformance.mjs`). While it is open, `frapp-prod` Auth settings have drifted from the",
  whySee:
    "after #643 shipped (#805). Production's copy of those settings is this workflow. See #1384.",
  commentReopened: "**Production Auth settings have drifted again** — reopening.",
  commentFailedAgain: "**Production Auth settings failed again.**",
  commentFooter:
    "_Posted automatically by `scripts/ci/production-auth-conformance.mjs`. Closes itself on the next clean run._",
  recoveryHeadline: "**Production Auth settings recovered.** Closing.",
  recoveryFooter:
    "_Closed automatically by `scripts/ci/production-auth-conformance.mjs` after a clean run._",
});

function withProductionCopy(args) {
  return { ...args, copy: PRODUCTION_AUTH_COPY };
}

export function buildRunSummary(args) {
  return buildStagingRunSummary(withProductionCopy(args));
}

export function buildAlertIssueBody(args) {
  return buildStagingAlertIssueBody(withProductionCopy(args));
}

export function buildAlertCommentBody(args) {
  return buildStagingAlertCommentBody(withProductionCopy(args));
}

export function buildRecoveryCommentBody(args) {
  return buildStagingRecoveryCommentBody(withProductionCopy(args));
}

function defaultWriteSummary(summary) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (path) appendFileSync(path, `${summary}\n`);
}

/**
 * Project ref from the committed environment map — never from injected
 * `SUPABASE_PROJECT_REF`, which follows whichever Infisical folder the
 * workflow asked for.
 */
export function productionProjectRef({ getEnvironmentImpl = getEnvironment } = {}) {
  return getEnvironmentImpl("production").supabaseProjectRef;
}

function defaultChecks({ accessToken, projectRef, fetchImpl }) {
  return [
    {
      id: "project-status",
      label: "Supabase project is ACTIVE_HEALTHY",
      run: () => checkProjectStatus({ accessToken, projectRef, fetchImpl }),
    },
    {
      id: "auth-hook",
      label: "custom_access_token_hook is enabled",
      run: () => checkAuthHook({ accessToken, projectRef, fetchImpl }),
    },
    {
      id: "auth-redirects",
      label: "Redirect allow list covers the web app's paths and the mobile scheme",
      run: () =>
        checkAuthRedirects({
          accessToken,
          projectRef,
          fetchImpl,
          expectedSiteUrl: PRODUCTION_SITE_URL,
        }),
    },
    {
      id: "auth-smtp",
      label: "Custom SMTP is Resend at no-reply@mail.frapp.live (skip while unset)",
      run: () =>
        checkAuthSmtp({
          accessToken,
          projectRef,
          fetchImpl,
          expectedAdminEmail: PRODUCTION_AUTH_SMTP_ADMIN_EMAIL,
          whenUnset: "skip",
        }),
    },
    {
      id: "auth-magic-link",
      label: "Magic Link template uses token_hash (skip while SMTP unset)",
      run: () =>
        checkAuthMagicLink({
          accessToken,
          projectRef,
          fetchImpl,
          whenSmtpUnset: "skip",
        }),
    },
  ];
}

/**
 * Runs the DEFAULT_CHECK_IDS production Auth assertions, reports, and upserts/resolves
 * the alert issue. Same skip ≠ pass / failed-lookup-must-not-close contract
 * as staging-conformance; different title and default `toRun`.
 */
export async function runProductionAuthConformance({
  token,
  repo,
  env = process.env,
  fetchImpl = fetch,
  checks,
  writeSummary = defaultWriteSummary,
  logger = console,
  runUrl = env.RUN_URL ?? "",
  getEnvironmentImpl = getEnvironment,
} = {}) {
  const toRun =
    checks ??
    defaultChecks({
      accessToken: env.SUPABASE_ACCESS_TOKEN,
      projectRef: productionProjectRef({ getEnvironmentImpl }),
      fetchImpl,
    });

  const results = [];
  for (const check of toRun) {
    const run = typeof check === "function" ? check : check.run;
    const id = typeof check === "function" ? "unknown" : check.id;
    const label = typeof check === "function" ? "assertion threw" : check.label;
    try {
      results.push(await run());
    } catch (error) {
      const reason = [error?.message ?? String(error), error?.cause?.message]
        .filter(Boolean)
        .join(": ");
      results.push(result(id, label, FAIL, `assertion threw — ${redactSecrets(reason, env)}`));
    }
  }

  const { outcome, failed, skipped } = classifyConformance(results);

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
      buildIssueBody: (previousBody) =>
        buildAlertIssueBody({ results, runUrl, previousBody }),
      buildCommentBody: ({ reopened }) =>
        buildAlertCommentBody({ results, runUrl, reopened }),
      refreshBodyOnRaise: true,
    });
    logger.log?.(
      alert.action === "failed"
        ? "::error::Production Auth conformance failed and the alert issue could not be written."
        : `[production-auth-conformance] alert issue #${alert.issueNumber} ${alert.action}`,
    );
    if (alert.bodyRefreshFailed) {
      logger.log?.(
        "::warning::Alert comment posted, but its body could not be refreshed — " +
          "the failing-assertion marker may be stale.",
      );
    }
    return { outcome, results, alert };
  }

  if (outcome === "inconclusive") {
    writeSummary(buildRunSummary({ outcome, results, runUrl }));
    logger.log?.(
      "::warning::Production Auth conformance asserted nothing — every check skipped. " +
        "Any open alert is left open.",
    );
    return { outcome, results, alert: { action: "none", closed: [] } };
  }

  const { issues: allAlerts, lookupOk } = await findAlertIssuesDetailed({
    token,
    repo,
    fetchImpl,
    title: ALERT_ISSUE_TITLE,
    lookupLabel: ALERT_ISSUE_LOOKUP_LABEL,
  });

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
    writeSummary(buildRunSummary({ outcome: "unproven-recovery", results, runUrl }));

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
    logger.log?.(`[production-auth-conformance] closed alert issue(s): ${alert.closed.join(", ")}`);
  } else if (alert.action === "failed") {
    logger.log?.(
      "::error::Production Auth settings are conformant but the alert issue could not be closed. " +
        "It is still open; close it by hand if this persists.",
    );
  }
  return { outcome, results, alert };
}

async function main() {
  const token = requireEnv("GITHUB_TOKEN");
  const repo = requireEnv("GITHUB_REPOSITORY");
  const { outcome } = await runProductionAuthConformance({ token, repo });
  if (outcome === "failed") process.exit(1);
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`Unhandled error: ${error.stack ?? error.message}`);
    process.exit(1);
  });
}
