#!/usr/bin/env node
// Runs on `push` to main (.github/workflows/pr-base-sync.yml). Branch protection
// on main sets `strict: true`, so every merge to main immediately makes every
// other open PR "out of date" — previously a human clicked Update branch on each
// one, serially, and conflicted PRs sat unmergeable until someone noticed. This
// sweep closes both gaps the moment the base moves:
//
//   1. Behind + clean PRs are updated via the update-branch API — but ONLY when
//      PR_BASE_SYNC_TOKEN holds a working GitHub App installation token. Pushes
//      made with the default GITHUB_TOKEN do not create workflow runs (GitHub's
//      recursion guard), so an update through it would leave required checks
//      stuck at "Expected" with no CI ever running — strictly worse than not
//      updating. An App token is not subject to that guard, and unlike a PAT it
//      has no hand-renewed expiry and is not tied to one person's account.
//   2. When the failure is PER-PR (conflicts, a fork head, a one-off update
//      error) one wake comment on that PR tells the watching agent session what
//      to do — merge origin/main itself, resolving conflicts if needed.
//      Comments are webhook events (same wake path as ci-wake.mjs), and the
//      agent's own push triggers CI normally.
//   3. When the failure is REPO-WIDE — no app token, or a token the API rejects
//      — every open PR would otherwise receive the same comment saying the same
//      thing, up to MAX_PRS of them per merge to main. That is the noise this
//      watchdog exists to prevent, so the token case raises ONE alert issue
//      instead (the deploy-alert.mjs / staging-conformance.mjs pattern) and
//      clears the stale per-PR comments. A later sweep that actually updates a
//      branch closes it.
//
// Auto-merge PRs share ONE update slot (#3599). Updating a PR cancels the CI
// running on its old head, and under `strict: true` only a PR that is both up to
// date and green can merge. When every behind auto-merge PR was updated on every
// push, they all raced: the fastest CI merged, moved `main`, and restarted the
// rest, so a PR whose CI outlasted the gap between merges never merged at all.
// So each sweep picks one holder (see pickSlotOrder) and updates only that one;
// the other behind auto-merge PRs are HELD (no update, no wake comment) until the
// holder merges and its push to `main` hands the slot on. A holder that goes red,
// or turns green without merging, would stall that hand-off, so the workflow also
// runs this sweep when CI completes on one of this repo's PRs, and every fifteen
// minutes (`mode: "checks"`), which only advances the slot.
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
//   GITHUB_TOKEN        — required (pull-requests + issues: write); reads,
//                         wake comments and the alert issue, never update-branch
//   PR_BASE_SYNC_TOKEN  — optional GitHub App installation token (contents +
//                         pull-requests write), minted in the workflow by
//                         actions/create-github-app-token; update-branch only
//   GITHUB_REPOSITORY   — required, owner/repo
//   GITHUB_REF_NAME     — required, the base branch that moved (main)
//   GITHUB_SHA          — required, the new base tip
//   GITHUB_EVENT_NAME   — `push` (the full sweep), or `workflow_run` / `schedule`
//                         (slot only)
//
// Exits 0 on every handled outcome (a watchdog that reds CI creates the noise
// it exists to remove); 1 only on unexpected errors.

import { ghRequest } from "./lib/github.mjs";
import { NON_IDEMPOTENT_TIMEOUT_MS } from "./lib/http.mjs";
import {
  clearMarkedComments,
  describeWakeFailure,
  upsertWakeComment,
  warningAnnotation,
} from "./ci-wake.mjs";
import {
  defineAlert,
  findAlertIssuesDetailed,
  raiseAlert as raiseAlertIssue,
  resolveAlert as resolveAlertIssue,
} from "./lib/alert-issue.mjs";
import { requireEnv } from "./lib/env.mjs";
import { isInvokedDirectly } from "./lib/invoked-directly.mjs";
import { ALL_REQUIRED_CHECKS } from "./lib/required-checks.mjs";
import { ACCEPTED_CONCLUSIONS, fetchCheckRuns, latestRunsByName } from "./lib/check-runs.mjs";

// One live comment per PR. No workflow-name suffix (unlike ci-wake's per-workflow
// markers): this sweep owns exactly one verdict per PR and each new base move
// supersedes the last, so delete-then-create per sweep is the correct cadence.
export const BASE_SYNC_MARKER = "<!-- frapp-base-sync -->";

// ── Alert issue identity ────────────────────────────────────────────────────
// Same contract as deploy-alert.mjs: the title is the primary key, looked up by
// exact match, so it must stay stable across releases. The lookup label comes
// from lib/alert-issue.mjs, which owns it for every watchdog.
//
// P2, not P1: the sweep degrades rather than breaks. PRs still merge; they just
// need a human or an agent to press Update branch, which is where this repo was
// before the sweep existed.
export const ALERT = defineAlert({
  title: "PR base sync cannot auto-update PR branches",
  labels: ["area:ci", "P2"],
});

const SETUP_STEPS = [
  "The token is minted in `.github/workflows/pr-base-sync.yml` by",
  "`actions/create-github-app-token`, from two secrets that belong in the `automation` environment:",
  "`PR_BASE_SYNC_APP_CLIENT_ID` and `PR_BASE_SYNC_APP_PRIVATE_KEY`.",
  "Setup and rotation: `docs/ci-cd/pr-babysitting.md` § Base-branch sync.",
].join(" ");

