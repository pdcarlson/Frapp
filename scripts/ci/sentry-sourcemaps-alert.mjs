#!/usr/bin/env node

// Turn the deploy job's source-map verdicts into alert issues (#2489).
//
// `verify-sentry-sourcemaps.mjs` runs at the end of `_deploy.yml`'s job, which
// holds the Sentry token and no GitHub write scope, and hands its verdicts out
// as the job output `sourcemaps`: one word per project, in
// `SOURCEMAP_PROJECTS` order. This runs in the caller's `deploy-outcome` job,
// which holds `issues: write` and no Sentry token, and files them through the
// shared alert lib, the path every other watchdog uses (`defineAlert`,
// #1731).
//
// The words carry no environment, SHA or detail, because the runner drops a
// job output that contains a value the Infisical injection masked, and
// `staging` and `production` are among them (see the verifier's header). So
// the environment and the SHA come from this job's own context, and each
// alert says what its verdict means and points at the deploy job's step
// summary for the specifics.
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
//   present                                 → close the alert (maps are back)
//   missing, no-token, rejected, no-project → raise it
//   unverifiable                            → annotate, change nothing: no
//                                             answer proves nothing either way
//   unbuilt                                 → nothing: this run didn't build it
// A project still waiting for its Sentry project (`awaitingProject` in
// `SOURCEMAP_PROJECTS`: `frapp-landing`, #2071) is raised only by `missing`,
// the one failing verdict that proves the project exists. Its `no-project` is
// the known state, and its `no-token` and `rejected` are already carried by
// the other projects' alerts, so they are notices.
//
// A report that should have arrived and didn't (the check step ran, per
// SOURCEMAPS_CHECKED, but SOURCEMAPS is empty) is a warning, never "nothing
// built". Either the verifier wrote nothing (it crashed, and says so in the
// deploy job's log) or the runner dropped the output as masked; no alert can
// be judged from it either way.
//
// **P2, not P1:** stack traces arrive minified, nothing is down.
//
// Exits 0 on every handled outcome, and a crash is a warning: a red
// `deploy-outcome` after a green deploy would read as a failed deploy. A
// missing required variable is a wiring bug, and exits 1 like every other
// script here.
//
// Env inputs:
//   GITHUB_TOKEN        — required (issues: write)
//   GITHUB_REPOSITORY   — required, owner/repo
//   RUN_URL             — required, html_url of this run
//   TARGET_ENVIRONMENT  — required: staging or production
//   DEPLOY_SHA          — required: the commit the run deployed
//   SOURCEMAPS          — `needs.deploy.outputs.sourcemaps`; empty when the
//                         run built nothing that uploads maps
//   SOURCEMAPS_CHECKED  — `needs.deploy.outputs.sourcemaps-checked`: the two
//                         check steps' outcomes, run together
//
// Unit tests: `scripts/ci/__tests__/sentry-sourcemaps-alert.test.mjs`.

import { defineAlert, raiseAlert, resolveAlert } from "./lib/alert-issue.mjs";
import { requireEnv } from "./lib/env.mjs";
import { ENVIRONMENTS, getEnvironment } from "./lib/environments.mjs";
import { isInvokedDirectly } from "./lib/invoked-directly.mjs";
import { SOURCEMAP_PROJECTS, VERDICTS } from "./verify-sentry-sourcemaps.mjs";

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
 * `{ <project>: <verdict> }` from the output's words, or `null` for an empty
 * output. Anything else that isn't one known verdict per project throws: a
 * malformed output is a bug between the two scripts, not a verdict.
 */
export function parseVerdicts(raw) {
  if (raw === undefined || raw === null || raw.trim() === "") return null;
  const words = raw.trim().split(/\s+/);
  const projects = Object.keys(SOURCEMAP_PROJECTS);
  if (words.length !== projects.length) {
    throw new Error(`the source-map output has ${words.length} verdict(s) for ${projects.length} projects: ${JSON.stringify(raw)}`);
  }
  for (const word of words) {
    if (!VERDICTS.includes(word)) throw new Error(`the source-map output holds the unknown verdict ${JSON.stringify(word)}`);
  }
  return Object.fromEntries(projects.map((project, i) => [project, words[i]]));
}

/** Whether either check step ran, from `SOURCEMAPS_CHECKED` (two step outcomes, run together). */
export function checkRan(checked) {
  return /success/.test(checked ?? "");
}

/** `raise`, `resolve`, `notice` or `none` for one project's verdict. */
export function actionFor(project, verdict) {
  if (verdict === "unbuilt") return "none";
  if (verdict === "present") return "resolve";
  if (!RAISING.has(verdict)) return "notice";
  if (SOURCEMAP_PROJECTS[project].awaitingProject && verdict !== "missing") return "notice";
  return "raise";
}

const MEANS = {
  missing: "Sentry answered, and holds no artifact bundle for this release that this deploy's build uploaded.",
  "no-token": "the deploy job got no `SENTRY_AUTH_TOKEN` from Infisical, so its builds uploaded nothing.",
  rejected: "Sentry refused the token the uploads use.",
  "no-project": "Sentry answered 404 for this project.",
};

