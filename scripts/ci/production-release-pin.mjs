#!/usr/bin/env node

// Scheduled pin: the three production hosts serve the same tagged commit.
//
// Launch criterion 1 is "frapp.live, app.frapp.live and api.frapp.live serve
// the same tagged commit, and a vX.Y.Z tag records what is live." Guardrails
// watch dashboard fail-open settings. Uptime watches /health/ready. Neither
// notices a split-brain deploy or a named-SHA ship that skipped Release.
//
// This script reads:
//   * Render frapp-api-prod's deploy with status `live` → commit.id
//   * Vercel frapp-web and frapp-landing READY production githubCommitSha
//   * GitHub refs/tags/vX.Y.Z peeled to a commit
// and requires the three SHAs to be identical and to match at least one
// such tag. Matching origin/main is NOT required: live is allowed to lag
// main until the next Deploy production.
//
// /health `commit` is corroboration only. Absent is ignored (the live tag
// predates that field). Present and disagreeing with Render is a failure.
//
// It does not name GitHub environment: production. A schedule job that
// did would suspend on ADR-19's required-reviewer gate.
//
// Own alert title. A recovered uptime or guardrail run must not close this.
//
// Semantics: the pure functions below. Unit tests:
// `scripts/ci/__tests__/production-release-pin.test.mjs`.

import { findAlertIssuesDetailed, raiseAlert, resolveAlert } from "./lib/alert-issue.mjs";
import { requireEnv } from "./lib/env.mjs";
import { ghRequest } from "./lib/github.mjs";
import { fetchJson, fetchRenderDeploys } from "./lib/providers.mjs";

export const SHA_PATTERN = /^[0-9a-f]{40}$/;
export const V_TAG_REF = /^refs\/tags\/v\d+\.\d+\.\d+$/;
export const DEFAULT_HEALTH_URL = "https://api.frapp.live/health";

export const ALERT_ISSUE_TITLE = "Production hosts are not on the same tagged commit";
export const ALERT_ISSUE_LOOKUP_LABEL = "routine-state";
export const ALERT_ISSUE_LABELS = [ALERT_ISSUE_LOOKUP_LABEL, "area:ci", "P1"];

export function isFullSha(value) {
  return typeof value === "string" && SHA_PATTERN.test(value);
}

export function tagNameFromRef(ref) {
  return typeof ref === "string" && ref.startsWith("refs/tags/") ? ref.slice("refs/tags/".length) : "";
}

function vercelReadyState(deployment) {
  return deployment?.readyState ?? deployment?.state;
}

/**
 * Newest-first Render deploy page → the running commit.
 * Nested decoys (serviceDetails.commit, top-level commitId) are ignored.
 */
export function readLiveRenderCommit(page) {
  if (!Array.isArray(page)) {
    return { ok: false, reason: "Render deploys list unreadable" };
  }
  const live = page.find((entry) => entry?.deploy?.status === "live");
  if (!live) {
    return { ok: false, reason: "no Render deploy with status 'live'" };
  }
  const sha = live.deploy?.commit?.id;
  if (!isFullSha(sha)) {
    return {
      ok: false,
      reason: `Render live commit '${sha ?? "unreadable"}' is not a 40-hex SHA`,
    };
  }
  return { ok: true, sha };
}

/**
 * Vercel v6 list body → the current production commit for one project.
 * Preview rows (`target` absent/null) are not production, even if READY.
 */
export function readProductionVercelCommit(body, label) {
  if (!Array.isArray(body?.deployments)) {
    return { ok: false, reason: `Vercel ${label} deployments list unreadable` };
  }
  const ready = body.deployments.find(
    (deployment) => deployment?.target === "production" && vercelReadyState(deployment) === "READY",
  );
  if (!ready) {
    return { ok: false, reason: `no READY production deployment for ${label}` };
  }
  const sha = ready.meta?.githubCommitSha;
  if (!isFullSha(sha)) {
    return {
      ok: false,
      reason: `Vercel ${label} githubCommitSha '${sha ?? "unreadable"}' is not a 40-hex SHA`,
    };
  }
  return { ok: true, sha };
}

