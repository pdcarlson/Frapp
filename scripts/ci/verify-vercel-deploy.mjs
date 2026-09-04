#!/usr/bin/env node
// Polls the Vercel deployments API until a deployment matching $GITHUB_SHA
// reaches a terminal state. Fails on `ERROR`. Treats `CANCELED` as neutral
// ONLY when a LATER deployment in the same channel on the same branch overtook
// it — the signature of Vercel auto-cancelling a build that a newer push
// superseded, where that newer build carries the verification. A cancel that
// nothing overtook means the code was never built, which is a failure rather
// than a no-op.
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

import { createClock, pollUntilTerminal } from "./lib/polling.mjs";
import { findVercelDeploymentBySha, vercelDeploymentCreatedAt } from "./lib/providers.mjs";
import { requireEnv } from "./lib/env.mjs";

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
// 30 minutes, matching the production deploy path. Was 15 while `turbo-ignore`
// skipped at least one app on most pushes; pinning `ignoreCommand: "exit 1"`
// means every push to `main` now queues a web build AND a landing build, and
// this account is on a Hobby plan with limited build concurrency — so a burst
// of merges can leave a real build QUEUED well past the old budget. Timing out
// is a failure here, and it also ends the job before the staging-alias step, so
// an over-tight budget would leave the alias pointing at the previous build.
export const VERCEL_OVERALL_TIMEOUT_MS = 30 * 60 * 1000;

// ── Deployment helpers ──────────────────────────────────────────────────────

