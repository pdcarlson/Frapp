#!/usr/bin/env node
// Runs on `push` to main (.github/workflows/pr-base-sync.yml). Branch protection
// on main sets `strict: true`, so every merge to main immediately makes every
// other open PR "out of date" — previously a human clicked Update branch on each
// one, serially, and conflicted PRs sat unmergeable until someone noticed. This
// sweep closes both gaps the moment the base moves:
//
//   1. Behind + clean PRs are updated via the update-branch API — but ONLY when
//      PR_BASE_SYNC_TOKEN (a fine-grained PAT) is configured. Pushes made with
//      the default GITHUB_TOKEN do not create workflow runs (GitHub's recursion
//      guard), so an update through it would leave required checks stuck at
//      "Expected" with no CI ever running — strictly worse than not updating.
//   2. When auto-update is unavailable (no PAT, fork head, API failure) or the
//      PR has conflicts, one wake comment per PR tells the watching agent
//      session what to do — merge origin/main itself, resolving conflicts if
//      needed. Comments are webhook events (same wake path as ci-wake.mjs), and
//      the agent's own push triggers CI normally.
//
// Verdicts fail SAFE: a PR whose mergeability cannot be established (API error,
// mergeable still null after bounded polling) is skipped — never blind-updated
// and never falsely accused of conflicts. The next push to main re-sweeps.
// One known race runs the other way: GitHub invalidates `mergeable` lazily, so a
// sweep firing seconds after the base push can read a stale `true` computed
// against the PREVIOUS base and route a freshly-conflicted PR down the behind
// path. The update-branch call then fails with a conflict message, which reroutes
// to the conflict wake comment; the no-PAT behind comment hedges its wording for
// the same reason.
//
// Env inputs:
//   GITHUB_TOKEN        — required (pull-requests/issues: write); reads + comments
//   PR_BASE_SYNC_TOKEN  — optional PAT (contents + pull-requests write); update-branch only
//   GITHUB_REPOSITORY   — required, owner/repo
//   GITHUB_REF_NAME     — required, the base branch that moved (main)
//   GITHUB_SHA          — required, the new base tip
//
// Exits 0 on every handled outcome (a watchdog that reds CI creates the noise
// it exists to remove); 1 only on unexpected errors.

import {
  ghRequest,
  clearMarkedComments,
  upsertWakeComment,
} from "./ci-wake.mjs";

// One live comment per PR. No workflow-name suffix (unlike ci-wake's per-workflow
// markers): this sweep owns exactly one verdict per PR and each new base move
// supersedes the last, so delete-then-create per sweep is the correct cadence.
export const BASE_SYNC_MARKER = "<!-- frapp-base-sync -->";

// Sweep bound. Sequential per-PR processing keeps this well inside the job
// timeout and gentle on the API; anything past the cap is LOGGED as deferred
// (never silently truncated). The list is requested least-recently-updated
// FIRST — with GitHub's default newest-first ordering the slice would keep the
// same 20 PRs every sweep and starve the rest forever. updated-asc also makes
// deferral self-correcting: acting on a PR (comment or update) bumps its
// updated_at to the back of the next sweep's order, so deferred PRs rotate to
// the front instead of waiting behind the same busy twenty.
export const MAX_PRS = 20;

// GitHub computes `mergeable` lazily; a GET can return null while the check
// runs. Bounded re-polls with a real delay, injectable for tests.
export const MERGEABLE_POLL_ATTEMPTS = 5;
export const MERGEABLE_POLL_DELAY_MS = 3000;

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const shortSha = (sha) => (sha ?? "").slice(0, 7);

/**
 * The PR detail with `mergeable` resolved, or null when it cannot be
 * established (API error, or still null after the poll budget). Null is a
 * fail-safe verdict upstream — never treated as "clean" or "conflicted".
 */
export async function fetchPrWithMergeable({
  token,
  repo,
  number,
  fetchImpl,
  sleep = defaultSleep,
}) {
  for (let attempt = 1; attempt <= MERGEABLE_POLL_ATTEMPTS; attempt += 1) {
    const { ok, data } = await ghRequest({
      token,
      fetchImpl,
      path: `/repos/${repo}/pulls/${number}`,
    });
    if (!ok || typeof data !== "object" || data === null) return null;
    if (data.mergeable !== null && data.mergeable !== undefined) return data;
    if (attempt < MERGEABLE_POLL_ATTEMPTS) {
      await sleep(MERGEABLE_POLL_DELAY_MS);
    }
  }
  return null;
}

/**
 * How many commits the PR head is behind the base ref, or null when the
 * compare API fails (fail safe — fork heads whose SHA isn't reachable in the
 * base repo land here too). `behind_by` counts base commits missing from head,
 * which is exactly the "Update branch" condition; `mergeable_state` is NOT
 * used for this because "blocked" (missing reviews/checks) masks "behind".
 */
export async function compareBehindBy({
  token,
  repo,
  baseRef,
  headSha,
  fetchImpl,
}) {
  const { ok, data } = await ghRequest({
    token,
    fetchImpl,
    path: `/repos/${repo}/compare/${encodeURIComponent(baseRef)}...${headSha}`,
  });
  if (!ok || typeof data?.behind_by !== "number") return null;
  return data.behind_by;
}

