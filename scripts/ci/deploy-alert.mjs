#!/usr/bin/env node
// Terminal reporting job for the `deploy-outcome` job of a deploy workflow.
// WHICH workflow it reports on is chosen by the `ALERT_CONFIG` env var; the
// configurations live in `ALERT_CONFIGS` below and an unknown name is a hard
// error, never a silent fallback.
//
// Written for `deploy-api.yml`, and generalised in #1674 to also watch
// `deploy-vercel-staging.yml`, which shipped in #1578 with no alerting of any
// kind. Parameterised rather than copied: a second copy of an
// upsert-one-tracking-issue script is two places for the "an open alert means
// it is broken right now" contract to drift.
//
// #2431 added a third, for `verify-deployments.yml`, which watched the staging
// API deploy Render ran on push. #2505 retired it with that push path, and the
// observer-only machinery (a verdict read from a job output, a branch-tip
// check, "not confirmed live" copy) went with it.
//
// #2803 merged the two staging workflows into `deploy-staging.yml`, one
// ordered job, and their two configs into `DEPLOY_STAGING_CONFIG` below. The
// config machinery stays general: `gateJob` and `gateOutputRows` have no user
// today. #2805 added `DEPLOY_PRODUCTION_CONFIG`, for `deploy-production.yml`.
//
// Closes the visibility gap recorded in issue #763:
// `Deploy API` failed 44 of 44 executing runs for 71 days and nobody noticed,
// because three things compounded —
//
//   1. A skipped run is a GREEN run. The `check-changes` path gate of the time
//      skipped the deploy/migrate jobs when a push touched neither `apps/api/`
//      nor `supabase/migrations/`; 46 of the last 90 runs were
//      green-because-empty, so the Actions list read "healthy" while the
//      deploy path was 100% dead. (No path gate is left since #2505.)
//   2. `workflow_run` failures never land on a commit or a PR the way `CI`
//      does, so nothing turned red anywhere a human normally looks.
//   3. There was no notification of any kind.
//
// Only (1) was specific to a workflow with a path gate. (2) and (3) are
// properties of every `workflow_run`-triggered deploy in this repo, which is
// exactly why the staging frontends' workflow needed this too: it had no skip
// path, so a failure did go red in the Actions list, but there was still no
// commit status, no PR check and no notification. ADR-21's Git unlink froze
// both staging hosts and went undetected for days on precisely that gap.
//
// This script answers (1) and (3). It runs after every deploy/migrate job in
// the run and:
//
//   * writes a step summary + annotation that states plainly whether the run
//     DEPLOYED something or DECLINED to deploy (and, for a config with a
//     deploy plan, whether the API was UP TO DATE or the run SUPERSEDED), so
//     green stops being ambiguous;
//   * on failure, upserts ONE tracking issue (create / reopen / comment) rather
//     than filing a fresh issue per failure — alert spam is how alerting gets
//     muted;
//   * on a later successful deploy (with a deploy plan, one for main's tip),
//     closes that issue, so "alert issue open" reliably means "the deploy path
//     is broken right now".
//
// Channel choice: GitHub Issues, matching `ci-wake.mjs` / `pr-base-sync.mjs`
// (which post to PRs) and the tracker itself (#680 retired Linear). A staging
// deploy is merge-driven with no PR to comment on, so an issue is the
// equivalent target.
// No new service, no new token — `GITHUB_TOKEN` with job-scoped `issues: write`.
//
// Env inputs:
//   GITHUB_TOKEN       — required (issues: write)
//   GITHUB_REPOSITORY  — required, owner/repo
//   DEPLOY_NEEDS       — required, `toJSON(needs)` from the workflow
//   ALERT_CONFIG       — required, which ALERT_CONFIGS entry to use. There is
//                        no default: every call site names itself
//   RUN_URL            — required, html_url of this run
//   HEAD_BRANCH        — the deployed ref (always `main` since #1340)
//   HEAD_SHA           — the deployed commit
//
// Exits 0 on every handled outcome — a watchdog that reds the run creates the
// noise it exists to remove, and the underlying deploy job is already red.
// Exits 1 only on unexpected errors.

import { appendFileSync } from "node:fs";

import {
  ALERT_LOOKUP_LABEL,
  findAlertIssues as findAlertIssuesByTitle,
  raiseAlert as raiseAlertIssue,
  resolveAlert as resolveAlertIssue,
} from "./lib/alert-issue.mjs";
import { requireEnv } from "./lib/env.mjs";
import { ghRequest } from "./lib/github.mjs";
import { isInvokedDirectly } from "./lib/invoked-directly.mjs";

// ── Alert issue identity ────────────────────────────────────────────────────
// Title is the primary key: it is looked up by exact match, so it must stay
// stable across releases. The lookup label comes from lib/alert-issue.mjs,
// which owns it for every watchdog and says what it does.
export const ALERT_ISSUE_LOOKUP_LABEL = ALERT_LOOKUP_LABEL;

// ── Alert configurations ────────────────────────────────────────────────────
// One entry per watched deploy workflow. A config is the complete answer to
// "which jobs am I reading, and which alert issue am I upserting" — everything
// workflow-specific in this file reads from here, and nothing else does.
//
// ⚠️ `alertTitle` is the issue LOOKUP KEY, matched by exact string. Renaming
// one orphans whatever alert issue is currently open under the old title: it
// could never be found again, and so would never self-close. So a config that
// replaces another lists the old title in `retiredAlertTitles`, and a
// successful run closes an issue still open under it (#2803).

