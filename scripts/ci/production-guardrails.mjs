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
//   2. Vercel `frapp-web` and `frapp-landing` must NOT be linked to Git.
//
// Assertion 2 was INVERTED on 2026-09-02 (#1579). It used to read "Production
// Branch must not be `main`", with an ABSENT value failing because Vercel fell
// back to the repository default branch. ADR-21 then retired the Git
// integration outright: both projects are unlinked, `link` is null, and a
// Production Branch no longer exists to assert. Under the old assertion that
// permanent, intended state read as a violation, which reddened the daily run
// and — because this same script is `deploy-production.yml`'s preflight —
// blocked every production deploy.
//
// So the assertion now proves the thing that actually keeps production safe
// post-ADR-21: there is no Git link at all, therefore no Production Branch and
// no push path. A PRESENT link is the violation, because re-linking silently
// restores BOTH fail-open dashboard settings the unlink removed. Inverted
// rather than deleted, deliberately: staying unlinked is itself unversioned
// dashboard state, so it needs an assertion exactly as the Production Branch
// did. ADR-21 in `spec/architecture/README.md` is the canonical record.
//
// Note what this costs. The old assertion failed CLOSED — absent meant
// violation — so a malformed or empty response could not be mistaken for a
// pass. The inverted one treats absent as the pass, so it MUST first establish
// that it is looking at a real project body; otherwise `{}` from a changed API
// shape, or an error envelope, would read as "unlinked" and green. That is what
// `looksLikeVercelProject` is for, and it is the load-bearing half of this
// assertion rather than a nicety.
//
// ── Why not a job in staging-conformance.mjs ───────────────────────────────
// That script's charter, and its alert issue title, are staging-scoped
// ("frapp-staging has drifted"). Folding production into it would either
// mis-title production alerts or force a rename — and its title is the issue
// LOOKUP KEY, so renaming it orphans any open alert so it can never self-close.
// A sibling script with its own title is cheaper than either.
//
// ── Two modes ───────────────────────────────────────────────────────────────
//   --migrations-only  with --preflight: assert everything that bears on a
//                  database write — Render's auto-deploy AND frapp-web's Vercel
//                  Production Branch — skipping only frapp-landing. See main().
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
import { requireEnv } from "./lib/env.mjs";
import { resilientFetch } from "./lib/http.mjs";
import { fetchJson } from "./lib/providers.mjs";

// Deliberately NOT renamed when assertion 2 was inverted (#1579), even though
// "production branch" now under-describes it. This string is the issue LOOKUP
// KEY — see the header — so changing it orphans any open alert filed under the
// old wording, which then can never self-close. #1564 is exactly such an alert.
// The cost of the stale half-sentence is a slightly wide title; the cost of
// renaming is an immortal P1 issue. Rename only in a change that also closes
// every open alert carrying the old title.
export const ALERT_ISSUE_TITLE =
  "Production deploy guardrails have drifted — auto-deploy or production branch is wrong";
export const ALERT_ISSUE_LOOKUP_LABEL = "routine-state";
export const ALERT_ISSUE_LABELS = [ALERT_ISSUE_LOOKUP_LABEL, "area:ci", "P1"];

// Provider identifiers are NOT defaulted here, deliberately. Every sibling
// script requires them from the environment, and the workflows that call this
// one pass the same values they use to deploy. A default would let this
// watchdog keep asserting against a service the deploy no longer targets — the
// one failure mode a guardrail must not have.

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
 * Does this response body actually look like a Vercel project?
 *
 * The inverted assertion below treats an absent `link` as the PASS, so it can
 * only be trusted once we know we are reading a project at all. Vercel's
 * `/v9/projects/{id}` returns the project object with `id` and `name` at the
 * top level; an error envelope (`{ error: { code, message } }`), an empty
 * object, or a future response shape has neither. Without this check, any of
 * those would present as "no link, therefore safe" — a guardrail reporting
 * success having verified nothing, on the only path to production.
 */
export function looksLikeVercelProject(project) {
  return (
    typeof project === "object" &&
    project !== null &&
    typeof project.id === "string" &&
    project.id !== ""
  );
}

/**
 * Vercel `frapp-web` and `frapp-landing` must NOT be linked to Git (ADR-21).
 *
 * A PRESENT link is the violation: re-linking restores the Production Branch
 * and auto-deploy-from-push settings the unlink removed, both of which fail
 * open. An absent link is the pass — but only once the body is confirmed to be
 * a project, since absent-means-pass is otherwise indistinguishable from a
 * response we failed to understand.
 */
export function assertVercelNoGitLink(project, label) {
  if (!looksLikeVercelProject(project)) {
    return [
      `Vercel ${label} did not return a readable project object, so this run could not ` +
        `determine whether it is linked to Git. Unreadable is not a pass — an absent 'link' in ` +
        `an unrecognised response shape is exactly what a silent regression would look like.`,
    ];
  }

  const link = project.link;
  if (link === undefined || link === null) return [];

  // A link object with nothing identifying in it is still a link: the project
  // is attached to a repository, which is the condition ADR-21 removed.
  const where = [link.type, link.org && link.repo ? `${link.org}/${link.repo}` : null]
    .filter(Boolean)
    .join(" ");
  return [
    `Vercel ${label} is linked to Git${where ? ` (${where})` : ""}. ADR-21 retired the Vercel ` +
      `Git integration; a link restores BOTH fail-open dashboard settings it removed — the ` +
      `Production Branch, and auto-deploy from push — so merges to main could ship to ` +
      `production with no CI gate, no migration gate and no approval. Disconnect it in the ` +
      `Vercel dashboard (Settings -> Git), or amend ADR-21 if the integration is coming back ` +
      `deliberately.`,
  ];
}

