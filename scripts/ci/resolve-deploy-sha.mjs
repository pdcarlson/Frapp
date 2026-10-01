#!/usr/bin/env node

// Choose the commit a production deploy ships when its `sha` input is empty
// (#3114): the newest commit on `main` whose required checks passed AND whose
// Deploy staging run succeeded, newer than what production runs now.
//
// A pasted SHA never comes through here. This script only picks the commit;
// `validate-deploy-sha.mjs` then validates the pick exactly as it validates a
// pasted one, in the next step of the same unscoped `validate` job. "Green" is
// that script's `validateDeploySha`, imported rather than restated: the same
// `ALL_REQUIRED_CHECKS` roster, the same narrowing to the jobs the commit's own
// workflows define, the same refusal of cancelled and missing checks.
//
// The pick, its subject, and every newer commit it skipped (with the reason)
// go to the step summary, which exists before GitHub asks anyone to approve the
// `production` environment. That is #1340's rule, the artifact is named before
// anything ships, kept for a commit nobody pasted.
//
// ── The floor: never resolve a rollback ─────────────────────────────────────
// Candidates are the commits newer than the newest `v*` tag, found the way
// `release.yml` finds it (`git tag --list 'v*' --sort=-version:refname`, not
// `git describe`: `v0.1.0`–`v0.6.0` sit on history that is not an ancestor of
// `main`). A tag means "this is what is live", so a commit at or behind it
// would roll production back, and an empty input must never do that. When the
// newest tag is not an ancestor of `main`, the range "newer than the tag"
// means nothing, and when there is no tag at all nothing says what production
// runs. Both refuse: paste a SHA. One case still gets past the floor, a live
// ship whose tag failed. Production then runs a commit newer than its newest
// tag, `deploy-outcome` and `production-release-pin.yml` both go red, and the
// summary names the floor so the approver can see it.
//
// ── Matching a Deploy staging run to its commit ─────────────────────────────
// Deploy staging runs on `workflow_run`, and such a run's `head_sha` is
// `main`'s tip when it fired, NOT the commit CI verified and the run deployed:
// run 36855311019 reports `93ae125` and deployed `9907e7e` (its CI finished at
// 11:25:47Z, the run was created at 11:25:49Z). Its jobs and its `staging`
// deployment record say `93ae125` too. So `deploy-staging.yml` puts the
// deployed commit in its `run-name`, and this reads it back out of the run's
// `display_title` (`stagingRunSha`). Runs from before that `run-name` carry no
// SHA, so their commits read as having no run: the walk goes newest first, so
// that only matters until the first deploy after it merged.
//
// ── What "staging succeeded" means ──────────────────────────────────────────
// The newest Deploy staging run naming the commit concluded `success`.
//   * When GitHub replaces a run's deploy job while it is still queued
//     (`_deploy.yml`'s concurrency note), the job ends `cancelled` and
//     `deploy-outcome` reports that as a failure, so the run doesn't succeed
//     and its commit is skipped, with the run's link. The newer run that
//     replaced it carries its changes, and the walk, newest first, normally
//     reaches that newer commit before this one.
//   * A `stale` or `current` success counts, though a `stale` run deployed no
//     API for its own commit: the plan verdict is a job output, which the
//     runs API doesn't return, so this can't tell those runs apart.
//   * The newest run wins over an older green one, as the newest check run
//     wins in `classifyRequiredChecks`.
//
// Unit tests: `scripts/ci/__tests__/resolve-deploy-sha.test.mjs`.

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

import { ALL_REQUIRED_CHECKS } from "./lib/required-checks.mjs";
import { requireEnv } from "./lib/env.mjs";
import { ghRequest } from "./lib/github.mjs";
import { isInvokedDirectly } from "./lib/invoked-directly.mjs";
import { isFullSha, validateDeploySha } from "./validate-deploy-sha.mjs";

/** The workflow file whose runs say which commits reached staging. */
export const STAGING_WORKFLOW_FILE = "deploy-staging.yml";