/**
 * `.github/workflows/deploy-staging.yml`, the one staging deploy since #2803:
 * database, API, web and landing in one ordered job.
 *
 * It replaced two configs. `deploy-api` watched `deploy-api.yml` (P1; a
 * `check-changes` gate, then `migrate-staging` and `deploy-staging`), and
 * `deploy-vercel-staging` watched `deploy-vercel-staging.yml` (P2; one gateless
 * `deploy` job). A failed merged deploy is P1, the level Deploy API used (owner
 * decision on #2803): the frontends now ship only behind a verified API, so a
 * failure anywhere stops staging.
 *
 * `gateJob` is null: the one `deploy` job carries the eligibility conditions
 * itself, so "nothing ran" on an eligible run is never a legitimate outcome.
 *
 * `planOutput` is the `deploy` job's plan (scripts/ci/plan-staging-deploy.mjs),
 * which a job result alone can't carry:
 *   deploy  — an API deploy was attempted; the job result is the verdict.
 *   current — the API needed no deploy and this is main's tip: a green job
 *             means the API was verified serving and ready and the frontends
 *             uploaded, which may close the alert, but the summary must not
 *             say the API DEPLOYED (nor that nothing shipped: web and landing
 *             did).
 *   forward — not main's tip, but deployed forward: a failure raises the
 *             alert like any deploy, but success doesn't close it, since
 *             main's tip may still be failing. The tip's run decides.
 *   stale   — not main's tip, and no API deployed. Web and landing may still
 *             have moved forward (the plan's `upload` rule), but the verdict
 *             is about a non-tip commit, so a green one neither raises nor
 *             closes the alert; a failed one raises it like any failure.
 *
 * `retiredAlertTitles` are the two old configs' titles. A successful run
 * closes an issue still open under either, so neither is orphaned by the
 * rename (titles are lookup keys; see the note above `DEPLOY_STAGING_CONFIG`).
 */
export const DEPLOY_STAGING_CONFIG = {
  name: "deploy-staging",
  workflowLabel: "Deploy staging",
  workflowFile: ".github/workflows/deploy-staging.yml",
  gateJob: null,
  deployJobs: ["deploy"],
  gateOutputRows: [],
  planOutput: { job: "deploy", output: "plan" },
  // What the alert issue tells its reader closes it. Not "a later successful
  // deploy": a `forward` deploy succeeds without closing it.
  closesOn: "a later run for `main`'s tip deploys successfully or finds the API up to date",
  alertTitle: "Deploy staging is failing — merges are not reaching staging",
  alertLabels: [ALERT_ISSUE_LOOKUP_LABEL, "area:ci", "P1"],
  retiredAlertTitles: [
    "Deploy API is failing — pushes are not reaching the environment",
    "Deploy Vercel staging is failing — web and landing are not reaching staging",
  ],
  noOpReason: "the deploy job did not run",
  // The `deploy-outcome` job carries the same conditions as `deploy`, so
  // whenever it runs, `deploy` should have run too. Reaching a no-op means the
  // two have drifted and every merge is silently deploying nothing (#763, and
  // ADR-21's frozen staging hosts), so it is ESCALATED to a failure rather than
  // annotated: an annotation on a `workflow_run` run page is as invisible as
  // the gap this closes.
  noOpIsUnexpected: true,
  noOpNote:
    "The `deploy` job did not run, so nothing was migrated, deployed, verified or uploaded. **A " +
    "green run of this shape is not evidence that deploys work** (#763). This is not expected for " +
    "this workflow: `deploy-outcome` carries the same trigger conditions as `deploy`, so reaching " +
    "this state means the two have drifted apart.",
  whyLines: [
    "`Deploy staging` is triggered by `workflow_run`, so its failures never appear as a PR check or",
    "a commit status, and nothing turns red anywhere a human normally looks. Before these alerts,",
    "that hid a 100% staging deploy failure rate for 71 days (#763), and ADR-21's Git unlink froze",
    "both staging frontends for days (#1674). This issue is the notification that was missing.",
  ],
};

/**
 * `.github/workflows/deploy-production.yml`, the only path to production
 * (#2805). Its `deploy` job is `_deploy.yml` called with `environment:
 * production`, so this reads the same one job staging's config does.
 *
 * Which runs reach this script is decided by the step's `if:` in that
 * workflow: a dry run never does (nothing was applied, and the dispatcher is
 * watching), a cancelled run never does, and a green `migrations-only` run
 * never does, because the code didn't ship and so it can't close the alert.
 * The one case decided here is a deploy job that never ran a step: a declined
 * or expired approval, the environment's branch rule, or a pending run
 * replaced in the queue. Its result is `failure` or `cancelled` like a real
 * one, and production is unchanged, so `deployNeverStarted` reads this
 * attempt's jobs and the script files nothing. Every other run that arrives
 * either raises (the deploy job failed) or closes (a real `full` release
 * succeeded).
 *
 * `gateJob` is null and `validate` is not a deploy job: a mistyped
 * confirmation or a red-CI SHA fails before anyone approves and costs nothing,
 * so it must never open an incident. The workflow skips `deploy` then, and the
 * outcome job with it. The tag (`release`) is not watched either: its failure
 * after a live ship reds the run's summary, and `production-release-pin.yml`
 * raises its own P1 when the hosts are left untagged.
 *
 * P1, like every production alert in ALERT_ROUTING.md.
 */
