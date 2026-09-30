#!/usr/bin/env node

// Delete old staging (preview) deployments of web and landing, so Vercel keeps
// a fixed number of them instead of every one CI ever uploaded (#2865).
//
// ── Why ────────────────────────────────────────────────────────────────────
// Every staging upload (`deploy-vercel.mjs`, `DEPLOY_TARGET=preview`) is a new
// deployment of both projects, and Vercel retains each one with its function
// bundles. On the Hobby team those count against a 10 GB Function Storage
// allowance shared with production, and at one upload per merge the team
// reached 75% within a week of CI taking over the uploads. The plan's path
// gate (`plan-staging-deploy.mjs`) makes uploads rarer; this is the ceiling.
//
// ── What it deletes ────────────────────────────────────────────────────────
// Per project, preview deployments only, newest first: it keeps the newest
// `keep`, and deletes the rest that have reached a terminal state. It never
// deletes:
//   * a deployment whose `target` is `production`. Those are releases and
//     rollback candidates; `deploy-production.yml` owns them;
//   * a deployment a staging hostname serves, whatever its age, read fresh
//     from the hostnames before anything is deleted. A hostname it can't
//     resolve stops the run before any delete: not knowing what staging
//     serves is not a reason to guess;
//   * one still building or queued.
// `maxDeletions` bounds each project per run, under Vercel's deletion rate
// limit (200 per ten minutes per team), so a backlog drains over a few runs.
// Runs close together can still reach that limit; a 429 stops the deletes and
// leaves the rest for the next run, and is not a failure.
//
// Env inputs:
//   VERCEL_API_KEY            — required
//   VERCEL_TEAM_ID            — required
//   VERCEL_WEB_PROJECT_ID     — required
//   VERCEL_LANDING_PROJECT_ID — required
//   VERCEL_STAGING_HOSTS      — required, space-separated staging hostnames
//
// Exits 1 when a list, a hostname or a delete (other than a 429) fails. It runs
// in its own job of `deploy-staging.yml`, after the deploy job, so that fails
// this job and not the deploy: everything has shipped by then, and a failed
// deploy job would raise the P1 staging alert, whose natural fix (a re-run)
// uploads both apps again.
// Unit tests: `scripts/ci/__tests__/prune-vercel-staging.test.mjs`.

import { appendFileSync } from "node:fs";

import { resolveDeploymentByHost } from "./deploy-vercel.mjs";
import { requireEnv } from "./lib/env.mjs";
import { resilientFetch } from "./lib/http.mjs";
import { isInvokedDirectly } from "./lib/invoked-directly.mjs";
import {
  VERCEL_NEUTRAL_TERMINAL_STATES,
  VERCEL_TERMINAL_FAILURE_STATES,
  VERCEL_TERMINAL_SUCCESS_STATES,
  fetchVercelDeployments,
  vercelDeploymentCreatedAt,
  vercelDeploymentState,
} from "./lib/providers.mjs";

/** Enough to alias staging back a few merges by hand. */
export const KEEP_PREVIEWS = 10;
/** Two projects a run stays under Vercel's 200 deletions per ten minutes. */
export const MAX_DELETIONS_PER_PROJECT = 40;
/** A project with more than 5,000 deployments is not one this was written for. */
const MAX_PAGES = 50;

const TERMINAL_STATES = new Set([
  ...VERCEL_TERMINAL_SUCCESS_STATES,
  ...VERCEL_TERMINAL_FAILURE_STATES,
  ...VERCEL_NEUTRAL_TERMINAL_STATES,
]);

const DELETE_URL = ({ id, teamId }) =>
  `https://api.vercel.com/v13/deployments/${encodeURIComponent(id)}?teamId=${encodeURIComponent(teamId)}`;

const idOf = (deployment) => deployment?.uid ?? deployment?.id ?? null;

/**
 * The pure choice. `deployments` is one project's list in any order;
 * `protectedIds` the deployments the staging hostnames serve. Returns the
 * deployments to delete, oldest first, and how many previews it saw.
 */
export function selectPrunable(deployments, { keep = KEEP_PREVIEWS, protectedIds = new Set(), maxDeletions = MAX_DELETIONS_PER_PROJECT } = {}) {
  const previews = deployments
    .filter((deployment) => idOf(deployment) && deployment.target !== "production")
    .sort((a, b) => vercelDeploymentCreatedAt(b) - vercelDeploymentCreatedAt(a));
  const prunable = previews
    .slice(keep)
    .filter((deployment) => !protectedIds.has(idOf(deployment)) && TERMINAL_STATES.has(vercelDeploymentState(deployment)))
    .reverse()
    .slice(0, maxDeletions);
  return { previews: previews.length, prunable };
}

