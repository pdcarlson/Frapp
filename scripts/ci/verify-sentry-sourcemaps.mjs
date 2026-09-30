#!/usr/bin/env node

// Ask Sentry whether the commit a deploy just shipped has its source maps
// (#2489), so a build that uploads none stops passing unnoticed.
//
// ── Why this exists ─────────────────────────────────────────────────────────
// All three deployed surfaces upload source maps on a best-effort basis, and
// that is deliberate: symbolicated stack traces are telemetry, and they must
// not gate shipping (#2431). The API's Render build logs one `WARNING:` line
// when `sentry-cli` fails and carries on
// (`apps/api/src/infrastructure/observability/upload-sentry-sourcemaps.ts`).
// Web's and landing's Sentry plugin logs a recoverable error and carries on.
// With no `SENTRY_AUTH_TOKEN` at all, all three skip the upload in silence. So
// a revoked or rotated token, a lost scope, a renamed Sentry project, or a
// token missing from an environment kept every build green while it shipped
// without maps. Someone found out only on opening a production error and
// reading compiled frames, which is the worst time to find out.
//
// This asks the one place that knows: after the deploy, does Sentry hold an
// artifact bundle for each project this run built, associated with the
// deployed commit as its release? Every upload in this repo names that
// release: the API passes `--release` = `RENDER_GIT_COMMIT`, and web and
// landing pass `release.name` = `VERCEL_GIT_COMMIT_SHA`, both the deployed SHA.
//
// ── The question it asks ────────────────────────────────────────────────────
//   GET <SENTRY_URL>/api/0/projects/<org>/<project>/files/artifact-bundles/?query=<sha>
// Debug-ID uploads (`sentry-cli sourcemaps upload`, and the Next plugin's) are
// artifact bundles, not the release files the documented
// `/releases/<version>/files/` endpoint lists. This endpoint is the one
// Sentry's own Settings → Source Maps page reads. It is undocumented, and it
// sits behind the same release permission as the documented one, whose scopes
// include `org:ci`: the org auth token that uploads can read it. It could not
// be called from where this was written (`sentry.io` is outside the agent
// sandbox's allowlist), so its answer is read defensively: any shape other
// than an array of bundles is `unverifiable`, never a verdict about the maps.
//
// ── Verdicts, one per project ───────────────────────────────────────────────
//   present      — a bundle is associated with the deployed SHA
//   missing      — Sentry answered, and no bundle is (re-asked for a while
//                  first, because Sentry assembles an upload after it lands)
//   no-token     — this job has no SENTRY_AUTH_TOKEN, so the build it ran, or
//                  the Render build synced from the same Infisical environment,
//                  uploaded nothing
//   rejected     — 401/403: the token that uploads can't read either
//   no-project   — 404: no such Sentry project (renamed, deleted, or never
//                  created: `frapp-landing` until #2071)
//   unverifiable — no answer to judge: the network, a 5xx after retries, a
//                  429, or a body that isn't the expected list
// `sentry-sourcemaps-alert.mjs` turns these into alert issues in the caller's
// `deploy-outcome` job, which holds `issues: write`. This job holds the Sentry
// token and no write scope; that one holds the write scope and no token.
//
// ── It never fails the deploy ───────────────────────────────────────────────
// Every verdict, and every error in here, exits 0 with an annotation. The maps
// are best effort, so the check on them is too: a deploy that shipped must not
// go red, and raise the deploy alert, because Sentry was slow. `_deploy.yml`
// sets no `continue-on-error` (its tests forbid it), so this file's own
// catch-all is what holds that line.
//
// Env inputs:
//   TARGET_ENVIRONMENT — required: staging or production
//   DEPLOY_SHA         — required: the full commit SHA the run deployed
//   API_BUILT          — `true` when this run built the API image on Render
//   FRONTENDS_BUILT    — `true` when this run built web and landing
//   SENTRY_AUTH_TOKEN  — from the Infisical injection; absent → `no-token`
//   SENTRY_URL         — optional, default https://sentry.io (sentry-cli's
//                        default, which the uploads use)
//   GITHUB_OUTPUT      — `verdicts=<json>` is written here
//   GITHUB_STEP_SUMMARY — a table of the verdicts is appended here
//
// Unit tests: `scripts/ci/__tests__/verify-sentry-sourcemaps.test.mjs`.

import { appendFileSync } from "node:fs";

import { resilientFetch } from "./lib/http.mjs";
import { isInvokedDirectly } from "./lib/invoked-directly.mjs";
import { createClock } from "./lib/polling.mjs";

export const SENTRY_ORG = "frapp-live";
export const DEFAULT_SENTRY_URL = "https://sentry.io";

