#!/usr/bin/env node
// Polls the Vercel deployments API until a deployment matching $GITHUB_SHA
// reaches a terminal state. Fails on `ERROR`. Treats `CANCELED` as neutral
// ONLY when the same branch already has an earlier successful deployment —
// the signature of Vercel auto-cancelling a build that a newer push
// superseded. A cancel with nothing behind it means the code was never built,
// which is a failure rather than a no-op.
//
// "No deployment for this SHA after the grace window" is a FAILURE. It was
// neutral while each app's `vercel.json` carried `ignoreCommand:
// "npx turbo-ignore <app>"`, which legitimately suppressed a build when the
// app tree was unchanged. That was removed (both apps now pin
// `ignoreCommand: "exit 1"`), so with `git.deploymentEnabled.main = true` and
// no skip step, every push to `main` must produce a deployment row for both
// projects. A missing one is a broken Git integration, not a quiet no-op.
//
// Env inputs:
//   VERCEL_API_KEY    — required
//   VERCEL_PROJECT_ID — required
//   GITHUB_SHA        — required
//   SERVICE_LABEL     — optional, used only for logs
//
// Exits 0 on success/neutral, 1 on terminal failure or overall timeout.

import { createClock } from "./lib/polling.mjs";
import { fetchVercelDeployments } from "./lib/providers.mjs";

// ── State semantics ─────────────────────────────────────────────────────────
export const VERCEL_TERMINAL_SUCCESS_STATES = new Set(["READY"]);
export const VERCEL_TERMINAL_FAILURE_STATES = new Set(["ERROR"]);
// Terminal states that are neither a successful build nor a build failure:
// Vercel produced no deployed output, without erroring. `verify-vercel-deploy`
// treats these as neutral only conditionally (see the CANCELED branch below);
// `ensure-vercel-staging-alias` treats them as "nothing to alias", which holds
// unconditionally.
export const VERCEL_NEUTRAL_TERMINAL_STATES = new Set(["CANCELED"]);

// ── Timing ──────────────────────────────────────────────────────────────────
export const VERCEL_NO_DEPLOY_GRACE_MS = 3 * 60 * 1000;
export const VERCEL_POLL_INTERVAL_MS = 20 * 1000;
export const VERCEL_OVERALL_TIMEOUT_MS = 15 * 60 * 1000;

// ── Deployment helpers ──────────────────────────────────────────────────────

/** Vercel's list endpoint returns `created` (epoch ms); tests and some
 *  responses carry `createdAt` (ISO). `new Date` handles both. */
function deploymentCreatedAt(deployment) {
  return new Date(deployment?.createdAt ?? deployment?.created ?? 0).getTime();
}

function deploymentState(deployment) {
  // Vercel's v6 deployments endpoint uses `state` (with `readyState` as a
  // legacy alias). Prefer `state`; fall back to `readyState`.
  return deployment?.state ?? deployment?.readyState;
}

/**
 * Did this branch already have a successful deployment behind `candidate`?
 *
 * This separates the one benign cancel from every other kind. Vercel's default
 * `github.autoJobCancelation` cancels an in-flight build when a newer commit
 * lands on the same branch, so a CANCELED deployment sitting behind an earlier
 * success on that branch is a superseded push: the branch is still verified, by
 * the build that overtook it.
 *
 * A cancel with NOTHING behind it has no such story — nothing on this branch
 * ever built — so it is a manual stop, a concurrency limit, or a broken
 * integration, and the project is unverified.
 *
 * Scoped to the candidate's branch because supersession is per-branch. When the
 * branch is unknown, fall back to any earlier success rather than failing a
 * deployment we simply cannot classify.
 */
export function hasPriorSuccessfulDeployment(deployments, candidate) {
  const branch = candidate?.meta?.githubCommitRef;
  const candidateAt = deploymentCreatedAt(candidate);

  return deployments.some((deployment) => {
    if (deployment === candidate) return false;
    if (!VERCEL_TERMINAL_SUCCESS_STATES.has(deploymentState(deployment))) return false;
    if (branch && deployment?.meta?.githubCommitRef !== branch) return false;
    return deploymentCreatedAt(deployment) < candidateAt;
  });
}

/**
 * Pure verifier. See verifyRenderDeploy for the return shape.
 */
