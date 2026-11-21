#!/usr/bin/env node
// Emails the owner when an app release run fails: the Staging app workflow
// (`staging-app.yml`, after every staging deploy) and Deploy production's app
// release (its `mobile-plan`, `mobile` and `ota` jobs).
//
// Why it exists (Paul, 2026-11-18, "I need to know about that sooner"): a
// staging merge added the Associated Domains entitlement to Frapp Staging, and
// every Staging app run for the next three hours failed its iOS build on the
// signing profile. Nobody heard. A `workflow_run` run that fails emails only
// its actor, here the merge queue bot, and an OTA update for a runtime no
// binary carries reaches no phone, so the app just stopped updating. Deploy
// production's `deploy-outcome` alert reads only `deploy` and `release`, so a
// failed store build or OTA after a good ship raised nothing either.
//
// It raises one `incident` alert per workflow (lib/alert-issue.mjs), which is
// assigned to the owner and so reaches him by email, the pager (ADR-24). The
// alert comments only when what fails changes (the failing jobs and, for
// staging, the runtime), so a merge train behind one broken build is one
// email, not one per merge. It closes on the first run that proves the release
// path works again: an `auto` run in which every job that ran succeeded. A run
// for a named platform, or `none`, can skip a platform that still can't build,
// so it neither raises on a skip nor closes.
//
// Env inputs:
//   GITHUB_TOKEN       — required (issues: write, actions: read)
//   GITHUB_REPOSITORY  — required, owner/repo
//   ALERT_CONFIG       — required, `staging-app` or `production-mobile`
//   NEEDS              — required, `toJSON(needs)` from the workflow
//   BUILD              — the run's build choice (`auto`, `ios`, ...). Staging:
//                        `inputs.build || 'auto'`; production: `inputs.mobile_build`
//   RUNTIME            — staging only, the plan's runtime
//   SHA                — the commit the run released
//   RUN_URL, RUN_ID, RUN_ATTEMPT — this run, to link it and to name the
//                        failed steps
//
// Exit codes: 0 on every handled outcome, because the failed job already reds
// the run; 1 only when the alert could not be read or written, so a lost
// alert shows.
//
// Unit tests: scripts/ci/__tests__/mobile-release-alert.test.mjs
// (`npm run test:ci-scripts`).

import { appendFileSync } from "node:fs";

import {
  defineAlert,
  findAlertIssuesDetailed,
  markerLine,
  raiseAlert,
  resolveAlert,
  selectAlertConfig,
} from "./lib/alert-issue.mjs";
import { requireEnv } from "./lib/env.mjs";
import { ghRequest } from "./lib/github.mjs";
import { isInvokedDirectly } from "./lib/invoked-directly.mjs";

const MOBILE_DOC = "docs/ops/deployment/mobile.md";

/** Frapp Staging: `staging-app.yml`. */
export const STAGING_APP_CONFIG = {
  name: "staging-app",
  workflowLabel: "Staging app",
  workflowFile: ".github/workflows/staging-app.yml",
  // Skipped when the staging deploy shipped nothing, which Deploy staging's own
  // alert covers. No verdict then.
  gateJob: "plan",
  jobs: {
    plan: "decide which binaries the commit needs",
    update: "publish the OTA update to the `staging` channel",
    ios: "build Frapp Staging for iOS and upload it to TestFlight",
    android: "build Frapp Staging for Android and upload it to the Play internal track",
    confirm: "confirm the store uploads finished",
  },
  alert: defineAlert({
    title: "Staging app updates are failing — phones with Frapp Staging are not getting merges",
    labels: ["area:ci", "P1"],
  }),
  impact:
    "Frapp Staging on phones stays on whatever it last received. The OTA update is published on " +
    "every run, but an update for a runtime no uploaded binary carries reaches no phone, so a failed " +
    "build stops every later merge from arriving too, until a build of that runtime uploads.",
  howToFix:
    `Open the failed step's log from the run link. An iOS build that fails on "Provisioning profile ... ` +
    `doesn't include the ... capability" needs the owner's interactive \`npm run eas -- credentials ` +
    `--platform ios\` on the \`staging\` profile, then a dispatch of Staging app with \`build: ios\` ` +
    `(${MOBILE_DOC} § 6.6 and § 6.8).`,
  closesOn: "the next automatic (or `build: auto`) Staging app run in which every job that ran succeeds",
};