export const DEPLOY_PRODUCTION_CONFIG = {
  name: "deploy-production",
  workflowLabel: "Deploy production",
  workflowFile: ".github/workflows/deploy-production.yml",
  gateJob: null,
  deployJobs: ["deploy"],
  gateOutputRows: [],
  planOutput: null,
  closesOn: "a later real `full` Deploy production run ships successfully",
  alertTitle: "Deploy production failed — production may be partly deployed",
  alertLabels: [ALERT_ISSUE_LOOKUP_LABEL, "area:ci", "P1"],
  retiredAlertTitles: [],
  // A deploy job that never ran a step changed nothing, so it isn't an
  // outage. Its display name as the jobs API lists it: the caller job's
  // `name:`, then ` / deploy` once the call to `_deploy.yml` expands.
  quietWhenNeverStarted: "Migrate, then ship Render + Vercel",
  noOpReason: "the deploy job did not run",
  // Unreachable through the workflow (its outcome job skips a skipped
  // `deploy`), and loud if that ever drifts.
  noOpIsUnexpected: true,
  noOpNote:
    "The `deploy` job did not run, so nothing was migrated, deployed or verified. This is not " +
    "expected: `deploy-outcome` runs only when `deploy` was attempted, so reaching this state " +
    "means the workflow's conditions have drifted.",
  whyLines: [
    "`Deploy production` is dispatched by hand, and a failed dispatch reds one row in the Actions",
    "list and emails only the person who ran it. Nothing durable recorded that production was left",
    "half-shipped: a migrated database under the previous API, or a new API under the previous",
    "frontends. The run log names the step that failed, and what each step leaves behind is in",
    "`docs/internal/ops/ALERT_ROUTING.md`. Recovery: `docs/internal/ops/DB_ROLLBACK_PLAYBOOK.md`.",
  ],
};

export const ALERT_CONFIGS = {
  [DEPLOY_STAGING_CONFIG.name]: DEPLOY_STAGING_CONFIG,
  [DEPLOY_PRODUCTION_CONFIG.name]: DEPLOY_PRODUCTION_CONFIG,
};

/** When an alert closes, unless a config says otherwise (`closesOn`). */
const DEFAULT_CLOSES_ON = "a later run deploys successfully";

/**
 * The sentences every config's reports share. Kept together so the summary,
 * the annotation and the alert issue say the same thing about one run.
 */
export const OUTCOME_COPY = {
  // "Not confirmed", not "nothing was deployed": a deploy can go live and a
  // later check in the same job fail (staging's served-commit check), and
  // the run log says which step it was.
  failedTail: "Nothing is confirmed deployed by this run; its log says which step failed.",
  noOpLead: "deployed NOTHING",
  noOpTail: "This run is green because it declined to deploy, not because a deploy succeeded.",
  badges: {
    failed: "❌ **FAILED — not confirmed deployed**",
    deployed: "✅ **DEPLOYED**",
    "no-op": "⏭️ **NO-OP — nothing deployed**",
    superseded: "⏭️ **SUPERSEDED — a newer run decides**",
    "not-started":
      "⏭️ **NOT STARTED — the deploy job never ran a step (a declined or expired approval, the " +
      "environment's branch rule, or a pending run replaced in the queue); production is unchanged**",
  },
  brokenLines: (label, closesOn = DEFAULT_CLOSES_ON) => [
    `deploy path is broken: the most recent \`${label}\` run that actually tried to deploy did`,
    `not succeed. It closes itself as soon as ${closesOn}.`,
  ],
  closesWhen: (closesOn = DEFAULT_CLOSES_ON) => `This issue closes itself when ${closesOn}.`,
};

// The default for the pure functions below, so a test or a caller reasoning
// about the original watchdog need not thread a config through every call. It
// is deliberately NOT a fallback for the CLI — see `resolveAlertConfig`.
export const DEFAULT_ALERT_CONFIG = DEPLOY_STAGING_CONFIG;

/**
 * Throws on a missing OR unknown name. A mis-wired workflow must be loud.
 *
 * An ABSENT name throws for the same reason an unknown one does, and this is
 * the more likely mistake: another deploy workflow copying a `deploy-outcome`
 * block and dropping the `ALERT_CONFIG:` line would otherwise silently resolve
 * to the staging config, read its own `deploy` job as staging's, and reopen
 * and comment on the live P1 staging alert from an unrelated failure. Every
 * call site names itself; there is no default.
 *
 * `Object.hasOwn` rather than a truthiness check on the lookup: a bare object
 * literal inherits `constructor`, `toString` and friends, so `ALERT_CONFIG:
 * toString` would otherwise pass the guard and die later inside
 * `alertJobNames` without ever printing the known-configurations list.
 */
export function resolveAlertConfig(name) {
  if (!name || !Object.hasOwn(ALERT_CONFIGS, name)) {
    throw new Error(
      `Unknown or missing ALERT_CONFIG ${JSON.stringify(name ?? null)}. ` +
        `Known configurations: ${Object.keys(ALERT_CONFIGS).join(", ")}.`,
    );
  }
  return ALERT_CONFIGS[name];
}