function alertBody(detail) {
  return [
    `\`main\` moved, at least one open PR was behind it, and the sweep updated`,
    "no branch automatically.",
    "",
    `- Cause: ${detail}`,
    "",
    SETUP_STEPS,
    "",
    "Until this is fixed the sweep still detects conflicts and still comments on",
    "them; only the silent auto-update is off, so behind PRs need `Update branch`",
    "pressed by hand (or an agent merging `main`).",
    "",
    "_Posted automatically by `scripts/ci/pr-base-sync.mjs`. This issue closes",
    "itself the next time a sweep updates a branch successfully._",
  ].join("\n");
}

/** One alert for the whole repo, however many PRs were affected this sweep. */
export async function raiseAutoUpdateAlert({ token, repo, detail, fetchImpl, lookup }) {
  return raiseAlertIssue({
    token,
    repo,
    fetchImpl,
    alert: ALERT,
    // The sweep's own read, when it made one (reconcileTokenAlert), so the
    // raise doesn't read the same pages again (#2333).
    lookup,
    buildIssueBody: () => alertBody(detail),
    buildCommentBody: ({ reopened }) =>
      [
        reopened
          ? "**Base-branch auto-update is broken again** — reopening."
          : "**Base-branch auto-update is still broken.**",
        "",
        `- Cause: ${detail}`,
        "",
        "_Posted automatically by `scripts/ci/pr-base-sync.mjs`._",
      ].join("\n"),
  });
}

/**
 * Closed when the sweep can show the cause is gone — either a real update-branch
 * success (direct proof), or a sweep that ran with a token and blocked on
 * nothing (the alert's cause no longer holds).
 *
 * The second condition exists because the first almost never fires here. This
 * repo merges roughly one PR at a time, so the usual sweep finds no OTHER open
 * PR to update, and an alert gated on a same-sweep success would stay open for
 * weeks after the fix — which is how a P2 becomes wallpaper. `proven` records
 * which of the two it was, so the closing comment does not overstate itself.
 */
export async function resolveAutoUpdateAlert({ token, repo, proven, fetchImpl }) {
  return resolveAlertIssue({
    token,
    repo,
    fetchImpl,
    alert: ALERT,
    buildRecoveryBody: () =>
      [
        "**Base-branch auto-update recovered.** Closing.",
        "",
        proven
          ? "A PR branch was updated via the update-branch API on this sweep."
          : "A sweep ran with a working app token and nothing was blocked. No " +
            "branch needed updating, so this is the absence of the fault rather " +
            "than a demonstration of the fix; the next behind PR re-raises if it " +
            "is still broken.",
        "",
        "_Closed automatically by `scripts/ci/pr-base-sync.mjs`._",
      ].join("\n"),
  });
}

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

