#!/usr/bin/env node

// Assert the two provider settings that make deploy-off-`main` safe, and keep
// asserting them.
//
// Retiring the `production` branch moves production deploys behind a manual
// `workflow_dispatch`. That is only true while two dashboard settings stay put,
// and BOTH of them fail open — if either drifts, ordinary merges to `main` start
// shipping to production with no CI gate, no migration gate, and no approval,
// and nothing anywhere goes red.
//
//   1. Render `frapp-api-prod` must have `autoDeploy: "no"`. Its live setting
//      before the cutover was `autoDeploy: "yes"` with
//      `autoDeployTrigger: "commit"` — a push deployed it without waiting for
//      CI. Combined with the branch change to `main` (also asserted here) that
//      is the single most destructive configuration available to this repo.
//   2. Vercel's Production Branch must NOT be `main`, for web and landing.
//
// Note the shape of assertion 2: it is "not main", not "equals X". After the
// branch is deleted, `productionBranch: "production"` points at a branch that no
// longer exists, and that is the SAFE state — no push can ever match it, so
// nothing auto-promotes and the dispatch workflow is the only path. Pinning it
// to a live branch name is what would be dangerous. An ABSENT value fails too:
// Vercel falls back to the repository's default branch when the field is unset,
// and the default branch is `main`.
//
// ── Why not a job in staging-conformance.mjs ───────────────────────────────
// That script's charter, and its alert issue title, are staging-scoped
// ("frapp-staging has drifted"). Folding production into it would either
// mis-title production alerts or force a rename — and its title is the issue
// LOOKUP KEY, so renaming it orphans any open alert so it can never self-close.
// A sibling script with its own title is cheaper than either.
//
// ── Two modes ───────────────────────────────────────────────────────────────
//   --preflight  exit non-zero on any violation, file nothing. Used by
//                deploy-production.yml before it touches anything.
//   (default)    raise/resolve a tracking issue, for the schedule.
//
// Unlike staging-conformance.mjs there is no `skipped` outcome. An unreadable
// setting is a failure: "I could not check whether production is wired to
// auto-deploy" is not a state in which to deploy to production.
//
// Semantics: the pure functions below. Unit tests:
// `scripts/ci/__tests__/production-guardrails.test.mjs`.

import { findAlertIssuesDetailed, raiseAlert, resolveAlert } from "./lib/alert-issue.mjs";

export const ALERT_ISSUE_TITLE =
  "Production deploy guardrails have drifted — auto-deploy or production branch is wrong";
export const ALERT_ISSUE_LOOKUP_LABEL = "routine-state";
export const ALERT_ISSUE_LABELS = [ALERT_ISSUE_LOOKUP_LABEL, "area:ci", "P1"];

export const RENDER_PROD_SERVICE_ID = "srv-d6lqu41aae7s73f62df0";
export const VERCEL_WEB_PROJECT_ID = "prj_xkn32taKrJCgYRZoN6pZRfGfPT9T";
export const VERCEL_LANDING_PROJECT_ID = "prj_aAkER9EZJcxR51vUY0mwNDnCf8vy";

const RENDER_SERVICE_URL = (serviceId) => `https://api.render.com/v1/services/${serviceId}`;
const VERCEL_PROJECT_URL = (projectId, teamId) =>
  `https://api.vercel.com/v9/projects/${projectId}${teamId ? `?teamId=${teamId}` : ""}`;

// ── Pure assertions ─────────────────────────────────────────────────────────

/**
 * Render must not auto-deploy production, and must track `main` now that
 * `production` is gone.
 */
export function assertRenderService(service) {
  const findings = [];
  const autoDeploy = service?.autoDeploy;
  const branch = service?.branch;

  if (autoDeploy !== "no") {
    findings.push(
      `Render frapp-api-prod has autoDeploy='${autoDeploy ?? "unreadable"}' (expected 'no'). ` +
        `With autoDeploy on, every push to its tracked branch deploys production without CI, ` +
        `without the migration gate, and without an approval.`,
    );
  }
  if (branch !== "main") {
    findings.push(
      `Render frapp-api-prod tracks branch '${branch ?? "unreadable"}' (expected 'main'). ` +
        `A service pointed at a deleted branch cannot resolve the commits this repo deploys.`,
    );
  }
  return findings;
}

/**
 * Vercel's Production Branch must not be `main`, and must be readable.
 *
 * Absent is a violation, not a pass: Vercel falls back to the repository
 * default branch (which is `main`) when the field is unset.
 */
export function assertVercelProductionBranch(project, label) {
  const branch = project?.link?.productionBranch;

  if (branch === undefined || branch === null || branch === "") {
    return [
      `Vercel ${label} has no Production Branch set, so Vercel falls back to the repository ` +
        `default branch (main). Every merge to main would become a production deployment. ` +
        `Set it in the dashboard (the REST API exposes link.productionBranch read-only).`,
    ];
  }
  if (branch === "main") {
    return [
      `Vercel ${label} has Production Branch = 'main'. Every merge to main deploys straight to ` +
        `production, bypassing deploy-production.yml entirely. Change it in the dashboard.`,
    ];
  }
  return [];
}

