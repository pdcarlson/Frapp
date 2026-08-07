#!/usr/bin/env node
// Runs on `workflow_run: completed` for CI / Docs spec sync / Links (see
// .github/workflows/ci-wake.yml). Closes the wake gap in the PR-babysitting
// loop: the PR-activity webhook that wakes a watching agent session fires on
// CI *failure*, comments, and reviews — never on success, cancelled, or
// timed-out — so those outcomes previously left the PR silent forever (the
// 2026-08-06 Actions outage on PR #659 red-failed secret-scan before
// checkout, cancelled six sibling jobs, and nothing ever woke the watching
// session).
//
// Three responsibilities:
//   1. Classify the completed run: code failure vs GitHub-infra failure
//      (job died before its first repo step) vs superseded (a newer run for
//      the same workflow+branch exists, e.g. concurrency cancel-in-progress)
//      vs deliberate cancellation (a job had already started running).
//      Classification fails CLOSED: if the jobs or runs API errors, the run
//      is never called "infra" and never requeued — an API blip must not
//      relabel a real code failure as infrastructure.
//   2. Auto-requeue infra-shaped failures, capped at MAX_RUN_ATTEMPTS total
//      attempts — re-runs re-fire `workflow_run: completed`, so an uncapped
//      loop would retry until GitHub's 50-attempt ceiling.
//   3. Upsert this workflow's single wake comment on the PR. The marker is
//      per-workflow so a green Links wake can never erase a red CI wake.
//      Delete-then-create, never edit-in-place: comment edits deliver
//      webhook action=edited, which created-only listeners (the agent wake
//      path) never see.
//
// Env inputs:
//   GITHUB_TOKEN       — required (actions: write + pull-requests/issues: write)
//   GITHUB_REPOSITORY  — required, owner/repo
//   GITHUB_EVENT_PATH  — required, workflow_run event payload
//
// Exits 0 on every handled outcome (a watchdog that reds CI creates the noise
// it exists to remove); 1 only on unexpected errors.

import { readFileSync } from "node:fs";

// ── Classification semantics ────────────────────────────────────────────────
// Steps the Actions runner itself owns. A job whose only failed step is one of
// these never executed repo code — the 2026-08-06 outage signature was exactly
// one step, "Set up job", failing with "Failed to resolve action download
// info. Error: Service Unavailable" before checkout.
export const RUNNER_PHASE_STEP_NAMES = new Set(["Set up job", "Complete job"]);

// Run conclusions that never reflect on the code and are retry-worthy when
// the run was not superseded and (for cancelled) no job had started.
export const INFRA_RUN_CONCLUSIONS = new Set([
  "cancelled",
  "timed_out",
  "startup_failure",
  "stale",
]);

// Conclusions that need no wake at all. Consulted explicitly below — keep in
// sync with the wake-coverage table in AGENT_INFRA.md.
export const IGNORED_RUN_CONCLUSIONS = new Set([
  "skipped",
  "neutral",
  "action_required",
]);

// Total attempts allowed on one run id (first run + auto re-runs). Attempt 3's
// outcome is final: still commented, never re-queued.
export const MAX_RUN_ATTEMPTS = 3;

// Per-workflow marker: each watched workflow owns exactly one live comment,
// so verdicts from different workflows never overwrite each other.
export const WAKE_COMMENT_MARKER_PREFIX = "<!-- frapp-ci-wake:";

export function wakeMarkerFor(workflowName) {
  return `${WAKE_COMMENT_MARKER_PREFIX}${workflowName} -->`;
}

// Pages of 100 comments to scan for previous wake comments before giving up
// (stale extras are cleaned up by the next upsert, so a cap is safe).
const MAX_COMMENT_PAGES = 10;

/**
 * True when the job failed inside a step the repo defines (checkout, npm ci,
 * an actual check), as opposed to dying in runner setup/teardown.
 */