// GitHub answers a secondary rate limit with 403 and one of these phrasings, the
// same status it uses for a dead token. Matching on the message is the only way
// to tell them apart from the response body alone.
const RATE_LIMITED = /rate limit|abuse detection|too many requests|retry after/i;

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
 * update-branch via the app token. `expected_head_sha` makes the call a no-op 422 if
 * the head moved since we read it — a fresh push means fresh CI anyway, so
 * losing that race is fine. Returns { updated } or { updated: false, status, error,
 * stalled }; `status` is what lets the caller tell a repo-wide auth rejection
 * (401/403 — one alert issue) from a per-PR problem (a comment on that PR), and
 * `stalled` marks a call that got no answer before its deadline (#2973).
 */
export async function updatePrBranch({
  updateToken,
  repo,
  number,
  expectedHeadSha,
  fetchImpl,
  timeoutMs,
  now = Date.now,
}) {
  const startedAt = now();
  const { ok, status, data } = await ghRequest({
    token: updateToken,
    fetchImpl,
    method: "PUT",
    path: `/repos/${repo}/pulls/${number}/update-branch`,
    body: { expected_head_sha: expectedHeadSha },
    // Unset is the library's ceiling for a write (NON_IDEMPOTENT_TIMEOUT_MS).
    ...(timeoutMs ? { retryOptions: { timeoutMs } } : {}),
  });
  if (ok) return { updated: true };
  // A transport failure carries its reason as a string (`ghRequest`'s
  // describeThrown), an answer as GitHub's JSON `message`.
  const text = typeof data === "string" ? data : data?.message;
  const why =
    typeof text === "string" ? text.trim().split(/\r?\n/, 1)[0].slice(0, 200) : "";
  // Only a call that ran to its deadline is a stall: a reset or a DNS failure
  // has no answer either, but it costs the sweep nothing.
  const ceiling = timeoutMs || NON_IDEMPOTENT_TIMEOUT_MS;
  return {
    updated: false,
    status,
    error: describeWakeFailure({ status, error: why || null }),
    stalled: !status && now() - startedAt >= ceiling * 0.9,
  };
}

/**
 * Stalled update-branch calls in a row (each ran to the write ceiling with no
 * answer) after which a sweep stops calling it (#2973).
 *
 * Each stalled PUT costs the full write ceiling, two minutes, and the sweep
 * runs its PRs one at a time inside the job's `timeout-minutes: 10`, with the
 * repo-level alert written only after the loop. So an endpoint that accepts
 * connections and never answers used to run the job out at about five PRs,
 * and the alert was never filed. After this many in a row, every later behind
 * PR gets the same blocked wake without a call, and the sweep reaches the alert.
 *
 * Two in a row, not one and not two in total: an isolated stall among working
 * updates must not stop the updates after it, which would leave no success to
 * outrank the failures and file an alert against a working endpoint (see
 * reconcileTokenAlert). Any other outcome, an answer or a quick transport
 * failure, resets the run.
 */
export const UPDATE_BRANCH_STALLS_BEFORE_STOP = 2;

// ── The auto-merge slot (#3599) ─────────────────────────────────────────────

/**
 * How long an up-to-date PR whose required checks have not all reported yet
 * still counts as in flight, measured from its head commit's committer date
 * (update-branch stamps it at the moment of the merge). Right after an update the
 * new head has no check runs while CI's `ci-${{ github.ref }}` group cancels the
 * old run, and that cancelled run's own completion fires a slot sweep inside
 * exactly that window: without the grace the holder would read as idle and a
 * second PR would be updated to race it. A check that never reports stops
 * holding the slot once this runs out; the scheduled sweep notices.
 */
export const CHECKS_START_GRACE_MS = 15 * 60 * 1000;

/**
 * How long an up-to-date PR whose required checks all passed still counts as in
 * flight after the last one completed. CI completing fires a slot sweep before
 * auto-merge has finished the merge; without this, that sweep would update the
 * next PR against a `main` the holder's merge outdates seconds later, wasting a
 * full CI run. Past it, a green PR that has not merged is waiting on something
 * other than CI, and the scheduled sweep hands the slot on.
 */
export const MERGE_GRACE_MS = 5 * 60 * 1000;

/**
 * Auto-merge PRs assessed per sweep, lowest numbers first. Each costs up to five
 * mergeable polls, a compare and a checks read before the per-PR pass begins, and
 * the job has `timeout-minutes: 10`; past this the rest are logged and left to
 * the per-PR pass, as before #3599.
 */
export const MAX_AUTO_MERGE_PRS = 15;

const timeMs = (value) => {
  const parsed = Date.parse(value ?? "");
  return Number.isNaN(parsed) ? 0 : parsed;
};

/**
 * Where a commit's REQUIRED checks stand, for the slot, as `{ state,
 * lastCompletedMs }`, or null when the checks API could not be read. `state`:
 * - "failed": the latest run of some required check concluded anything but a pass
 *   (cancelled included: auto-merge cannot act on it either);
 * - "running": none failed, and at least one has a run that has not completed;
 * - "missing": none failed or running, but some have not reported (a fresh head,
 *   or a check that never reports; isInFlight bounds it in time);
 * - "passed": every required check reported a pass.
 *
 * The read and the pass set are lib/check-runs.mjs's, shared with the deploy
 * gate, so the two agree on what green means.
 */
export async function readRequiredChecks({
  token,
  repo,
  sha,
  fetchImpl,
  required = ALL_REQUIRED_CHECKS,
  retryOptions,
}) {
  if (!sha) return null;
  let runs;
  try {
    runs = await fetchCheckRuns({ repo, sha, token, fetchImpl, retryOptions });
  } catch {
    return null;
  }
  const latest = latestRunsByName(runs);
  let running = false;
  let missing = false;
  let lastCompletedMs = 0;
  for (const name of required) {
    const run = latest.get(name);
    if (!run) {
      missing = true;
    } else if (run.status !== "completed") {
      running = true;
    } else if (!ACCEPTED_CONCLUSIONS.has(run.conclusion)) {
      return { state: "failed", lastCompletedMs: timeMs(run.completed_at) };
    } else {
      lastCompletedMs = Math.max(lastCompletedMs, timeMs(run.completed_at));
    }
  }
  const state = running ? "running" : missing ? "missing" : "passed";
  return { state, lastCompletedMs };
}

/** When a commit was made, from its committer date; 0 when unreadable. */
async function headCommittedAtMs({ token, repo, sha, fetchImpl }) {
  const { ok, data } = await ghRequest({
    token,
    fetchImpl,
    path: `/repos/${repo}/commits/${sha}`,
    retry: true,
  });
  return ok ? timeMs(data?.commit?.committer?.date) : 0;
}

/**
 * Governed by the slot: clean, same-repo, compare readable, not red. A PR whose
 * checks could not be read is governed (held while another PR holds the slot,
 * so it is not updated beside the holder) but can never hold the slot itself.
 */
function isQueueable(c) {
  return Boolean(
    c?.pr &&
      c.pr.mergeable === true &&
      !c.isFork &&
      typeof c.behindBy === "number" &&
      c.checks?.state !== "failed",
  );
}

const canHold = (c) => isQueueable(c) && c.checks !== null;

/** Up to date, and its CI is still on its way to a merge. */
export function isInFlight(c, now) {
  if (!canHold(c) || c.behindBy !== 0) return false;
  const { state, lastCompletedMs } = c.checks;
  if (state === "running") return true;
  if (state === "missing") return now - (c.headAtMs ?? 0) < CHECKS_START_GRACE_MS;
  if (state === "passed") return now - lastCompletedMs < MERGE_GRACE_MS;
  return false;
}

/**
 * The slot for this sweep, from `candidates` (assessed auto-merge PRs, ascending
 * PR number):
 * - `inFlight`: an up-to-date PR whose CI is still on its way to a merge
 *   (isInFlight). It holds the slot and nothing is updated, so a sweep that fires
 *   while it runs never starts a second PR racing it.
 * - `order`: otherwise, the behind PRs that may take the slot, best first: those
 *   whose required checks are still running (almost always the holder, knocked
 *   behind by a base move the queue did not cause, so it keeps the slot), then
 *   the rest, each lowest number first. The sweep tries them in turn until one
 *   updates.
 * - `queued`: every behind PR the slot governs. Whatever is not updated is held.
 *
 * A red PR is not governed: the sweep updates it as before #3599, so a fix on
 * `main` still reaches it.
 */
export function pickSlotOrder(candidates, now = Date.now()) {
  const queued = candidates.filter((c) => isQueueable(c) && c.behindBy > 0);
  const inFlight = candidates.find((c) => isInFlight(c, now))?.number ?? null;
  const eligible = queued.filter(canHold);
  const running = (c) => c.checks.state === "running";
  const order = inFlight
    ? []
    : [...eligible.filter(running), ...eligible.filter((c) => !running(c))].map((c) => c.number);
  return { inFlight, order, queued: queued.map((c) => c.number) };
}

/**
 * Reads the open auto-merge PRs once each (mergeability, how far behind,
 * required checks) and picks the slot. All of them, not only the MAX_PRS slice:
 * updating the holder bumps its `updated_at` to the back of the list, and a
 * holder the slice no longer showed would read as absent, so the next sweep
 * would update a second PR. Returns the assessments by number, so the per-PR pass
 * reuses them instead of reading each PR twice; an unresolved mergeability is
 * recorded as `pr: null` for the same reason.
 */
async function assessAutoMergeQueue({ token, repo, baseRef, listed, fetchImpl, sleep, now, logger }) {
  const assessed = new Map();
  const numbers = listed
    .filter((pr) => pr.auto_merge)
    .map((pr) => pr.number)
    .sort((a, b) => a - b);
  if (numbers.length > MAX_AUTO_MERGE_PRS) {
    logger.log?.(
      `[pr-base-sync] ${numbers.length} auto-merge PRs; the slot governs the ${MAX_AUTO_MERGE_PRS} lowest-numbered, the rest take the per-PR pass`,
    );
  }
  for (const number of numbers.slice(0, MAX_AUTO_MERGE_PRS)) {
    const pr = await fetchPrWithMergeable({ token, repo, number, fetchImpl, sleep });
    if (pr === null) {
      assessed.set(number, { number, pr: null });
      continue;
    }
    // The detail is the source of truth: auto-merge may have been turned off
    // since the list was read. Such a PR takes the ordinary per-PR pass.
    if (!pr.auto_merge) continue;
    const isFork = pr.head?.repo?.full_name !== repo;
    const entry = { number, pr, isFork, behindBy: null, checks: null, headAtMs: null };
    if (pr.mergeable === true && !isFork) {
      entry.behindBy = await compareBehindBy({
        token,
        repo,
        baseRef,
        headSha: pr.head?.sha,
        fetchImpl,
      });
      entry.checks = await readRequiredChecks({
        token,
        repo,
        sha: pr.head?.sha,
        fetchImpl,
      });
      if (entry.behindBy === 0 && entry.checks?.state === "missing") {
        entry.headAtMs = await headCommittedAtMs({ token, repo, sha: pr.head?.sha, fetchImpl });
      }
    }
    assessed.set(number, entry);
  }
  return { assessed, ...pickSlotOrder([...assessed.values()], now) };
}

function heldResult(number, holder, entry, logger) {
  logger.log?.(
    `[pr-base-sync] #${number}: behind by ${entry.behindBy}, auto-merge on — held, ` +
      `#${holder} holds the update slot (required checks on this head: ${entry.checks?.state ?? "unreadable"})`,
  );
  return { number, verdict: "behind", action: "held", holder };
}

// update-branch's 422 for `expected_head_sha` losing to a push. GitHub also
// answers 422 for other validation failures, which must not read as a race.
const HEAD_MOVED = /expected head sha|head ref|head sha/i;

/** An update-branch failure that means another sweep or a push moved the head first. */
export function isHeadMoved({ status, error }) {
  return status === 422 && HEAD_MOVED.test(error ?? "");
}

/**
 * Fills the slot: tries `queue.order` in turn until one PR is updated (or turns
 * out to have been updated already), then reports every other governed PR as
 * held. With a PR in flight nothing is tried. When no PR could be updated there
 * is no holder, so nothing is held: the PRs that could not take the slot already
 * got their per-PR handling from `tryUpdate`, and the rest go to `fallback`.
 *
 * Trying every eligible PR rather than stopping after a few is what keeps one PR
 * nobody is watching (a rule rejecting the App's push, say) from holding the
 * queue. A repo-wide failure fails every call fast, or trips the stall stop, so
 * the cost is the pre-#3599 one: each behind PR gets its wake.
 */
async function runSlot({ queue, logger, tryUpdate, onHeld = async () => {}, fallback = async () => null }) {
  const results = [];
  let holder = queue.inFlight;
  const tried = new Set();
  for (const number of holder ? [] : queue.order) {
    tried.add(number);
    const result = await tryUpdate(number);
    results.push(result);
    if (result.action === "updated" || result.action === "raced") {
      holder = number;
      break;
    }
    logger.log?.(`[pr-base-sync] #${number}: could not take the update slot — trying the next PR`);
    if (result.stopSlot) break;
  }
  for (const number of queue.queued) {
    if (tried.has(number)) continue;
    if (holder) {
      await onHeld(number);
      results.push(heldResult(number, holder, queue.assessed.get(number), logger));
    } else {
      const result = await fallback(number);
      if (result) results.push(result);
    }
  }
  return results;
}

/** Deletes this sweep's stale wake comments without posting a new one. */
export async function clearWakeComments({ token, repo, prNumber, fetchImpl }) {
  const { deleted } = await clearMarkedComments({
    token,
    repo,
    prNumber,
    marker: BASE_SYNC_MARKER,
    fetchImpl,
  });
  return deleted;
}

const WAKE_FOOTER =
  "_Automated wake signal from `pr-base-sync.yml` (`docs/ci-cd/pr-babysitting.md` " +
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
  // Tests shorten it; production keeps the library's write ceiling.
  updateBranchTimeoutMs,
  // "push": the base moved; the full sweep. "checks": CI completed on some PR
  // and the base did NOT move; only the auto-merge slot is advanced.
  mode = "push",
  now = Date.now,
}) {
  if (mode === "checks" && !updateToken) {
    logger.log?.(
      "[pr-base-sync] checks completed, but no app token minted — the update slot cannot advance; the next push to main sweeps (and raises the alert)",
    );
    return [];
  }

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

  // Without an app token nothing is updated, so there is no slot to share: every
  // behind PR gets its wake, as before.
  const queue = updateToken
    ? await assessAutoMergeQueue({
        token,
        repo,
        baseRef,
        listed: data,
        fetchImpl,
        sleep,
        now: now(),
        logger,
      })
    : null;
  if (queue && queue.assessed.size > 0) {
    logger.log?.(
      `[pr-base-sync] ${queue.assessed.size} auto-merge PR(s); update slot: ` +
        (queue.inFlight
          ? `#${queue.inFlight} (in flight)`
          : queue.order.length
            ? `next in line #${queue.order.join(", #")}`
            : "none eligible"),
    );
  }

  if (mode === "checks") {
    return advanceSlot({ token, updateToken, repo, queue, fetchImpl, logger, updateBranchTimeoutMs });
  }

  // The PRs the slot governs are handled by runSlot below, so they take no
  // MAX_PRS place: a long-held one would otherwise sit at the front of the
  // updated-asc list forever (it is never acted on) and crowd out the rest.
  const queued = new Set(queue?.queued ?? []);
  const rest = data.filter((pr) => !queued.has(pr.number));
  const prs = rest.slice(0, MAX_PRS);
  if (rest.length > MAX_PRS) {
    logger.log?.(
      `[pr-base-sync] ${rest.length} open PRs target ${baseRef} outside the update slot; processing the ${MAX_PRS} least-recently-updated, deferring ${rest.length - MAX_PRS} (they rotate to the front of a later sweep)`,
    );
  }
  logger.log?.(
    `[pr-base-sync] base ${baseRef} @ ${shortSha(baseSha)} — sweeping ${prs.length} open PR(s)` +
      (queued.size ? ` plus ${queued.size} in the update slot` : "") +
      (updateToken
        ? " (auto-update enabled)"
        : " (no app token — auto-update off; a behind PR raises the alert issue)"),
  );

  // Shared by every PR in this sweep: see UPDATE_BRANCH_STALLS_BEFORE_STOP.
  const updateBranch = { stalls: 0, stoppedDetail: null };
  // Belt over the per-PR body: ghRequest already converts network failures into
  // ok:false, so a throw here is a logic error — but even that must cost one PR,
  // not the rest of the sweep (the fail-safe contract in the header).
  const runOne = (number) =>
    processOnePr({
      token,
      updateToken,
      repo,
      baseRef,
      baseSha,
      number,
      fetchImpl,
      sleep,
      logger,
      updateBranch,
      updateBranchTimeoutMs,
      queue,
    }).catch((error) => {
      logger.log?.(
        `[pr-base-sync] #${number}: unexpected error (${error.message}) — skipping, fail safe`,
      );
      return { number, verdict: "unknown", action: "skipped" };
    });

  const results = [];
  for (const listed of prs) {
    results.push(await runOne(listed.number));
  }

  if (queue) {
    results.push(
      ...(await runSlot({
        queue,
        logger,
        // The full per-PR path, so a PR that can't take the slot gets exactly the
        // wake and the alert evidence it would have had before #3599.
        tryUpdate: async (number) => {
          const result = await runOne(number);
          // Past the stall stop every call is skipped anyway; the rest of the
          // queue goes to the per-PR path, which posts their blocked wakes.
          return updateBranch.stoppedDetail ? { ...result, stopSlot: true } : result;
        },
        // A held PR keeps no stale "merge main yourself" wake from an earlier
        // sweep: following it would restart the race the slot prevents.
        onHeld: (number) => clearWakeComments({ token, repo, prNumber: number, fetchImpl }),
        // No PR could take the slot: the rest are handled as before #3599.
        fallback: runOne,
      })),
    );
  }

  await reconcileTokenAlert({
    token,
    updateToken,
    repo,
    results,
    fetchImpl,
    logger,
  });

  return results;
}