/** Deploy production's app release: `deploy-production.yml`'s `mobile-plan`, `mobile` and `ota`. */
export const PRODUCTION_MOBILE_CONFIG = {
  name: "production-mobile",
  workflowLabel: "Deploy production",
  workflowFile: ".github/workflows/deploy-production.yml",
  // Skipped when nothing shipped, or `mobile_build` was `none`. Deploy
  // production's own alert covers a failed ship.
  gateJob: "mobile-plan",
  jobs: {
    "mobile-plan": "decide the app release (OTA update or store build)",
    mobile: "build the shipped commit for the stores and upload it",
    ota: "publish the shipped commit as an OTA update to the `production` channel",
  },
  alert: defineAlert({
    title: "Deploy production's app release failed — phones may not have what production serves",
    labels: ["area:ci", "P1"],
  }),
  impact:
    "The web and the API shipped, but the store build or the OTA update did not, so installed apps " +
    "are behind what production serves until a later Deploy production releases the app.",
  howToFix:
    `Open the failed step's log from the run link. A store upload that failed can be retried with ` +
    `Retry a store upload; an iOS build that fails on a provisioning profile capability needs the ` +
    `owner's interactive \`npm run eas -- credentials --platform ios\` on the \`production\` profile ` +
    `(${MOBILE_DOC} § 6.6).`,
  closesOn: "the next Deploy production with `mobile_build: auto` whose app release jobs all succeed",
};

export const ALERT_CONFIGS = {
  [STAGING_APP_CONFIG.name]: STAGING_APP_CONFIG,
  [PRODUCTION_MOBILE_CONFIG.name]: PRODUCTION_MOBILE_CONFIG,
};

const MARKER_PREFIX = "<!-- mobile-release-failing:";

/**
 * What this run proves: `no-run` (the gate job didn't run, so nothing was
 * released), `failed` (a job failed), `recovered` (an `auto` run in which every
 * job that ran succeeded) or `unproven` (green, but a choice other than `auto`
 * may have skipped a platform that still can't build, or a job was cancelled).
 */
export function classify(config, needs, build) {
  const results = Object.fromEntries(Object.keys(config.jobs).map((job) => [job, needs?.[job]?.result ?? "skipped"]));
  const failed = Object.keys(config.jobs).filter((job) => results[job] === "failure");
  if (results[config.gateJob] === "skipped") return { verdict: "no-run", results, failed };
  if (failed.length > 0) return { verdict: "failed", results, failed };
  const allDone = Object.values(results).every((result) => result === "success" || result === "skipped");
  if (allDone && build === "auto") return { verdict: "recovered", results, failed };
  return { verdict: "unproven", results, failed };
}

export function marker({ failed }, runtime = "") {
  return `${MARKER_PREFIX} ${[...failed].sort().join(",")}${runtime ? ` @${runtime}` : ""} -->`;
}

/**
 * The failed jobs of this attempt, each with its failed steps, read from the
 * Actions API. A called workflow's jobs appear here by their own names, which
 * `needs` can't show. Empty when the read fails: the alert still goes out.
 */
export async function readFailedSteps({ token, repo, runId, attempt, fetchImpl = fetch }) {
  if (!runId) return [];
  const path = `/repos/${repo}/actions/runs/${runId}/attempts/${attempt || 1}/jobs?per_page=100`;
  const { ok, data } = await ghRequest({ token, fetchImpl, path, retry: true });
  if (!ok || !Array.isArray(data?.jobs)) return [];
  return data.jobs
    .filter((job) => job.conclusion === "failure")
    .map((job) => ({
      name: job.name,
      url: job.html_url ?? "",
      steps: (job.steps ?? []).filter((step) => step.conclusion === "failure").map((step) => step.name),
    }));
}

function describeFailure(config, classified, failedSteps) {
  const lines = classified.failed.map((job) => `- \`${job}\`: could not ${config.jobs[job]}.`);
  if (failedSteps.length > 0) {
    lines.push("", "Failed steps:");
    for (const job of failedSteps) {
      const where = job.url ? `[${job.name}](${job.url})` : job.name;
      lines.push(`- ${where}${job.steps.length > 0 ? `: ${job.steps.map((s) => `"${s}"`).join(", ")}` : ""}`);
    }
  }
  return lines;
}

function context({ sha, runtime, runUrl }) {
  return [
    sha ? `Commit: \`${sha}\`` : "",
    runtime ? `Runtime: \`${runtime}\`` : "",
    runUrl ? `Run: ${runUrl}` : "",
  ].filter(Boolean);
}

export function buildIssueBody(config, classified, { failedSteps = [], sha = "", runtime = "", runUrl = "" } = {}) {
  return [
    `A **${config.workflowLabel}** run failed to release the app (\`${config.workflowFile}\`).`,
    "",
    ...describeFailure(config, classified, failedSteps),
    "",
    `**What it means.** ${config.impact}`,
    "",
    `**What to do.** ${config.howToFix}`,
    "",
    `This alert comments only when what fails changes, and closes on ${config.closesOn}.`,
    "",
    ...context({ sha, runtime, runUrl }),
    "",
    marker(classified, runtime),
  ].join("\n");
}

