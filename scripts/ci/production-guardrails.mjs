#!/usr/bin/env node

// Assert the provider settings that make deploy-off-`main` safe, and keep
// asserting them.
//
// Retiring the `production` branch moved production deploys behind a manual
// `workflow_dispatch`. That is only true while the Vercel projects stay
// unlinked from Git, a dashboard setting that fails open: if it drifts,
// ordinary merges to `main` start shipping to production with no CI gate, no
// migration gate, and no approval, and nothing anywhere goes red.
//
//   Vercel `frapp-web` and `frapp-landing` must NOT be linked to Git.
//
// Until #5228 this also asserted Render `frapp-api-prod`'s settings
// (auto-deploy off, tracking `main`, healthCheckPath `/health`). The API moved
// to Cloud Run, which nothing deploys but the deploy job (no build trigger
// watches the repository), and Render was removed.
//
// The assertion was INVERTED on 2026-09-02 (#1579). It used to read "Production
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
// did. ADR-21 in `spec/architecture/adr/adr-21.md` is the canonical record.
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
//                  database write — frapp-web's Vercel Git link — skipping
//                  only frapp-landing. See main().
//   --preflight  exit non-zero on any violation, file nothing. Used by
//                deploy-production.yml before it touches anything.
//   (default)    raise/resolve a tracking issue, for the schedule. Exits 1 on
//                any violation, or when a clean run could not read or close
//                its alert (see syncGuardrailsAlert).
//
// Unlike staging-conformance.mjs there is no `skipped` outcome. An unreadable
// setting is a failure: "I could not check whether production is wired to
// auto-deploy" is not a state in which to deploy to production.
//
// Semantics: the pure functions below. Unit tests:
// `scripts/ci/__tests__/production-guardrails.test.mjs`.

import {
  defineAlert,
  raiseAlert,
  resolveAlert,
} from "./lib/alert-issue.mjs";
import { requireEnv } from "./lib/env.mjs";
import { resilientFetch } from "./lib/http.mjs";
import { fetchJson } from "./lib/providers.mjs";
import { isInvokedDirectly } from "./lib/invoked-directly.mjs";

// Deliberately NOT renamed when assertion 2 was inverted (#1579), even though
// "production branch" now under-describes it. This string is the issue LOOKUP
// KEY — see the header — so changing it orphans any open alert filed under the
// old wording, which then can never self-close. #1564 is exactly such an alert.
// The cost of the stale half-sentence is a slightly wide title; the cost of
// renaming is an immortal P1 issue. Rename only in a change that also closes
// every open alert carrying the old title.
export const ALERT = defineAlert({
  title: "Production deploy guardrails have drifted — auto-deploy or production branch is wrong",
  labels: ["area:ci", "P1"],
});

// Provider identifiers are NOT defaulted here, deliberately. Every sibling
// script requires them from the environment, and the workflows that call this
// one pass the same values they use to deploy. A default would let this
// watchdog keep asserting against a service the deploy no longer targets — the
// one failure mode a guardrail must not have.

const VERCEL_PROJECT_URL = (projectId, teamId) =>
  `https://api.vercel.com/v9/projects/${projectId}${teamId ? `?teamId=${teamId}` : ""}`;

// ── Pure assertions ─────────────────────────────────────────────────────────

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
 * `--migrations-only` frapp-landing is never fetched, and a success line that
 * still said "neither Vercel project is linked to Git" would be an
 * affirmative written assurance about a setting nothing looked at, on the only
 * path to production. That is the "reports success having verified nothing"
 * failure this file's own header rejects.
 */
export function buildSummary(findings, { checked = ["vercel"] } = {}) {
  if (findings.length === 0) {
    return checked.includes("vercel")
      ? "All production deploy guardrails hold: neither Vercel project is linked to Git."
      : "The production deploy guardrails THIS RUN CHECKED hold: frapp-web is not linked to Git. " +
          "frapp-landing's Git link was NOT read (--migrations-only); it has no Supabase " +
          "client, so it cannot be coupled to a schema change.";
  }
  return [`${findings.length} production guardrail violation(s):`, ...findings.map((f) => `- ${f}`)].join("\n");
}