/**
 * The jobs this config reads, in the order they are reported. The gate comes
 * first when there is one; a config with `gateJob: null` reports only its
 * deploy jobs.
 */
export function alertJobNames(config = DEFAULT_ALERT_CONFIG) {
  return config.gateJob ? [config.gateJob, ...config.deployJobs] : [...config.deployJobs];
}

// Results that mean the job did not do its work. `cancelled` and `timed_out`
// are included deliberately: a cancelled deploy is not a deploy, and treating it
// as benign is precisely the "green history" failure this script exists to end.
export const FAILED_RESULTS = new Set(["failure", "cancelled", "timed_out"]);

/**
 * Pure classifier over the `needs` context's job results.
 * Returns { outcome, failed, deployed } where outcome is one of:
 *   "failed"   — at least one gate/migrate/deploy job did not succeed
 *   "deployed" — nothing failed and at least one migrate/deploy job succeeded
 *   "no-op"    — nothing failed and nothing ran (the green-because-empty case)
 */
export function classifyDeployOutcome({ jobResults, config = DEFAULT_ALERT_CONFIG }) {
  const failed = [];
  const deployed = [];

  for (const name of alertJobNames(config)) {
    const result = jobResults[name];
    if (FAILED_RESULTS.has(result)) {
      failed.push(name);
    } else if (result === "success" && name !== config.gateJob) {
      // The gate succeeding is not a deploy — only the real deploy jobs count.
      // With `gateJob: null` this comparison is always true, which is correct:
      // such a config has no gate to exclude.
      deployed.push(name);
    }
  }

  if (failed.length > 0) return { outcome: "failed", failed, deployed };
  if (deployed.length > 0) return { outcome: "deployed", failed, deployed };

  // A no-op is benign for a config with a path gate — declining to deploy is
  // what the gate is FOR. For a config without one it is a defect: nothing ran
  // that could have, on a run that was eligible to deploy. Escalating it to
  // `failed` is what makes it visible, because the alternative (an annotation)
  // lands on a `workflow_run` run page — no commit, no PR — which is the exact
  // invisibility this script exists to end. It self-closes on the next
  // successful deploy like any other alert.
  //
  // `escalated` is reported so the summary can EXPLAIN itself. Without it the
  // reader gets a "FAILED — not confirmed deployed" badge above a job table reading
  // `deploy | skipped`, which is a contradiction they cannot resolve. It is
  // spread in only when true, so the returned shape for a gated config stays
  // exactly what it was — the same trick `lib/alert-issue.mjs` uses for
  // `bodyRefreshFailed`.
  if (config.noOpIsUnexpected) {
    return { outcome: "failed", failed: [...config.deployJobs], deployed, escalated: true };
  }

  return { outcome: "no-op", failed, deployed };
}

/**
 * Flattens `toJSON(needs)` into { jobName: result }. A job absent from the
 * context (renamed or removed) reads as "skipped" rather than throwing, so a
 * future edit to a watched workflow degrades to a reported no-op (escalated
 * for a gateless config) instead of a crash.
 */
export function readJobResults(needs, config = DEFAULT_ALERT_CONFIG) {
  const results = {};
  for (const name of alertJobNames(config)) {
    results[name] = needs?.[name]?.result ?? "skipped";
  }
  return results;
}

/**
 * The plan a config's `planOutput` job published, or null (no `planOutput`,
 * or nothing published). See DEPLOY_STAGING_CONFIG.
 */
export function readPlan(needs, config = DEFAULT_ALERT_CONFIG) {
  if (!config.planOutput) return null;
  const { job, output } = config.planOutput;
  const value = needs?.[job]?.outputs?.[output];
  return typeof value === "string" && value ? value : null;
}

/**
 * Whether this run must neither raise nor close the alert: its plan is
 * `stale`, or a `forward` deploy of a non-tip commit succeeded (a failure of
 * one still raises). Always false for a config without `planOutput`.
 */
export function isSuperseded(needs, config = DEFAULT_ALERT_CONFIG) {
  if (!config.planOutput) return false;
  if (needs?.[config.planOutput.job]?.result !== "success") return false;
  const plan = readPlan(needs, config);
  return plan === "stale" || plan === "forward";
}

/** Human-readable one-liner used in the annotation and the issue body. */
export function buildHeadline({
  outcome,
  failed,
  deployed,
  headBranch,
  escalated = false,
  plan = null,
  supersededReason = "",
  config = DEFAULT_ALERT_CONFIG,
}) {
  const ref = headBranch ? `\`${headBranch}\`` : "this ref";
  const label = config.workflowLabel;
  if (outcome === "superseded") {
    return `${label} on ${ref} is superseded: ${supersededReason}. It neither raises nor closes the alert; the run for the newest commit decides.`;
  }
  if (outcome === "not-started") {
    return `${label} on ${ref} never started its deploy job, so nothing ran and production is unchanged. It neither raises nor closes the alert.`;
  }
  if (outcome === "failed") {
    // An escalated no-op needs its own sentence. Saying "did not succeed" of a
    // job whose result is `skipped` reads as a lie next to the job table, and
    // sends the reader looking for a failed build that does not exist.
    if (escalated) {
      return `${label} deployed NOTHING on ${ref} — ${failed.join(", ")} did not run at all, on a run that was eligible to deploy. This is a configuration defect, not a skip.`;
    }
    return `${label} FAILED on ${ref} — ${failed.join(", ")} did not succeed. ${OUTCOME_COPY.failedTail}`;
  }
  if (outcome === "deployed") {
    if (plan === "current") {
      return `${label} succeeded on ${ref} — ${deployed.join(", ")} completed. The API needed no deploy; staging was verified serving it and ready.`;
    }
    return `${label} succeeded on ${ref} — ${deployed.join(", ")} completed.`;
  }
  return `${label} ${OUTCOME_COPY.noOpLead} on ${ref} — ${config.noOpReason}. ${OUTCOME_COPY.noOpTail}`;
}

