#!/usr/bin/env node

// Deploy ONE named commit to a Render service, and watch that deploy — not "a
// deploy" — to a terminal state. Both API environments deploy through it:
// `deploy-production.yml` for `frapp-api-prod`, and `deploy-api.yml`'s
// `deploy-staging` for `frapp-api-staging` (#2505).
//
// ── Why this exists rather than a deploy hook or auto-deploy ────────────────
// A deploy hook cannot name a commit: it builds whatever is at the tip of the
// service's configured branch. With deploys running off `main`, the tip moves
// whenever anyone merges, so a hook fired for commit X can ship commit Y — and
// nothing in the run would say so. Render's auto-deploy has the same defect
// and a worse one: it builds on push, before CI or the staging migration has
// run. Staging used both until #2505, so every API commit built twice, the
// second time from whatever the tip was by then.
//
// `POST /v1/services/{id}/deploys` takes a `commitId`, which makes the deployed
// artifact an input rather than a race.
//
// ── Why it polls by deploy id, not by commit ───────────────────────────────
// Scanning the deploy list for the first entry matching a SHA is ambiguous:
// re-running the same SHA produces two deploys with the same commit, and the
// older one is already terminal. The POST hands back the id of the deploy it
// created; watching that id cannot pick the wrong one.
//
// ── Why `canceled` is a failure ────────────────────────────────────────────
// Both callers hold a single-concurrency lock and create exactly one deploy,
// and neither service auto-deploys, so nothing of ours supersedes it. A cancel
// means the commit did not ship, and reporting that as neutral would be a green
// run that deployed nothing — the #763 failure mode, rebuilt.
//
// Semantics: the pure functions below. Unit tests:
// `scripts/ci/__tests__/deploy-render-commit.test.mjs`.

import { createClock, pollUntilTerminal } from "./lib/polling.mjs";
import { requireEnv } from "./lib/env.mjs";
import { resilientFetch } from "./lib/http.mjs";
import { isInvokedDirectly } from "./lib/invoked-directly.mjs";

// ── Render deploy states ────────────────────────────────────────────────────
// `live` is the only state in which this commit is serving. Render says
// `canceled` when a newer deploy replaces this one before it finishes, and
// `deactivated` when a newer deploy replaced it after it went live; both mean
// the commit is not serving, so `classifyRenderStatus` fails them.
export const RENDER_TERMINAL_SUCCESS_STATES = new Set(["live"]);
export const RENDER_TERMINAL_FAILURE_STATES = new Set([
  "build_failed",
  "update_failed",
  "pre_deploy_failed",
]);
export const RENDER_SUPERSEDED_STATES = new Set(["canceled", "deactivated"]);

export const RENDER_POLL_INTERVAL_MS = 20 * 1000;
export const RENDER_OVERALL_TIMEOUT_MS = 20 * 60 * 1000;

const CREATE_DEPLOY_URL = (serviceId) =>
  `https://api.render.com/v1/services/${serviceId}/deploys`;

const GET_DEPLOY_URL = (serviceId, deployId) =>
  `https://api.render.com/v1/services/${serviceId}/deploys/${deployId}`;

/**
 * Classify a Render deploy status. A superseded deploy is a failure — see the
 * header.
 */
export function classifyRenderStatus(status) {
  if (RENDER_TERMINAL_SUCCESS_STATES.has(status)) return "success";
  if (RENDER_TERMINAL_FAILURE_STATES.has(status)) return "failure";
  if (RENDER_SUPERSEDED_STATES.has(status)) return "failure";
  return "pending";
}

/**
 * Ask Render to build `sha` on `serviceId`. Returns the created deploy's id.
 *
 * A non-2xx here is fatal and says so with the response body: the two ways this
 * realistically fails are a revoked API key and a commit Render's git
 * integration cannot see, and those want different fixes.
 */