// ── Provider reads ──────────────────────────────────────────────────────────

/**
 * Every violation across the Vercel projects. A project that cannot be READ
 * yields a violation of its own rather than being skipped.
 */
export async function collectFindings({
  vercelApiKey,
  teamId,
  vercelProjects,
  fetchImpl = resilientFetch,
}) {
  const findings = [];

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
    "A production provider setting the guardrails assert has drifted.",
    "",
    "If a Vercel project is re-linked to Git, a merge to `main` may deploy to production",
    "with no CI gate, no migration gate, and no approval.",
    "",
    ...findings.map((f) => `- ${f}`),
    "",
    runUrl ? `Run: ${runUrl}` : "",
    "",
    "These settings are dashboard-only. See `docs/ops/deployment/`.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Raises the alert on a violation, or closes it on a clean run, and returns the
 * scheduled run's exit code: 1 on any violation, and 1 on a clean run whose
 * alert could not be read or closed, since exiting 0 there hides a P1 left open
 * on a healthy production (#2627).
 */
export async function syncGuardrailsAlert({
  findings,
  summary,
  token,
  repo,
  runUrl = "",
  fetchImpl,
  logger = console,
}) {
  if (findings.length > 0) {
    const alert = await raiseAlert({
      token,
      repo,
      fetchImpl,
      alert: ALERT,
      buildIssueBody: () => buildAlertIssueBody({ findings, runUrl }),
      buildCommentBody: ({ reopened }) =>
        `${reopened ? "Reopened — " : ""}still drifted:\n\n${findings.map((f) => `- ${f}`).join("\n")}${runUrl ? `\n\nRun: ${runUrl}` : ""}`,
      refreshBodyOnRaise: true,
    });
    if (alert.action === "failed") {
      logger.log?.("::error::guardrails have drifted and the alert issue could not be written");
    }
    return { alert, exitCode: 1 };
  }

  const alert = await resolveAlert({
    token,
    repo,
    fetchImpl,
    alert: ALERT,
    buildRecoveryBody: () => `Guardrails hold again.\n\n${summary}${runUrl ? `\n\nRun: ${runUrl}` : ""}`,
  });
  if (alert.action === "unread") {
    logger.log?.(
      "::error::guardrails hold, but the alert issues could not be read, so none was closed this run",
    );
    return { alert, exitCode: 1 };
  }
  if (alert.action === "failed") {
    logger.log?.("::error::guardrails hold but the alert issue could not be closed");
    return { alert, exitCode: 1 };
  }
  return { alert, exitCode: 0 };
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
      "ℹ️  --migrations-only: asserting frapp-web's Vercel Git link. " +
        "frapp-landing is NOT checked — it has no Supabase " +
        "client, so it cannot be coupled to the schema this run changes.",
    );
  }

  const findings = await collectFindings({
    vercelApiKey: requireEnv("VERCEL_API_KEY"),
    teamId: process.env.VERCEL_TEAM_ID,
    vercelProjects: [
      { projectId: requireEnv("VERCEL_WEB_PROJECT_ID"), label: "frapp-web" },
      ...(migrationsOnly
        ? []
        : [{ projectId: requireEnv("VERCEL_LANDING_PROJECT_ID"), label: "frapp-landing" }]),
    ],
  });

  const summary = buildSummary(findings, {
    checked: migrationsOnly ? ["vercel-web"] : ["vercel"],
  });
  if (findings.length === 0) console.log(`✅ ${summary}`);
  else console.error(`::error::${summary}`);

  if (preflight) {
    process.exit(findings.length === 0 ? 0 : 1);
  }

  const token = requireEnv("GITHUB_TOKEN");
  const repo = requireEnv("GITHUB_REPOSITORY");
  const runUrl = process.env.RUN_URL ?? "";

  const { exitCode } = await syncGuardrailsAlert({ findings, summary, token, repo, runUrl });
  process.exit(exitCode);
}

if (isInvokedDirectly(import.meta.url)) {
  main().catch((error) => {
    console.error(`Unhandled error: ${error.stack ?? error.message}`);
    process.exit(1);
  });
}