/**
 * update-branch via the PAT. `expected_head_sha` makes the call a no-op 422 if
 * the head moved since we read it — a fresh push means fresh CI anyway, so
 * losing that race is fine. Returns { updated } or { updated: false, error }.
 */
export async function updatePrBranch({
  updateToken,
  repo,
  number,
  expectedHeadSha,
  fetchImpl,
}) {
  const { ok, status, data } = await ghRequest({
    token: updateToken,
    fetchImpl,
    method: "PUT",
    path: `/repos/${repo}/pulls/${number}/update-branch`,
    body: { expected_head_sha: expectedHeadSha },
  });
  if (ok) return { updated: true };
  return {
    updated: false,
    error: `HTTP ${status}${data?.message ? `: ${data.message}` : ""}`,
  };
}

/** Deletes this sweep's stale wake comments without posting a new one. */
export async function clearWakeComments({ token, repo, prNumber, fetchImpl }) {
  return clearMarkedComments({
    token,
    repo,
    prNumber,
    marker: BASE_SYNC_MARKER,
    fetchImpl,
  });
}

const WAKE_FOOTER =
  "_Automated wake signal from `pr-base-sync.yml` (`docs/internal/ci-cd/AGENT_INFRA.md` " +
  "§ Base-branch sync): posted fresh (never edited) on each base move so created-only " +
  "webhook listeners fire. One live comment per PR — a later sweep removes it once the " +
  "PR is back in sync with its base._";

// Shared scaffolding for both wake variants: marker first line, `headline` after the
// common "base moved" prefix, variant `instructions`, the same metadata bullets, footer.
function buildSyncComment({ baseRef, baseSha, pr, headline, instructions }) {
  return [
    BASE_SYNC_MARKER,
    `**Base-branch sync** — \`${baseRef}\` moved to \`${shortSha(baseSha)}\`${headline}`,
    "",
    ...instructions,
    "",
    `- Base \`${baseRef}\`: ${baseSha}`,
    `- PR head at sweep time: ${pr.head?.sha ?? "unknown"}`,
    "",
    WAKE_FOOTER,
  ].join("\n");
}

export function buildConflictComment({ baseRef, baseSha, pr }) {
  return buildSyncComment({
    baseRef,
    baseSha,
    pr,
    headline: " and this PR now has **merge conflicts** with it.",
    instructions: [
      "If you are the agent session watching this PR, resolve them now:",
      "",
      `1. \`git fetch origin ${baseRef}\``,
      `2. \`git merge origin/${baseRef}\` on this PR's branch`,
      "3. Resolve the conflicts — keep both sides' behavior; only ask when a conflict is genuinely ambiguous (both sides changed the same logic and picking one loses behavior).",
      "4. Run the checks you can locally, then push. Your push re-runs CI against the new base.",
    ],
  });
}

export function buildBehindComment({ baseRef, baseSha, pr, reason }) {
  return buildSyncComment({
    baseRef,
    baseSha,
    pr,
    headline: `; this PR is behind it and was **not** auto-updated (${reason}).`,
    instructions: [
      "If you are the agent session watching this PR, update the branch yourself: " +
        `\`git fetch origin ${baseRef} && git merge origin/${baseRef}\`, then push. ` +
        "The merge should be clean, but resolve conflicts if it surfaces any — mergeability may have been computed against the previous base. " +
        "Your push is what makes CI re-run against the new base — the workflow's default token cannot trigger CI runs.",
    ],
  });
}

/**
 * Full sweep for one base move. Returns a per-PR summary array; the CLI wrapper
 * logs it. Everything network-bound goes through fetchImpl so tests run offline.
 */
export async function processBaseMove({
  token,
  updateToken = null,
  repo,
  baseRef,
  baseSha,
  fetchImpl = fetch,
  sleep = defaultSleep,
  logger = console,
}) {
  // sort=updated&direction=asc: see the MAX_PRS comment — least-recently-updated
  // first is what makes the cap a rotation instead of a permanent starvation of
  // the oldest PRs.
  const { ok, data } = await ghRequest({
    token,
    fetchImpl,
    path: `/repos/${repo}/pulls?base=${encodeURIComponent(baseRef)}&state=open&sort=updated&direction=asc&per_page=100`,
  });
  if (!ok || !Array.isArray(data)) {
    logger.log?.(
      `[pr-base-sync] could not list open PRs for base ${baseRef} — nothing done; the next base move re-sweeps`,
    );
    return [];
  }

  const prs = data.slice(0, MAX_PRS);
  if (data.length > MAX_PRS) {
    logger.log?.(
      `[pr-base-sync] ${data.length} open PRs target ${baseRef}; processing the ${MAX_PRS} least-recently-updated, deferring ${data.length - MAX_PRS} (they rotate to the front of a later sweep)`,
    );
  }
  logger.log?.(
    `[pr-base-sync] base ${baseRef} @ ${shortSha(baseSha)} — sweeping ${prs.length} open PR(s)` +
      (updateToken ? " (auto-update enabled)" : " (no PR_BASE_SYNC_TOKEN — wake comments only)"),
  );

  const results = [];
  for (const listed of prs) {
    const number = listed.number;
    // Belt over the per-PR body: ghRequest already converts network failures into
    // ok:false, so a throw here is a logic error — but even that must cost one PR,
    // not the rest of the sweep (the fail-safe contract in the header).
    try {
      results.push(
        await processOnePr({
          token,
          updateToken,
          repo,
          baseRef,
          baseSha,
          number,
          fetchImpl,
          sleep,
          logger,
        }),
      );
    } catch (error) {
      logger.log?.(
        `[pr-base-sync] #${number}: unexpected error (${error.message}) — skipping, fail safe`,
      );
      results.push({ number, verdict: "unknown", action: "skipped" });
    }
  }

  return results;
}