/**
 * The step summary. This is the answer to "is it possible to tell at a glance
 * whether a green run deployed anything" — before this, you had to open four
 * skipped jobs and infer it.
 */
export function buildRunSummary({
  outcome,
  failed,
  deployed,
  jobResults,
  headBranch,
  headSha,
  runUrl,
  // Keyed by the gate job's raw output name, e.g. { "api-changed": true }.
  // Empty for a config with no gate job, which then renders no changed rows.
  gateOutputs = {},
  gateSucceeded,
  escalated = false,
  // The `planOutput` job's plan, or null. `superseded` is this script's own
  // outcome for a `stale` run or a successful `forward` one (see runDeployAlert).
  plan = null,
  supersededReason = "",
  config = DEFAULT_ALERT_CONFIG,
}) {
  const badge = escalated
    ? "❌ **NOTHING RAN — nothing deployed**"
    : outcome === "deployed" && plan === "current"
      ? "✅ **API UP TO DATE — no API deploy needed; staging verified**"
      : OUTCOME_COPY.badges[outcome];

  // When the gate job itself did not succeed, its outputs are empty — which is
  // NOT the same as "no paths changed". Reporting the absent output as "no"
  // would state an unmeasured value as fact.
  const changed = (value) => (gateSucceeded ? (value ? "yes" : "no") : "unknown");

  const lines = [
    `## ${config.workflowLabel} outcome`,
    "",
    badge,
    "",
    buildHeadline({ outcome, failed, deployed, headBranch, escalated, plan, supersededReason, config }),
    "",
    "| | |",
    "| --- | --- |",
    `| Ref | \`${headBranch ?? "unknown"}\` |`,
    `| Commit | \`${headSha ?? "unknown"}\` |`,
    // A config with no gate contributes no rows here, rather than printing
    // "unknown" for a question its workflow never asks.
    ...config.gateOutputRows.map(
      ({ label, output }) => `| ${label} | ${changed(gateOutputs[output])} |`,
    ),
    ...(config.planOutput ? [`| Deploy plan | ${plan ? `\`${plan}\`` : "none published"} |`] : []),
    "",
    "### Job results",
    "",
    "| Job | Result |",
    "| --- | --- |",
    ...alertJobNames(config).map((name) => `| \`${name}\` | ${jobResults[name]} |`),
  ];

  // The note is what explains a job table reading `skipped` under a red badge,
  // so it is required on the escalated path, not only on the benign one.
  if (outcome === "no-op" || escalated) {
    lines.push("", config.noOpNote);
  }

  if (runUrl) lines.push("", `- Run: ${runUrl}`);
  return lines.join("\n");
}

/** Body for the alert issue when it is first created. */
export function buildAlertIssueBody({
  headline,
  failed,
  headBranch,
  headSha,
  runUrl,
  escalated = false,
  config = DEFAULT_ALERT_CONFIG,
}) {
  return [
    `## ${config.workflowLabel} is failing`,
    "",
    headline,
    "",
    "This issue is **opened and closed automatically** by the `deploy-outcome` job in",
    `\`${config.workflowFile}\` (\`scripts/ci/deploy-alert.mjs\`). While it is open, the`,
    // The ordinary sentence asserts a run TRIED to deploy. For an escalated
    // no-op that is exactly false — no run tried, and that is the defect being
    // reported — so saying it would send the reader looking for a failed build
    // that does not exist.
    ...(escalated
      ? [
          `deploy path is broken: the most recent \`${config.workflowLabel}\` run did not even attempt a`,
          `deploy. It closes itself as soon as ${config.closesOn ?? DEFAULT_CLOSES_ON}.`,
        ]
      : OUTCOME_COPY.brokenLines(config.workflowLabel, config.closesOn)),
    "",
    `Do not claim this issue as backlog work — it carries \`${ALERT_ISSUE_LOOKUP_LABEL}\` and tracks live state,`,
    "not a unit of work. Fix the underlying failure and it resolves on its own.",
    "",
    "### Latest failure",
    "",
    `- ${escalated ? "Jobs that did not run" : "Failed jobs"}: ${failed.map((name) => `\`${name}\``).join(", ")}`,
    `- Ref: \`${headBranch ?? "unknown"}\``,
    `- Commit: \`${headSha ?? "unknown"}\``,
    runUrl ? `- Run: ${runUrl}` : "",
    "",
    "### Why this issue exists",
    "",
    // The DIAGNOSIS belongs here, not only on the run page. This issue is the
    // durable artifact — linked from ALERT_ROUTING.md, and it outlives log
    // retention — so a responder who never opens the run still needs the
    // sentence naming what actually drifted.
    ...(escalated ? [config.noOpNote, ""] : []),
    ...config.whyLines,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/** Body for the comment appended to an already-open (or reopened) alert. */
