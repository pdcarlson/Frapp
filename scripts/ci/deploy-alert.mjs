#!/usr/bin/env node
// Terminal reporting job for the `deploy-outcome` job of a deploy workflow.
// WHICH workflow it reports on is chosen by the `ALERT_CONFIG` env var; the
// configurations live in `ALERT_CONFIGS` below and an unknown name is a hard
// error, never a silent fallback.
//
// Written for .github/workflows/deploy-api.yml, and generalised in #1674 to
// also watch .github/workflows/deploy-vercel-staging.yml, which shipped in
// #1578 with no alerting of any kind. Parameterised rather than copied: a
// second copy of an upsert-one-tracking-issue script is two places for the
// "an open alert means it is broken right now" contract to drift.
//
// Closes the visibility gap recorded in issue #763:
// `Deploy API` failed 44 of 44 executing runs for 71 days and nobody noticed,
// because three things compounded —
//
//   1. A skipped run is a GREEN run. The `check-changes` path gate skips the
//      deploy/migrate jobs when a push touches neither `apps/api/` nor
//      `supabase/migrations/`; 46 of the last 90 runs were green-because-empty,
//      so the Actions list read "healthy" while the deploy path was 100% dead.
//   2. `workflow_run` failures never land on a commit or a PR the way `CI`
//      does, so nothing turned red anywhere a human normally looks.
//   3. There was no notification of any kind.
//
// Only (1) is specific to a workflow that HAS a path gate. (2) and (3) are
// properties of every `workflow_run`-triggered deploy in this repo, which is
// exactly why `deploy-vercel-staging.yml` needed this too: it has no skip path,
// so a failure does go red in the Actions list, but there is still no commit
// status, no PR check and no notification. ADR-21's Git unlink froze both
// staging hosts and went undetected for days on precisely that gap.
//
// This script answers (1) and (3). It runs after every deploy/migrate job in
// the run and:
//
//   * writes a step summary + annotation that states plainly whether the run
//     DEPLOYED something or DECLINED to deploy, so green stops being ambiguous;
//   * on failure, upserts ONE tracking issue (create / reopen / comment) rather
//     than filing a fresh issue per failure — alert spam is how alerting gets
//     muted;
//   * on a later successful deploy, closes that issue, so "alert issue open"
//     reliably means "the deploy path is broken right now".
//
// Channel choice: GitHub Issues, matching `ci-wake.mjs` / `pr-base-sync.mjs`
// (which post to PRs) and the tracker itself (#680 retired Linear). `Deploy API`
// is push-driven with no PR to comment on, so an issue is the equivalent target.
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
  findAlertIssues as findAlertIssuesByTitle,
  raiseAlert as raiseAlertIssue,
  resolveAlert as resolveAlertIssue,
} from "./lib/alert-issue.mjs";
import { requireEnv } from "./lib/env.mjs";

// ── Alert issue identity ────────────────────────────────────────────────────
// Title is the primary key: it is looked up by exact match, so it must stay
// stable across releases. `routine-state` marks it as routine infrastructure —
// `/next` §0.2 treats that label as never-claimable, which is what keeps agent
// sessions from picking the alert up as if it were backlog work.
export const ALERT_ISSUE_LOOKUP_LABEL = "routine-state";

// ── Alert configurations ────────────────────────────────────────────────────
// One entry per watched deploy workflow. A config is the complete answer to
// "which jobs am I reading, and which alert issue am I upserting" — everything
// workflow-specific in this file reads from here, and nothing else does.
//
// ⚠️ `alertTitle` is the issue LOOKUP KEY, matched by exact string. Renaming
// one orphans whatever alert issue is currently open under the old title: it
// could never be found again, and so would never self-close. Titles are
// append-only in practice. That is also why the Deploy API title is NOT
// rescoped to "staging" even though it now only watches staging.

