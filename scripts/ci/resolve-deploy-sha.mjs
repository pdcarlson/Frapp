#!/usr/bin/env node

// Choose the commit a production deploy ships when its `sha` input is empty
// (#3114): the newest commit on `main` whose required checks passed AND whose
// Deploy staging run deployed and verified it, newer than what production runs
// now.
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
// Candidates are the commits newer than production's latest release tag, by
// `lib/release-tag.mjs`'s rule, which is `release.yml`'s own (not `git
// describe`: `v0.1.0`–`v0.6.0` sit on history that is not an ancestor of
// `main`). A tag means "this is what is live", so a commit at or behind it
// would roll production back, and an empty input must never do that. No tag,
// a top tag that isn't `vX.Y.Z`, or one that isn't an ancestor of `main` all
// leave "newer than production" without a meaning, and all refuse: paste a
// SHA. One case still gets past the floor, a live ship whose tag failed.
// Production then runs a commit newer than its newest tag, `deploy-outcome`
// and `production-release-pin.yml` both go red, and the summary names the
// floor so the approver can see it.
//
// After a rollback the floor is no protection. Rolling production back to an
// older commit through Deploy production tags that commit with a higher
// version, so the latest release sits behind an earlier one on `main`, and
// every commit above it, the rolled-back change included, is a candidate
// again. Whether a revert has merged since is something only the operator
// knows, so the resolver refuses while any release on `main` is newer than
// production's (`releasesAhead`): paste the SHA. It clears once a ship past
// that release is tagged.
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
// ── What "staging succeeded" means (the canonical statement) ────────────────
// `docs/ops/database/promotion.md` links here for the exact rule, and states
// only what it means for an operator.
// In the newest Deploy staging run naming the commit, the `deploy` job
// succeeded AND its "Verify staging serves the commit" step passed. That step
// runs whenever the plan sets `verify_sha` (`plan-staging-deploy.mjs`), and
// checks that staging serves it, ready: this commit when the run deployed it
// (`deploy`, `forward`), or the commit staging already served when nothing the
// API image is built from changed since (`current`, and a `stale` plan that
// uploads the frontends). So a pass means staging's API carries this commit's.
// It says nothing about web and landing: a run can verify the API and skip the
// upload, when it can't read what a staging host serves, say (#3120). The
// run's conclusion alone would say less:
//   * A `stale` plan that uploads nothing sets no `verify_sha`, skips the step
//     and still concludes `success`, though its migrations apply. That covers
//     a run that couldn't tell what staging serves (the planner's `unsure`),
//     which verified nothing, so the commit doesn't count.
//   * `prune-vercel-staging` is a separate housekeeping job whose failure reds
//     the run without meaning the deploy failed, so it doesn't disqualify.
//   * When GitHub replaces the deploy job while it is still queued
//     (`_deploy.yml`'s concurrency note), the job ends `cancelled`, and the
//     commit is skipped with the run's link. The newer run that replaced it
//     carries its changes, and the walk, newest first, normally reaches that
//     newer commit before this one.
// "Newest" is the run whose latest attempt started last, as the newest check
// run wins in `classifyRequiredChecks`: a re-run keeps its id, so the id alone
// would let an older run's failed re-run hide behind a newer green run. The
// jobs are read for each run's latest attempt.
//
// Unit tests: `scripts/ci/__tests__/resolve-deploy-sha.test.mjs`.

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

import { ALL_REQUIRED_CHECKS } from "./lib/required-checks.mjs";
import { requireEnv } from "./lib/env.mjs";
import { ghRequest } from "./lib/github.mjs";
import { isInvokedDirectly } from "./lib/invoked-directly.mjs";
import { latestReleaseTag, RELEASE_TAG_PATTERN } from "./lib/release-tag.mjs";
import { isFullSha, validateDeploySha } from "./validate-deploy-sha.mjs";

/** The workflow file whose runs say which commits reached staging. */
export const STAGING_WORKFLOW_FILE = "deploy-staging.yml";

/**
 * The staging deploy job as the jobs API names it, `<caller job> / <called
 * job>`: `deploy-staging.yml`'s job `deploy` calls `_deploy.yml`'s job
 * `deploy`, neither with a `name:`. And that job's step that checks staging
 * serves the commit. `resolve-deploy-sha.test.mjs` pins all three against the
 * workflows: a rename would otherwise read as "not verified" on every commit.
 */
