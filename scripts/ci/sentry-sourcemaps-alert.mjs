#!/usr/bin/env node

// Turn the deploy job's source-map verdicts into alert issues (#2489).
//
// `verify-sentry-sourcemaps.mjs` runs at the end of `_deploy.yml`'s job, which
// holds the Sentry token and no GitHub write scope, and hands its verdicts out
// as the job output `sourcemaps`. This runs in the caller's `deploy-outcome`
// job, which holds `issues: write` and no Sentry token, and files them through
// the shared alert lib, the path every other watchdog uses (`defineAlert`,
// #1731).
//
// ── One alert per project and environment ───────────────────────────────────
// A run checks only what it built: a staging run that deployed the API alone
// says nothing about web's maps. So each alert tracks one project on one
// environment, and a run raises or closes only the ones it checked. One alert
// per environment would need a marker of which projects failed (as
// staging-conformance keeps), or it would close web's alert on a run that
// only proved the API. Six small identities keep that out.
//
// ── What each verdict does ──────────────────────────────────────────────────
//   present                              → close the alert (maps are back)
//   missing, no-token, rejected, no-project → raise it
//   unverifiable                         → annotate, change nothing: no answer
//                                          proves nothing either way
// A project still waiting for its Sentry project (`awaitingProject` in
// `SOURCEMAP_PROJECTS`: `frapp-landing`, #2071) is raised only by `missing`,
// the one failing verdict that proves the project exists. Its `no-project` is
// the known state, and its `no-token` and `rejected` are already carried by
// the other projects' alerts, so they are notices.
//
// **P2, not P1:** stack traces arrive minified, nothing is down.
//
// Exits 0 on every handled outcome: an alert write that failed is a warning,
// because a red `deploy-outcome` after a green deploy would read as a failed
// deploy.
//
// Env inputs:
//   GITHUB_TOKEN      — required (issues: write)
//   GITHUB_REPOSITORY — required, owner/repo
//   RUN_URL           — required, html_url of this run
//   SOURCEMAPS        — `needs.deploy.outputs.sourcemaps`; empty when the run
//                       built nothing that uploads maps
//
// Unit tests: `scripts/ci/__tests__/sentry-sourcemaps-alert.test.mjs`.

import { defineAlert, raiseAlert, resolveAlert } from "./lib/alert-issue.mjs";
import { requireEnv } from "./lib/env.mjs";
import { isInvokedDirectly } from "./lib/invoked-directly.mjs";
import { ENVIRONMENTS, SOURCEMAP_PROJECTS, VERDICTS } from "./verify-sentry-sourcemaps.mjs";

const RAISING = new Set(["missing", "no-token", "rejected", "no-project"]);

/** Every identity, keyed `<environment>/<project>`. The title is the lookup key: never rename one. */
export const ALERTS = Object.freeze(
  Object.fromEntries(
    ENVIRONMENTS.flatMap((environment) =>
      Object.keys(SOURCEMAP_PROJECTS).map((project) => [
        `${environment}/${project}`,
        defineAlert({
          title: `Sentry has no source maps for ${project} on ${environment} — its stack traces are minified`,
          labels: ["area:ci", "P2"],
        }),
      ]),
    ),
  ),
);

export function alertFor(environment, project) {
  const alert = ALERTS[`${environment}/${project}`];
  if (!alert) throw new Error(`No source-map alert for ${environment}/${project}`);
  return alert;
}

/**
 * The report `verify-sentry-sourcemaps.mjs` wrote, or `null` for an empty
 * output. Anything else that doesn't parse into its shape throws: a malformed
 * report is a bug between the two scripts, not a verdict.
 */
export function parseReport(raw) {
  if (raw === undefined || raw === null || raw.trim() === "") return null;
  const report = JSON.parse(raw);
  if (!ENVIRONMENTS.includes(report?.environment)) {
    throw new Error(`source-map report names environment ${JSON.stringify(report?.environment)}`);
  }
  if (typeof report.sha !== "string" || typeof report.projects !== "object" || report.projects === null) {
    throw new Error("source-map report has no sha or projects");
  }
  for (const [project, result] of Object.entries(report.projects)) {
    if (!Object.hasOwn(SOURCEMAP_PROJECTS, project)) throw new Error(`source-map report names unknown project ${project}`);
    if (!VERDICTS.includes(result?.verdict)) {
      throw new Error(`source-map report gives ${project} the unknown verdict ${JSON.stringify(result?.verdict)}`);
    }
  }
  return report;
}

/** `raise`, `resolve` or `notice` for one project's verdict. */
export function actionFor(project, verdict) {
  if (verdict === "present") return "resolve";
  if (!RAISING.has(verdict)) return "notice";
  if (SOURCEMAP_PROJECTS[project].awaitingProject && verdict !== "missing") return "notice";
  return "raise";
}