/** Every deployment of one project, paging back through `pagination.next`. */
export async function listDeployments({ apiKey, teamId, projectId, fetchImpl = resilientFetch }) {
  const all = [];
  let until;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const body = await fetchVercelDeployments({ apiKey, projectId, teamId, until, limit: 100, fetchImpl });
    if (!Array.isArray(body?.deployments)) {
      throw new Error(`Vercel returned an unexpected deployment list for ${projectId} (page ${page + 1})`);
    }
    all.push(...body.deployments);
    until = body.pagination?.next;
    if (!until || body.deployments.length === 0) return all;
  }
  throw new Error(`${projectId} has more than ${MAX_PAGES} pages of deployments; refusing to prune a partial list`);
}

/** Vercel's answer to a delete over its rate limit: stop, and let the next run carry on. */
export class DeleteRateLimited extends Error {}

/**
 * Delete one deployment. A 404 means it is already gone, which is the goal;
 * a 429 throws `DeleteRateLimited`, which is not a failure (see the header).
 */
export async function deleteDeployment({ apiKey, teamId, id, fetchImpl = resilientFetch }) {
  const response = await fetchImpl(DELETE_URL({ id, teamId }), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (response.ok || response.status === 404) return;
  if (response.status === 429) throw new DeleteRateLimited(`HTTP 429 deleting ${id}`);
  const detail = await response.text().catch(() => "");
  throw new Error(`HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
}

/**
 * Prune every project. Resolves the hostnames first and throws if any can't
 * be, before a single delete. Returns one summary per project, with the ids
 * it deleted, the deletes that failed, and `deferred`: how many it left for
 * the next run once Vercel rate-limited it (every later delete, in every
 * project, waits too).
 */
export async function pruneStagingDeployments({
  apiKey,
  teamId,
  projects,
  hosts,
  keep = KEEP_PREVIEWS,
  maxDeletions = MAX_DELETIONS_PER_PROJECT,
  fetchImpl = resilientFetch,
}) {
  const protectedIds = new Set();
  for (const host of hosts) {
    const { deploymentId } = await resolveDeploymentByHost({ apiKey, host, teamId, fetchImpl });
    protectedIds.add(deploymentId);
  }

  const results = [];
  let rateLimited = false;
  for (const { label, projectId } of projects) {
    const deployments = await listDeployments({ apiKey, teamId, projectId, fetchImpl });
    const { previews, prunable } = selectPrunable(deployments, { keep, protectedIds, maxDeletions });
    const deleted = [];
    const failed = [];
    let deferred = 0;
    for (const deployment of prunable) {
      if (rateLimited) {
        deferred += 1;
        continue;
      }
      const id = idOf(deployment);
      try {
        await deleteDeployment({ apiKey, teamId, id, fetchImpl });
        deleted.push(id);
      } catch (error) {
        if (error instanceof DeleteRateLimited) {
          rateLimited = true;
          deferred += 1;
        } else {
          failed.push({ id, error: String(error?.message ?? error) });
        }
      }
    }
    results.push({ label, previews, deleted, failed, deferred });
  }
  return results;
}

// ── CLI entry ───────────────────────────────────────────────────────────────

async function main() {
  const apiKey = requireEnv("VERCEL_API_KEY");
  const teamId = requireEnv("VERCEL_TEAM_ID");
  const projects = [
    { label: "frapp-web", projectId: requireEnv("VERCEL_WEB_PROJECT_ID") },
    { label: "frapp-landing", projectId: requireEnv("VERCEL_LANDING_PROJECT_ID") },
  ];
  const hosts = requireEnv("VERCEL_STAGING_HOSTS").split(/\s+/).filter(Boolean);

  const results = await pruneStagingDeployments({ apiKey, teamId, projects, hosts });
  let failures = 0;
  for (const { label, previews, deleted, failed, deferred } of results) {
    console.log(
      `[${label}] ${previews} preview deployment(s); kept the newest ${KEEP_PREVIEWS} and what staging serves; ` +
        `deleted ${deleted.length}${failed.length ? `, ${failed.length} failed` : ""}` +
        `${deferred ? `, ${deferred} left for the next run (Vercel rate-limited the deletes)` : ""}.`,
    );
    for (const { id, error } of failed) console.error(`::error::[${label}] could not delete ${id}: ${error}`);
    failures += failed.length;
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Vercel staging deployments pruned\n\n` +
        results
          .map(
            ({ label, previews, deleted, failed, deferred }) =>
              `- \`${label}\`: ${previews} previews, ${deleted.length} deleted, ${failed.length} failed, ${deferred} left for the next run`,
          )
          .join("\n") +
        "\n",
    );
  }
  if (failures > 0) process.exit(1);
}

if (isInvokedDirectly(import.meta.url)) {
  main().catch((error) => {
    console.error(`Unhandled error: ${error.stack ?? error.message}`);
    process.exit(1);
  });
}