/**
 * `.github/workflows/deploy-api.yml` — the original, and the default.
 *
 * `migrate-production` and `deploy-production` used to be in `deployJobs`.
 * They were deleted from deploy-api.yml with the `production` branch (#1340) —
 * production now deploys through `deploy-production.yml`, a manual dispatch
 * that does its own terminal reporting in its `report` job. A name left here
 * that no workflow emits would report as a permanently missing job.
 */
export const DEPLOY_API_CONFIG = {
  name: "deploy-api",
  workflowLabel: "Deploy API",
  workflowFile: ".github/workflows/deploy-api.yml",
  gateJob: "check-changes",
  deployJobs: ["migrate-staging", "deploy-staging"],
  gateOutputRows: [
    { label: "API paths changed", output: "api-changed" },
    { label: "Migration paths changed", output: "migrations-changed" },
  ],
  alertTitle: "Deploy API is failing — pushes are not reaching the environment",
  alertLabels: [ALERT_ISSUE_LOOKUP_LABEL, "area:ci", "P1"],
  noOpReason: "the changed-path gate skipped every migrate and deploy job",
  // Explicit: a no-op IS a legitimate outcome here. `check-changes` skipping
  // the deploy jobs on a docs-only push is the gate doing its job, and 46 of
  // the 90 runs in #763 were exactly that. It must stay reported-but-benign,
  // and in particular must never close an open alert — skipping every job
  // proves nothing about whether deploys work.
  noOpIsUnexpected: false,
  noOpNote:
    "The changed-path gate (`check-changes`) found no changes under `apps/api/`, " +
    "`packages/validation/`, `packages/typescript-config/`, or `supabase/migrations/`, " +
    "so every migrate and deploy job was skipped. **A green run of this shape is not " +
    "evidence that deploys work** — see issue #763.",
  whyLines: [
    "`Deploy API` is triggered by `workflow_run`, so its failures never appear as a PR check or a",
    "commit status, and runs that skip every job report green. That combination hid a 100% deploy",
    "failure rate for 71 days (#763). This issue is the notification that was missing.",
    "",
    "Background on the original outage: #696.",
  ],
};

/**
 * `.github/workflows/deploy-vercel-staging.yml` — added by #1674.
 *
 * `gateJob` is **null**, not a differently-named gate: this workflow has one
 * job and no changed-path filter at all. Every consumer below has to handle
 * that, which is why it is spelled as an explicit null rather than omitted.
 *
 * P2 rather than the Deploy API alert's P1, and the difference is deliberate.
 * This watches STAGING web + landing only; production frontend deploys are
 * `deploy-production.yml`'s, which reports through its own `report` job. A
 * frozen staging host blocks verification, it does not take a customer
 * surface down — the same "degraded rather than down" reasoning
 * `ALERT_ROUTING.md` already applies to the PR base-sync alert.
 */
export const DEPLOY_VERCEL_STAGING_CONFIG = {
  name: "deploy-vercel-staging",
  workflowLabel: "Deploy Vercel staging",
  workflowFile: ".github/workflows/deploy-vercel-staging.yml",
  gateJob: null,
  deployJobs: ["deploy"],
  gateOutputRows: [],
  alertTitle:
    "Deploy Vercel staging is failing — web and landing are not reaching staging",
  alertLabels: [ALERT_ISSUE_LOOKUP_LABEL, "area:ci", "P2"],
  noOpReason: "no deploy job ran",
  // This workflow has no path gate, so "nothing ran" is never a legitimate
  // outcome: `deploy-outcome` carries the same `if:` as `deploy`, so whenever
  // this job runs, `deploy` should have run too. Reaching a no-op means those
  // two have drifted apart and every merge is now silently deploying nothing —
  // the ADR-21 frozen-staging failure verbatim. So it is ESCALATED to a failure
  // rather than annotated (see classifyDeployOutcome): an annotation on a
  // `workflow_run` run page is exactly as invisible as the gap this closes.
  noOpIsUnexpected: true,
  noOpNote:
    "No deploy job ran, so nothing was uploaded to Vercel. **A green run of this shape is not " +
    "evidence that deploys work.** This is not expected for this workflow — its `deploy-outcome` " +
    "job carries the same trigger conditions as its `deploy` job, so reaching this state means " +
    "those two have drifted apart.",
  whyLines: [
    "`Deploy Vercel staging` is triggered by `workflow_run`, so its failures never appear as a PR",
    "check or a commit status — nothing turns red anywhere a human normally looks, and no",
    "notification is sent. Staging web and landing then quietly stay on the last commit that did",
    "deploy.",
    "",
    "That is not hypothetical: ADR-21 unlinked both Vercel projects from Git, which froze both",
    "staging hosts, and it went undetected for days. This workflow (#1578) is the replacement",
    "deploy; this issue (#1674) is the notification it shipped without.",
  ],
};