const FIX = {
  missing:
    "Read the build that uploaded (or should have). The API's Render build logs `WARNING: … frapp-api source-map upload not confirmed` when `sentry-cli` failed; " +
    "a failed upload is cached with its Docker layer, so clear Render's build cache before redeploying the same commit. " +
    "Web and landing log the Sentry plugin's error in the `Build the Vercel … bundles` step of the deploy run.",
  "no-token":
    "Add `SENTRY_AUTH_TOKEN` (a Sentry org auth token) to Infisical for this environment. Render and the deploy job both read it from there; " +
    "never set it on the platform ([SECRETS_MANAGEMENT.md § 5](https://github.com/pdcarlson/Frapp/blob/main/docs/internal/environment/SECRETS_MANAGEMENT.md#5-configure-secret-syncs)).",
  rejected:
    "The token was revoked, rotated without updating Infisical, or lost its scope. Mint a new org auth token in Sentry, put it in Infisical, and redeploy.",
  "no-project":
    "The Sentry project was renamed or deleted, or Sentry moved the artifact-bundles endpoint. Check the project slug in Sentry against the one the build uploads to.",
};

function describe({ project, environment, sha, verdict, detail, runUrl }) {
  return [
    `**${project} on ${environment}:** \`${verdict}\` for \`${sha}\` — ${detail}.`,
    "",
    `**Fix:** ${FIX[verdict]}`,
    "",
    `Run: ${runUrl}`,
  ].join("\n");
}

export function buildIssueBody(context) {
  return [
    `## Sentry has no source maps for ${context.project} on ${context.environment}`,
    "",
    "Opened and closed automatically by `scripts/ci/sentry-sourcemaps-alert.mjs` in the deploy workflow's `deploy-outcome` job, " +
      "from what `scripts/ci/verify-sentry-sourcemaps.mjs` found at the end of the deploy (#2489).",
    "",
    "While it is open, errors from this project arrive with compiled, minified frames. The deploy itself shipped: maps are best effort and never fail it (#2431).",
    "",
    describe(context),
    "",
    `Closes itself when a later deploy that builds ${context.project} finds its maps in Sentry.`,
  ].join("\n");
}

export function buildCommentBody(context, { reopened }) {
  return [
    reopened ? "**Source maps are missing again**, reopening." : "**Still missing.**",
    "",
    describe(context),
    "",
    "_Posted automatically by `scripts/ci/sentry-sourcemaps-alert.mjs`._",
  ].join("\n");
}

export function buildRecoveryBody({ project, environment, sha, detail, runUrl }) {
  return [
    `**Recovered.** Sentry holds ${project}'s source maps for \`${sha}\` on ${environment}: ${detail}. Closing.`,
    "",
    `Run: ${runUrl}`,
    "",
    "_Closed automatically by `scripts/ci/sentry-sourcemaps-alert.mjs`._",
  ].join("\n");
}

export async function reportSourcemaps({ report, token, repo, runUrl, fetchImpl = fetch, logger = console }) {
  if (!report) {
    logger.log("No source-map report: this run built nothing that uploads source maps, so no alert changes.");
    return [];
  }
  const outcomes = [];
  for (const [project, { verdict, detail }] of Object.entries(report.projects)) {
    const context = { project, environment: report.environment, sha: report.sha, verdict, detail, runUrl };
    const alert = alertFor(report.environment, project);
    const action = actionFor(project, verdict);
    if (action === "notice") {
      const awaiting = SOURCEMAP_PROJECTS[project].awaitingProject;
      logger.log(
        verdict === "unverifiable"
          ? `::warning::${project} on ${report.environment}: source maps unverifiable (${detail}). Its alert is left as it is.`
          : `::notice::${project} on ${report.environment}: ${verdict} (${detail}). It has no Sentry project until #${awaiting}, so this changes no alert.`,
      );
      outcomes.push({ project, verdict, action: "none" });
      continue;
    }
    if (action === "resolve") {
      const result = await resolveAlert({
        token,
        repo,
        fetchImpl,
        alert,
        buildRecoveryBody: () => buildRecoveryBody(context),
      });
      if (result.action === "failed" || result.action === "unread") {
        logger.log(`::warning::${project} on ${report.environment}: maps are present, but its alert could not be closed (${result.action}).`);
      } else if (result.action === "closed") {
        logger.log(`${project} on ${report.environment}: maps present; closed #${result.closed.join(", #")}.`);
      }
      outcomes.push({ project, verdict, action: result.action });
      continue;
    }
    const result = await raiseAlert({
      token,
      repo,
      fetchImpl,
      alert,
      buildIssueBody: () => buildIssueBody(context),
      buildCommentBody: ({ reopened }) => buildCommentBody(context, { reopened }),
    });
    logger.log(
      result.action === "failed"
        ? `::warning::${project} on ${report.environment}: ${verdict}, and its alert issue could not be written.`
        : `${project} on ${report.environment}: ${verdict}; alert #${result.issueNumber} ${result.action}.`,
    );
    outcomes.push({ project, verdict, action: result.action });
  }
  return outcomes;
}

async function main() {
  const token = requireEnv("GITHUB_TOKEN");
  const repo = requireEnv("GITHUB_REPOSITORY");
  const runUrl = requireEnv("RUN_URL");
  let report;
  try {
    report = parseReport(process.env.SOURCEMAPS);
  } catch (error) {
    console.log(`::warning::The deploy job's source-map report could not be read, so no alert changes: ${error.message}`);
    return;
  }
  await reportSourcemaps({ report, token, repo, runUrl });
}

if (isInvokedDirectly(import.meta.url)) {
  main().catch((error) => {
    console.log(`::warning::Source-map alerting crashed, so no alert changed: ${error?.stack ?? error}`);
  });
}