export function jobFailedInRealStep(job) {
  return (job.steps ?? []).some(
    (step) =>
      step.conclusion === "failure" && !RUNNER_PHASE_STEP_NAMES.has(step.name),
  );
}

/**
 * Pure classifier. `run` is the workflow_run payload object. `jobs` is the
 * run's latest-attempt jobs, or null when the jobs API errored (unknown).
 * `hasNewerRun` is true/false, or null when the runs API errored (unknown).
 * Unknowns fail closed: never "infra", never a requeue.
 * Returns { verdict, shouldRerun, shouldComment, reason }.
 */
export function classifyRun({ run, jobs = [], hasNewerRun = false }) {
  if (hasNewerRun === true) {
    return {
      verdict: "superseded",
      shouldRerun: false,
      shouldComment: false,
      reason:
        "A newer run exists for this workflow and branch (repush or " +
        "concurrency cancel); this outcome is stale.",
    };
  }

  const attemptsLeft = (run.run_attempt ?? 1) < MAX_RUN_ATTEMPTS;

  if (run.conclusion === "success") {
    return {
      verdict: "success",
      shouldRerun: false,
      shouldComment: true,
      reason: "All jobs green.",
    };
  }

  if (run.conclusion === "failure") {
    if (jobs === null) {
      return {
        verdict: "unclassified-failure",
        shouldRerun: false,
        shouldComment: true,
        reason:
          "Jobs API unavailable — cannot distinguish infra from code. " +
          "Treating as a real failure (no auto-requeue); diagnose it.",
      };
    }
    const failedJobs = jobs.filter((job) => job.conclusion === "failure");
    const anyRealStepFailure = failedJobs.some(jobFailedInRealStep);
    if (anyRealStepFailure) {
      return {
        verdict: "code-failure",
        shouldRerun: false,
        shouldComment: true,
        reason:
          "At least one job failed in a repo-defined step — a re-run cannot fix this.",
      };
    }
    return {
      verdict: "infra-failure",
      shouldRerun: attemptsLeft,
      shouldComment: true,
      reason:
        "Every failed job died before its first repo step (runner setup, " +
        'e.g. "Failed to resolve action download info") — GitHub Actions infra, not code.',
    };
  }

  if (run.conclusion === "cancelled") {
    if (hasNewerRun === null) {
      return {
        verdict: "cancelled",
        shouldRerun: false,
        shouldComment: true,
        reason:
          "Run cancelled, but the runs API was unavailable so a newer " +
          "superseding run cannot be ruled out — not auto-requeued.",
      };
    }
    if (jobs === null) {
      return {
        verdict: "cancelled",
        shouldRerun: false,
        shouldComment: true,
        reason:
          "Run cancelled, but the jobs API was unavailable so an infra " +
          "cancellation cannot be told from a deliberate one — not auto-requeued.",
      };
    }
    const anyJobStarted = jobs.some((job) => (job.steps ?? []).length > 0);
    if (anyJobStarted) {
      return {
        verdict: "cancelled",
        shouldRerun: false,
        shouldComment: true,
        reason:
          "At least one job had started running — treating this as a " +
          "deliberate or mid-run cancellation, not auto-requeued.",
      };
    }
    return {
      verdict: "infra-failure",
      shouldRerun: attemptsLeft,
      shouldComment: true,
      reason:
        "Cancelled before any job started a step (no runner ever picked the " +
        "work up) — the Actions-outage signature, not a deliberate cancel.",
    };
  }

  if (INFRA_RUN_CONCLUSIONS.has(run.conclusion)) {
    return {
      verdict: "infra-failure",
      shouldRerun: attemptsLeft,
      shouldComment: true,
      reason: `Run ended ${run.conclusion} without being superseded — never completed on its own merits.`,
    };
  }

  if (IGNORED_RUN_CONCLUSIONS.has(run.conclusion)) {
    return {
      verdict: "ignored",
      shouldRerun: false,
      shouldComment: false,
      reason: `Conclusion "${run.conclusion}" needs no wake.`,
    };
  }

  return {
    verdict: "ignored",
    shouldRerun: false,
    shouldComment: false,
    reason: `Unrecognized conclusion "${run.conclusion}" — staying silent.`,
  };
}