export const STAGING_CALLER_JOB = "deploy";
export const STAGING_DEPLOY_JOB = "deploy";
export const STAGING_VERIFY_STEP = "Verify staging serves the commit";
const DEPLOY_JOB_NAME = `${STAGING_CALLER_JOB} / ${STAGING_DEPLOY_JOB}`;

/** How many commits above the floor the walk reads before it gives up. */
export const MAX_CANDIDATES = 50;

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

const attemptStarted = (run) => {
  const parsed = Date.parse(run?.run_started_at ?? run?.created_at ?? "");
  return Number.isNaN(parsed) ? 0 : parsed;
};

/**
 * The newest Deploy staging run per deployed commit: the one whose latest
 * attempt started last, ties to the higher id.
 *
 * A `skipped` run is left out. Its jobs never ran, because the CI run behind
 * it didn't succeed on a push to `main`, and the commit's own required checks
 * already say so.
 */
export function indexStagingRuns(runs) {
  const byCommit = new Map();
  for (const run of Array.isArray(runs) ? runs : []) {
    const sha = stagingRunSha(run);
    if (!sha || run.conclusion === "skipped") continue;
    const previous = byCommit.get(sha);
    const newer =
      !previous ||
      attemptStarted(run) > attemptStarted(previous) ||
      (attemptStarted(run) === attemptStarted(previous) && Number(run.id) > Number(previous.id));
    if (newer) byCommit.set(sha, run);
  }
  return byCommit;
}

/**
 * Why a commit's staging run doesn't show staging deployed and verified it,
 * or null when it does. `jobs` is the run's latest-attempt jobs listing.
 */
export function stagingVerdict(run, jobs) {
  const where = run.html_url ? ` (${run.html_url})` : "";
  const deployJobs = (Array.isArray(jobs) ? jobs : []).filter((job) => job?.name === DEPLOY_JOB_NAME);
  if (deployJobs.length !== 1) {
    if (run.status !== "completed") return `its Deploy staging run is still ${run.status}${where}`;
    return `its Deploy staging run lists ${deployJobs.length} \`${DEPLOY_JOB_NAME}\` jobs, not one${where}`;
  }
  const [job] = deployJobs;
  if (job.status !== "completed") return `its Deploy staging deploy is still ${job.status}${where}`;
  if (job.conclusion !== "success") {
    const hint = job.conclusion === "cancelled" ? ": someone stopped it, or GitHub replaced it while it was queued" : "";
    return `its Deploy staging deploy concluded ${job.conclusion ?? "with no conclusion"}${where}${hint}`;
  }
  const verify = (Array.isArray(job.steps) ? job.steps : []).find((step) => step?.name === STAGING_VERIFY_STEP);
  if (!verify) return `its Deploy staging deploy has no "${STAGING_VERIFY_STEP}" step, so nothing shows staging serves it${where}`;
  if (verify.conclusion === "skipped") {
    return (
      `its Deploy staging run verified nothing${where} (plan \`stale\`: staging already served a newer ` +
      "commit, nothing it would ship changed, or it couldn't tell what staging serves)"
    );
  }
  if (verify.conclusion !== "success") return `its "${STAGING_VERIFY_STEP}" step concluded ${verify.conclusion}${where}`;
  return null;
}

/** The jobs of a run's latest attempt. An unreadable listing throws. */
export async function fetchRunJobs({ repo, token, runId, fetchImpl = fetch, retryOptions }) {
  const result = await ghRequest({
    token,
    fetchImpl,
    path: `/repos/${repo}/actions/runs/${runId}/jobs?filter=latest&per_page=100`,
    retry: true,
    retryOptions,
  });
  if (!result.ok || !Array.isArray(result.data?.jobs)) {
    throw new Error(`GitHub Actions API returned HTTP ${result.status} listing the jobs of run ${runId}`);
  }
  return result.data.jobs;
}