/** How many commits above the floor the walk reads before it gives up. */
export const MAX_CANDIDATES = 50;

/** The tags `release.yml` mints, and nothing else that starts with `v`. */
const RELEASE_TAG = /^v\d+\.\d+\.\d+$/;

// One 40-hex token, standing alone, anywhere in the title. The wording around
// it can change without breaking this; losing the SHA cannot, because every
// commit then reads as having no run and the resolver refuses.
const TITLE_SHA = /(?:^|\s)([0-9a-f]{40})(?=\s|$)/;

const short = (sha) => sha.slice(0, 12);

function defaultGit(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: "pipe" });
}

/** The commit a Deploy staging run deployed, read from its title, or null. */
export function stagingRunSha(run) {
  const match = typeof run?.display_title === "string" ? TITLE_SHA.exec(run.display_title) : null;
  return match ? match[1] : null;
}

/**
 * The newest Deploy staging run per deployed commit. Run ids only grow, so
 * the highest id is the newest run (a re-run keeps its id and reports its
 * latest attempt).
 *
 * A `skipped` run is left out: its jobs never ran, because the CI run behind
 * it wasn't a successful push to `main`. Either CI failed, which the commit's
 * own required checks report, or it was a fork's pull request from a branch
 * named `main`, which `branches: [main]` lets through and whose title can name
 * any commit. Counted, the fork's run would shadow the real one.
 */
export function indexStagingRuns(runs) {
  const byCommit = new Map();
  for (const run of Array.isArray(runs) ? runs : []) {
    const sha = stagingRunSha(run);
    if (!sha || run.conclusion === "skipped") continue;
    const previous = byCommit.get(sha);
    if (!previous || Number(run.id) > Number(previous.id)) byCommit.set(sha, run);
  }
  return byCommit;
}

/** Why a commit's staging run disqualifies it, or null when it succeeded. */
export function stagingVerdict(run) {
  if (!run) return null;
  const where = run.html_url ? ` (${run.html_url})` : "";
  if (run.status !== "completed") return `its Deploy staging run is still ${run.status}${where}`;
  if (run.conclusion === "success") return null;
  const hint = run.conclusion === "cancelled" ? ": someone stopped it, or GitHub replaced it while it was queued" : "";
  return `its Deploy staging run concluded ${run.conclusion ?? "with no conclusion"}${where}${hint}`;
}

/**
 * The newest `v*` release tag and its commit, the way `release.yml` finds the
 * last tag. `{tag: null}` when there is none.
 */
export function newestReleaseTag({ git = defaultGit }) {
  const listing = git(["tag", "--list", "v*", "--sort=-version:refname"]);
  const tag = listing
    .split("\n")
    .map((line) => line.trim())
    .find((name) => RELEASE_TAG.test(name));
  if (!tag) return { tag: null, sha: null };
  return { tag, sha: git(["rev-parse", `${tag}^{commit}`]).trim() };
}

/**
 * `main`'s first-parent commits newer than `floorSha`, newest first, at most
 * `limit` of them. Each is `{sha, date, subject}`.
 */
export function commitsAbove({ mainRef, floorSha, limit, git = defaultGit }) {
  const out = git([
    "log",
    "--first-parent",
    `--max-count=${limit}`,
    "--format=%H%x09%cI%x09%s",
    mainRef,
    `^${floorSha}`,
  ]);
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, date, ...subject] = line.split("\t");
      return { sha, date, subject: subject.join("\t") };
    });
}

/**
 * Every Deploy staging run on `main` created since `since`, following
 * pagination. An unreadable page throws: "could not tell" must not resolve.
 */