export function buildSummary(findings) {
  if (findings.length === 0) {
    return "All production deploy guardrails hold: Render auto-deploy is off and tracking main; neither Vercel project promotes from main.";
  }
  return [`${findings.length} production guardrail violation(s):`, ...findings.map((f) => `- ${f}`)].join("\n");
}

// ── Provider reads ──────────────────────────────────────────────────────────

async function readJson({ url, headers, what, fetchImpl }) {
  const response = await fetchImpl(url, { headers });
  if (!response.ok) {
    throw new Error(`${what} returned HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * Every violation across both providers. A provider that cannot be READ yields
 * a violation of its own rather than being skipped.
 */
export async function collectFindings({
  renderApiKey,
  vercelApiKey,
  teamId,
  renderServiceId = RENDER_PROD_SERVICE_ID,
  vercelProjects = [
    { projectId: VERCEL_WEB_PROJECT_ID, label: "frapp-web" },
    { projectId: VERCEL_LANDING_PROJECT_ID, label: "frapp-landing" },
  ],
  fetchImpl = fetch,
}) {
  const findings = [];

  try {
    const service = await readJson({
      url: RENDER_SERVICE_URL(renderServiceId),
      headers: { Authorization: `Bearer ${renderApiKey}` },
      what: `Render service ${renderServiceId}`,
      fetchImpl,
    });
    findings.push(...assertRenderService(service));
  } catch (error) {
    findings.push(`Could not read Render service ${renderServiceId}: ${error.message}. Unreadable is not a pass.`);
  }

  for (const project of vercelProjects) {
    try {
      const body = await readJson({
        url: VERCEL_PROJECT_URL(project.projectId, teamId),
        headers: { Authorization: `Bearer ${vercelApiKey}` },
        what: `Vercel project ${project.label}`,
        fetchImpl,
      });
      findings.push(...assertVercelProductionBranch(body, project.label));
    } catch (error) {
      findings.push(`Could not read Vercel project ${project.label}: ${error.message}. Unreadable is not a pass.`);
    }
  }

  return findings;
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

function buildAlertIssueBody({ findings, runUrl }) {
  return [
    "The settings that keep production deploys behind `deploy-production.yml` have drifted.",
    "",
    "Until this is fixed, a merge to `main` may deploy to production with no CI gate, no",
    "migration gate, and no approval.",
    "",
    ...findings.map((f) => `- ${f}`),
    "",
    runUrl ? `Run: ${runUrl}` : "",
    "",
    "Both settings are dashboard-only. See `docs/internal/ops/DEPLOYMENT.md`.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function main() {
  const preflight = process.argv.includes("--preflight");

  const findings = await collectFindings({
    renderApiKey: requireEnv("RENDER_API_KEY"),
    vercelApiKey: requireEnv("VERCEL_API_KEY"),
    teamId: process.env.VERCEL_TEAM_ID,
  });

  const summary = buildSummary(findings);
  if (findings.length === 0) console.log(`✅ ${summary}`);
  else console.error(`::error::${summary}`);

  if (preflight) {
    process.exit(findings.length === 0 ? 0 : 1);
  }

  const token = requireEnv("GITHUB_TOKEN");
  const repo = requireEnv("GITHUB_REPOSITORY");
  const runUrl = process.env.RUN_URL ?? "";

  if (findings.length > 0) {
    await raiseAlert({
      token,
      repo,
      title: ALERT_ISSUE_TITLE,
      labels: ALERT_ISSUE_LABELS,
      lookupLabel: ALERT_ISSUE_LOOKUP_LABEL,
      buildIssueBody: () => buildAlertIssueBody({ findings, runUrl }),
      buildCommentBody: ({ reopened }) =>
        `${reopened ? "Reopened — " : ""}still drifted:\n\n${findings.map((f) => `- ${f}`).join("\n")}${runUrl ? `\n\nRun: ${runUrl}` : ""}`,
      refreshBodyOnRaise: true,
    });
    process.exit(1);
  }

  // Only close on a lookup that actually worked. A failed lookup returns an
  // empty list, which is indistinguishable from "no alert is open" — closing on
  // that would let a transient 5xx silently resolve a live alert.
  const { lookupOk } = await findAlertIssuesDetailed({
    token,
    repo,
    title: ALERT_ISSUE_TITLE,
    lookupLabel: ALERT_ISSUE_LOOKUP_LABEL,
  });
  if (lookupOk) {
    await resolveAlert({
      token,
      repo,
      title: ALERT_ISSUE_TITLE,
      lookupLabel: ALERT_ISSUE_LOOKUP_LABEL,
      buildRecoveryBody: () => `Guardrails hold again.\n\n${summary}${runUrl ? `\n\nRun: ${runUrl}` : ""}`,
    });
  }
  process.exit(0);
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`Unhandled error: ${error.stack ?? error.message}`);
    process.exit(1);
  });
}