export function buildAlertCommentBody({
  headline,
  failed,
  headBranch,
  headSha,
  runUrl,
  reopened,
  escalated = false,
  config = DEFAULT_ALERT_CONFIG,
}) {
  const lines = [
    reopened
      ? `**${config.workflowLabel} is failing again** — reopening.`
      : `**${config.workflowLabel} failed again.**`,
    "",
    headline,
    "",
    `- ${escalated ? "Jobs that did not run" : "Failed jobs"}: ${failed.map((name) => `\`${name}\``).join(", ")}`,
    `- Ref: \`${headBranch ?? "unknown"}\``,
    `- Commit: \`${headSha ?? "unknown"}\``,
  ];
  if (runUrl) lines.push(`- Run: ${runUrl}`);
  lines.push(
    "",
    `_Posted automatically by \`scripts/ci/deploy-alert.mjs\`. ${OUTCOME_COPY.closesWhen(config.closesOn)}_`,
  );
  return lines.join("\n");
}

/** Body for the comment posted when a deploy succeeds and the alert resolves. */
export function buildRecoveryCommentBody({
  deployed,
  headBranch,
  headSha,
  runUrl,
  config = DEFAULT_ALERT_CONFIG,
  // Set when closing an issue under one of `retiredAlertTitles`: the workflow
  // it watched is gone, and this config's workflow replaced it.
  retiredTitle = null,
}) {
  const lines = [
    retiredTitle
      ? `**Replaced by ${config.workflowLabel}, which succeeded.** Closing. The workflow this alert watched no longer exists; \`${config.workflowFile}\` does its work, and its own alert is *${config.alertTitle}*.`
      : `**${config.workflowLabel} recovered.** Closing.`,
    "",
    `\`${deployed.join("`, `")}\` succeeded on \`${headBranch ?? "unknown"}\`.`,
    "",
    `- Commit: \`${headSha ?? "unknown"}\``,
  ];
  if (runUrl) lines.push(`- Run: ${runUrl}`);
  lines.push(
    "",
    "_Closed automatically by `scripts/ci/deploy-alert.mjs` after a successful deploy._",
  );
  return lines.join("\n");
}

// ── Issue lookup / mutation ─────────────────────────────────────────────────

/**
 * Every issue (open or closed) that is this alert. Matched on exact title within
 * the lookup label, so a human renaming the issue detaches it rather
 * than causing surprise writes. Returns [] when the lookup fails — a failed
 * lookup then falls through to "create", because a duplicate alert is a better
 * failure mode than silence, and the resolve path closes every match.
 */
export async function findAlertIssues({
  token,
  repo,
  fetchImpl,
  config = DEFAULT_ALERT_CONFIG,
}) {
  return findAlertIssuesByTitle({
    token,
    repo,
    fetchImpl,
    title: config.alertTitle,
    lookupLabel: ALERT_ISSUE_LOOKUP_LABEL,
  });
}

/**
 * Create / reopen / comment, whichever the current state calls for.
 * Returns { action, issueNumber } where action is "created" | "commented" |
 * "reopened" | "failed".
 */
export async function raiseAlert({
  token,
  repo,
  fetchImpl,
  headline,
  failed,
  headBranch,
  headSha,
  runUrl,
  escalated = false,
  config = DEFAULT_ALERT_CONFIG,
}) {
  return raiseAlertIssue({
    token,
    repo,
    fetchImpl,
    title: config.alertTitle,
    labels: config.alertLabels,
    lookupLabel: ALERT_ISSUE_LOOKUP_LABEL,
    buildIssueBody: () =>
      buildAlertIssueBody({ headline, failed, headBranch, headSha, runUrl, escalated, config }),
    buildCommentBody: ({ reopened }) =>
      buildAlertCommentBody({
        headline,
        failed,
        headBranch,
        headSha,
        runUrl,
        reopened,
        escalated,
        config,
      }),
  });
}

/**
 * Closes every open alert issue after a successful deploy. Closing them all
 * (not just the first) is what makes a duplicate created during an API blip
 * self-heal. Issues still open under one of the config's `retiredAlertTitles`
 * close too, so a workflow that replaced another does not orphan its alert.
 *
 * Returns lib/alert-issue.mjs's `resolveAlert` shape, "closed" | "none" |
 * "failed" | "unread" with the issue numbers closed, merged across titles:
 * the worst action wins, because a title whose lookup or close failed is an
 * alert that may still be open.
 */