/**
 * The slot-only sweep (`mode: "checks"`), run when CI completes on one of this
 * repo's PRs and on a schedule: `main` did not move. It fills the slot as the
 * push sweep does, and writes nothing else but the updated PR's stale wake: no
 * new wake (each one is a fresh "base moved" signal, and the base did not move),
 * no conflict handling and no alert. Those belong to the push sweep, which runs
 * on every base move. A PR it could not update is left for that sweep, and the
 * slot moves on to the next.
 */
async function advanceSlot({ token, updateToken, repo, queue, fetchImpl, logger, updateBranchTimeoutMs }) {
  return runSlot({
    queue,
    logger,
    tryUpdate: async (number) => {
      const entry = queue.assessed.get(number);
      const result = await updatePrBranch({
        updateToken,
        repo,
        number,
        expectedHeadSha: entry.pr.head?.sha,
        fetchImpl,
        timeoutMs: updateBranchTimeoutMs,
      });
      if (result.updated) {
        const cleared = await clearWakeComments({ token, repo, prNumber: number, fetchImpl });
        logger.log?.(
          `[pr-base-sync] #${number}: behind by ${entry.behindBy} — takes the update slot, auto-updated via update-branch` +
            (cleared ? `, cleared ${cleared} stale wake comment(s)` : ""),
        );
        return { number, verdict: "behind", action: "updated" };
      }
      if (isHeadMoved(result)) {
        logger.log?.(
          `[pr-base-sync] #${number}: head moved while taking the update slot (${result.error}) — another sweep or a push got there first`,
        );
        return { number, verdict: "behind", action: "raced" };
      }
      logger.log?.(
        `[pr-base-sync] #${number}: update-branch failed (${result.error}) — left for the next push sweep`,
      );
      // A call that ran to its deadline will stall the next one too; the job's
      // ten minutes are better spent ending than waiting on it again.
      return { number, verdict: "behind", action: "skipped", stopSlot: result.stalled };
    },
  });
}

