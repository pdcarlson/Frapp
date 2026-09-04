#!/usr/bin/env node
// After a Preview deployment on `main` is READY, ensure the project's staging
// custom domain (e.g. app.staging.frapp.live) is aliased to that deployment.
//
// Vercel's branch-linked domain does not always attach to every deployment;
// without this, GitHub / Slack links show only the unique *.vercel.app URL.
//
// Env:
//   VERCEL_API_KEY        — required
//   VERCEL_PROJECT_ID     — required unless VERCEL_DEPLOYMENT_ID is given
//   VERCEL_STAGING_ALIAS  — required (hostname only, e.g. app.staging.frapp.live)
//   VERCEL_DEPLOYMENT_ID  — optional; when set, alias THIS deployment and skip
//                           the search entirely (the preferred path — see below)
//   DEPLOY_SHA            — the commit to search for; required unless
//                           VERCEL_DEPLOYMENT_ID is given
//   GITHUB_SHA            — fallback for DEPLOY_SHA. Prefer DEPLOY_SHA: a
//                           step-level `env: GITHUB_SHA:` is SILENTLY IGNORED
//                           by Actions (`GITHUB_` is a reserved prefix), so a
//                           caller naming a commit other than the ambient one
//                           reads as correct and gets the ambient value
//   SERVICE_LABEL         — optional, used only for logs
//
// Exits 0 on success or skip, 1 on failure.
//
// ── Two ways in, and why the id one is preferred (#1578) ───────────────────
// Historically this script only knew a SHA, and it searched Vercel's paged
// deployment list for a deployment whose `meta.githubCommitSha` matched. On no
// match it exits 0 — non-fatal, because it only points a hostname at a build
// and was never the gate: `verify-vercel-deploy.mjs` ran as the preceding step
// in `verify-deployments.yml` and FAILED when no deployment existed for the
// SHA, so the job ended before reaching this script.
//
// That gate is gone. #1579 removed those jobs (nothing created a deployment for
// them to find), so a caller relying on the search would get a silent exit 0
// and a staging hostname still serving the previous build — the exact symptom
// #1578 exists to end.
//
// So the caller that creates the deployment passes `VERCEL_DEPLOYMENT_ID` and
// the search never runs. The search path is kept for a caller that genuinely
// has only a SHA, and it keeps its non-fatal skip; it is no longer how the
// staging workflow reaches this file.

import { findVercelDeploymentBySha, vercelDeploymentCreatedAt } from "./lib/providers.mjs";
import { VERCEL_NEUTRAL_TERMINAL_STATES } from "./verify-vercel-deploy.mjs";
import { requireEnv } from "./lib/env.mjs";

const LIST_ALIASES_URL = (deploymentId) =>
  `https://api.vercel.com/v2/deployments/${deploymentId}/aliases`;

const ASSIGN_ALIAS_URL = (deploymentId) =>
  `https://api.vercel.com/v2/deployments/${deploymentId}/aliases`;

/**
 * @param {object} options
 * @param {string} options.apiKey
 * @param {string} options.projectId
 * @param {string} options.sha
 * @param {string} options.stagingAlias
 * @param {typeof fetch} [options.fetchImpl]
 */
export async function ensureVercelStagingAlias({
  apiKey,
  projectId,
  sha,
  stagingAlias,
  deploymentId: knownDeploymentId = null,
  fetchImpl = fetch,
}) {
  // A caller that CREATED the deployment passes its id, and then none of the
  // search below runs. That is the difference between this being a best-effort
  // step and a real one:
  //
  //   * The search matches on `meta.githubCommitSha` across a paged deployment
  //     list, and answers "no match" for reasons that have nothing to do with
  //     the deployment being wrong — an index that has not caught up, a lost
  //     `--meta` flag, a commit deployed to both channels. "No match" then
  //     exits 0 (see below), so the hostname silently keeps the previous build.
  //   * It also has no channel filter, so with one SHA deployed to both
  //     production and staging the newest match can be the PRODUCTION
  //     deployment — and the staging hostname would be pointed at a bundle
  //     compiled against production env vars.
  //
  // An id from the deployer has neither problem. `deploy-vercel-staging.yml`
  // supplies one; the search path stays for a caller that has no id to give.
  if (knownDeploymentId) {
    return assignStagingAlias({
      apiKey,
      deploymentId: knownDeploymentId,
      stagingAlias,
      fetchImpl,
    });
  }

  let matches;
  let pagesSearched;
  let exhausted;
  try {
    ({ matches, pagesSearched, exhausted } = await findVercelDeploymentBySha({
      apiKey,
      projectId,
      sha,
      fetchImpl,
    }));
  } catch (error) {
    return {
      status: "failure",
      message: `Vercel API error listing deployments: ${error.message}`,
    };
  }

  if (matches.length === 0) {
    const searchNote = exhausted
      ? `searched all ${pagesSearched} page(s) of deployment history`
      : `searched ${pagesSearched} page(s) — older deployments may still exist beyond that`;
    return {
      status: "skipped",
      message:
        `No deployment for commit ${sha} (${searchNote}); nothing to alias, skipping. ` +
        `verify-vercel-deploy reports this case as a failure.`,
    };
  }

  const latest = [...matches].sort(
    (a, b) => vercelDeploymentCreatedAt(b) - vercelDeploymentCreatedAt(a),
  )[0];

  const state = latest.state ?? latest.readyState;
  const deploymentId = latest.uid;
  if (!deploymentId) {
    return { status: "failure", message: "Matched deployment has no uid." };
  }

  if (VERCEL_NEUTRAL_TERMINAL_STATES.has(state)) {
    return {
      status: "skipped",
      message: `Deployment ${deploymentId} is ${state}; skipping staging alias (same semantics as verify-vercel-deploy neutral).`,
    };
  }

  if (state !== "READY") {
    return {
      status: "failure",
      message: `Deployment ${deploymentId} is ${state}, not READY; cannot assign alias yet.`,
    };
  }

  return assignStagingAlias({ apiKey, deploymentId, stagingAlias, fetchImpl });
}

