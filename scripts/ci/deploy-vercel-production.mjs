#!/usr/bin/env node

// Build ONE named commit as a Vercel PRODUCTION deployment, for web and
// landing, and watch the deployments it created.
//
// ── Why a fresh build and not `promote` ────────────────────────────────────
// Vercel's `POST /v10/projects/{id}/promote/{deploymentId}` re-points production
// traffic at an existing deployment WITHOUT rebuilding it. The only deployment
// this repo has for a given SHA is the Preview built when that commit landed on
// `main`, and `NEXT_PUBLIC_*` values are inlined at build time — a Preview build
// carries the staging API URL and the staging Supabase keys (the Infisical
// syncs are split Production / Preview; see SECRETS_MANAGEMENT.md). Promoting
// one would put the production dashboard on staging infrastructure while every
// status page said "deployed". `apps/web/lib/sentry/options.ts` derives its
// environment tag from `VERCEL_ENV` at build time too, so a promoted preview
// would also tag production errors `preview` forever.
//
// `target: "production"` rebuilds the same commit against Production env vars,
// and keeps `meta.githubCommitSha`, so the deployment stays tied to the commit
// everywhere it is displayed.
//
// ── Why `CANCELED` is a FAILURE here ───────────────────────────────────────
// This is the subtle one, and it is the reason this file exists rather than a
// second call to `verify-vercel-deploy.mjs`.
//
// That verifier calls `CANCELED` neutral when the deployment's branch already
// has an earlier successful deployment. It was safe only because production
// deployments lived on the `production` branch, which had no earlier successes:
// Vercel's own build log for the last promotion reads `No previous deployments
// found for "web" on branch "production" -> Proceeding with deployment`.
//
// Deploying from `main` inverts that. `main` has many READY deployments, so the
// "prior success" test is ALWAYS true, and every cancelled production build
// would read as a neutral no-op — green, forever, having shipped nothing.
//
// This is not hypothetical. It is exactly what run 33275321347 did: each app's
// `vercel.json` carried `ignoreCommand: "npx turbo-ignore <app>"`, and because
// `gitSource.ref` is `main` (see the header on the create call below),
// turbo-ignore diffed the release against the main PREVIEW of the *same commit*,
// concluded "unaffected", and skipped both builds. Migrations and the API had
// already shipped. Both apps now pin `ignoreCommand: "exit 1"`, so a build can
// no longer be skipped — but the rule below is what makes that failure loud
// instead of green, and it stays whatever the ignore step is set to.
//
// So on this path a cancel is a failure, always. A skipped release is a fact to
// report, not a state to infer a no-op from.
//
// Semantics: the pure functions below. Unit tests:
// `scripts/ci/__tests__/deploy-vercel-production.test.mjs`.

import { createClock } from "./lib/polling.mjs";
import {
  VERCEL_NEUTRAL_TERMINAL_STATES,
  VERCEL_TERMINAL_FAILURE_STATES,
  VERCEL_TERMINAL_SUCCESS_STATES,
} from "./verify-vercel-deploy.mjs";
import { requireEnv } from "./lib/env.mjs";
import { resilientFetch } from "./lib/http.mjs";

export const VERCEL_POLL_INTERVAL_MS = 20 * 1000;
// Longer than the observer's 15 minutes on purpose. This account is on a Hobby
// plan with limited build concurrency, and this path creates two production
// builds at once while a main preview may still be building — a queue the
// observer never had to sit through. Timing out reports failure, so a timeout
// that is merely "slower than we guessed" costs a re-dispatch of a deploy that
// actually succeeded; the extra headroom is cheaper than that.
export const VERCEL_OVERALL_TIMEOUT_MS = 30 * 60 * 1000;

const CREATE_DEPLOYMENT_URL = (teamId) =>
  `https://api.vercel.com/v13/deployments${teamId ? `?teamId=${teamId}` : ""}`;