export async function createRenderDeploy({
  apiKey,
  serviceId,
  sha,
  clearCache = "do_not_clear",
  fetchImpl = resilientFetch,
}) {
  const response = await fetchImpl(CREATE_DEPLOY_URL(serviceId), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ commitId: sha, clearCache }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Render refused to create a deploy for ${sha} on ${serviceId} ` +
        `(HTTP ${response.status})${detail ? `: ${detail.slice(0, 400)}` : ""}`,
    );
  }

  const body = await response.json();
  const deployId = body?.id;
  if (!deployId) {
    throw new Error(
      `Render accepted the deploy request for ${sha} but returned no deploy id. ` +
        `Nothing can be verified from here, so this is a failure, not a pass.`,
    );
  }
  return { deployId, commitId: body?.commit?.id ?? null };
}

/**
 * Poll one deploy id to a terminal state. `{status, message}` where status is
 * "success" | "failure"; there is no neutral outcome on this path.
 */
export async function pollRenderDeploy({
  apiKey,
  serviceId,
  deployId,
  label = serviceId,
  clock = createClock(),
  fetchImpl = resilientFetch,
  pollIntervalMs = RENDER_POLL_INTERVAL_MS,
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
      const response = await fetchImpl(GET_DEPLOY_URL(serviceId, deployId), {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!response.ok) {
        return { httpStatus: response.status };
      }
      const deploy = await response.json();
      return { deployStatus: deploy?.status ?? null };
    },
    classify: (state) => {
      if (state.httpStatus) {
        return {
          status: "failure",
          message: `Render API returned HTTP ${state.httpStatus} for deploy ${deployId} on ${label}.`,
        };
      }

      const deployStatus = state.deployStatus;
      lastObservedStatus = deployStatus;

      const verdict = classifyRenderStatus(deployStatus);
      if (verdict === "success") {
        return { status: "success", message: `Render deploy ${deployId} for ${label} is ${deployStatus}.` };
      }
      if (verdict === "failure") {
        return {
          status: "failure",
          message:
            `Render deploy ${deployId} for ${label} ended in ${deployStatus}. ` +
            `This commit did not ship.`,
        };
      }

      logger.log?.(`[${label}] Render deploy ${deployId} is ${deployStatus}...`);
      return null;
    },
    onTimeout: () => ({
      status: "failure",
      message:
        `Timed out after ${Math.round(overallTimeoutMs / 1000)}s waiting for Render deploy ` +
        `${deployId} on ${label}. Last observed status: ${lastObservedStatus ?? "none"}. ` +
        `Timing out is a failure, not an assumption that it went live.`,
    }),
  });
}

/** create + poll, the whole job. */
export async function deployRenderCommit({
  apiKey,
  serviceId,
  sha,
  label = serviceId,
  clock = createClock(),
  fetchImpl = resilientFetch,
  pollIntervalMs = RENDER_POLL_INTERVAL_MS,
  overallTimeoutMs = RENDER_OVERALL_TIMEOUT_MS,
  logger = console,
}) {
  let created;
  try {
    created = await createRenderDeploy({ apiKey, serviceId, sha, fetchImpl });
  } catch (error) {
    return { status: "failure", message: error.message, deployId: null };
  }

  logger.log?.(`[${label}] Created Render deploy ${created.deployId} for ${sha}.`);
  const result = await pollRenderDeploy({
    apiKey,
    serviceId,
    deployId: created.deployId,
    label,
    clock,
    fetchImpl,
    pollIntervalMs,
    overallTimeoutMs,
    logger,
  });
  return { ...result, deployId: created.deployId };
}

// ── CLI entry ───────────────────────────────────────────────────────────────

async function main() {
  const serviceId = requireEnv("RENDER_SERVICE_ID");
  const result = await deployRenderCommit({
    apiKey: requireEnv("RENDER_API_KEY"),
    serviceId,
    sha: requireEnv("DEPLOY_SHA"),
    label: process.env.SERVICE_LABEL ?? serviceId,
  });

  if (result.deployId) {
    console.log(`render_deploy_id=${result.deployId}`);
  }
  if (result.status === "success") {
    console.log(`✅ ${result.message}`);
    process.exit(0);
  }
  console.error(`::error::${result.message}`);
  process.exit(1);
}

if (isInvokedDirectly(import.meta.url)) {
  main().catch((error) => {
    console.error(`Unhandled error: ${error.stack ?? error.message}`);
    process.exit(1);
  });
}