/**
 * Builds the wake comment body. Keep the marker first so upserts can find it
 * regardless of how GitHub renders the rest.
 */
export function buildWakeComment({ run, verdict, reason, rerunResult }) {
  const attempt = run.run_attempt ?? 1;
  const lines = [
    wakeMarkerFor(run.name),
    `**CI wake** — \`${run.name}\` attempt ${attempt}: **${run.conclusion}** (${verdict}).`,
    "",
    reason,
  ];

  if (rerunResult?.requeued) {
    lines.push(
      "",
      `Auto-requeued as attempt ${attempt + 1} (\`${rerunResult.mode}\`); the next completion posts a fresh wake.`,
    );
  } else if (verdict === "infra-failure") {
    lines.push(
      "",
      rerunResult?.error
        ? `Re-queue attempt failed (${rerunResult.error}); re-run manually via the Actions UI or MCP \`actions_run_trigger\`.`
        : `Attempt cap (${MAX_RUN_ATTEMPTS}) reached — do not blind-retry again; check githubstatus.com, then re-run manually once the incident clears.`,
    );
  } else if (verdict === "success") {
    lines.push(
      "",
      "If you are babysitting this PR: re-check mergeability, review state, and conversation resolution now.",
    );
  }

  lines.push(
    "",
    `- Run: ${run.html_url}`,
    `- Commit: ${run.head_sha}`,
    "",
    "_Automated wake signal for watching agent sessions (`docs/internal/ci-cd/AGENT_INFRA.md` § PR babysitting): the PR-activity webhook never fires on success/cancelled/timed-out, so this comment is the wake. One live comment per watched workflow; superseded runs stay silent._",
  );
  return lines.join("\n");
}

// ── GitHub REST helpers (injectable fetch, same headers as configure-branch-protection.mjs)
// Exported for reuse by sibling watchdog scripts (pr-base-sync.mjs) — one request/upsert
// implementation, so the delete-then-create webhook semantics can't drift between them.