const GET_DEPLOYMENT_URL = (deploymentId, teamId) =>
  `https://api.vercel.com/v13/deployments/${deploymentId}${teamId ? `?teamId=${teamId}` : ""}`;

function deploymentState(deployment) {
  return deployment?.state ?? deployment?.readyState;
}

/**
 * Classify a Vercel deployment state for the STRICT production path. Unlike
 * the observer there is no neutral outcome — see the header on CANCELED.
 */
export function classifyVercelState(state) {
  if (VERCEL_TERMINAL_SUCCESS_STATES.has(state)) return "success";
  if (VERCEL_TERMINAL_FAILURE_STATES.has(state)) return "failure";
  if (VERCEL_NEUTRAL_TERMINAL_STATES.has(state)) return "failure";
  return "pending";
}

/**
 * Create one production deployment from a git commit.
 *
 * `gitSource.ref` is `main` rather than the SHA: Vercel wants a branch for the
 * ref and the exact commit in `sha`, and passing the SHA in both places makes
 * `meta.githubCommitRef` a commit id, which every downstream branch-scoped
 * lookup then fails to match.
 */
export async function createVercelProductionDeployment({
  apiKey,
  projectId,
  projectName,
  sha,
  repoId,
  teamId,
  ref = "main",
  fetchImpl = resilientFetch,
}) {
  const response = await fetchImpl(CREATE_DEPLOYMENT_URL(teamId), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: projectName,
      project: projectId,
      target: "production",
      gitSource: { type: "github", repoId: String(repoId), ref, sha },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Vercel refused to create a production deployment for ${sha} on ${projectName} ` +
        `(HTTP ${response.status})${detail ? `: ${detail.slice(0, 400)}` : ""}`,
    );
  }

  const body = await response.json();
  if (!body?.id) {
    throw new Error(
      `Vercel accepted the deployment request for ${projectName} but returned no id. ` +
        `Nothing can be verified from here, so this is a failure, not a pass.`,
    );
  }

  // We asked for production. If Vercel handed back anything else, the traffic
  // would never move and a poll on readyState alone would happily report READY.
  if (body.target !== "production") {
    throw new Error(
      `Vercel created deployment ${body.id} for ${projectName} with target ` +
        `'${body.target ?? "null"}', not 'production'. Refusing to treat a preview ` +
        `build as a production deploy.`,
    );
  }

  return { deploymentId: body.id, url: body.url ?? null };
}

/** Poll one deployment id to a terminal state. */
export async function pollVercelDeployment({
  apiKey,
  deploymentId,
  teamId,
  label = deploymentId,
  clock = createClock(),
  fetchImpl = resilientFetch,
  pollIntervalMs = VERCEL_POLL_INTERVAL_MS,
  overallTimeoutMs = VERCEL_OVERALL_TIMEOUT_MS,
  logger = console,
}) {
  const startedAt = clock.now();
  let lastObservedState = null;

  while (clock.now() - startedAt < overallTimeoutMs) {
    const response = await fetchImpl(GET_DEPLOYMENT_URL(deploymentId, teamId), {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      return {
        status: "failure",
        message: `Vercel API returned HTTP ${response.status} for deployment ${deploymentId} (${label}).`,
      };
    }

    const deployment = await response.json();
    const state = deploymentState(deployment);
    lastObservedState = state;

    const verdict = classifyVercelState(state);
    if (verdict === "success") {
      return {
        status: "success",
        message: `Vercel deployment ${deploymentId} for ${label} is ${state}.`,
      };
    }
    if (verdict === "failure") {
      const cancelled = VERCEL_NEUTRAL_TERMINAL_STATES.has(state);
      return {
        status: "failure",
        message: cancelled
          ? `Vercel deployment ${deploymentId} for ${label} was ${state}. On the production ` +
            `path a cancel is never a no-op — nothing was shipped to production. Check the ` +
            `project's Ignored Build Step: \`${label}\`'s vercel.json pins ` +
            `\`ignoreCommand: "exit 1"\` so a build cannot be skipped, and a cancel here ` +
            `means either that was overridden or the build was stopped externally.`
          : `Vercel deployment ${deploymentId} for ${label} ended in ${state}.`,
      };
    }

    logger.log?.(`[${label}] Vercel deployment ${deploymentId} is ${state}...`);
    await clock.sleep(pollIntervalMs);
  }

  return {
    status: "failure",
    message:
      `Timed out after ${Math.round(overallTimeoutMs / 1000)}s waiting for Vercel deployment ` +
      `${deploymentId} (${label}). Last observed state: ${lastObservedState ?? "none"}.`,
  };
}

