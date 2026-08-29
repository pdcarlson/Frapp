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
 * Was `candidate` overtaken by a later deployment on the same branch?
 *
 * This separates the one benign cancel from every other kind. Vercel's default
 * `github.autoJobCancelation` cancels an in-flight build when a newer commit
 * lands on the same branch, so a CANCELED deployment with a LATER deployment
 * behind it on that branch is a superseded push: the branch is still verified,
 * by the build that overtook it, and that build has its own verify run.
 *
 * The test looks FORWARD, deliberately. It used to look backward — "does an
 * earlier success exist on this branch" — which was the right question while
 * `ignoreCommand` ran `turbo-ignore`, because an earlier success was the
 * baseline a skip diffed against. It is the wrong question for supersession:
 * on `main` an earlier success always exists, so every cancel would read as
 * benign no matter what caused it. A manual stop or a Hobby-plan build
 * concurrency limit would have gone green with the commit never deployed.
 *
 * No state filter on the later deployment: it may still be BUILDING, and
 * requiring it to be READY would fail the superseded one for losing a race it
 * is supposed to lose.
 *
 * Scoped to the candidate's branch because supersession is per-branch. When the
 * branch is unknown, fall back to any later deployment rather than failing one
 * we simply cannot classify.
 */
export function wasSupersededByLaterDeployment(deployments, candidate) {
  const branch = candidate?.meta?.githubCommitRef;
  const candidateAt = deploymentCreatedAt(candidate);

  return deployments.some((deployment) => {
    if (deployment === candidate) return false;
    if (branch && deployment?.meta?.githubCommitRef !== branch) return false;
    return deploymentCreatedAt(deployment) > candidateAt;
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
            `${Math.round(noDeployGraceMs / 1000)}s. No build should be skippable — ` +
            `each app's vercel.json is expected to pin \`ignoreCommand: "exit 1"\` and ` +
            `\`git.deploymentEnabled.main\` is true — so a missing deployment row means ` +
            `either that Ignored Build Step was changed or the Git integration did not ` +
            `fire. Check the vercel.json first; it is the cheaper of the two.`,
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

      if (!wasSupersededByLaterDeployment(deployments, latest)) {
        return {
          status: "failure",
          message:
            `Vercel deployment ${latest.uid ?? latest.url} for ${label} was ${state}, ` +
            `and no later deployment on ${branchLabel} overtook it, so this was not a ` +
            `superseded push. Nothing was built for ${sha} — an unverified project, ` +
            `not a no-op. Likely a manual stop, a build concurrency limit, or an ` +
            `Ignored Build Step that skipped it (each app's vercel.json is expected ` +
            `to pin \`ignoreCommand: "exit 1"\` — check it before debugging further).`,
        };
      }

      return {
        status: "neutral",
        message:
          `Vercel deployment ${latest.uid ?? latest.url} for ${label} was ${state}, ` +
          `superseded by a later deployment on ${branchLabel} which carries the ` +
          `verification. Treating as neutral.`,
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