export function buildCommentBody(config, classified, { failedSteps = [], sha = "", runtime = "", runUrl = "", reopened = false } = {}) {
  return [
    reopened ? `**Reopened.** ${config.workflowLabel} failed to release the app again.` : "What fails changed. Now:",
    "",
    ...describeFailure(config, classified, failedSteps),
    "",
    ...context({ sha, runtime, runUrl }),
  ].join("\n");
}

export function buildRecoveryBody(config, { sha = "", runtime = "", runUrl = "" } = {}) {
  return [`**Recovered.** A ${config.workflowLabel} run released the app with every job green.`, "", ...context({ sha, runtime, runUrl })].join("\n");
}

function defaultWriteSummary(markdown) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (path) appendFileSync(path, `${markdown}\n`);
}

/** Raise, leave or close the alert for one run. Returns `{ verdict, alert }`. */
export async function runAlert({
  token,
  repo,
  config,
  needs,
  build = "",
  runtime = "",
  sha = "",
  runUrl = "",
  runId = "",
  attempt = "",
  fetchImpl = fetch,
  writeSummary = defaultWriteSummary,
  logger = console,
}) {
  const classified = classify(config, needs, build);
  const { verdict } = classified;
  let alert = { action: "none", issueNumber: null };

  if (verdict === "recovered") {
    alert = await resolveAlert({
      token,
      repo,
      fetchImpl,
      alert: config.alert,
      buildRecoveryBody: () => buildRecoveryBody(config, { sha, runtime, runUrl }),
    });
  } else if (verdict === "failed") {
    logger.log?.(`::error::${config.workflowLabel}: ${classified.failed.join(", ")} failed; alerting the owner.`);
    const lookup = await findAlertIssuesDetailed({ token, repo, fetchImpl, alert: config.alert });
    const open = lookup.lookupOk ? lookup.issues.find((issue) => issue.state === "open") : null;
    if (!lookup.lookupOk) {
      // Raising blind could file a duplicate, but silence is the failure this
      // script exists to prevent, and the lib's resolve closes every duplicate.
      logger.log?.("::warning::Could not read the alert issues; raising without the marker check.");
    }
    if (open && markerLine(open.body, MARKER_PREFIX) === marker(classified, runtime)) {
      // One email per change in what fails, not one per merge.
      alert = { action: "unchanged", issueNumber: open.number };
    } else {
      const failedSteps = await readFailedSteps({ token, repo, runId, attempt, fetchImpl });
      const details = { failedSteps, sha, runtime, runUrl };
      alert = await raiseAlert({
        token,
        repo,
        fetchImpl,
        alert: config.alert,
        lookup,
        buildIssueBody: () => buildIssueBody(config, classified, details),
        buildCommentBody: ({ reopened }) => buildCommentBody(config, classified, { ...details, reopened }),
        // The body holds the marker, so it has to track what fails now.
        refreshBodyOnRaise: true,
      });
    }
  }

  logger.log?.(`[mobile-release-alert:${config.name}] verdict ${verdict}; alert ${alert.action}${alert.issueNumber ? ` #${alert.issueNumber}` : ""}`);
  writeSummary(
    [
      `## ${config.workflowLabel}: app release alert`,
      "",
      `Verdict: **${verdict}**. Alert: ${alert.action}${alert.issueNumber ? ` (#${alert.issueNumber})` : ""}.`,
      ...Object.entries(classified.results).map(([job, result]) => `- \`${job}\`: ${result}`),
    ].join("\n"),
  );
  return { verdict, alert };
}

/** 1 only when the alert's state is unknown or a write failed. */
export function exitCodeFor({ alert }) {
  return alert.action === "failed" || alert.action === "unread" ? 1 : 0;
}

export async function main({ env = process.env, alert = runAlert } = {}) {
  const config = selectAlertConfig(ALERT_CONFIGS, env.ALERT_CONFIG, "ALERT_CONFIG");
  const token = requireEnv("GITHUB_TOKEN", { env });
  const repo = requireEnv("GITHUB_REPOSITORY", { env });
  const needs = JSON.parse(requireEnv("NEEDS", { env }));
  return exitCodeFor(
    await alert({
      token,
      repo,
      config,
      needs,
      build: env.BUILD ?? "",
      runtime: env.RUNTIME ?? "",
      sha: env.SHA ?? "",
      runUrl: env.RUN_URL ?? "",
      runId: env.RUN_ID ?? "",
      attempt: env.RUN_ATTEMPT ?? "",
    }),
  );
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
