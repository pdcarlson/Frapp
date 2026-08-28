#!/usr/bin/env node

// Gate on the commit a production deploy names.
//
// Retiring the `production` branch removed two protections at once, and this
// script is where both of them come back:
//
//   * Branch protection meant only `main` could open a PR into `production`
//     (`ci.yml`'s `branch-policy` job enforced the head). A `workflow_dispatch`
//     takes a raw SHA, so a commit from an unmerged branch, a fork, or an
//     orphaned force-push is spellable. `git merge-base --is-ancestor` is the
//     replacement.
//   * Branch protection also required a list of status checks to be green
//     before the merge. A dispatch has no PR and therefore no required checks,
//     so this asks the checks API directly, against the same
//     `ALL_REQUIRED_CHECKS` list `configure-branch-protection.mjs` writes to
//     GitHub. Importing that list rather than restating it is deliberate: two
//     copies drift, and the copy that drifts is the one nobody reads.
//
// Both assertions are fatal. "Could not tell" is never a pass — an unreadable
// checks API fails the deploy, for the same reason `check-migration-drift.mjs`
// refuses to treat an unreachable database as clean.
//
// Semantics are the pure functions below. Unit tests:
// `scripts/ci/__tests__/validate-deploy-sha.test.mjs`.

import { execFileSync } from "node:child_process";

import { ALL_REQUIRED_CHECKS } from "../configure-branch-protection.mjs";

export const SHA_PATTERN = /^[0-9a-f]{40}$/;

// GitHub counts all three as satisfying a required check, and so does branch
// protection. `skipped` is the load-bearing one: this repo path-gates several
// required jobs with a job-level `if:`, and a job skipped that way reports
// Success. See the long note in `configure-branch-protection.mjs`.
export const ACCEPTED_CONCLUSIONS = new Set(["success", "skipped", "neutral"]);

const CHECK_RUNS_URL = (repo, sha, page) =>
  `https://api.github.com/repos/${repo}/commits/${sha}/check-runs?per_page=100&page=${page}`;

/**
 * A 40-character lowercase hex string and nothing else.
 *
 * Called before the SHA reaches `git`, which is what makes the `execFileSync`
 * calls below safe by construction rather than by argument-array hygiene alone.
 * An abbreviated SHA is rejected on purpose: `git` would happily resolve it,
 * and a deploy record that says `a1b2c3d` cannot be matched against a Render
 * `commitId` or a Vercel `meta.githubCommitSha` later.
 */
export function isFullSha(value) {
  return typeof value === "string" && SHA_PATTERN.test(value);
}

function startedAt(run) {
  const value = run?.started_at ?? run?.completed_at;
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Which of `required` are missing, still running, or failed on this commit.
 *
 * A name can appear more than once (a re-run creates a second check run with
 * the same name), so the most recently started run wins. Taking "any run
 * succeeded" instead would let a green first attempt mask a red re-run.
 *
 * @param {{checkRuns: Array<object>, required: string[]}} input
 */
export function classifyRequiredChecks({ checkRuns, required }) {
  const latestByName = new Map();
  for (const run of Array.isArray(checkRuns) ? checkRuns : []) {
    const name = run?.name;
    if (typeof name !== "string" || name === "") continue;
    const previous = latestByName.get(name);
    if (!previous || startedAt(run) >= startedAt(previous)) {
      latestByName.set(name, run);
    }
  }

  const missing = [];
  const pending = [];
  const failing = [];

  for (const name of required) {
    const run = latestByName.get(name);
    if (!run) {
      // Absent is NOT "nothing to worry about". A required check that never
      // reported is exactly the shape of the hole this repo has been closing
      // all year: the workflow was skipped by a branch/path filter, so nothing
      // ever asserted anything, and the absence read as silence rather than
      // failure.
      missing.push(name);
      continue;
    }
    if (run.status !== "completed") {
      pending.push(`${name} (${run.status})`);
      continue;
    }
    if (!ACCEPTED_CONCLUSIONS.has(run.conclusion)) {
      failing.push(`${name} (${run.conclusion ?? "no conclusion"})`);
    }
  }

  return { missing, pending, failing, ok: !missing.length && !pending.length && !failing.length };
}

/** Human-readable reason a commit is not deployable, or null when it is. */
export function describeCheckFailure({ missing, pending, failing }) {
  const parts = [];
  if (failing.length) parts.push(`failed: ${failing.join(", ")}`);
  if (pending.length) parts.push(`still running: ${pending.join(", ")}`);
  if (missing.length) parts.push(`never reported: ${missing.join(", ")}`);
  return parts.length ? parts.join("; ") : null;
}

// ── Git assertions ──────────────────────────────────────────────────────────

function defaultGit(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: "pipe" });
}

