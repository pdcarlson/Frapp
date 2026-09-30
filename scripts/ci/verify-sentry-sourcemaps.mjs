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
// ── Whose bundle counts ─────────────────────────────────────────────────────
// Staging and production upload to the same Sentry projects under the same
// release name, so a bundle for the SHA may be the other environment's.
//   * Web and landing: only a bundle uploaded since this run's builds began
//     (`SOURCEMAPS_SINCE`, noted by the step before them) counts. Their builds
//     inline each environment's `NEXT_PUBLIC_*` values, so staging's chunks,
//     and the debug IDs derived from them, are not production's, and
//     staging's maps can't symbolicate a production frame. Known limit: a
//     staging deploy of the same commit that uploads while this run builds
//     would still count.
//   * The API: any bundle for the release counts. Its image is the same bytes
//     in both environments (nothing is inlined at build time), and
//     `sentry-cli sourcemaps inject` derives each debug ID from the file's
//     contents, so either environment's bundle symbolicates both. Filtering by
//     time would instead cry wolf on a same-commit redeploy, where Render
//     reuses the cached upload layer and uploads nothing new.
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
//   present      — a bundle that counts (above) is associated with the SHA
//   missing      — Sentry answered, and none is (re-asked for a minute first,
//                  because Sentry assembles an upload after it lands)
//   no-token     — this job has no SENTRY_AUTH_TOKEN, so the build it ran, or
//                  the Render build synced from the same Infisical environment,
//                  uploaded nothing
//   rejected     — 401, or 403 from both this endpoint and the documented
//                  releases list: the token that uploads can't read either.
//                  A 403 here with a readable releases list is `unverifiable`:
//                  the undocumented endpoint wants a scope the upload may not
//   no-project   — 404: no such Sentry project (renamed, deleted, or never
//                  created: `frapp-landing` until #2071)
//   unverifiable — no answer to judge: the network, a 5xx after retries, a
//                  429, a body that isn't the expected list, or a bundle
//                  whose upload time can't be read where that time decides
//   unbuilt      — this run didn't build the project; nothing was asked
//
// ── Why the output is only words ────────────────────────────────────────────
// The verdicts leave this job as the output `verdicts`: one word per project,
// in `SOURCEMAP_PROJECTS` order, e.g. `present missing unbuilt`. Nothing else
// may go in it. The Infisical injection registers every value it sets as a
// masked secret, and those include `NODE_ENV` (`staging`, `production`) and a
// `PORT` a SHA can contain. The runner drops any job output that contains a
// masked value ("Skip output … since it may contain secret"), so an output
// carrying the environment name, the SHA or free text would reach
// `deploy-outcome` empty, and read as "nothing built" (#2489 review). The
// words above contain none of those. The details go to the annotations and
// the step summary instead, where masking only blanks a word; this script
// never names the environment, which reaches `deploy-outcome` another way.
//
// `sentry-sourcemaps-alert.mjs` turns the words into alert issues in the
// caller's `deploy-outcome` job, which holds `issues: write`. This job holds
// the Sentry token and no write scope; that one holds the write scope and no
// token.
//
// ── It never fails the deploy, and it is bounded ────────────────────────────
// Every verdict, and every error in here, exits 0 with an annotation. The maps
// are best effort, so the check on them is too: a deploy that shipped must not
// go red, and raise the deploy alert, because Sentry was slow. `_deploy.yml`
// sets no `continue-on-error` (its tests forbid it), so this file's own
// catch-all is what holds that line. The projects are asked concurrently, and
// each stops re-asking after `MISSING_WINDOW_MS`, so the step takes that
// window plus one read (a read is at most ~51 s: `resilientFetch`'s three
// 15 s attempts and their backoff), about two minutes at worst.
//
// Env inputs:
//   DEPLOY_SHA         — required: the full commit SHA the run deployed
//   API_BUILT          — `true` when this run built the API image on Render
//   FRONTENDS_BUILT    — `true` when this run built web and landing
//   SOURCEMAPS_SINCE   — ISO time the run's builds began; required for web and
//                        landing to be judged at all
//   SENTRY_AUTH_TOKEN  — from the Infisical injection; absent → `no-token`
//   SENTRY_URL         — optional, default https://sentry.io (sentry-cli's
//                        default, which the uploads use)
//   GITHUB_OUTPUT      — `verdicts=<words>` is written here
//   GITHUB_STEP_SUMMARY — a table of the verdicts and their details
//
// Unit tests: `scripts/ci/__tests__/verify-sentry-sourcemaps.test.mjs`.