export async function fetchStagingRuns({ repo, token, since, fetchImpl = fetch, maxPages = 10, retryOptions }) {
  const runs = [];
  const created = since ? `&created=${encodeURIComponent(`>=${since}`)}` : "";
  for (let page = 1; page <= maxPages; page += 1) {
    const result = await ghRequest({
      token,
      fetchImpl,
      path:
        `/repos/${repo}/actions/workflows/${STAGING_WORKFLOW_FILE}/runs` +
        `?branch=main&event=workflow_run&per_page=100&page=${page}${created}`,
      retry: true,
      retryOptions,
    });
    if (!result.ok) {
      const detail = result.data ? `: ${typeof result.data === "string" ? result.data : JSON.stringify(result.data)}` : "";
      throw new Error(`GitHub Actions API returned HTTP ${result.status} listing Deploy staging runs${detail}`);
    }
    if (!Array.isArray(result.data?.workflow_runs)) {
      throw new Error(`GitHub Actions API returned an unexpected payload listing Deploy staging runs (page ${page})`);
    }
    const batch = result.data.workflow_runs;
    runs.push(...batch);
    if (batch.length < 100) break;
  }
  return runs;
}

/**
 * The whole resolution. Returns `{ok, sha, subject, stagingRun, floor,
 * skipped, truncated, limit}` on success, or `{ok: false, reason, floor,
 * skipped}` (plus `truncated` and `limit` once the walk ran).
 * `validate` is `validateDeploySha`; tests swap it.
 */
export async function resolveDeploySha({
  repo,
  token,
  mainRef = "origin/main",
  required = ALL_REQUIRED_CHECKS,
  limit = MAX_CANDIDATES,
  git = defaultGit,
  fetchImpl = fetch,
  retryOptions,
  validate = validateDeploySha,
}) {
  const floor = newestReleaseTag({ git });
  if (!floor.tag) {
    return {
      ok: false,
      reason:
        "No vX.Y.Z tag in this checkout, so nothing says what production runs, and an empty `sha` " +
        "could resolve to a rollback. Paste the SHA to deploy.",
      floor,
      skipped: [],
    };
  }
  try {
    git(["merge-base", "--is-ancestor", floor.sha, mainRef]);
  } catch {
    return {
      ok: false,
      reason:
        `Production's newest tag ${floor.tag} (${short(floor.sha)}) is not an ancestor of ${mainRef}, so ` +
        `"newer than production" has no meaning on main. Paste the SHA to deploy.`,
      floor,
      skipped: [],
    };
  }

  // One more than the limit, to know whether there were more.
  const listed = commitsAbove({ mainRef, floorSha: floor.sha, limit: limit + 1, git });
  const truncated = listed.length > limit;
  const candidates = listed.slice(0, limit);
  if (candidates.length === 0) {
    return {
      ok: false,
      reason: `${mainRef} has nothing newer than production's ${floor.tag} (${short(floor.sha)}). Nothing to deploy.`,
      floor,
      skipped: [],
    };
  }

  // A run can't be created before the commit it deploys was committed. A day of
  // margin covers committer-clock skew; reading too far back costs only pages.
  const oldest = Date.parse(candidates[candidates.length - 1].date);
  const since = Number.isNaN(oldest) ? null : new Date(oldest - 24 * 60 * 60 * 1000).toISOString();
  let stagingRuns;
  try {
    stagingRuns = indexStagingRuns(await fetchStagingRuns({ repo, token, since, fetchImpl, retryOptions }));
  } catch (error) {
    return { ok: false, reason: `Could not read Deploy staging runs: ${error.message}`, floor, skipped: [] };
  }

  const quiet = { log: () => {} };
  const skipped = [];
  for (const commit of candidates) {
    if (!isFullSha(commit.sha)) {
      skipped.push({ ...commit, reason: "git returned something that is not a full SHA" });
      continue;
    }
    const run = stagingRuns.get(commit.sha);
    const staging = stagingVerdict(run);
    // A staging run that exists and isn't green settles it, with no API call.
    if (staging) {
      skipped.push({ ...commit, reason: staging });
      continue;
    }
    // With no run at all, CI says more: usually it is still running.
    const ci = await validate({ sha: commit.sha, repo, token, mainRef, required, git, fetchImpl, retryOptions, logger: quiet });
    if (!ci.ok) {
      skipped.push({ ...commit, reason: ci.reason });
      continue;
    }
    if (!run) {
      skipped.push({
        ...commit,
        reason:
          "its required checks are green, but no Deploy staging run names it: the run starts when CI on " +
          "main completes, and runs from before #3114 carry no SHA in their title",
      });
      continue;
    }
    return { ok: true, sha: commit.sha, subject: commit.subject, stagingRun: run, floor, skipped, truncated, limit };
  }

  const scope = truncated
    ? `the newest ${limit} commits above production's ${floor.tag} (older ones were not read)`
    : `the ${candidates.length} commit${candidates.length === 1 ? "" : "s"} above production's ${floor.tag}`;
  return {
    ok: false,
    reason:
      `None of ${scope} has both green required checks and a successful Deploy staging run. ` +
      `The summary lists why each was skipped. To deploy one anyway, paste its SHA.`,
    floor,
    skipped,
    truncated,
    limit,
  };
}