/**
 * Is `sha` a real commit in this checkout, and is it an ancestor of `mainRef`?
 *
 * `--is-ancestor` exits 0 for yes and 1 for no, so a thrown error is the "no"
 * branch rather than an error to propagate. A SHA that resolves nowhere is
 * reported separately, because "not merged yet" and "not a commit at all" send
 * the operator to different places.
 *
 * @param {{sha: string, mainRef?: string, git?: (args: string[]) => string}} input
 */
export function checkAncestry({ sha, mainRef = "origin/main", git = defaultGit }) {
  try {
    git(["cat-file", "-e", `${sha}^{commit}`]);
  } catch {
    return { ok: false, reason: `${sha} is not a commit in this repository.` };
  }

  try {
    git(["merge-base", "--is-ancestor", sha, mainRef]);
  } catch {
    return {
      ok: false,
      reason:
        `${sha} is not an ancestor of ${mainRef}. Production deploys only ever ` +
        `ship commits that are already on main — merge it first.`,
    };
  }

  return { ok: true, reason: null };
}

// ── Checks API ──────────────────────────────────────────────────────────────

/**
 * Every check run recorded against `sha`, following pagination.
 *
 * Paginated rather than a single 100-item page because this repo emits well
 * over 20 check runs per commit today and the required list is ~20 of them; a
 * truncated page would silently classify the overflow as `missing`, turning a
 * green commit into a refused deploy (and, if the defaults were ever inverted,
 * the reverse).
 */
export async function fetchCheckRuns({ repo, sha, token, fetchImpl = fetch, maxPages = 10 }) {
  const runs = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const response = await fetchImpl(CHECK_RUNS_URL(repo, sha, page), {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok) {
      throw new Error(`GitHub checks API returned HTTP ${response.status} for ${sha}`);
    }
    const body = await response.json();
    const batch = Array.isArray(body?.check_runs) ? body.check_runs : [];
    runs.push(...batch);
    if (batch.length < 100) break;
  }
  return runs;
}

/**
 * The whole gate. Returns `{ok, reason}`; the CLI turns that into an exit code.
 */
export async function validateDeploySha({
  sha,
  repo,
  token,
  mainRef = "origin/main",
  required = ALL_REQUIRED_CHECKS,
  git = defaultGit,
  fetchImpl = fetch,
  logger = console,
}) {
  if (!isFullSha(sha)) {
    return {
      ok: false,
      reason: `'${sha}' is not a 40-character lowercase hex commit SHA. Paste the full SHA.`,
    };
  }

  const ancestry = checkAncestry({ sha, mainRef, git });
  if (!ancestry.ok) return { ok: false, reason: ancestry.reason };
  logger.log?.(`✅ ${sha} is an ancestor of ${mainRef}.`);

  let checkRuns;
  try {
    checkRuns = await fetchCheckRuns({ repo, sha, token, fetchImpl });
  } catch (error) {
    // Deliberately not a pass. An unreadable checks API means we do not know
    // whether CI was green, and "unknown" must not deploy.
    return { ok: false, reason: `Could not read CI status for ${sha}: ${error.message}` };
  }

  const verdict = classifyRequiredChecks({ checkRuns, required });
  const failure = describeCheckFailure(verdict);
  if (failure) {
    return { ok: false, reason: `CI is not green on ${sha} — ${failure}` };
  }

  logger.log?.(`✅ All ${required.length} required checks passed on ${sha}.`);
  return { ok: true, reason: null };
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
  const result = await validateDeploySha({
    sha: requireEnv("DEPLOY_SHA"),
    repo: requireEnv("GITHUB_REPOSITORY"),
    token: requireEnv("GITHUB_TOKEN"),
    mainRef: process.env.DEPLOY_MAIN_REF ?? "origin/main",
  });

  if (result.ok) process.exit(0);
  console.error(`::error::${result.reason}`);
  process.exit(1);
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`Unhandled error: ${error.stack ?? error.message}`);
    process.exit(1);
  });
}