import { appendFileSync } from "node:fs";

import { resilientFetch } from "./lib/http.mjs";
import { isInvokedDirectly } from "./lib/invoked-directly.mjs";
import { createClock, pollUntilTerminal } from "./lib/polling.mjs";

export const SENTRY_ORG = "frapp-live";
export const DEFAULT_SENTRY_URL = "https://sentry.io";

/**
 * The Sentry projects a deploy uploads to, in the order the output lists
 * them. `builtBy` says which build uploads each; `sinceThisRun` that only a
 * bundle uploaded by this run counts (see "Whose bundle counts").
 *
 * `awaitingProject` names the issue that creates a project that does not
 * exist yet. Until it does, only a verdict proving the project exists
 * (`missing`, `present`) may change its alert; see
 * `sentry-sourcemaps-alert.mjs`. Delete the key once #2071 is done.
 */
export const SOURCEMAP_PROJECTS = Object.freeze({
  "frapp-api": Object.freeze({ builtBy: "api", sinceThisRun: false }),
  "frapp-web": Object.freeze({ builtBy: "frontends", sinceThisRun: true }),
  "frapp-landing": Object.freeze({ builtBy: "frontends", sinceThisRun: true, awaitingProject: 2071 }),
});

/** Every word the output may hold. None contains a masked value (see above). */
export const VERDICTS = Object.freeze([
  "present",
  "missing",
  "no-token",
  "rejected",
  "no-project",
  "unverifiable",
  "unbuilt",
]);

/** How often, and for how long, a `missing` answer is re-asked. */
export const MISSING_RETRY_INTERVAL_MS = 15 * 1000;
export const MISSING_WINDOW_MS = 60 * 1000;

/**
 * Slack for the runner's clock against Sentry's, when a bundle's upload time
 * is compared with `SOURCEMAPS_SINCE`. Far below the minutes between a run's
 * builds starting and any other run's upload of the same commit.
 */
export const CLOCK_SKEW_MS = 60 * 1000;

const FULL_SHA = /^[0-9a-f]{40}$/;

/** The projects a run built, in `SOURCEMAP_PROJECTS` order. */
export function projectsToCheck({ apiBuilt, frontendsBuilt }) {
  return Object.entries(SOURCEMAP_PROJECTS)
    .filter(([, { builtBy }]) => (builtBy === "api" ? apiBuilt : frontendsBuilt))
    .map(([project]) => project);
}

function apiBase(baseUrl) {
  return `${baseUrl.replace(/\/+$/, "")}/api/0`;
}

export function artifactBundlesUrl({ baseUrl = DEFAULT_SENTRY_URL, org = SENTRY_ORG, project, release }) {
  return (
    `${apiBase(baseUrl)}/projects/${encodeURIComponent(org)}/${encodeURIComponent(project)}` +
    `/files/artifact-bundles/?query=${encodeURIComponent(release)}`
  );
}

/**
 * The documented "List an Organization's Releases", which `org:ci` may read.
 * Asked only after a 403 from the artifact-bundles endpoint, to tell a token
 * that can read nothing (revoked, or lost its scope: the upload fails too)
 * from one the undocumented endpoint wants another scope for (the upload may
 * be fine, so that is no verdict on the maps).
 */
export function releasesProbeUrl({ baseUrl = DEFAULT_SENTRY_URL, org = SENTRY_ORG, release }) {
  return `${apiBase(baseUrl)}/organizations/${encodeURIComponent(org)}/releases/?per_page=1&query=${encodeURIComponent(release)}`;
}

/** A bundle's latest upload time in ms, or null when Sentry sent none readable. */
function uploadedAt(bundle) {
  const times = [bundle.date, bundle.dateModified]
    .map((value) => (typeof value === "string" ? Date.parse(value) : Number.NaN))
    .filter((ms) => Number.isFinite(ms));
  return times.length > 0 ? Math.max(...times) : null;
}

/**
 * `present` when a bundle with files is associated with `release` (and, when
 * `sinceMs` is given, was uploaded at or after it), `missing` when none is,
 * `unverifiable` when the body is not a list of bundles, or when `sinceMs`
 * decides and a matching bundle's upload time can't be read. A bundle's
 * `associations` is its `[{ release, dist }]`.
 */