/**
 * The Sentry projects a deploy uploads to, and which build uploads each.
 *
 * `awaitingProject` names the issue that creates a project that does not
 * exist yet. Until it does, only a verdict proving the project exists
 * (`missing`, `present`) may change its alert; see
 * `sentry-sourcemaps-alert.mjs`. Delete the key once #2071 is done.
 */
export const SOURCEMAP_PROJECTS = Object.freeze({
  "frapp-api": Object.freeze({ builtBy: "api" }),
  "frapp-web": Object.freeze({ builtBy: "frontends" }),
  "frapp-landing": Object.freeze({ builtBy: "frontends", awaitingProject: 2071 }),
});

export const ENVIRONMENTS = Object.freeze(["staging", "production"]);

// The Infisical slug each environment's secrets come from: production's is
// `prod`, not `production`.
const INFISICAL_SLUGS = Object.freeze({ staging: "staging", production: "prod" });

export const VERDICTS = Object.freeze([
  "present",
  "missing",
  "no-token",
  "rejected",
  "no-project",
  "unverifiable",
]);

/** How often, and how long, a `missing` answer is re-asked. */
export const MISSING_RETRY_INTERVAL_MS = 15 * 1000;
export const MISSING_ATTEMPTS = 5;

const SHA_PATTERN = /^[0-9a-f]{40}$/;

/** The projects a run built, in `SOURCEMAP_PROJECTS` order. */
export function projectsToCheck({ apiBuilt, frontendsBuilt }) {
  return Object.entries(SOURCEMAP_PROJECTS)
    .filter(([, { builtBy }]) => (builtBy === "api" ? apiBuilt : frontendsBuilt))
    .map(([project]) => project);
}

export function artifactBundlesUrl({ baseUrl = DEFAULT_SENTRY_URL, org = SENTRY_ORG, project, release }) {
  const base = baseUrl.replace(/\/+$/, "");
  return (
    `${base}/api/0/projects/${encodeURIComponent(org)}/${encodeURIComponent(project)}` +
    `/files/artifact-bundles/?query=${encodeURIComponent(release)}`
  );
}

/**
 * `present` when a bundle with files is associated with `release`, `missing`
 * when the list holds none, `unverifiable` when the body is not a list of
 * bundles at all. A bundle's `associations` is its `[{ release, dist }]`.
 */
export function classifyBundles(data, release) {
  if (!Array.isArray(data)) {
    return { verdict: "unverifiable", detail: "Sentry answered 200 with something other than a list of artifact bundles" };
  }
  if (data.some((bundle) => !Array.isArray(bundle?.associations))) {
    return { verdict: "unverifiable", detail: "Sentry listed artifact bundles without `associations`, so their releases can't be read" };
  }
  const matching = data.filter(
    (bundle) =>
      bundle.associations.some((association) => association?.release === release) &&
      // `fileCount` is read only when Sentry sends it; an empty bundle is no maps.
      !(typeof bundle.fileCount === "number" && bundle.fileCount <= 0),
  );
  if (matching.length > 0) {
    const files = matching.reduce((sum, bundle) => sum + (typeof bundle.fileCount === "number" ? bundle.fileCount : 0), 0);
    return {
      verdict: "present",
      detail: `${matching.length} artifact bundle(s)${files > 0 ? `, ${files} file(s),` : ""} for this release`,
    };
  }
  return { verdict: "missing", detail: "no artifact bundle is associated with this release" };
}

/** One project's verdict: one read, re-asked only while the answer is `missing`. */
export async function checkProject({
  project,
  release,
  token,
  baseUrl = DEFAULT_SENTRY_URL,
  fetchImpl = resilientFetch,
  clock = createClock(),
  attempts = MISSING_ATTEMPTS,
  intervalMs = MISSING_RETRY_INTERVAL_MS,
}) {
  const url = artifactBundlesUrl({ baseUrl, project, release });
  let result;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    result = await readOnce({ url, release, token, fetchImpl });
    if (result.verdict !== "missing" || attempt === attempts) break;
    await clock.sleep(intervalMs);
  }
  if (result.verdict === "missing" && attempts > 1) {
    const waitedS = Math.round(((attempts - 1) * intervalMs) / 1000);
    return { ...result, detail: `${result.detail}, after asking ${attempts} times over ${waitedS}s` };
  }
  return result;
}