function fixFor(verdict, infisicalSlug) {
  switch (verdict) {
    case "missing":
      return (
        "Read the build that uploaded (or should have). The API's Render build logs `WARNING: … frapp-api source-map upload not confirmed` when `sentry-cli` failed, " +
        "and `SENTRY_AUTH_TOKEN unset; skipping` when Render's environment lacks the token (check the Infisical sync); " +
        "a failed upload is cached with its Docker layer, so clear Render's build cache before redeploying the same commit. " +
        "Web and landing log the Sentry plugin's error in the `Build the Vercel … bundles` step of the deploy run."
      );
    case "no-token":
      return (
        `Add \`SENTRY_AUTH_TOKEN\` (a Sentry org auth token) to Infisical \`${infisicalSlug}\`. Render and the deploy job both read it from there; ` +
        "never set it on the platform ([SECRETS_MANAGEMENT.md § 5](https://github.com/pdcarlson/Frapp/blob/main/docs/internal/environment/SECRETS_MANAGEMENT.md#5-configure-secret-syncs))."
      );
    case "rejected":
      return "The token was revoked, rotated without updating Infisical, or lost its scope. Mint a new org auth token in Sentry, put it in Infisical, and redeploy.";
    case "no-project":
      return "The Sentry project was renamed or deleted, or Sentry moved the artifact-bundles endpoint. Check the project slug in Sentry against the one the build uploads to.";
    default:
      return "";
  }
}

function infisicalSlugFor(environment) {
  try {
    return getEnvironment(environment).infisicalEnvSlug ?? environment;
  } catch {
    return environment;
  }
}

function describe({ project, environment, sha, verdict, runUrl }) {
  return [
    `**${project} on ${environment}:** \`${verdict}\` for \`${sha}\`: ${MEANS[verdict]}`,
    "",
    `**Fix:** ${fixFor(verdict, infisicalSlugFor(environment))}`,
    "",
    `Run: ${runUrl} (the deploy job's step summary, *Sentry source maps for \`${sha}\`*, has what Sentry answered).`,
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

export function buildRecoveryBody({ project, environment, sha, runUrl }) {
  return [
    `**Recovered.** Sentry holds ${project}'s source maps for \`${sha}\` on ${environment}. Closing.`,
    "",
    `Run: ${runUrl}`,
    "",
    "_Closed automatically by `scripts/ci/sentry-sourcemaps-alert.mjs`._",
  ].join("\n");
}

export async function reportSourcemaps({
  environment,
  sha,
  verdicts,
  checked,
  token,
  repo,
  runUrl,
  fetchImpl = fetch,
  logger = console,
}) {
  if (!verdicts) {
    logger.log(
      checkRan(checked)
        ? "::warning::The source-map check ran, but no verdicts reached this job, so no alert changes. Either the check wrote none " +
            "(look for its `crashed` warning in the deploy job) or the runner dropped the output as containing a masked value."
        : "No source-map verdicts: this run built nothing that uploads source maps, so no alert changes.",
    );
    return [];
  }
  const outcomes = [];
  for (const [project, verdict] of Object.entries(verdicts)) {
    const action = actionFor(project, verdict);
    if (action === "none") continue;
    const context = { project, environment, sha, verdict, runUrl };
    const alert = alertFor(environment, project);
    if (action === "notice") {
      const awaiting = SOURCEMAP_PROJECTS[project].awaitingProject;
      logger.log(
        verdict === "unverifiable"
          ? `::warning::${project} on ${environment}: source maps unverifiable (the deploy job's step summary says why). Its alert is left as it is.`
          : `::notice::${project} on ${environment}: ${verdict}. It has no Sentry project until #${awaiting}, so this changes no alert.`,
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
        logger.log(`::warning::${project} on ${environment}: maps are present, but its alert could not be closed (${result.action}).`);
      } else if (result.action === "closed") {
        logger.log(`${project} on ${environment}: maps present; closed #${result.closed.join(", #")}.`);
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
        ? `::warning::${project} on ${environment}: ${verdict}, and its alert issue could not be written.`
        : `${project} on ${environment}: ${verdict}; alert #${result.issueNumber} ${result.action}.`,
    );
    outcomes.push({ project, verdict, action: result.action });
  }
  return outcomes;
}

async function main() {
  const token = requireEnv("GITHUB_TOKEN");
  const repo = requireEnv("GITHUB_REPOSITORY");
  const runUrl = requireEnv("RUN_URL");
  const environment = requireEnv("TARGET_ENVIRONMENT");
  const sha = requireEnv("DEPLOY_SHA");
  if (!ENVIRONMENTS.includes(environment)) {
    throw new Error(`TARGET_ENVIRONMENT is ${JSON.stringify(environment)}, not one of ${ENVIRONMENTS.join(", ")}`);
  }
  let verdicts;
  try {
    verdicts = parseVerdicts(process.env.SOURCEMAPS);
  } catch (error) {
    console.log(`::warning::The deploy job's source-map verdicts could not be read, so no alert changes: ${error.message}`);
    return;
  }
  await reportSourcemaps({ environment, sha, verdicts, checked: process.env.SOURCEMAPS_CHECKED, token, repo, runUrl });
}

if (isInvokedDirectly(import.meta.url)) {
  main().catch((error) => {
    console.log(`::warning::Source-map alerting crashed, so no alert changed: ${error?.stack ?? error}`);
  });
}