export function classifyBundles(data, release, { sinceMs = null } = {}) {
  if (!Array.isArray(data)) {
    return { verdict: "unverifiable", detail: "Sentry answered 200 with something other than a list of artifact bundles" };
  }
  if (data.some((bundle) => !Array.isArray(bundle?.associations))) {
    return { verdict: "unverifiable", detail: "Sentry listed artifact bundles without `associations`, so their releases can't be read" };
  }
  const forRelease = data.filter(
    (bundle) =>
      bundle.associations.some((association) => association?.release === release) &&
      // `fileCount` is read only when Sentry sends it; an empty bundle is no maps.
      !(typeof bundle.fileCount === "number" && bundle.fileCount <= 0),
  );
  let counted = forRelease;
  if (sinceMs !== null) {
    if (forRelease.some((bundle) => uploadedAt(bundle) === null)) {
      return {
        verdict: "unverifiable",
        detail: "a bundle for this release has no readable upload time, so whether this run uploaded it can't be told",
      };
    }
    counted = forRelease.filter((bundle) => uploadedAt(bundle) >= sinceMs - CLOCK_SKEW_MS);
  }
  if (counted.length > 0) {
    const files = counted.reduce((sum, bundle) => sum + (typeof bundle.fileCount === "number" ? bundle.fileCount : 0), 0);
    return {
      verdict: "present",
      detail: `${counted.length} artifact bundle(s)${files > 0 ? ` with ${files} file(s)` : ""} for this release${sinceMs !== null ? ", uploaded by this run" : ""}`,
    };
  }
  if (forRelease.length > 0) {
    return {
      verdict: "missing",
      detail: `no artifact bundle for this release was uploaded by this run; the ${forRelease.length} older one(s) are another build's, whose debug IDs this deploy's chunks don't share`,
    };
  }
  return { verdict: "missing", detail: "no artifact bundle is associated with this release" };
}

const REFUSED = "the upload uses the same token, so it can't have uploaded either";

async function get(url, token, fetchImpl) {
  try {
    return {
      response: await fetchImpl(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      }),
    };
  } catch (error) {
    // undici puts the real reason (ENOTFOUND, ECONNRESET) on `cause`.
    const reason = [error?.message ?? String(error), error?.cause?.message].filter(Boolean).join(": ");
    return { failure: { verdict: "unverifiable", detail: `the request to Sentry failed: ${reason}` } };
  }
}