/**
 * Optional /health `commit` field. Absent is not a failure — live still
 * omits it until a later Deploy of the tree that added `readDeployedCommit`.
 */
export function readHealthCommitField(bodyText) {
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return { present: false };
  }
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return { present: false };
  }
  const commit = body.commit;
  if (commit == null || commit === "") {
    return { present: false };
  }
  if (!isFullSha(commit)) {
    return {
      present: true,
      ok: false,
      reason: `/health commit '${commit}' is not a 40-hex SHA`,
    };
  }
  return { present: true, ok: true, sha: commit };
}

export function compareHostShas({ api, web, landing }) {
  if (!api?.ok) return { ok: false, reason: api?.reason ?? "api SHA unreadable" };
  if (!web?.ok) return { ok: false, reason: web?.reason ?? "web SHA unreadable" };
  if (!landing?.ok) return { ok: false, reason: landing?.reason ?? "landing SHA unreadable" };
  if (api.sha !== web.sha || api.sha !== landing.sha) {
    return {
      ok: false,
      reason: `host SHAs disagree: api=${api.sha} web=${web.sha} landing=${landing.sha}`,
    };
  }
  return { ok: true, sha: api.sha };
}

export function tagsMatchingSha(tags, sha) {
  return (Array.isArray(tags) ? tags : [])
    .filter((tag) => tag?.sha === sha && typeof tag.name === "string")
    .map((tag) => tag.name)
    .sort();
}

/**
 * Combine host SHAs, peeled v* tags, and optional /health corroboration.
 */
export function evaluatePin({ hosts, tagsResult, health }) {
  const compared = compareHostShas(hosts);
  if (!compared.ok) return compared;

  if (!tagsResult?.ok) {
    return { ok: false, reason: tagsResult?.reason ?? "GitHub tags unreadable" };
  }
  const names = tagsMatchingSha(tagsResult.tags, compared.sha);
  if (names.length === 0) {
    return {
      ok: false,
      reason: `live SHA ${compared.sha} has no vX.Y.Z tag`,
    };
  }

  if (health?.present) {
    if (!health.ok) {
      return { ok: false, reason: health.reason };
    }
    if (health.sha !== compared.sha) {
      return {
        ok: false,
        reason: `/health commit ${health.sha} disagrees with Render live ${compared.sha}`,
      };
    }
  }

  return {
    ok: true,
    sha: compared.sha,
    tags: names,
    reason: `api=web=landing=${compared.sha} tagged ${names.join(", ")}`,
  };
}

export async function findLiveRenderDeployPage({
  apiKey,
  serviceId,
  maxPages = 5,
  fetchImpl = fetch,
}) {
  let cursor;
  for (let page = 0; page < maxPages; page += 1) {
    const rows = await fetchRenderDeploys({ apiKey, serviceId, cursor, fetchImpl });
    const live = readLiveRenderCommit(rows);
    if (live.ok) return { page: rows, live };
    if (live.reason !== "no Render deploy with status 'live'") {
      return { page: rows, live };
    }
    if (!Array.isArray(rows) || rows.length === 0) break;
    cursor = rows[rows.length - 1]?.cursor;
    if (!cursor) break;
  }
  return { page: [], live: { ok: false, reason: "no Render deploy with status 'live'" } };
}

function vercelProductionUrl(projectId, teamId) {
  const params = new URLSearchParams({
    projectId,
    target: "production",
    limit: "20",
  });
  if (teamId) params.set("teamId", teamId);
  return `https://api.vercel.com/v6/deployments?${params}`;
}