/**
 * One alert for the whole sweep, raised or closed on evidence only.
 *
 * A single successful update outranks a blocked sibling in the same sweep, and
 * resolves rather than raises. The reasoning runs the other way from the obvious
 * one: an update that went through is direct proof the mechanism works, so a
 * failure beside it is something narrower — a transient 502, a rate limit — and
 * filing a P2 that accuses a working credential sends the owner hunting for a
 * fault that is not there. Under-raising is the cheap error here: the affected
 * PRs still got their wakes, and the next merge to `main` re-evaluates.
 */
async function reconcileTokenAlert({
  token,
  updateToken,
  repo,
  results,
  fetchImpl,
  logger,
}) {
  const updated = results.some((result) => result.action === "updated");
  const failures = updated
    ? []
    : results.filter((result) => result.blockedDetail);
  if (failures.length > 0) {
    // `raiseAlert` comments on every raise, which is right for deploy-alert.mjs
    // (it fires only on a failed deploy) and wrong here: this sweep runs on
    // EVERY merge to main, so raising unconditionally would put a "still broken"
    // comment on the alert per merge — the same fan-out this change removes,
    // relocated from N PRs to one issue. So only a state CHANGE is written: an
    // already-open alert is left exactly as it is.
    const lookup = await findAlertIssuesDetailed({
      token,
      repo,
      fetchImpl,
      alert: ALERT,
    });
    const { issues, lookupOk } = lookup;
    // A failed lookup falls through to raise, matching alert-issue.mjs's own
    // trade-off: a duplicate alert self-heals (resolveAlert closes every match),
    // silence about a broken watchdog does not.
    if (lookupOk && issues.some((issue) => issue.state === "open")) {
      logger.log?.(
        `[pr-base-sync] ${failures.length} behind PR(s) not auto-updated; alert already open — not re-commenting`,
      );
      return;
    }

    const alert = await raiseAutoUpdateAlert({
      token,
      repo,
      detail: failures[0].blockedDetail,
      fetchImpl,
      lookup,
    });
    logger.log?.(
      `[pr-base-sync] ${failures.length} behind PR(s) could not be auto-updated — ` +
        `alert issue ${alert.action}` +
        (alert.issueNumber ? ` (#${alert.issueNumber})` : ""),
    );
    return;
  }

  // Nothing blocked. Close on a real update (proof), or on a sweep that at least
  // held a token and hit no failure (the cause is gone). A sweep with NO token
  // never reaches here — an untokened sweep with zero behind PRs is the one case
  // that genuinely proves nothing, and it must not close a live alert. Nor does
  // a sweep whose behind PRs were all held behind the update slot (#3599): it
  // called update-branch on none of them, so "hit no failure" would be vacuous.
  const untested = results.some((r) => r.action === "held" || r.action === "raced");
  if (!updated && (!updateToken || untested)) return;

  const recovery = await resolveAutoUpdateAlert({
    token,
    repo,
    proven: updated,
    fetchImpl,
  });
  // Say "proven" only when this sweep updated a branch; otherwise the token
  // merely hit no failure, which is what `proven` tells the closing comment.
  const why = updated ? "auto-update proven working" : "auto-update hit no failure";
  if (recovery.action === "closed") {
    logger.log?.(
      `[pr-base-sync] ${why} — closed alert issue(s) ` +
        recovery.closed.map((n) => `#${n}`).join(", "),
    );
  } else if (recovery.action === "failed") {
    // A close that left an alert open, including a duplicate beside one that
    // did close. Surfaced so the one still open shows in the run.
    const closed = recovery.closed.length
      ? ` (closed ${recovery.closed.map((n) => `#${n}`).join(", ")})`
      : "";
    logger.log?.(
      `::warning::[pr-base-sync] ${why}, but an alert issue could not be closed${closed}`,
    );
  } else if (recovery.action === "unread") {
    // A warning, not a red run: this sweep runs on every merge to main, its
    // alert is a P2, and the next sweep looks again. It must not say an alert
    // is open, because the lookup that would know failed.
    logger.log?.(
      `::warning::[pr-base-sync] ${why}, but the alert issues could not be read, so none was closed`,
    );
  }
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
  updateBranch,
  updateBranchTimeoutMs,
  queue = null,
}) {
  // An auto-merge PR was already read by assessAutoMergeQueue; reuse it,
  // including an unresolved mergeability (pr: null), which must not be polled
  // a second time and then read clean behind the slot's back.
  const assessed = queue?.assessed.get(number);
  const pr = assessed
    ? assessed.pr
    : await fetchPrWithMergeable({
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
    const wake = await postWakeComment({
      token,
      repo,
      number,
      body: buildConflictComment({ baseRef, baseSha, pr }),
      what: `CONFLICTS with ${baseRef}`,
      fetchImpl,
      logger,
    });
    return { number, verdict: "conflict", ...wake };
  };

  if (pr.mergeable === false) return postConflictComment();

  const behindBy =
    typeof assessed?.behindBy === "number"
      ? assessed.behindBy
      : await compareBehindBy({
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

  // Behind and clean. A fork head cannot be updated through the API from here,
  // and without a working app token an update would run no CI (see header).
  //
  // Every one of these still gets its per-PR wake, because the instruction in it
  // — merge `origin/main` yourself — is what unblocks THIS PR, and it is the
  // watching session's only signal that the base moved. What was noise was never
  // the wake; it was repeating a repo-level DIAGNOSIS ("no secret is configured")
  // on twenty PRs whose readers cannot act on it. So the diagnosis moves to one
  // alert issue, the wake stays, and `autoUpdateBlocked` marks the PR as evidence
  // for that issue rather than as a reason to say nothing.
  const isFork = pr.head?.repo?.full_name !== repo;
  let blockedDetail = null;
  const autoUpdateBlocked = (detail) => {
    blockedDetail = detail;
    return (
      "automatic base-branch updates are off for this repo right now — the cause " +
      "is diagnosed in the open `PR base sync cannot auto-update` issue"
    );
  };

  let reason = null;
  if (isFork) {
    reason = "the head branch lives in a fork, which this sweep cannot push to";
  } else if (!updateToken) {
    reason = autoUpdateBlocked(
      "the workflow minted no app token. Either `PR_BASE_SYNC_APP_CLIENT_ID` / " +
        "`PR_BASE_SYNC_APP_PRIVATE_KEY` are missing, or the mint step failed — " +
        "most often because the App is not installed on this repository, or was " +
        "installed without **Contents: Read and write** and **Pull requests: " +
        "Read and write** (the mint requests both and fails if either is absent)",
    );
  } else if (updateBranch.stoppedDetail) {
    logger.log?.(
      `[pr-base-sync] #${number}: behind by ${behindBy} — update-branch not attempted; ` +
        `it stalled to its deadline ${updateBranch.stalls} times in a row this sweep`,
    );
    reason = autoUpdateBlocked(updateBranch.stoppedDetail);
  } else {
    const result = await updatePrBranch({
      updateToken,
      repo,
      number,
      expectedHeadSha: pr.head?.sha,
      fetchImpl,
      timeoutMs: updateBranchTimeoutMs,
    });
    updateBranch.stalls = result.stalled ? updateBranch.stalls + 1 : 0;
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
    // A slot PR whose head moved under the call: a concurrent sweep (push and
    // slot sweeps run in separate groups) or a push already updated it. A
    // "merge main yourself" wake now would start a second CI racing that one.
    // Only that 422: any other failure takes the per-PR path below, and the slot
    // moves on.
    if (queue?.queued.includes(number) && isHeadMoved(result)) {
      logger.log?.(
        `[pr-base-sync] #${number}: head moved while taking the update slot (${result.error}) — no wake`,
      );
      return { number, verdict: "behind", action: "raced" };
    }
    // 403 is overloaded: it is what GitHub returns for a dead or under-permitted
    // token, and ALSO for a secondary rate limit — which a sequential twenty-push
    // sweep is exactly the shape to trip. Calling a rate limit a revoked token
    // would file a P2 accusing a credential that is fine, so the rate-limited
    // case skips fail-safe (the module's standing contract) and the next base
    // move re-sweeps. Only a non-rate-limited 401/403 is a token verdict.
    if (RATE_LIMITED.test(result.error)) {
      logger.log?.(
        `[pr-base-sync] #${number}: update-branch rate-limited (${result.error}) — skipping, fail safe`,
      );
      return { number, verdict: "unknown", action: "skipped" };
    }
    // Everything left splits into "this PR" and "this repo". A 422 is per-PR by
    // construction (`expected_head_sha` lost a race with a push, or a validation
    // failure), so it stays a plain per-PR reason; the update slot's head-moved
    // case returned above. A rejected token, a GitHub 5xx, or a transport
    // failure (`ghRequest` reports those as status 0) would hit every remaining
    // PR identically — those are the repo-level ones, and their diagnosis
    // belongs in the alert rather than repeated on twenty threads.
    if (result.status === 401 || result.status === 403) {
      reason = autoUpdateBlocked(`the app token was rejected (${result.error})`);
    } else if (!result.status || result.status >= 500) {
      const detail =
        `the update-branch API is failing (${result.error}) — a GitHub incident ` +
        "or a network fault, not this PR";
      reason = autoUpdateBlocked(detail);
      if (updateBranch.stalls >= UPDATE_BRANCH_STALLS_BEFORE_STOP) {
        updateBranch.stoppedDetail = detail;
      }
    } else {
      reason = `the update-branch call failed (${result.error})`;
    }
  }

  const wake = await postWakeComment({
    token,
    repo,
    number,
    body: buildBehindComment({ baseRef, baseSha, pr, reason }),
    what: `behind by ${behindBy}, not auto-updated (${reason})`,
    fetchImpl,
    logger,
  });
  return {
    number,
    verdict: "behind",
    ...wake,
    ...(blockedDetail ? { blockedDetail } : {}),
  };
}

/**
 * Posts one PR's wake comment and says whether it landed.
 *
 * The comment is the only signal that reaches the session watching a conflicted
 * PR (the PR-activity webhook is silent on merge conflicts), so a failed post
 * is loud: a `::warning::` annotation on the run, carrying GitHub's status and
 * message, and `action: "comment-failed"` instead of `"commented"` (#3019).
 *
 * Deliberately not a red run, for the reason in this file's header: a
 * watchdog that reds CI creates the noise it exists to remove, and this one
 * runs on every push to `main`, so its red mark would sit on `main`'s commit.
 * Not the alert issue either: that issue's identity and body are the app
 * token's (one repo-wide cause, closed by a working update), and a failed post
 * can be per-PR (a locked thread). The annotation is on the run's summary, the
 * next push to `main` retries the post, and the warning's status says whether
 * the cause is repo-wide. If posts keep failing for one repo-wide reason, that
 * is the case for a second alert identity.
 */
async function postWakeComment({ token, repo, number, body, what, fetchImpl, logger }) {
  const { posted, status, error } = await upsertWakeComment({
    token,
    repo,
    prNumber: number,
    marker: BASE_SYNC_MARKER,
    body,
    fetchImpl,
  });
  if (posted) {
    logger.log?.(`[pr-base-sync] #${number}: ${what} — wake comment posted`);
    return { action: "commented" };
  }
  logger.log?.(
    warningAnnotation(
      `[pr-base-sync] #${number}: ${what} — wake comment FAILED ` +
        `(${describeWakeFailure({ status, error })}); the session watching this PR was not woken`,
    ),
  );
  return { action: "comment-failed", status };
}

// ── CLI entry ───────────────────────────────────────────────────────────────

/**
 * A CI completion or the schedule only advances the slot; a push is a base move.
 * The workflow has no other trigger. A completion read as a push would post
 * wakes and update every behind PR on every CI run, so the mapping is tested.
 */
export function sweepModeFor(eventName) {
  return eventName === "workflow_run" || eventName === "schedule" ? "checks" : "push";
}

async function main() {
  const token = requireEnv("GITHUB_TOKEN");
  const repo = requireEnv("GITHUB_REPOSITORY");
  const baseRef = requireEnv("GITHUB_REF_NAME");
  const baseSha = requireEnv("GITHUB_SHA");
  const updateToken = process.env.PR_BASE_SYNC_TOKEN || null;
  // A CI completion runs on the default branch's ref and tip, so baseRef and
  // baseSha still name `main`; only what the sweep may do changes.
  const mode = sweepModeFor(process.env.GITHUB_EVENT_NAME);
  await processBaseMove({ token, updateToken, repo, baseRef, baseSha, mode });
}

if (isInvokedDirectly(import.meta.url)) {
  main().catch((error) => {
    console.error(`Unhandled error: ${error.stack ?? error.message}`);
    process.exit(1);
  });
}
