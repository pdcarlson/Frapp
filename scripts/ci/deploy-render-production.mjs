#!/usr/bin/env node

// Deploy ONE named commit to the production Render service, and watch that
// deploy — not "a deploy" — to a terminal state.
//
// ── Why this exists rather than the deploy hook ─────────────────────────────
// `deploy-api.yml` triggers Render with `curl "$RENDER_DEPLOY_HOOK_URL"`. A
// deploy hook cannot name a commit: it builds whatever is at the tip of the
// service's configured branch. That was tolerable while a `production` branch
// existed whose tip WAS the thing being promoted. With deploys running off
// `main`, the tip moves whenever anyone merges, so a hook fired for commit X
// can ship commit Y — and nothing in the run would say so.
//
// `POST /v1/services/{id}/deploys` takes a `commitId`, which makes the deployed
// artifact an input rather than a race.
//
// ── Why it polls by deploy id, not by commit ───────────────────────────────
// `verify-render-deploy.mjs` scans the deploy list for the first entry matching
// `$GITHUB_SHA` (`entries.find(...)`). That is right for an observer reacting to
// a push, and ambiguous here: re-dispatching the same SHA produces two deploys
// with the same commit, and the older one is already terminal. The POST hands
// back the id of the deploy it created; watching that id cannot pick the wrong
// one.
//
// ── Why `canceled` is a failure here and neutral there ─────────────────────
// The observer treats `canceled` / `deactivated` as neutral because a newer
// push supersedes an older deploy, which is normal and not anyone's failure.
// This path holds a single-concurrency lock and creates exactly one deploy, so
// there is no "newer push" to be superseded by: a cancel means the commit did
// not ship, and reporting that as neutral would be a green run that deployed
// nothing — the #763 failure mode, rebuilt.
//
// Semantics: the pure functions below. Unit tests:
// `scripts/ci/__tests__/deploy-render-production.test.mjs`.

import { createClock, pollUntilTerminal } from "./lib/polling.mjs";
import {
  RENDER_NEUTRAL_TERMINAL_STATES,
  RENDER_TERMINAL_FAILURE_STATES,
  RENDER_TERMINAL_SUCCESS_STATES,
} from "./verify-render-deploy.mjs";
import { requireEnv } from "./lib/env.mjs";
import { resilientFetch } from "./lib/http.mjs";

export const RENDER_POLL_INTERVAL_MS = 20 * 1000;
export const RENDER_OVERALL_TIMEOUT_MS = 20 * 60 * 1000;

const CREATE_DEPLOY_URL = (serviceId) =>
  `https://api.render.com/v1/services/${serviceId}/deploys`;

const GET_DEPLOY_URL = (serviceId, deployId) =>
  `https://api.render.com/v1/services/${serviceId}/deploys/${deployId}`;

/**
 * Classify a Render deploy status for the STRICT (deliberate, single-deploy)
 * path. The neutral set the observer honours collapses into failure here — see
 * the header.
 */
export function classifyRenderStatus(status) {
  if (RENDER_TERMINAL_SUCCESS_STATES.has(status)) return "success";
  if (RENDER_TERMINAL_FAILURE_STATES.has(status)) return "failure";
  if (RENDER_NEUTRAL_TERMINAL_STATES.has(status)) return "failure";
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
            `On a deliberate single-commit deploy this means the commit did not ship.`,
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
export async function deployRenderProduction({
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
  const result = await deployRenderProduction({
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

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`Unhandled error: ${error.stack ?? error.message}`);
    process.exit(1);
  });
}