export async function peelVTags({ token, repo, fetchImpl }) {
  const listed = await ghRequest({
    token,
    fetchImpl,
    path: `/repos/${repo}/git/matching-refs/tags/v`,
  });
  if (!listed.ok || !Array.isArray(listed.data)) {
    return {
      ok: false,
      reason: `GitHub tags unreadable (HTTP ${listed.status})`,
      tags: [],
    };
  }

  const tags = [];
  for (const row of listed.data) {
    const ref = row?.ref;
    if (typeof ref !== "string" || !V_TAG_REF.test(ref)) continue;
    const object = row.object;
    const name = tagNameFromRef(ref);
    if (!name || !object || typeof object.sha !== "string") continue;

    if (object.type === "commit") {
      if (isFullSha(object.sha)) tags.push({ name, sha: object.sha });
      continue;
    }
    if (object.type !== "tag") continue;

    const peeled = await ghRequest({
      token,
      fetchImpl,
      path: `/repos/${repo}/git/tags/${object.sha}`,
    });
    const commitSha = peeled.ok ? peeled.data?.object?.sha : null;
    if (peeled.ok && isFullSha(commitSha)) {
      tags.push({ name, sha: commitSha });
    }
  }
  return { ok: true, tags };
}

export async function collectLiveShas({
  renderApiKey,
  vercelApiKey,
  teamId,
  renderServiceId,
  webProjectId,
  landingProjectId,
  healthUrl,
  fetchImpl = fetch,
}) {
  let api;
  try {
    const found = await findLiveRenderDeployPage({
      apiKey: renderApiKey,
      serviceId: renderServiceId,
      fetchImpl,
    });
    api = found.live;
  } catch (error) {
    api = {
      ok: false,
      reason: `Could not read Render deploys: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  async function vercelProject(projectId, label) {
    try {
      const body = await fetchJson({
        url: vercelProductionUrl(projectId, teamId),
        headers: { Authorization: `Bearer ${vercelApiKey}` },
        what: `Vercel production deployments for ${label}`,
        fetchImpl,
      });
      return readProductionVercelCommit(body, label);
    } catch (error) {
      return {
        ok: false,
        reason: `Could not read Vercel ${label}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  const web = await vercelProject(webProjectId, "frapp-web");
  const landing = await vercelProject(landingProjectId, "frapp-landing");

  let health = { present: false };
  if (healthUrl) {
    try {
      const response = await fetchImpl(healthUrl, { method: "GET" });
      const bodyText = await response.text();
      if (response.ok) {
        health = readHealthCommitField(bodyText);
      }
    } catch {
      health = { present: false };
    }
  }

  return { api, web, landing, health };
}

function buildAlertIssueBody({ verdict, runUrl }) {
  return [
    "Production hosts are not on one tagged commit.",
    "",
    `**${verdict.reason}**`,
    "",
    "`frapp.live`, `app.frapp.live`, and `api.frapp.live` must serve the same SHA, and that SHA must be the peeled target of a `vX.Y.Z` tag. Matching `main` is not required.",
    "",
    "Do not dispatch Deploy production from an agent session to clear this. If a host drifted, the next named-SHA Deploy of a tagged commit is the ship path.",
    "",
    runUrl ? `Run: ${runUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function runWatchdog({
  verdict,
  token,
  repo,
  runUrl = "",
  fetchImpl,
}) {
  const lookup = await findAlertIssuesDetailed({
    token,
    repo,
    fetchImpl,
    title: ALERT_ISSUE_TITLE,
    lookupLabel: ALERT_ISSUE_LOOKUP_LABEL,
  });
  const open = lookup.lookupOk
    ? lookup.issues.find((issue) => issue.state === "open")
    : null;

  if (!verdict.ok) {
    const raised = await raiseAlert({
      token,
      repo,
      fetchImpl,
      title: ALERT_ISSUE_TITLE,
      labels: ALERT_ISSUE_LABELS,
      lookupLabel: ALERT_ISSUE_LOOKUP_LABEL,
      buildIssueBody: () => buildAlertIssueBody({ verdict, runUrl }),
      buildCommentBody: ({ reopened }) =>
        `${reopened ? "Reopened — " : ""}still drifted: ${verdict.reason}${runUrl ? `\n\nRun: ${runUrl}` : ""}`,
      refreshBodyOnRaise: true,
    });
    return { outcome: "fail", alert: raised, lookupOk: lookup.lookupOk, open };
  }

  if (!lookup.lookupOk) {
    return { outcome: "pass", resolved: false, lookupOk: false };
  }

  const hadOpen = lookup.issues.some((issue) => issue.state === "open");
  const resolved = await resolveAlert({
    token,
    repo,
    fetchImpl,
    title: ALERT_ISSUE_TITLE,
    lookupLabel: ALERT_ISSUE_LOOKUP_LABEL,
    buildRecoveryBody: () =>
      `Production hosts share a tagged commit again: ${verdict.reason}${runUrl ? `\n\nRun: ${runUrl}` : ""}`,
  });
  if (resolved.action === "failed") {
    return { outcome: "fail", resolved: false, lookupOk: true };
  }
  if (hadOpen && resolved.action === "none") {
    return { outcome: "fail", resolved: false, lookupOk: true };
  }
  return {
    outcome: "pass",
    resolved: resolved.action === "closed",
    lookupOk: true,
  };
}

async function main() {
  const probeOnly = process.argv.includes("--probe-only");

  const renderApiKey = requireEnv("RENDER_API_KEY");
  const vercelApiKey = requireEnv("VERCEL_API_KEY");
  const renderServiceId = requireEnv("RENDER_SERVICE_ID");
  const webProjectId = requireEnv("VERCEL_WEB_PROJECT_ID");
  const landingProjectId = requireEnv("VERCEL_LANDING_PROJECT_ID");
  const teamId = process.env.VERCEL_TEAM_ID;
  const healthUrl = process.env.API_HEALTH_URL ?? DEFAULT_HEALTH_URL;

  let token;
  let repo;
  if (!probeOnly) {
    token = requireEnv("GITHUB_TOKEN");
    repo = requireEnv("GITHUB_REPOSITORY");
  }

  const hosts = await collectLiveShas({
    renderApiKey,
    vercelApiKey,
    teamId,
    renderServiceId,
    webProjectId,
    landingProjectId,
    healthUrl,
  });

  let tagsResult = { ok: true, tags: [] };
  if (!probeOnly) {
    tagsResult = await peelVTags({ token, repo });
  } else if (process.env.PROBE_TAG_SHA && process.env.PROBE_TAG_NAME) {
    tagsResult = {
      ok: true,
      tags: [{ name: process.env.PROBE_TAG_NAME, sha: process.env.PROBE_TAG_SHA }],
    };
  }

  const verdict = evaluatePin({ hosts, tagsResult, health: hosts.health });
  if (verdict.ok) {
    console.log(`✅ ${verdict.reason}`);
  } else {
    console.error(`::error::${verdict.reason}`);
  }

  if (probeOnly) {
    process.exit(verdict.ok ? 0 : 1);
  }

  const runUrl = process.env.RUN_URL ?? "";
  const watchdog = await runWatchdog({ verdict, token, repo, runUrl });
  if (!verdict.ok && watchdog.alert?.action === "failed") {
    console.error("::error::hosts are unpinned and the alert issue could not be written");
  }
  if (verdict.ok && watchdog.lookupOk === false) {
    console.error("::warning::Could not read the alert issues, so no alert was closed this run");
  }
  if (verdict.ok && watchdog.outcome === "fail") {
    console.error("::error::hosts are pinned but the alert issue could not be closed");
  }
  process.exit(watchdog.outcome === "pass" ? 0 : 1);
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`Unhandled error: ${error.stack ?? error.message}`);
    process.exit(1);
  });
}
