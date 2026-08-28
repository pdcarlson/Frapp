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

import { createClock } from "./lib/polling.mjs";
import { fetchRenderDeploys } from "./lib/providers.mjs";

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
  const startedAt = clock.now();
  let lastObservedStatus = null;

  while (clock.now() - startedAt < overallTimeoutMs) {
    let page;
    try {
      page = await fetchRenderDeploys({ apiKey, serviceId, fetchImpl });
    } catch (error) {
      return {
        status: "failure",
        message: `Render API error for ${label}: ${error.message}`,
      };
    }

    const entries = Array.isArray(page) ? page : [];
    const match = entries.find((entry) => entry?.deploy?.commit?.id === sha);

    if (!match) {
      const elapsed = clock.now() - startedAt;
      if (elapsed >= noDeployGraceMs) {
        return {
          status: "failure",
          message:
            `No Render deploy created for ${sha} on ${label} within ` +
            `${Math.round(noDeployGraceMs / 1000)}s. ` +
            `Check that Render autoDeploy is enabled and pointed at the correct branch.`,
        };
      }
      logger.log?.(`[${label}] Waiting for Render to create a deploy for ${sha}...`);
      await clock.sleep(pollIntervalMs);
      continue;
    }

    const status = match.deploy.status;
    lastObservedStatus = status;

    if (RENDER_TERMINAL_SUCCESS_STATES.has(status)) {
      return {
        status: "success",
        message: `Render deploy ${match.deploy.id} for ${label} is ${status}.`,
      };
    }

    if (RENDER_TERMINAL_FAILURE_STATES.has(status)) {
      return {
        status: "failure",
        message: `Render deploy ${match.deploy.id} for ${label} ended in ${status}.`,
      };
    }

    if (RENDER_NEUTRAL_TERMINAL_STATES.has(status)) {
      return {
        status: "neutral",
        message:
          `Render deploy ${match.deploy.id} for ${label} was superseded (${status}); ` +
          `treating as neutral.`,
      };
    }

    logger.log?.(`[${label}] Render deploy ${match.deploy.id} is ${status}...`);
    await clock.sleep(pollIntervalMs);
  }

  return {
    status: "failure",
    message:
      `Timed out after ${Math.round(overallTimeoutMs / 1000)}s waiting for ` +
      `Render deploy on ${label}. Last observed status: ${lastObservedStatus ?? "none"}.`,
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
  const apiKey = requireEnv("RENDER_API_KEY");
  const serviceId = requireEnv("RENDER_SERVICE_ID");
  const sha = requireEnv("GITHUB_SHA");
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