/**
 * Point `stagingAlias` at a deployment already known to exist.
 *
 * Split out so the id-supplied path above and the search path share one
 * implementation of the alias assignment itself — the half that talks to the
 * alias API. Only the way the deployment is *identified* differs between them.
 */
export async function assignStagingAlias({ apiKey, deploymentId, stagingAlias, fetchImpl = fetch }) {
  let listResponse;
  try {
    listResponse = await fetchImpl(LIST_ALIASES_URL(deploymentId), {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch (error) {
    return {
      status: "failure",
      message: `Vercel API error listing aliases: ${error.message}`,
    };
  }

  if (!listResponse.ok) {
    return {
      status: "failure",
      message: `List aliases failed: HTTP ${listResponse.status}`,
    };
  }

  const listBody = await listResponse.json();
  const aliases = Array.isArray(listBody?.aliases) ? listBody.aliases : [];
  const hasStaging = aliases.some((row) => row?.alias === stagingAlias);

  if (hasStaging) {
    return {
      status: "success",
      message: `Staging alias ${stagingAlias} already points at ${deploymentId}.`,
    };
  }

  let assignResponse;
  try {
    assignResponse = await fetchImpl(ASSIGN_ALIAS_URL(deploymentId), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ alias: stagingAlias }),
    });
  } catch (error) {
    return {
      status: "failure",
      message: `Vercel API error assigning alias: ${error.message}`,
    };
  }

  if (assignResponse.ok) {
    return {
      status: "success",
      message: `Assigned ${stagingAlias} to deployment ${deploymentId}.`,
    };
  }

  if (assignResponse.status === 409) {
    return {
      status: "success",
      message: `Alias ${stagingAlias} already assigned (HTTP 409).`,
    };
  }

  let detail = "";
  try {
    const errBody = await assignResponse.json();
    if (errBody?.error?.message) {
      detail = `: ${errBody.error.message}`;
    }
  } catch {
    // ignore
  }

  return {
    status: "failure",
    message: `Assign alias failed: HTTP ${assignResponse.status}${detail}`,
  };
}

async function main() {
  const apiKey = requireEnv("VERCEL_API_KEY");
  const stagingAlias = requireEnv("VERCEL_STAGING_ALIAS");
  const deploymentId = process.env.VERCEL_DEPLOYMENT_ID || null;

  // Only the search path needs a project and a commit; the id path needs
  // neither. Demanding them anyway would make the better caller carry inputs it
  // does not use, and `requireEnv` exits 1 on a missing one.
  const projectId = deploymentId
    ? (process.env.VERCEL_PROJECT_ID ?? null)
    : requireEnv("VERCEL_PROJECT_ID");
  // DEPLOY_SHA wins over GITHUB_SHA — see the reserved-prefix note in the
  // header. `deploy-vercel-staging.yml` runs on `workflow_run`, where
  // `github.sha` is the default branch's tip rather than the commit CI verified.
  const sha = deploymentId ? null : process.env.DEPLOY_SHA || requireEnv("GITHUB_SHA");
  const label = process.env.SERVICE_LABEL ?? projectId ?? deploymentId;

  const result = await ensureVercelStagingAlias({
    apiKey,
    projectId,
    sha,
    stagingAlias,
    deploymentId,
  });

  if (result.status === "success") {
    console.log(`✅ [${label}] ${result.message}`);
    process.exit(0);
  }
  if (result.status === "skipped") {
    console.log(`⚪ [${label}] ${result.message}`);
    process.exit(0);
  }
  console.error(`❌ [${label}] ${result.message}`);
  process.exit(1);
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`Unhandled error: ${error.stack ?? error.message}`);
    process.exit(1);
  });
}