// `deploymentCreatedAt` moved to `lib/providers.mjs` (`vercelDeploymentCreatedAt`)
// so the paginated finder and this file's sorting/supersession logic read the
// same field. Re-exported locally under the old name for the rest of this file.
const deploymentCreatedAt = vercelDeploymentCreatedAt;

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
  const candidateSha = candidate?.meta?.githubCommitSha;
  const candidateTarget = candidate?.target ?? null;

  return deployments.some((deployment) => {
    if (deployment === candidate) return false;
    if (branch && deployment?.meta?.githubCommitRef !== branch) return false;
    // Same channel only. `deploy-vercel.mjs` stamps every deployment it
    // creates with `--meta githubCommitRef=main` (it was `gitSource.ref` before
    // ADR-21 removed the Git integration; same field, same reason), so a
    // release of some OTHER commit lands on this project with
    // `githubCommitRef: "main"` and a later timestamp. It verifies nothing
    // about the preview that was cancelled, and without this filter a
    // dispatched production deploy would silently excuse an unrelated
    // cancelled staging build.
    if ((deployment?.target ?? null) !== candidateTarget) return false;
    // A retry of the SAME commit is not a superseding push.
    if (candidateSha && deployment?.meta?.githubCommitSha === candidateSha) return false;
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
  let lastObservedState = null;

  return pollUntilTerminal({
    clock,
    pollIntervalMs,
    overallTimeoutMs,
    logger,
    fetchOne: async () => {
      try {
        const { deployments, matches, pagesSearched, oldestSeenMs, exhausted } =
          await findVercelDeploymentBySha({ apiKey, projectId, sha, fetchImpl });
        return { deployments, matches, pagesSearched, oldestSeenMs, exhausted };
      } catch (error) {
        return { error };
      }
    },
    classify: (state, { elapsedMs }) => {
      if (state.error) {
        return {
          status: "failure",
          message: `Vercel API error for ${label}: ${state.error.message}`,
        };
      }

      const { deployments, matches, pagesSearched, oldestSeenMs, exhausted } = state;

      if (matches.length === 0) {
        if (elapsedMs >= noDeployGraceMs) {
          const cutoff = oldestSeenMs != null ? new Date(oldestSeenMs).toISOString() : "the start";
          const searchNote = exhausted
            ? `searched all ${pagesSearched} page(s) of Vercel's deployment history for this ` +
              `project, back to ${cutoff}`
            : `searched ${pagesSearched} page(s) back to ${cutoff} — older deployments may still ` +
              `exist beyond that`;
          return {
            status: "failure",
            message:
              `No Vercel deployment found for ${sha} on ${label} within ` +
              `${Math.round(noDeployGraceMs / 1000)}s (${searchNote}). No build should be skippable — ` +
              `each app's vercel.json is expected to pin \`ignoreCommand: "exit 1"\` and ` +
              `\`git.deploymentEnabled.main\` is true — so a missing deployment row means ` +
              `either that Ignored Build Step was changed or the Git integration did not ` +
              `fire. Check the vercel.json first; it is the cheaper of the two.`,
          };
        }
        logger.log?.(`[${label}] Waiting for Vercel to create a deployment for ${sha}...`);
        return null;
      }

      // Pick the most recently created match (Vercel can record multiple
      // attempts per SHA if a deploy is retried).
      const latest = [...matches].sort(
        (a, b) => deploymentCreatedAt(b) - deploymentCreatedAt(a),
      )[0];

      const deployState = deploymentState(latest);
      lastObservedState = deployState;

      if (VERCEL_TERMINAL_SUCCESS_STATES.has(deployState)) {
        return {
          status: "success",
          message: `Vercel deployment ${latest.uid ?? latest.url} for ${label} is ${deployState}.`,
        };
      }

      if (VERCEL_TERMINAL_FAILURE_STATES.has(deployState)) {
        return {
          status: "failure",
          message: `Vercel deployment ${latest.uid ?? latest.url} for ${label} ended in ${deployState}.`,
        };
      }

      if (VERCEL_NEUTRAL_TERMINAL_STATES.has(deployState)) {
        const branch = latest?.meta?.githubCommitRef;
        const branchLabel = branch ? `branch ${branch}` : "this branch";

        if (wasSupersededByLaterDeployment(deployments, latest)) {
          return {
            status: "neutral",
            message:
              `Vercel deployment ${latest.uid ?? latest.url} for ${label} was ${deployState}, ` +
              `superseded by a later deployment on ${branchLabel} which carries the ` +
              `verification. Treating as neutral.`,
          };
        }

        // Not superseded *yet*. Keep polling rather than failing on first sight:
        // the cancel and the superseding deployment are two separate writes and
        // they are not ordered. Two merges seconds apart cancel the first build
        // the moment the second push arrives, and that cancel can appear in the
        // list before the newer deployment's row does — so failing here on the
        // first observation would red a push that was superseded normally.
        if (elapsedMs < noDeployGraceMs) {
          logger.log?.(
            `[${label}] ${latest.uid ?? latest.url} is ${deployState}; waiting to see whether a ` +
              `later deployment overtook it...`,
          );
          return null;
        }

        return {
          status: "failure",
          message:
            `Vercel deployment ${latest.uid ?? latest.url} for ${label} was ${deployState}, ` +
            `and after ${Math.round(noDeployGraceMs / 1000)}s no later deployment on ` +
            `${branchLabel} had overtaken it, so this was not a superseded push. ` +
            `Nothing was built for ${sha} — an unverified project, not a no-op. ` +
            `Likely a manual stop, a build concurrency limit, or an Ignored Build Step ` +
            `that skipped it (each app's vercel.json is expected to pin ` +
            `\`ignoreCommand: "exit 1"\` — check it before debugging further).`,
        };
      }

      logger.log?.(`[${label}] Vercel deployment ${latest.uid ?? latest.url} is ${deployState}...`);
      return null;
    },
    onTimeout: () => ({
      status: "failure",
      message:
        `Timed out after ${Math.round(overallTimeoutMs / 1000)}s waiting for ` +
        `Vercel deployment on ${label}. Last observed state: ${lastObservedState ?? "none"}.`,
    }),
  });
}

// ── CLI entry ───────────────────────────────────────────────────────────────

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
