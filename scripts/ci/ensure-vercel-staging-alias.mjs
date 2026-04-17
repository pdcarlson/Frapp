#!/usr/bin/env node
// After a Preview deployment on `main` is READY, ensure the project's staging
// custom domain (e.g. app.staging.frapp.live) is aliased to that deployment.
//
// Vercel's branch-linked domain does not always attach to every deployment;
// without this, GitHub / Slack links show only the unique *.vercel.app URL.
//
// Env:
//   VERCEL_API_KEY       — required
//   VERCEL_PROJECT_ID    — required
//   GITHUB_SHA           — required
//   VERCEL_STAGING_ALIAS — required (hostname only, e.g. app.staging.frapp.live)
//
// Exits 0 on success or skip (no deployment for SHA). Exits 1 on failure.

import { fetchVercelDeployments } from "./lib/providers.mjs";

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
  fetchImpl = fetch,
}) {
  let page;
  try {
    page = await fetchVercelDeployments({ apiKey, projectId, fetchImpl });
  } catch (error) {
    return {
      status: "failure",
      message: `Vercel API error listing deployments: ${error.message}`,
    };
  }

  const deployments = Array.isArray(page?.deployments) ? page.deployments : [];
  const matches = deployments.filter((d) => d?.meta?.githubCommitSha === sha);

  if (matches.length === 0) {
    return {
      status: "skipped",
      message: `No deployment for commit ${sha}; skipping staging alias (likely turbo-ignore).`,
    };
  }

  const latest = [...matches].sort((a, b) => {
    const aAt = new Date(a.createdAt ?? a.created ?? 0).getTime();
    const bAt = new Date(b.createdAt ?? b.created ?? 0).getTime();
    return bAt - aAt;
  })[0];

  const state = latest.state ?? latest.readyState;
  const deploymentId = latest.uid;
  if (!deploymentId) {
    return { status: "failure", message: "Matched deployment has no uid." };
  }

  if (state !== "READY") {
    return {
      status: "failure",
      message: `Deployment ${deploymentId} is ${state}, not READY; cannot assign alias yet.`,
    };
  }

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
  const stagingAlias = requireEnv("VERCEL_STAGING_ALIAS");
  const label = process.env.SERVICE_LABEL ?? projectId;

  const result = await ensureVercelStagingAlias({
    apiKey,
    projectId,
    sha,
    stagingAlias,
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