/** Production's latest release tag and its commit, or `{error}`. */
export function releaseFloor({ git = defaultGit }) {
  const latest = latestReleaseTag({ git });
  if (!latest.ok) return { tag: latest.tag, sha: null, error: latest.error };
  try {
    return { tag: latest.tag, sha: git(["rev-parse", `${latest.tag}^{commit}`]).trim(), error: null };
  } catch (error) {
    return { tag: latest.tag, sha: null, error: `${latest.tag} does not name a commit here: ${error.message}` };
  }
}

/**
 * The vX.Y.Z tags on `mainRef` whose commits are strictly newer than
 * `floorSha`: releases production has been rolled back behind. Empty in the
 * ordinary case, where the latest release is also the newest on `main`.
 */
export function releasesAhead({ floorSha, mainRef, git = defaultGit }) {
  const tags = git(["tag", "--list", "v*", "--contains", floorSha])
    .split("\n")
    .map((t) => t.trim())
    .filter((t) => RELEASE_TAG_PATTERN.test(t));
  return tags.filter((tag) => {
    const tagged = git(["rev-parse", `${tag}^{commit}`]).trim();
    if (tagged === floorSha) return false;
    try {
      git(["merge-base", "--is-ancestor", tagged, mainRef]);
      return true;
    } catch {
      return false;
    }
  });
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
  const floor = releaseFloor({ git });
  if (floor.error) {
    return {
      ok: false,
      reason:
        `Production's release tag is unknown (${floor.error}), so an empty \`sha\` could resolve to a ` +
        "rollback. Paste the SHA to deploy.",
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

  const ahead = releasesAhead({ floorSha: floor.sha, mainRef, git });
  if (ahead.length > 0) {
    return {
      ok: false,
      reason:
        `Production's ${floor.tag} (${short(floor.sha)}) is behind ${ahead.join(", ")} on ${mainRef}: production ` +
        "was rolled back. Main still holds what was rolled back unless a revert merged since, so an empty " +
        "`sha` won't choose. Paste the SHA to deploy.",
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
    // A staging run that exists and didn't deploy and verify it settles it.
    if (run) {
      let jobs;
      try {
        jobs = await fetchRunJobs({ repo, token, runId: run.id, fetchImpl, retryOptions });
      } catch (error) {
        return { ok: false, reason: `Could not read Deploy staging run ${run.id}: ${error.message}`, floor, skipped };
      }
      const staging = stagingVerdict(run, jobs);
      if (staging) {
        skipped.push({ ...commit, reason: staging });
        continue;
      }
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
      `None of ${scope} has both green required checks and a Deploy staging run that deployed and verified it. ` +
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
      `| Deploy staging | [run ${result.stagingRun.id}](${result.stagingRun.html_url}): "${STAGING_VERIFY_STEP}" passed, so staging's API carries this commit's (that run may have verified the commit staging already served, with the same API image). Web and landing aren't checked here: the run's own summary says whether it uploaded them |`,
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

/**
 * The step's whole job: resolve, write the summary, and on success write
 * `sha=` to `GITHUB_OUTPUT`, which `deploy-production.yml` reads as
 * `steps.resolve.outputs.sha`. Returns the exit code. Everything it touches is
 * injectable, so the test drives the real wiring offline.
 */
export async function runCli({ env = process.env, resolve = resolveDeploySha, append = appendFileSync, out = console } = {}) {
  const result = await resolve({
    repo: requireEnv("GITHUB_REPOSITORY", { env }),
    token: requireEnv("GITHUB_TOKEN", { env }),
    mainRef: env.DEPLOY_MAIN_REF ?? "origin/main",
  });

  if (env.GITHUB_STEP_SUMMARY) append(env.GITHUB_STEP_SUMMARY, `${renderSummary(result)}\n`);

  for (const commit of result.skipped) out.log(`⏭️  ${short(commit.sha)} ${commit.subject}: ${commit.reason}`);
  if (!result.ok) {
    out.error(`::error::${result.reason}`);
    return 1;
  }
  out.log(`✅ Resolved ${result.sha} (${result.subject}), Deploy staging run ${result.stagingRun.html_url}.`);
  append(requireEnv("GITHUB_OUTPUT", { env }), `sha=${result.sha}\n`);
  return 0;
}

if (isInvokedDirectly(import.meta.url)) {
  runCli()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`Unhandled error: ${error.stack ?? error.message}`);
      process.exit(1);
    });
}
