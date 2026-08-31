#!/usr/bin/env node
// Polls the Render deploy-list API until a deploy matching $GITHUB_SHA reaches
// a terminal state. Fails on build_failed / update_failed / pre_deploy_failed
// and on "no deploy for this SHA after the grace window" (autoDeploy wiring
// red flag). Treats `canceled` / `deactivated` as neutral (superseded by a
// newer deploy).
//
// Env inputs:
//   RENDER_API_KEY     — required
//   RENDER_SERVICE_ID  — required
//   GITHUB_SHA         — required
//   SERVICE_LABEL      — optional, used only for logs
//
// Exits 0 on success/neutral, 1 on terminal failure or overall timeout.

import { createClock, pollUntilTerminal } from "./lib/polling.mjs";
import { fetchRenderDeploys } from "./lib/providers.mjs";
import { requireEnv } from "./lib/env.mjs";

// ── State semantics ─────────────────────────────────────────────────────────
// Any of these means the deploy we were watching is now the running deploy
// (or, in the neutral case, was superseded by a newer one that will be picked
// up on the next push).
export const RENDER_TERMINAL_SUCCESS_STATES = new Set(["live"]);
export const RENDER_TERMINAL_FAILURE_STATES = new Set([
  "build_failed",
  "update_failed",
  "pre_deploy_failed",
]);
export const RENDER_NEUTRAL_TERMINAL_STATES = new Set([
  // Render uses "canceled" when a newer deploy replaces this one before it
  // finishes, and "deactivated" when a newer deploy replaced a previously
  // live one. Neither is a user-visible failure.
  "canceled",
  "deactivated",
]);

// ── Timing (named constants, no magic numbers) ──────────────────────────────
export const RENDER_NO_DEPLOY_GRACE_MS = 5 * 60 * 1000;
export const RENDER_POLL_INTERVAL_MS = 20 * 1000;
export const RENDER_OVERALL_TIMEOUT_MS = 20 * 60 * 1000;

/**
 * Pure verifier. Returns `{ status, message }` where status is one of
 * "success" | "failure" | "neutral". The CLI wrapper translates that to an
 * exit code; tests assert on the return value directly.
 */
export async function verifyRenderDeploy({
  apiKey,
  serviceId,
  sha,
  label = serviceId,
  clock = createClock(),
  fetchImpl,
  pollIntervalMs = RENDER_POLL_INTERVAL_MS,
  noDeployGraceMs = RENDER_NO_DEPLOY_GRACE_MS,
  overallTimeoutMs = RENDER_OVERALL_TIMEOUT_MS,
  logger = console,
}) {
  let lastObservedStatus = null;

  return pollUntilTerminal({
    clock,
    pollIntervalMs,
    overallTimeoutMs,
    logger,
    fetchOne: async () => {
      try {
        const page = await fetchRenderDeploys({ apiKey, serviceId, fetchImpl });
        const entries = Array.isArray(page) ? page : [];
        return { match: entries.find((entry) => entry?.deploy?.commit?.id === sha) };
      } catch (error) {
        return { error };
      }
    },
    classify: (state, { elapsedMs }) => {
      if (state.error) {
        return {
          status: "failure",
          message: `Render API error for ${label}: ${state.error.message}`,
        };
      }

      if (!state.match) {
        if (elapsedMs >= noDeployGraceMs) {
          return {
            status: "failure",
            message:
              `No Render deploy created for ${sha} on ${label} within ` +
              `${Math.round(noDeployGraceMs / 1000)}s. ` +
              `Check that Render autoDeploy is enabled and pointed at the correct branch.`,
          };
        }
        logger.log?.(`[${label}] Waiting for Render to create a deploy for ${sha}...`);
        return null;
      }

      const status = state.match.deploy.status;
      lastObservedStatus = status;

      if (RENDER_TERMINAL_SUCCESS_STATES.has(status)) {
        return {
          status: "success",
          message: `Render deploy ${state.match.deploy.id} for ${label} is ${status}.`,
        };
      }

      if (RENDER_TERMINAL_FAILURE_STATES.has(status)) {
        return {
          status: "failure",
          message: `Render deploy ${state.match.deploy.id} for ${label} ended in ${status}.`,
        };
      }

      if (RENDER_NEUTRAL_TERMINAL_STATES.has(status)) {
        return {
          status: "neutral",
          message:
            `Render deploy ${state.match.deploy.id} for ${label} was superseded (${status}); ` +
            `treating as neutral.`,
        };
      }

      logger.log?.(`[${label}] Render deploy ${state.match.deploy.id} is ${status}...`);
      return null;
    },
    onTimeout: () => ({
      status: "failure",
      message:
        `Timed out after ${Math.round(overallTimeoutMs / 1000)}s waiting for ` +
        `Render deploy on ${label}. Last observed status: ${lastObservedStatus ?? "none"}.`,
    }),
  });
}

// ── CLI entry ───────────────────────────────────────────────────────────────

async function main() {
  const apiKey = requireEnv("RENDER_API_KEY");
  const serviceId = requireEnv("RENDER_SERVICE_ID");
  // DEPLOY_SHA wins over GITHUB_SHA so a `workflow_dispatch` caller can name the
  // commit it is deploying. `github.sha` on a dispatch is the tip of the ref the
  // workflow was dispatched on, which is NOT the commit being shipped — and
  // overriding GITHUB_SHA in a step-level `env:` collides with GitHub's reserved
  // prefix rule, so it reads correct and is undefined. An explicit variable does
  // not have that problem.
  const sha = process.env.DEPLOY_SHA || requireEnv("GITHUB_SHA");
  const label = process.env.SERVICE_LABEL ?? serviceId;

  const result = await verifyRenderDeploy({ apiKey, serviceId, sha, label });

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