/**
 * The pass/fail line.
 *
 * `checked` names what this run actually read. It is not decoration: with
 * `--render-only` the Vercel projects are never fetched, and a success line that
 * still said "neither Vercel project is linked to Git" would be an
 * affirmative written assurance about a setting nothing looked at — on the only
 * path to production, in the step whose whole job is asserting the two settings
 * that fail open. That is the "reports success having verified nothing" failure
 * this file's own header rejects, and an earlier `ℹ️ --render-only` notice does
 * not undo a later `✅` that names the unchecked setting.
 */
export function buildSummary(findings, { checked = ["render", "vercel"] } = {}) {
  if (findings.length === 0) {
    const full = checked.includes("vercel");
    const parts = ["Render auto-deploy is off and tracking main"];
    if (full) parts.push("neither Vercel project is linked to Git");
    else if (checked.includes("vercel-web")) parts.push("frapp-web is not linked to Git");
    return full
      ? `All production deploy guardrails hold: ${parts.join("; ")}.`
      : `The production deploy guardrails THIS RUN CHECKED hold: ${parts.join("; ")}. ` +
          `frapp-landing's Git link was NOT read (--migrations-only); it has no Supabase ` +
          `client, so it cannot be coupled to a schema change.`;
  }
  return [`${findings.length} production guardrail violation(s):`, ...findings.map((f) => `- ${f}`)].join("\n");
}

// ── Provider reads ──────────────────────────────────────────────────────────

/**
 * Every violation across both providers. A provider that cannot be READ yields
 * a violation of its own rather than being skipped.
 */
export async function collectFindings({
  renderApiKey,
  vercelApiKey,
  teamId,
  renderServiceId,
  vercelProjects,
  fetchImpl = resilientFetch,
}) {
  const findings = [];

  try {
    const service = await fetchJson({
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
      const body = await fetchJson({
        url: VERCEL_PROJECT_URL(project.projectId, teamId),
        headers: { Authorization: `Bearer ${vercelApiKey}` },
        what: `Vercel project ${project.label}`,
        fetchImpl,
      });
      findings.push(...assertVercelNoGitLink(body, project.label));
    } catch (error) {
      findings.push(`Could not read Vercel project ${project.label}: ${error.message}. Unreadable is not a pass.`);
    }
  }

  return findings;
}

// ── CLI entry ───────────────────────────────────────────────────────────────

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

  // `--migrations-only` drops exactly ONE assertion: frapp-landing's Vercel
  // Git link. It exists for one caller, `deploy-production.yml` under
  // `scope: migrations-only`, which writes to the database and deploys no code.
  //
  // An earlier cut of this flag was called `--render-only` and dropped BOTH
  // Vercel projects, on the stated grounds that "a Vercel Production Branch
  // bears on nothing a migration does". That is false for frapp-web and the
  // repo proves it: `apps/web/lib/supabase/client.ts` builds a Supabase browser
  // client, `apps/web/lib/chat/use-chat-channel.ts` reads
  // `chat_message_actions` through PostgREST directly, and
  // `packages/chat-core/src/realtime-manager.ts` binds `postgres_changes` to
  // `public.chat_messages` and `public.chat_message_actions`. Tables, columns,
  // publication membership and RLS policies are exactly what a migration
  // changes — so if frapp-web were re-linked to Git, every merge could already
  // have shipped a production dashboard wired straight to the schema this run
  // is about to change. The reasoning survives the #1579 inversion intact: only
  // the mechanism changed (a link rather than a branch name), not which project
  // a database-only run can honestly skip.
  //
  // frapp-landing genuinely has no Supabase client (verified: no
  // `@supabase/supabase-js` or `createClient` anywhere under apps/landing), so
  // it is the one assertion a database-only run can honestly skip.
  const migrationsOnly = process.argv.includes("--migrations-only");
  if (migrationsOnly && !preflight) {
    console.error("Error: --migrations-only is only meaningful with --preflight.");
    process.exit(2);
  }
  if (migrationsOnly) {
    console.log(
      "ℹ️  --migrations-only: asserting Render auto-deploy and frapp-web's Vercel Git link. " +
        "frapp-landing is NOT checked — it has no Supabase client, so it cannot be coupled to " +
        "the schema this run changes.",
    );
  }

  const findings = await collectFindings({
    renderApiKey: requireEnv("RENDER_API_KEY"),
    vercelApiKey: requireEnv("VERCEL_API_KEY"),
    teamId: process.env.VERCEL_TEAM_ID,
    renderServiceId: requireEnv("RENDER_SERVICE_ID"),
    vercelProjects: [
      { projectId: requireEnv("VERCEL_WEB_PROJECT_ID"), label: "frapp-web" },
      ...(migrationsOnly
        ? []
        : [{ projectId: requireEnv("VERCEL_LANDING_PROJECT_ID"), label: "frapp-landing" }]),
    ],
  });

  const summary = buildSummary(findings, {
    checked: migrationsOnly ? ["render", "vercel-web"] : ["render", "vercel"],
  });
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
