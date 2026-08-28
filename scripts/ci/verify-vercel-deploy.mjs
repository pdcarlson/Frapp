#!/usr/bin/env node
// Polls the Vercel deployments API until a deployment matching $GITHUB_SHA
// reaches a terminal state. Fails on `ERROR`. Treats `CANCELED` as neutral
// ONLY when the same branch already has a successful deployment that
// turbo-ignore could have skipped against; a cancel with nothing behind it
// means the code was never built, which is a failure rather than a no-op.
// Treats "no deployment for this SHA after the grace window" as neutral
// (landing often has no changes to deploy).
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
 * Did this branch already have a successful deployment that turbo-ignore could
 * have compared `candidate` against?
 *
 * turbo-ignore decides "unaffected, skip the build" by diffing the commit
 * against the branch's last successful deployment. With no such deployment it
 * has no baseline, logs `No previous deployments found for "<app>" on branch
 * "<branch>"`, and builds for real — so a CANCELED with nothing behind it was
 * cancelled for some other reason (superseded push, manual stop, concurrency
 * limit) and verified nothing.
 *
 * Scoped to the candidate's branch because that is what turbo-ignore scopes to.
 * When the branch is unknown, fall back to any earlier success rather than
 * failing a deployment we simply cannot classify.
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
          status: "neutral",
          message:
            `No Vercel deployment found for ${sha} on ${label} within ` +
            `${Math.round(noDeployGraceMs / 1000)}s. ` +
            `Likely a turbo-ignore skip (no project changes). Treating as neutral.`,
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
            `but ${branchLabel} has no earlier successful deployment for turbo-ignore ` +
            `to have skipped against. Nothing was built for ${sha}, so this is an ` +
            `unverified project, not a no-op.`,
        };
      }

      return {
        status: "neutral",
        message:
          `Vercel deployment ${latest.uid ?? latest.url} for ${label} was ${state} ` +
          `(turbo-ignore skip against an earlier successful deployment on ` +
          `${branchLabel}). Treating as neutral.`,
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
  const sha = requireEnv("GITHUB_SHA");
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