export const ALERT_CONFIGS = {
  [DEPLOY_API_CONFIG.name]: DEPLOY_API_CONFIG,
  [DEPLOY_VERCEL_STAGING_CONFIG.name]: DEPLOY_VERCEL_STAGING_CONFIG,
};

// The default for the pure functions below, so a test or a caller reasoning
// about the original watchdog need not thread a config through every call. It
// is deliberately NOT a fallback for the CLI — see `resolveAlertConfig`.
export const DEFAULT_ALERT_CONFIG = DEPLOY_API_CONFIG;

/**
 * Throws on a missing OR unknown name. A mis-wired workflow must be loud.
 *
 * An ABSENT name throws for the same reason an unknown one does, and this is
 * the more likely mistake: a third deploy workflow copying a `deploy-outcome`
 * block and dropping the `ALERT_CONFIG:` line would otherwise silently resolve
 * to Deploy API, find none of its job names in `needs`, read them all as
 * "skipped", and report a permanent no-op while looking correctly wired. Worse,
 * a workflow that happens to own a job called `deploy-staging` would reopen and
 * comment on the live P1 Deploy API alert from an unrelated failure. Every
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

// The Deploy API alert's identity, re-exported under the names this module used
// before #1674 parameterised it. `deploy-alert.test.mjs` imports both to assert
// that the two watchdogs never share an alert title — a shared one would let a
// recovered Deploy API run close a live Vercel outage's alert.
//
// `GATE_JOB_NAME` and `DEPLOY_JOB_NAMES` were re-exported here too and are
// gone: nothing imported them, and a dead export that looks like an API is how
// a caller ends up reading the Deploy API's job names for a different workflow.
// Read `DEPLOY_API_CONFIG.gateJob` / `.deployJobs` instead.
export const ALERT_ISSUE_TITLE = DEPLOY_API_CONFIG.alertTitle;
export const ALERT_ISSUE_LABELS = DEPLOY_API_CONFIG.alertLabels;

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
  // reader gets a "FAILED — nothing deployed" badge above a job table reading
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
 * future edit to deploy-api.yml degrades to silence instead of a red run.
 */
export function readJobResults(needs, config = DEFAULT_ALERT_CONFIG) {
  const results = {};
  for (const name of alertJobNames(config)) {
    results[name] = needs?.[name]?.result ?? "skipped";
  }
  return results;
}