// ── Step summary ────────────────────────────────────────────────────────────

const cell = (text) => String(text ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

/** The markdown the approver reads before approving. */
export function renderSummary(result) {
  const lines = [];
  if (result.ok) {
    lines.push(`### Newest green \`main\` commit: \`${result.sha}\``, "");
    lines.push(
      "> `sha` was left empty, so this run picked the commit. To ship exactly this one later (the real",
      "> run after this dry run, say), paste it into `sha`: an empty `sha` picks again, and `main` may",
      "> have moved.",
      "",
      "| | |",
      "| --- | --- |",
      `| Commit | \`${result.sha}\` ${cell(result.subject)} |`,
      `| Deploy staging | [run ${result.stagingRun.id}](${result.stagingRun.html_url}) succeeded |`,
      "| Required checks | green; the next step checks them again, as it does a pasted SHA |",
      `| Production now | \`${result.floor.tag}\` (\`${short(result.floor.sha)}\`); only newer commits were candidates |`,
      "",
    );
  } else {
    lines.push("### No commit resolved: production was NOT deployed", "", `> ${result.reason}`, "");
  }
  if (result.skipped.length > 0) {
    lines.push(
      result.ok ? "Skipped, newer than the commit above:" : "Skipped:",
      "",
      "| Commit | Subject | Why |",
      "| --- | --- | --- |",
      ...result.skipped.map((c) => `| \`${short(c.sha)}\` | ${cell(c.subject)} | ${cell(c.reason)} |`),
      "",
    );
  } else if (result.ok) {
    lines.push("It is `main`'s tip: nothing newer was skipped.", "");
  }
  if (result.truncated) lines.push(`Only the newest ${result.limit} commits above the tag were read.`, "");
  return lines.join("\n");
}

// ── CLI entry ───────────────────────────────────────────────────────────────

async function main() {
  const result = await resolveDeploySha({
    repo: requireEnv("GITHUB_REPOSITORY"),
    token: requireEnv("GITHUB_TOKEN"),
    mainRef: process.env.DEPLOY_MAIN_REF ?? "origin/main",
  });

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) appendFileSync(summaryPath, `${renderSummary(result)}\n`);

  for (const commit of result.skipped) console.log(`⏭️  ${short(commit.sha)} ${commit.subject}: ${commit.reason}`);
  if (!result.ok) {
    console.error(`::error::${result.reason}`);
    process.exit(1);
  }
  console.log(`✅ Resolved ${result.sha} (${result.subject}), Deploy staging run ${result.stagingRun.html_url}.`);
  appendFileSync(requireEnv("GITHUB_OUTPUT"), `sha=${result.sha}\n`);
}

if (isInvokedDirectly(import.meta.url)) {
  main().catch((error) => {
    console.error(`Unhandled error: ${error.stack ?? error.message}`);
    process.exit(1);
  });
}