export async function ghRequest({
  token,
  fetchImpl = fetch,
  method = "GET",
  path,
  body,
}) {
  // Network-level rejections (DNS, ECONNRESET — undici throws, it doesn't return a
  // response) surface as an ordinary failed request. Both watchdogs treat `ok: false`
  // as a fail-safe skip; an uncaught throw instead aborted the WHOLE run — for
  // pr-base-sync that dropped every PR after the failing one and turned a transient
  // socket blip into a red run on main.
  try {
    const response = await fetchImpl(`https://api.github.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    const text = await response.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

/**
 * True when a newer run of the same workflow exists for the branch — the
 * repush / concurrency-cancel case whose outcome must stay silent. Returns
 * null when the API call fails (unknown — the classifier fails closed on it).
 */
export async function hasNewerRun({ token, repo, run, fetchImpl }) {
  const { ok, data } = await ghRequest({
    token,
    fetchImpl,
    path:
      `/repos/${repo}/actions/workflows/${run.workflow_id}/runs` +
      `?branch=${encodeURIComponent(run.head_branch)}&event=${run.event}&per_page=10`,
  });
  if (!ok || !Array.isArray(data?.workflow_runs)) return null;
  const createdAt = new Date(run.created_at).getTime();
  return data.workflow_runs.some(
    (other) =>
      other.id !== run.id && new Date(other.created_at).getTime() > createdAt,
  );
}

/**
 * The run's latest-attempt jobs, or null when the API call fails — null is
 * meaningfully different from [] (the classifier must not read an API error
 * as "no job failed in a real step", which is the infra signature).
 */
export async function fetchLatestJobs({ token, repo, run, fetchImpl }) {
  const { ok, data } = await ghRequest({
    token,
    fetchImpl,
    path: `/repos/${repo}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`,
  });
  return ok && Array.isArray(data?.jobs) ? data.jobs : null;
}

/**
 * Re-queues the run: rerun-failed-jobs first (cheap — only red jobs), plain
 * rerun as the fallback (a fully-cancelled run has no failed jobs to re-run).
 * Returns { requeued, mode } or { requeued: false, error }.
 */
export async function requeueRun({ token, repo, run, fetchImpl }) {
  let lastError = null;
  for (const mode of ["rerun-failed-jobs", "rerun"]) {
    const { ok, status, data } = await ghRequest({
      token,
      fetchImpl,
      method: "POST",
      path: `/repos/${repo}/actions/runs/${run.id}/${mode}`,
    });
    if (ok) return { requeued: true, mode };
    lastError = `HTTP ${status}${data?.message ? `: ${data.message}` : ""}`;
  }
  return { requeued: false, error: lastError };
}

/**
 * The open PR for this run's head, or null. The list query is authoritative
 * for open-state (a workflow_run payload's pull_requests array says nothing
 * about state, so a wake could otherwise land on a merged PR) and uses the
 * head repo's owner so fork PRs resolve too. The payload is only a fallback
 * when the API errors — a possibly-stale wake beats silence.
 */
export async function findOpenPrNumber({ token, repo, run, fetchImpl }) {
  const headOwner = run.head_repository?.owner?.login ?? repo.split("/")[0];
  const { ok, data } = await ghRequest({
    token,
    fetchImpl,
    path: `/repos/${repo}/pulls?head=${encodeURIComponent(headOwner)}:${encodeURIComponent(run.head_branch)}&state=open&per_page=1`,
  });
  if (ok && Array.isArray(data)) return data[0]?.number ?? null;

  const fromPayload = (run.pull_requests ?? []).find(
    (pr) => pr.head?.sha === run.head_sha || pr.head?.ref === run.head_branch,
  );
  return fromPayload?.number ?? null;
}

/**
 * All comment ids on the PR whose body carries `marker`, collected across pages
 * BEFORE any delete — deleting while paginating shifts later comments backward
 * and skips them.
 */
export async function findMarkedCommentIds({
  token,
  repo,
  prNumber,
  marker,
  fetchImpl,
}) {
  const ids = [];
  for (let page = 1; page <= MAX_COMMENT_PAGES; page += 1) {
    const { ok, data } = await ghRequest({
      token,
      fetchImpl,
      path: `/repos/${repo}/issues/${prNumber}/comments?per_page=100&page=${page}`,
    });
    if (!ok || !Array.isArray(data)) break;
    for (const comment of data) {
      // startsWith, not includes: every wake comment leads with its marker, while a
      // human/agent quote-reply embeds the (invisible) marker mid-body behind "> " —
      // an includes() match would silently DELETE that reply on the next upsert.
      if (comment.body?.startsWith(marker)) ids.push(comment.id);
    }
    if (data.length < 100) break;
  }
  return ids;
}

/**
 * Deletes every comment on the PR that leads with `marker`, without posting a
 * replacement. Shared by upsertWakeComment (its delete half) and pr-base-sync's
 * back-in-sync cleanup, so the delete semantics can't drift between watchdogs.
 * Returns the number of comments deleted.
 */
export async function clearMarkedComments({
  token,
  repo,
  prNumber,
  marker,
  fetchImpl,
}) {
  const staleIds = await findMarkedCommentIds({
    token,
    repo,
    prNumber,
    marker,
    fetchImpl,
  });
  for (const id of staleIds) {
    await ghRequest({
      token,
      fetchImpl,
      method: "DELETE",
      path: `/repos/${repo}/issues/comments/${id}`,
    });
  }
  return staleIds.length;
}

/**
 * Delete-then-create upsert scoped to one workflow's marker. Creating (not
 * editing) is what makes the webhook deliver action=created to the wake path.
 */
export async function upsertWakeComment({
  token,
  repo,
  prNumber,
  marker,
  body,
  fetchImpl,
}) {
  await clearMarkedComments({ token, repo, prNumber, marker, fetchImpl });

  const { ok, status } = await ghRequest({
    token,
    fetchImpl,
    method: "POST",
    path: `/repos/${repo}/issues/${prNumber}/comments`,
    body: { body },
  });
  return { posted: ok, status };
}

// ── Orchestration ───────────────────────────────────────────────────────────

/**
 * Full flow for one workflow_run completed event. Returns a summary object;
 * the CLI wrapper logs it. Everything network-bound goes through fetchImpl so
 * tests run offline.
 */
export async function processCompletedRun({
  token,
  repo,
  run,
  fetchImpl = fetch,
  logger = console,
}) {
  if (run.event !== "pull_request") {
    return { verdict: "ignored", reason: `event ${run.event} is not a PR run` };
  }

  // Freshness first: a superseded run needs no jobs fetch, no requeue, and no
  // comment — and with cancel-in-progress on ci.yml, every repush makes one.
  const newer = await hasNewerRun({ token, repo, run, fetchImpl });
  if (newer === true) {
    const classification = classifyRun({ run, hasNewerRun: true });
    logger.log?.(`[ci-wake] ${run.name} #${run.id}: superseded, staying silent`);
    return { ...classification, rerunResult: null, commented: false };
  }

  const jobs =
    run.conclusion === "failure" || run.conclusion === "cancelled"
      ? await fetchLatestJobs({ token, repo, run, fetchImpl })
      : [];
  const classification = classifyRun({ run, jobs, hasNewerRun: newer });
  logger.log?.(
    `[ci-wake] ${run.name} #${run.id} attempt ${run.run_attempt}: ` +
      `${run.conclusion} → ${classification.verdict} (${classification.reason})`,
  );

  let rerunResult = null;
  if (classification.shouldRerun) {
    rerunResult = await requeueRun({ token, repo, run, fetchImpl });
    logger.log?.(
      rerunResult.requeued
        ? `[ci-wake] re-queued via ${rerunResult.mode}`
        : `[ci-wake] re-queue failed: ${rerunResult.error}`,
    );
  }

  if (!classification.shouldComment) {
    return { ...classification, rerunResult, commented: false };
  }

  const prNumber = await findOpenPrNumber({ token, repo, run, fetchImpl });
  if (!prNumber) {
    logger.log?.("[ci-wake] no open PR for this run; nothing to wake");
    return { ...classification, rerunResult, commented: false };
  }

  const body = buildWakeComment({
    run,
    verdict: classification.verdict,
    reason: classification.reason,
    rerunResult,
  });
  const { posted, status } = await upsertWakeComment({
    token,
    repo,
    prNumber,
    marker: wakeMarkerFor(run.name),
    body,
    fetchImpl,
  });
  logger.log?.(
    posted
      ? `[ci-wake] wake comment posted on #${prNumber}`
      : `[ci-wake] comment post failed on #${prNumber}: HTTP ${status}`,
  );
  return { ...classification, rerunResult, commented: posted, prNumber };
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

async function main() {
  const token = requireEnv("GITHUB_TOKEN");
  const repo = requireEnv("GITHUB_REPOSITORY");
  const eventPath = requireEnv("GITHUB_EVENT_PATH");
  const event = JSON.parse(readFileSync(eventPath, "utf8"));
  const run = event.workflow_run;
  if (!run) {
    console.error("Error: event payload has no workflow_run object.");
    process.exit(1);
  }
  await processCompletedRun({ token, repo, run });
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`Unhandled error: ${error.stack ?? error.message}`);
    process.exit(1);
  });
}