export async function resolveAlert({
  token,
  repo,
  fetchImpl,
  deployed,
  headBranch,
  headSha,
  runUrl,
  config = DEFAULT_ALERT_CONFIG,
}) {
  const results = [];
  for (const title of [config.alertTitle, ...(config.retiredAlertTitles ?? [])]) {
    results.push(
      await resolveAlertIssue({
        token,
        repo,
        fetchImpl,
        title,
        lookupLabel: ALERT_ISSUE_LOOKUP_LABEL,
        buildRecoveryBody: () =>
          buildRecoveryCommentBody({
            deployed,
            headBranch,
            headSha,
            runUrl,
            config,
            retiredTitle: title === config.alertTitle ? null : title,
          }),
      }),
    );
  }
  const closed = results.flatMap((result) => result.closed);
  const worst = ["failed", "unread", "closed", "none"].find((action) =>
    results.some((result) => result.action === action),
  );
  return { action: worst, closed };
}

// ── Orchestration ───────────────────────────────────────────────────────────

function defaultWriteSummary(summary) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (path) appendFileSync(path, `${summary}\n`);
}

/**
 * Whether this attempt's deploy job never ran a step (#2805): true, false, or
 * null when that can't be read.
 *
 * A declined or expired approval, the environment's branch rule and a pending
 * run replaced in the queue all end the job before any step, with a result a
 * real failure also has. The jobs API tells them apart: a job that never got
 * a runner lists no steps. It is read for THIS attempt
 * (`/actions/runs/{id}/attempts/{n}/jobs`, `actions: read`), because a re-run
 * keeps the run id and an earlier attempt's never-started job must not quiet a
 * later attempt's real failure. An output the called job's first step writes
 * would say the same, but a reusable workflow's outputs may not reach the
 * caller when its job fails, and a lost output would drop a real alert.
 * Unreadable, or no job by that name, reads as started: the alert is raised.
 */
export async function deployNeverStarted({ token, repo, runId, runAttempt, jobName, fetchImpl = fetch }) {
  if (!runId || !runAttempt || !jobName) return null;
  const res = await ghRequest({
    token,
    fetchImpl,
    path: `/repos/${repo}/actions/runs/${runId}/attempts/${runAttempt}/jobs?per_page=100`,
  });
  if (!res.ok || !Array.isArray(res.data?.jobs)) return null;
  const jobs = res.data.jobs.filter((job) => job?.name === jobName || String(job?.name ?? "").startsWith(`${jobName} / `));
  if (jobs.length === 0) return null;
  return jobs.every((job) => !Array.isArray(job.steps) || job.steps.length === 0);
}

/**
 * Full flow for one completed run of the watched workflow. Everything network-bound goes
 * through fetchImpl, and the summary write through writeSummary, so tests run
 * offline with no filesystem side effects.
 */