/**
 * Create every project's deployment FIRST, then poll them together.
 *
 * Deliberately not create-poll-create-poll: on a Hobby plan the builds queue,
 * and deploying serially means landing waits out web's entire build before it
 * even starts. Creating both up front lets Vercel run them as its concurrency
 * allows, and the wall clock becomes the slower build rather than their sum.
 *
 * @param {{projects: Array<{projectId: string, projectName: string, label: string}>}} input
 */
export async function deployVercelProduction({
  apiKey,
  projects,
  sha,
  repoId,
  teamId,
  clock = createClock(),
  fetchImpl = resilientFetch,
  pollIntervalMs = VERCEL_POLL_INTERVAL_MS,
  overallTimeoutMs = VERCEL_OVERALL_TIMEOUT_MS,
  logger = console,
}) {
  const created = [];
  for (const project of projects) {
    try {
      const result = await createVercelProductionDeployment({
        apiKey,
        projectId: project.projectId,
        projectName: project.projectName,
        sha,
        repoId,
        teamId,
        fetchImpl,
      });
      logger.log?.(`[${project.label}] Created Vercel deployment ${result.deploymentId} for ${sha}.`);
      created.push({ project, ...result });
    } catch (error) {
      created.push({ project, deploymentId: null, error: error.message });
    }
  }

  const results = await Promise.all(
    created.map(async (entry) => {
      if (!entry.deploymentId) {
        return { label: entry.project.label, status: "failure", message: entry.error, deploymentId: null };
      }
      const polled = await pollVercelDeployment({
        apiKey,
        deploymentId: entry.deploymentId,
        teamId,
        label: entry.project.label,
        clock,
        fetchImpl,
        pollIntervalMs,
        overallTimeoutMs,
        logger,
      });
      return { label: entry.project.label, deploymentId: entry.deploymentId, ...polled };
    }),
  );

  // Every project must land. A green web and a failed landing is a failed
  // production deploy, not a partial success to be reported cheerfully.
  const failures = results.filter((r) => r.status !== "success");
  return { ok: failures.length === 0, results, failures };
}

// ── CLI entry ───────────────────────────────────────────────────────────────

async function main() {
  const projects = [
    {
      projectId: requireEnv("VERCEL_WEB_PROJECT_ID"),
      projectName: process.env.VERCEL_WEB_PROJECT_NAME ?? "frapp-web",
      label: "frapp-web",
    },
    {
      projectId: requireEnv("VERCEL_LANDING_PROJECT_ID"),
      projectName: process.env.VERCEL_LANDING_PROJECT_NAME ?? "frapp-landing",
      label: "frapp-landing",
    },
  ];

  const outcome = await deployVercelProduction({
    apiKey: requireEnv("VERCEL_API_KEY"),
    projects,
    sha: requireEnv("DEPLOY_SHA"),
    repoId: requireEnv("GITHUB_REPO_ID"),
    teamId: process.env.VERCEL_TEAM_ID,
  });

  for (const result of outcome.results) {
    if (result.deploymentId) console.log(`vercel_deployment_id[${result.label}]=${result.deploymentId}`);
    if (result.status === "success") console.log(`✅ ${result.message}`);
    else console.error(`::error::${result.message}`);
  }

  process.exit(outcome.ok ? 0 : 1);
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`Unhandled error: ${error.stack ?? error.message}`);
    process.exit(1);
  });
}
