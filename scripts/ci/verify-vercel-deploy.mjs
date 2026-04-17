#!/usr/bin/env node
// Polls the Vercel deployments API until a deployment matching $GITHUB_SHA
// reaches a terminal state. Fails on `ERROR`. Treats `CANCELED` as neutral
// (turbo-ignore skipped the build), and treats "no deployment for this SHA
// after the grace window" as neutral for the same reason (landing often has
// no changes to deploy).
//
// Env inputs:
//   VERCEL_API_KEY    — required
//   VERCEL_PROJECT_ID — required
//   GITHUB_SHA        — required
//   SERVICE_LABEL     — optional, used only for logs
//   GITHUB_REF        — optional; when `refs/heads/main` and `VERCEL_STAGING_ALIAS`
//                       are set, assigns that hostname to the READY deployment via
//                       the Vercel aliases API (idempotent `not_modified` = success).
//   VERCEL_STAGING_ALIAS — optional custom hostname (e.g. app.staging.frapp.live)
//   VERCEL_TEAM_ID    — optional; defaults to the project's `accountId` from the API
//
// Exits 0 on success/neutral, 1 on terminal failure or overall timeout.

import { createClock } from "./lib/polling.mjs";
import {
  assignVercelDeploymentAlias,
  fetchVercelDeployments,
  resolveVercelTeamId,
} from "./lib/providers.mjs";

// ── State semantics ─────────────────────────────────────────────────────────
export const VERCEL_TERMINAL_SUCCESS_STATES = new Set(["READY"]);
export const VERCEL_TERMINAL_FAILURE_STATES = new Set(["ERROR"]);
// CANCELED is Vercel's turbo-ignore short-circuit (nothing in the project
// changed since the last deploy). Treat it as a legitimate no-op.
export const VERCEL_NEUTRAL_TERMINAL_STATES = new Set(["CANCELED"]);

// ── Timing ──────────────────────────────────────────────────────────────────
export const VERCEL_NO_DEPLOY_GRACE_MS = 3 * 60 * 1000;
export const VERCEL_POLL_INTERVAL_MS = 20 * 1000;
export const VERCEL_OVERALL_TIMEOUT_MS = 15 * 60 * 1000;

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
    const latest = [...matches].sort((a, b) => {
      const aAt = new Date(a.createdAt ?? a.created ?? 0).getTime();
      const bAt = new Date(b.createdAt ?? b.created ?? 0).getTime();
      return bAt - aAt;
    })[0];

    // Vercel's v6 deployments endpoint uses `state` (with `readyState` as a
    // legacy alias). Prefer `state`; fall back to `readyState`.
    const state = latest.state ?? latest.readyState;
    lastObservedState = state;

    if (VERCEL_TERMINAL_SUCCESS_STATES.has(state)) {
      return {
        status: "success",
        message: `Vercel deployment ${latest.uid ?? latest.url} for ${label} is ${state}.`,
        deploymentUid: latest.uid ?? null,
      };
    }

    if (VERCEL_TERMINAL_FAILURE_STATES.has(state)) {
      return {
        status: "failure",
        message: `Vercel deployment ${latest.uid ?? latest.url} for ${label} ended in ${state}.`,
      };
    }

    if (VERCEL_NEUTRAL_TERMINAL_STATES.has(state)) {
      return {
        status: "neutral",
        message:
          `Vercel deployment ${latest.uid ?? latest.url} for ${label} was ${state} ` +
          `(turbo-ignore skip). Treating as neutral.`,
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
  const githubRef = process.env.GITHUB_REF ?? "";
  const stagingAlias = process.env.VERCEL_STAGING_ALIAS?.trim();

  const result = await verifyVercelDeploy({ apiKey, projectId, sha, label });

  if (result.status === "success") {
    console.log(`✅ ${result.message}`);
    if (githubRef === "refs/heads/main" && stagingAlias) {
      const deploymentUid = result.deploymentUid;
      if (!deploymentUid) {
        console.error(
          "Error: VERCEL_STAGING_ALIAS is set but the READY deployment has no uid; cannot assign alias.",
        );
        process.exit(1);
      }
      try {
        const teamId = await resolveVercelTeamId({ apiKey, projectId });
        const aliasOutcome = await assignVercelDeploymentAlias({
          apiKey,
          teamId,
          deploymentUid,
          alias: stagingAlias,
        });
        if (!aliasOutcome.ok) {
          console.error(
            `❌ Failed to assign ${stagingAlias} to ${deploymentUid}: ${aliasOutcome.message}`,
          );
          process.exit(1);
        }
        console.log(`🔗 Staging hostname https://${stagingAlias} now targets deployment ${deploymentUid}.`);
      } catch (error) {
        console.error(`❌ Staging alias step failed: ${error.message}`);
        process.exit(1);
      }
    }
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