export async function runDeployAlert({
  token,
  repo,
  needs,
  runUrl,
  runId = "",
  runAttempt = "",
  headBranch,
  headSha,
  fetchImpl = fetch,
  writeSummary = defaultWriteSummary,
  logger = console,
  config = DEFAULT_ALERT_CONFIG,
}) {
  const jobResults = readJobResults(needs, config);
  const plan = readPlan(needs, config);

  // A `stale` run, or a successful `forward` one, is not for main's tip.
  // Classifying it would close the alert on a run that verified an old or
  // non-tip commit (or on its migrations' success alone), while the tip's
  // own run may be failing. The tip's run decides; this one only reports. A
  // failed `forward` deploy is not superseded: it raises like any failure.
  if (isSuperseded(needs, config)) {
    const reason =
      plan === "forward"
        ? "it deployed this commit forward, but it is not main's tip, so the tip's run decides the alert"
        : "its deploy plan is `stale`: this run is not for main's tip and deployed no API";
    const headline = buildHeadline({
      outcome: "superseded",
      failed: [],
      deployed: [],
      headBranch,
      supersededReason: reason,
      config,
    });
    writeSummary(
      buildRunSummary({
        outcome: "superseded",
        failed: [],
        deployed: [],
        jobResults,
        headBranch,
        headSha,
        runUrl,
        gateOutputs: {},
        gateSucceeded: false,
        plan,
        supersededReason: reason,
        config,
      }),
    );
    logger.log?.(`::notice::${headline}`);
    return { outcome: "superseded", failed: [], deployed: [], alert: { action: "none" } };
  }

  const {
    outcome,
    failed,
    deployed,
    escalated = false,
  } = classifyDeployOutcome({ jobResults, config });
  const gateOutputs = Object.fromEntries(
    config.gateOutputRows.map(({ output }) => [
      output,
      needs?.[config.gateJob]?.outputs?.[output] === "true",
    ]),
  );
  if (outcome === "failed" && config.quietWhenNeverStarted && !escalated) {
    const neverStarted = await deployNeverStarted({
      token,
      repo,
      runId,
      runAttempt,
      jobName: config.quietWhenNeverStarted,
      fetchImpl,
    });
    if (neverStarted === true) {
      writeSummary(
        buildRunSummary({
          outcome: "not-started",
          failed,
          deployed,
          jobResults,
          headBranch,
          headSha,
          runUrl,
          gateOutputs,
          gateSucceeded: false,
          plan,
          config,
        }),
      );
      logger.log?.(`::notice::${buildHeadline({ outcome: "not-started", failed, deployed, headBranch, config })}`);
      return { outcome: "not-started", failed, deployed, alert: { action: "none" } };
    }
    if (neverStarted === null) {
      logger.log?.("::warning::[deploy-alert] could not read whether this attempt's deploy job started; treating the failure as a failed deploy");
    }
  }

  // `escalated` matters here, not only in the summary: this headline is what
  // the annotation and the ALERT ISSUE carry. Omitting it put the escalated
  // sentence on the step summary alone — the one surface this script's own
  // header calls invisible — and left the run page contradicting itself, with
  // the annotation saying "did not succeed" above a summary saying "did not
  // run at all".
  const headline = buildHeadline({
    outcome,
    failed,
    deployed,
    headBranch,
    escalated,
    plan,
    config,
  });

  writeSummary(
    buildRunSummary({
      outcome,
      failed,
      deployed,
      jobResults,
      headBranch,
      headSha,
      runUrl,
      gateOutputs,
      // A config with no gate job has no gate to succeed. `false` is the safe
      // reading — but it is also unobservable, because such a config declares
      // no gateOutputRows, so `changed()` is never called.
      gateSucceeded: config.gateJob ? jobResults[config.gateJob] === "success" : false,
      escalated,
      plan,
      config,
    }),
  );

  // Annotations surface at the top of the run page, above the job list.
  // `::error::` here does NOT fail the job — it only annotates.
  logger.log?.(`${outcome === "failed" ? "::error::" : "::notice::"}${headline}`);

  if (outcome === "failed") {
    const alert = await raiseAlert({
      token,
      repo,
      fetchImpl,
      headline,
      failed,
      headBranch,
      headSha,
      runUrl,
      escalated,
      config,
    });
    logger.log?.(
      alert.action === "failed"
        ? // Annotated, not a plain log line. This is the WORSE of the two
          // write failures — a deploy is genuinely broken and the notification
          // for it did not get written, so the run exits 0 with the failure
          // invisible again, which is the whole condition this script exists
          // to end. A bare log line buried in step output is not a signal.
          "::error::[deploy-alert] the deploy FAILED and the alert issue could not be written — this failure is currently unnotified"
        : `[deploy-alert] alert issue #${alert.issueNumber} ${alert.action}`,
    );
    return { outcome, failed, deployed, alert };
  }

  if (outcome === "deployed") {
    const alert = await resolveAlert({
      token,
      repo,
      fetchImpl,
      deployed,
      headBranch,
      headSha,
      runUrl,
      config,
    });
    if (alert.action === "closed") {
      logger.log?.(`[deploy-alert] closed alert issue(s): ${alert.closed.join(", ")}`);
    } else if (alert.action === "failed") {
      if (alert.closed?.length) {
        logger.log?.(`[deploy-alert] closed alert issue(s): ${alert.closed.join(", ")}`);
      }
      // `lib/alert-issue.mjs` added this action precisely so a failed close
      // could not be mistaken for a successful one, and dropping it here put
      // the mistake back: the alert stays open claiming the deploy path is
      // broken while it is healthy, and every later successful run posts
      // another "recovered — Closing" comment on it. That is unbounded for a
      // config with no path gate, where every merge reaches this branch.
      logger.log?.(
        "::warning::[deploy-alert] the deploy recovered but the alert issue could not be closed — it is still open and will re-post on the next run",
      );
    } else if (alert.action === "unread") {
      // Not "still open": a lookup failed, so this run does not know whether
      // an alert is open under that title. The next successful deploy looks
      // again. With retired titles, another title's issue may still have
      // closed in the same run, and the log says which (#2803).
      logger.log?.(
        alert.closed?.length
          ? `::warning::[deploy-alert] the deploy succeeded and closed alert issue(s) ${alert.closed.join(", ")}, but another alert title could not be read, so an issue under it may still be open`
          : "::warning::[deploy-alert] the deploy succeeded but the alert issues could not be read, so none was closed",
      );
    }
    return { outcome, failed, deployed, alert };
  }

  // no-op: the summary and annotation above are the entire point. Deliberately
  // does NOT close an open alert — skipping every job proves nothing about
  // whether deploys work, and closing on a no-op would silence a live outage.
  logger.log?.("[deploy-alert] nothing deployed; alert issue left as-is");
  return { outcome, failed, deployed, alert: { action: "none" } };
}

// ── CLI entry ───────────────────────────────────────────────────────────────

async function main() {
  const token = requireEnv("GITHUB_TOKEN");
  const repo = requireEnv("GITHUB_REPOSITORY");
  const needs = JSON.parse(requireEnv("DEPLOY_NEEDS"));
  // Required, not optional. This is the one place a mis-wired workflow can be
  // caught, so it is deliberately strict in both directions: a typo'd OR an
  // absent ALERT_CONFIG would otherwise write the staging alert's issue from
  // the wrong workflow's job results.
  const config = resolveAlertConfig(requireEnv("ALERT_CONFIG"));
  const { outcome } = await runDeployAlert({
    token,
    repo,
    needs,
    runUrl: process.env.RUN_URL ?? "",
    runId: process.env.RUN_ID ?? "",
    runAttempt: process.env.RUN_ATTEMPT ?? "",
    headBranch: process.env.HEAD_BRANCH ?? "",
    headSha: process.env.HEAD_SHA ?? "",
    config,
  });
  // For a later step: production's summary reads it to tell a deploy that
  // never started from one that failed.
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `outcome=${outcome}\n`);
}

if (isInvokedDirectly(import.meta.url)) {
  main().catch((error) => {
    console.error(`Unhandled error: ${error.stack ?? error.message}`);
    process.exit(1);
  });
}