async function processOnePr({
  token,
  updateToken,
  repo,
  baseRef,
  baseSha,
  number,
  fetchImpl,
  sleep,
  logger,
}) {
  const pr = await fetchPrWithMergeable({
    token,
    repo,
    number,
    fetchImpl,
    sleep,
  });

  if (pr === null) {
    logger.log?.(
      `[pr-base-sync] #${number}: mergeability unknown (API error or still computing) — skipping, fail safe`,
    );
    return { number, verdict: "unknown", action: "skipped" };
  }

  const postConflictComment = async () => {
    const { posted } = await upsertWakeComment({
      token,
      repo,
      prNumber: number,
      marker: BASE_SYNC_MARKER,
      body: buildConflictComment({ baseRef, baseSha, pr }),
      fetchImpl,
    });
    logger.log?.(
      `[pr-base-sync] #${number}: CONFLICTS with ${baseRef} — wake comment ${posted ? "posted" : "FAILED"}`,
    );
    return { number, verdict: "conflict", action: "commented" };
  };

  if (pr.mergeable === false) return postConflictComment();

  const behindBy = await compareBehindBy({
    token,
    repo,
    baseRef,
    headSha: pr.head?.sha,
    fetchImpl,
  });
  if (behindBy === null) {
    logger.log?.(
      `[pr-base-sync] #${number}: compare with ${baseRef} failed — skipping, fail safe`,
    );
    return { number, verdict: "unknown", action: "skipped" };
  }
  if (behindBy === 0) {
    const cleared = await clearWakeComments({
      token,
      repo,
      prNumber: number,
      fetchImpl,
    });
    logger.log?.(
      `[pr-base-sync] #${number}: already contains ${baseRef} tip — in sync${cleared ? `, cleared ${cleared} stale wake comment(s)` : ""}`,
    );
    return { number, verdict: "current", action: "none" };
  }

  // Behind and clean. A fork head cannot be updated through the API from
  // here, and without the PAT an update would run no CI (see header) — both
  // cases hand the merge to the watching agent instead.
  const isFork = pr.head?.repo?.full_name !== repo;
  let reason = null;
  if (isFork) {
    reason = "the head branch lives in a fork, which this sweep cannot push to";
  } else if (!updateToken) {
    reason = "no `PR_BASE_SYNC_TOKEN` secret is configured";
  } else {
    const result = await updatePrBranch({
      updateToken,
      repo,
      number,
      expectedHeadSha: pr.head?.sha,
      fetchImpl,
    });
    if (result.updated) {
      const cleared = await clearWakeComments({
        token,
        repo,
        prNumber: number,
        fetchImpl,
      });
      logger.log?.(
        `[pr-base-sync] #${number}: behind by ${behindBy} — auto-updated via update-branch${cleared ? `, cleared ${cleared} stale wake comment(s)` : ""}`,
      );
      return { number, verdict: "behind", action: "updated" };
    }
    // The stale-`mergeable` race from the header lands here: a freshly-conflicted
    // PR read as `mergeable: true` fails update-branch with a conflict message.
    // Post the conflict guidance — a "behind, expect a clean merge" comment would
    // send the agent into conflicts it was told not to expect.
    if (/conflict/i.test(result.error)) {
      logger.log?.(
        `[pr-base-sync] #${number}: update-branch reports a conflict (stale mergeable) — rerouting to the conflict wake`,
      );
      return postConflictComment();
    }
    reason = `the update-branch call failed (${result.error})`;
  }

  const { posted } = await upsertWakeComment({
    token,
    repo,
    prNumber: number,
    marker: BASE_SYNC_MARKER,
    body: buildBehindComment({ baseRef, baseSha, pr, reason }),
    fetchImpl,
  });
  logger.log?.(
    `[pr-base-sync] #${number}: behind by ${behindBy}, not auto-updated (${reason}) — wake comment ${posted ? "posted" : "FAILED"}`,
  );
  return { number, verdict: "behind", action: "commented" };
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
  const baseRef = requireEnv("GITHUB_REF_NAME");
  const baseSha = requireEnv("GITHUB_SHA");
  const updateToken = process.env.PR_BASE_SYNC_TOKEN || null;
  await processBaseMove({ token, updateToken, repo, baseRef, baseSha });
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`Unhandled error: ${error.stack ?? error.message}`);
    process.exit(1);
  });
}