async function readOnce({ url, release, token, fetchImpl }) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
  } catch (error) {
    // undici puts the real reason (ENOTFOUND, ECONNRESET) on `cause`.
    const reason = [error?.message ?? String(error), error?.cause?.message].filter(Boolean).join(": ");
    return { verdict: "unverifiable", detail: `the request to Sentry failed: ${reason}` };
  }
  if (response.status === 401 || response.status === 403) {
    return {
      verdict: "rejected",
      detail: `Sentry refused the token (HTTP ${response.status}); the upload uses the same token, so it can't have uploaded either`,
    };
  }
  if (response.status === 404) {
    return { verdict: "no-project", detail: "Sentry answered 404: no such project in the org, or the endpoint moved" };
  }
  if (!response.ok) {
    return { verdict: "unverifiable", detail: `Sentry answered HTTP ${response.status}` };
  }
  let data;
  try {
    data = await response.json();
  } catch (error) {
    return { verdict: "unverifiable", detail: `Sentry's answer was not JSON (${error?.message ?? error})` };
  }
  return classifyBundles(data, release);
}

/**
 * Every project this run built, each with a verdict, or `null` with a reason
 * when the inputs don't describe a deploy to check.
 */
export async function verifySentrySourcemaps({
  env = process.env,
  fetchImpl = resilientFetch,
  clock = createClock(),
  attempts,
  intervalMs,
} = {}) {
  const environment = env.TARGET_ENVIRONMENT;
  const sha = env.DEPLOY_SHA;
  if (!ENVIRONMENTS.includes(environment)) {
    return { report: null, reason: `TARGET_ENVIRONMENT is ${JSON.stringify(environment ?? null)}, not one of ${ENVIRONMENTS.join(", ")}` };
  }
  if (!SHA_PATTERN.test(sha ?? "")) {
    return { report: null, reason: `DEPLOY_SHA is ${JSON.stringify(sha ?? null)}, not a full lowercase commit SHA` };
  }
  const projects = projectsToCheck({
    apiBuilt: env.API_BUILT === "true",
    frontendsBuilt: env.FRONTENDS_BUILT === "true",
  });
  if (projects.length === 0) {
    return { report: null, reason: "this run built nothing that uploads source maps" };
  }
  const token = env.SENTRY_AUTH_TOKEN?.trim();
  const baseUrl = env.SENTRY_URL?.trim() || DEFAULT_SENTRY_URL;
  const results = {};
  for (const project of projects) {
    results[project] = token
      ? await checkProject({ project, release: sha, token, baseUrl, fetchImpl, clock, attempts, intervalMs })
      : {
          verdict: "no-token",
          detail:
            `this job got no SENTRY_AUTH_TOKEN from Infisical \`${INFISICAL_SLUGS[environment]}\`, and the builds read the ` +
            "same environment (web and landing in this job, the API through Render's sync), so they uploaded nothing",
        };
  }
  return { report: { environment, sha, projects: results } };
}

const ANNOTATION = {
  present: null,
  missing: "warning",
  "no-token": "warning",
  rejected: "warning",
  "no-project": "warning",
  unverifiable: "warning",
};

export function annotationsFor(report) {
  return Object.entries(report.projects)
    .filter(([, { verdict }]) => ANNOTATION[verdict])
    .map(
      ([project, { verdict, detail }]) =>
        `::${ANNOTATION[verdict]}::Sentry source maps for ${project} on ${report.environment}: ${verdict} — ${detail}`,
    );
}

export function buildSummary(report) {
  const rows = Object.entries(report.projects).map(
    ([project, { verdict, detail }]) => `| \`${project}\` | \`${verdict}\` | ${detail.replace(/\|/g, "\\|")} |`,
  );
  return [
    `### Sentry source maps — ${report.environment} — \`${report.sha}\``,
    "",
    "| Project | Verdict | Detail |",
    "| --- | --- | --- |",
    ...rows,
    "",
    "The deploy's outcome does not depend on this table: maps are best effort (#2431). The `deploy-outcome` job raises or closes one alert per project from it (#2489).",
    "",
  ].join("\n");
}

async function main() {
  const { report, reason } = await verifySentrySourcemaps();
  if (!report) {
    console.log(`::warning::Sentry source-map check did not run: ${reason}.`);
    return;
  }
  for (const line of annotationsFor(report)) console.log(line);
  for (const [project, { verdict, detail }] of Object.entries(report.projects)) {
    console.log(`${project}: ${verdict} — ${detail}`);
  }
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `verdicts=${JSON.stringify(report)}\n`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, buildSummary(report));
  }
}

if (isInvokedDirectly(import.meta.url)) {
  // Exit 0 whatever happens: see "It never fails the deploy" above.
  main().catch((error) => {
    console.log(`::warning::Sentry source-map check crashed, so nothing was checked: ${error?.stack ?? error}`);
  });
}