async function readOnce({ project, release, sinceMs, token, baseUrl, fetchImpl }) {
  const { response, failure } = await get(artifactBundlesUrl({ baseUrl, project, release }), token, fetchImpl);
  if (failure) return failure;
  if (response.status === 401) {
    return { verdict: "rejected", detail: `Sentry refused the token (HTTP 401); ${REFUSED}` };
  }
  if (response.status === 403) {
    // A 403 on an undocumented endpoint may be a scope it wants that the
    // upload doesn't: ask a documented one before calling the token dead.
    const probe = await get(releasesProbeUrl({ baseUrl, release }), token, fetchImpl);
    if (probe.response?.ok) {
      return {
        verdict: "unverifiable",
        detail: "Sentry refused the artifact-bundles read (HTTP 403) but let the same token list releases, so it wants a scope the upload may not; the maps are unjudged",
      };
    }
    if (probe.response?.status === 401 || probe.response?.status === 403) {
      return { verdict: "rejected", detail: `Sentry refused the token (HTTP 403, and ${probe.response.status} listing releases); ${REFUSED}` };
    }
    return {
      verdict: "unverifiable",
      detail: `Sentry refused the artifact-bundles read (HTTP 403), and listing releases to tell why ${probe.failure ? "failed" : `answered HTTP ${probe.response.status}`}`,
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
  return classifyBundles(data, release, { sinceMs });
}

/**
 * One project's verdict: read, and re-ask only while the answer is `missing`,
 * until `windowMs` has passed. The loop is `pollUntilTerminal`'s, so the
 * window is a deadline, and the detail reports the time actually waited.
 */
export async function checkProject({
  project,
  release,
  sinceMs = null,
  token,
  baseUrl = DEFAULT_SENTRY_URL,
  fetchImpl = resilientFetch,
  clock = createClock(),
  windowMs = MISSING_WINDOW_MS,
  intervalMs = MISSING_RETRY_INTERVAL_MS,
}) {
  return pollUntilTerminal({
    fetchOne: () => readOnce({ project, release, sinceMs, token, baseUrl, fetchImpl }),
    classify: (result) => (result.verdict === "missing" ? null : result),
    onTimeout: (last, elapsedMs) =>
      last
        ? { ...last, detail: `${last.detail} (asked for ${Math.round(elapsedMs / 1000)}s)` }
        : { verdict: "unverifiable", detail: "no read finished inside the window" },
    clock,
    pollIntervalMs: intervalMs,
    overallTimeoutMs: windowMs,
    logger: { log: () => {} },
  });
}

/**
 * A verdict for every project in `SOURCEMAP_PROJECTS` (`unbuilt` for those
 * this run didn't build), or `null` with a reason when the inputs don't
 * describe a deploy to check.
 */
export async function verifySentrySourcemaps({
  env = process.env,
  fetchImpl = resilientFetch,
  clock = createClock(),
  windowMs,
  intervalMs,
} = {}) {
  const sha = env.DEPLOY_SHA;
  if (!FULL_SHA.test(sha ?? "")) {
    return { report: null, reason: "DEPLOY_SHA is not a full lowercase commit SHA" };
  }
  const built = projectsToCheck({
    apiBuilt: env.API_BUILT === "true",
    frontendsBuilt: env.FRONTENDS_BUILT === "true",
  });
  if (built.length === 0) {
    return { report: null, reason: "this run built nothing that uploads source maps" };
  }
  const since = env.SOURCEMAPS_SINCE ? Date.parse(env.SOURCEMAPS_SINCE) : Number.NaN;
  const token = env.SENTRY_AUTH_TOKEN?.trim();
  const baseUrl = env.SENTRY_URL?.trim() || DEFAULT_SENTRY_URL;
  const judge = async (project) => {
    if (!built.includes(project)) return { verdict: "unbuilt", detail: "this run didn't build it" };
    if (!token) {
      return {
        verdict: "no-token",
        detail:
          "this job got no SENTRY_AUTH_TOKEN from its Infisical injection, and the builds read the same Infisical " +
          "environment (web and landing in this job, the API through Render's sync), so they uploaded nothing",
      };
    }
    const { sinceThisRun } = SOURCEMAP_PROJECTS[project];
    if (sinceThisRun && !Number.isFinite(since)) {
      return { verdict: "unverifiable", detail: "SOURCEMAPS_SINCE is missing or unreadable, so this run's uploads can't be told from another build's" };
    }
    return checkProject({
      project,
      release: sha,
      sinceMs: sinceThisRun ? since : null,
      token,
      baseUrl,
      fetchImpl,
      clock,
      windowMs,
      intervalMs,
    });
  };
  const projects = Object.keys(SOURCEMAP_PROJECTS);
  // Concurrently: each project's re-asking window runs at the same time.
  const results = await Promise.all(projects.map(judge));
  return { report: Object.fromEntries(projects.map((project, i) => [project, results[i]])) };
}

/** The job output: one verdict word per project, in `SOURCEMAP_PROJECTS` order. */
export function outputWords(report) {
  return Object.keys(SOURCEMAP_PROJECTS)
    .map((project) => report[project].verdict)
    .join(" ");
}

const WARN = new Set(["missing", "no-token", "rejected", "no-project", "unverifiable"]);

export function annotationsFor(report) {
  return Object.entries(report)
    .filter(([, { verdict }]) => WARN.has(verdict))
    .map(([project, { verdict, detail }]) => `::warning::Sentry source maps for ${project}: ${verdict} — ${detail}`);
}

export function buildSummary(report, sha) {
  const rows = Object.entries(report).map(
    ([project, { verdict, detail }]) => `| \`${project}\` | \`${verdict}\` | ${detail.replace(/\|/g, "\\|")} |`,
  );
  return [
    `### Sentry source maps for \`${sha}\``,
    "",
    "| Project | Verdict | Detail |",
    "| --- | --- | --- |",
    ...rows,
    "",
    "The deploy's outcome does not depend on this table: maps are best effort (#2431). The `deploy-outcome` job raises or closes one alert per project from the verdicts (#2489).",
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
  for (const [project, { verdict, detail }] of Object.entries(report)) {
    console.log(`${project}: ${verdict} — ${detail}`);
  }
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `verdicts=${outputWords(report)}\n`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, buildSummary(report, process.env.DEPLOY_SHA));
  }
}

if (isInvokedDirectly(import.meta.url)) {
  // Exit 0 whatever happens: see "It never fails the deploy" above.
  main().catch((error) => {
    console.log(`::warning::Sentry source-map check crashed, so nothing was checked: ${error?.stack ?? error}`);
  });
}