/** Human-readable one-liner used in the annotation and the issue body. */
export function buildHeadline({
  outcome,
  failed,
  deployed,
  headBranch,
  escalated = false,
  config = DEFAULT_ALERT_CONFIG,
}) {
  const ref = headBranch ? `\`${headBranch}\`` : "this ref";
  const label = config.workflowLabel;
  if (outcome === "failed") {
    // An escalated no-op needs its own sentence. Saying "did not succeed" of a
    // job whose result is `skipped` reads as a lie next to the job table, and
    // sends the reader looking for a failed build that does not exist.
    if (escalated) {
      return `${label} deployed NOTHING on ${ref} — ${failed.join(", ")} did not run at all, on a run that was eligible to deploy. This is a configuration defect, not a skip.`;
    }
    return `${label} FAILED on ${ref} — ${failed.join(", ")} did not succeed. Nothing was deployed by this run.`;
  }
  if (outcome === "deployed") {
    return `${label} succeeded on ${ref} — ${deployed.join(", ")} completed.`;
  }
  return `${label} deployed NOTHING on ${ref} — ${config.noOpReason}. This run is green because it declined to deploy, not because a deploy succeeded.`;
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
  config = DEFAULT_ALERT_CONFIG,
}) {
  const badge = escalated
    ? "❌ **NOTHING RAN — nothing deployed**"
    : {
        failed: "❌ **FAILED — nothing deployed**",
        deployed: "✅ **DEPLOYED**",
        "no-op": "⏭️ **NO-OP — nothing deployed**",
      }[outcome];

  // When the gate job itself did not succeed, its outputs are empty — which is
  // NOT the same as "no paths changed". Reporting the absent output as "no"
  // would state an unmeasured value as fact.
  const changed = (value) => (gateSucceeded ? (value ? "yes" : "no") : "unknown");

  const lines = [
    `## ${config.workflowLabel} outcome`,
    "",
    badge,
    "",
    buildHeadline({ outcome, failed, deployed, headBranch, escalated, config }),
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
          "deploy. It closes itself as soon as a later run deploys successfully.",
        ]
      : [
          `deploy path is broken: the most recent \`${config.workflowLabel}\` run that actually tried to deploy did`,
          "not succeed. It closes itself as soon as a later run deploys successfully.",
        ]),
    "",
    "Do not claim this issue as backlog work — it carries `routine-state` and tracks live state,",
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
    "_Posted automatically by `scripts/ci/deploy-alert.mjs`. This issue closes itself when a later run deploys successfully._",
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
}) {
  const lines = [
    `**${config.workflowLabel} recovered.** Closing.`,
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
 * the `routine-state` label, so a human renaming the issue detaches it rather
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
 * self-heal.
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
  return resolveAlertIssue({
    token,
    repo,
    fetchImpl,
    title: config.alertTitle,
    lookupLabel: ALERT_ISSUE_LOOKUP_LABEL,
    buildRecoveryBody: () =>
      buildRecoveryCommentBody({ deployed, headBranch, headSha, runUrl, config }),
  });
}

// ── Orchestration ───────────────────────────────────────────────────────────

function defaultWriteSummary(summary) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (path) appendFileSync(path, `${summary}\n`);
}

/**
 * Full flow for one completed Deploy API run. Everything network-bound goes
 * through fetchImpl, and the summary write through writeSummary, so tests run
 * offline with no filesystem side effects.
 */
export async function runDeployAlert({
  token,
  repo,
  needs,
  runUrl,
  headBranch,
  headSha,
  fetchImpl = fetch,
  writeSummary = defaultWriteSummary,
  logger = console,
  config = DEFAULT_ALERT_CONFIG,
}) {
  const jobResults = readJobResults(needs, config);
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
      // `lib/alert-issue.mjs` added this action precisely so a failed close
      // could not be mistaken for a successful one, and dropping it here put
      // the mistake back: the alert stays open claiming the deploy path is
      // broken while it is healthy, and every later successful run posts
      // another "recovered — Closing" comment on it. That is unbounded for a
      // config with no path gate, where every merge reaches this branch.
      logger.log?.(
        "::warning::[deploy-alert] the deploy recovered but the alert issue could not be closed — it is still open and will re-post on the next run",
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
  // absent ALERT_CONFIG would otherwise write the Deploy API alert's issue from
  // the wrong workflow's job results.
  const config = resolveAlertConfig(requireEnv("ALERT_CONFIG"));
  await runDeployAlert({
    token,
    repo,
    needs,
    runUrl: process.env.RUN_URL ?? "",
    headBranch: process.env.HEAD_BRANCH ?? "",
    headSha: process.env.HEAD_SHA ?? "",
    config,
  });
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`Unhandled error: ${error.stack ?? error.message}`);
    process.exit(1);
  });
}