export async function verifyVercelDeploy({
  apiKey,
  projectId,
  sha,
  label = projectId,
  clock = createClock(),
  fetchImpl,
  pollIntervalMs = VERCEL_POLL_INTERVAL_MS,
  noDeployGraceMs = VERCEL_NO_DEPLOY_GRACE_MS,
  overallTimeoutMs = VERCEL_OVERALL_TIMEOUT_MS,
  logger = console,
}) {
  const startedAt = clock.now();
  let lastObservedState = null;

  while (clock.now() - startedAt < overallTimeoutMs) {
    let page;
    try {
      page = await fetchVercelDeployments({ apiKey, projectId, fetchImpl });
    } catch (error) {
      return {
        status: "failure",
        message: `Vercel API error for ${label}: ${error.message}`,
      };
    }

    const deployments = Array.isArray(page?.deployments) ? page.deployments : [];
    const matches = deployments.filter(
      (deployment) => deployment?.meta?.githubCommitSha === sha,
    );

    if (matches.length === 0) {
      const elapsed = clock.now() - startedAt;
      if (elapsed >= noDeployGraceMs) {
        return {
          status: "failure",
          message:
            `No Vercel deployment found for ${sha} on ${label} within ` +
            `${Math.round(noDeployGraceMs / 1000)}s. Nothing suppresses a build ` +
            `any more — both apps pin \`ignoreCommand: "exit 1"\` and deploy on ` +
            `\`main\` — so a missing deployment row means the Git integration did ` +
            `not fire, not that there was nothing to build.`,
        };
      }
      logger.log?.(`[${label}] Waiting for Vercel to create a deployment for ${sha}...`);
      await clock.sleep(pollIntervalMs);
      continue;
    }

    // Pick the most recently created match (Vercel can record multiple
    // attempts per SHA if a deploy is retried).
    const latest = [...matches].sort(
      (a, b) => deploymentCreatedAt(b) - deploymentCreatedAt(a),
    )[0];

    const state = deploymentState(latest);
    lastObservedState = state;

    if (VERCEL_TERMINAL_SUCCESS_STATES.has(state)) {
      return {
        status: "success",
        message: `Vercel deployment ${latest.uid ?? latest.url} for ${label} is ${state}.`,
      };
    }

    if (VERCEL_TERMINAL_FAILURE_STATES.has(state)) {
      return {
        status: "failure",
        message: `Vercel deployment ${latest.uid ?? latest.url} for ${label} ended in ${state}.`,
      };
    }

    if (VERCEL_NEUTRAL_TERMINAL_STATES.has(state)) {
      const branch = latest?.meta?.githubCommitRef;
      const branchLabel = branch ? `branch ${branch}` : "this branch";

      if (!hasPriorSuccessfulDeployment(deployments, latest)) {
        return {
          status: "failure",
          message:
            `Vercel deployment ${latest.uid ?? latest.url} for ${label} was ${state}, ` +
            `but ${branchLabel} has no earlier successful deployment behind it, so ` +
            `this was not a superseded push. Nothing was built for ${sha}, so this ` +
            `is an unverified project, not a no-op.`,
        };
      }

      return {
        status: "neutral",
        message:
          `Vercel deployment ${latest.uid ?? latest.url} for ${label} was ${state} ` +
          `(superseded by a later push, with an earlier successful deployment on ` +
          `${branchLabel} behind it). Treating as neutral.`,
      };
    }

    logger.log?.(`[${label}] Vercel deployment ${latest.uid ?? latest.url} is ${state}...`);
    await clock.sleep(pollIntervalMs);
  }

  return {
    status: "failure",
    message:
      `Timed out after ${Math.round(overallTimeoutMs / 1000)}s waiting for ` +
      `Vercel deployment on ${label}. Last observed state: ${lastObservedState ?? "none"}.`,
  };
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
  const apiKey = requireEnv("VERCEL_API_KEY");
  const projectId = requireEnv("VERCEL_PROJECT_ID");
  // DEPLOY_SHA wins over GITHUB_SHA so a `workflow_dispatch` caller can name the
  // commit it is deploying. `github.sha` on a dispatch is the tip of the ref the
  // workflow was dispatched on, which is NOT the commit being shipped — and
  // overriding GITHUB_SHA in a step-level `env:` collides with GitHub's reserved
  // prefix rule, so it reads correct and is undefined. An explicit variable does
  // not have that problem.
  const sha = process.env.DEPLOY_SHA || requireEnv("GITHUB_SHA");
  const label = process.env.SERVICE_LABEL ?? projectId;

  const result = await verifyVercelDeploy({ apiKey, projectId, sha, label });

  if (result.status === "success") {
    console.log(`✅ ${result.message}`);
    process.exit(0);
  }
  if (result.status === "neutral") {
    console.log(`⚪ ${result.message}`);
    process.exit(0);
  }
  console.error(`❌ ${result.message}`);
  process.exit(1);
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`Unhandled error: ${error.stack ?? error.message}`);
    process.exit(1);
  });
}
