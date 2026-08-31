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
// ── The deployable-window bug this closes ───────────────────────────────────
// `ALL_REQUIRED_CHECKS` is TODAY's list, and it is asked of a commit from any
// point in the past. A check run cannot exist on a commit whose tree did not
// define the job that emits it — so every time a check is ADDED to that array,
// every commit older than the job's introduction silently becomes undeployable
// with "never reported: <new-check>".
//
// That is not theoretical and it is not new. `web-production-build` (#1374) did
// it, and adding `migration-order` would have done it again. The failure lands
// on the one operation that matters most when something is wrong:
// `DB_ROLLBACK_PLAYBOOK.md` recovery is "redeploy the API at the pre-<X>
// revision", i.e. deploying an OLDER commit — the exact thing a growing
// required-check list makes impossible, and it fails at the moment you can
// least afford to debug a gate.
//
// So the expected set is intersected with the jobs the deployed commit's own
// workflows define (`jobIdsAtRef`). A check the tree never defined is reported
// as NOT APPLICABLE rather than missing. The extraction is a deliberate
// SUPERSET of job ids — it matches any two-space-indented YAML key, the same
// approximation `scripts/check-doc-tables.mjs` makes — because erring toward
// "defined" keeps a real gate fatal, while erring the other way would excuse
// one. A check whose job IS in the tree and did not report stays fatal.
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

/**
 * `cancelled` is NOT accepted — a cancelled check asserted nothing — but it is
 * reported apart from a genuine failure, because the remedy is different and an
 * operator mid-rollback should not have to guess it.
 *
 * How a merge commit on `main` used to end up with cancelled required checks:
 * `ci.yml`, `docs.yml`, `links.yml` and `migration-drift-gate.yml` each carried
 * `group: <name>-${{ github.ref }}` with `cancel-in-progress: true`, and
 * `github.ref` is `refs/heads/main` for EVERY push to main. Two merges a few
 * minutes apart — routine here — put both push runs in one group, so the first
 * commit's run is cancelled by the second's. Its checks conclude `cancelled`,
 * and nothing re-runs them.
 *
 * All four now guard it with `cancel-in-progress: ${{ github.ref !=
 * 'refs/heads/main' }}` (#1378 for migration-drift-gate, #1379 for the rest), so
 * main push runs no longer cancel each other. This classification still earns
 * its place: commits merged BEFORE that fix keep their cancelled runs, and a run
 * can still be cancelled by a manual stop, a timeout, or a `stale` conclusion —
 * none of which the guard touches.
 *
 * That commit is then permanently undeployable: `jobIdsAtRef` cannot excuse it
 * (the run EXISTS, it is just cancelled), so it lands in `failing` and reads as
 * "CI is not green" — a red-tests message for a commit whose tests never ran.
 * It is the same "an older commit became undeployable" class the narrowing
 * above fixes, arriving through a different door, and it lands on the same
 * operation: DB_ROLLBACK_PLAYBOOK recovery is redeploying an older commit.
 *
 * Naming it is the fix that generalises. A cancelled run can be re-run from the
 * Actions UI for 30 days, which turns a dead end into one click.
 */
export const CANCELLED_CONCLUSIONS = new Set(["cancelled", "timed_out", "stale"]);

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
 * `defined` is the set of job ids the deployed commit's own workflows declare,
 * and `currentlyDefined` the set the TRUSTED ref declares. A required check is
 * excused only when it is absent from `defined` AND present in
 * `currentlyDefined` — i.e. it demonstrably exists now and demonstrably did not
 * exist then, which is what "this commit predates the gate" actually means.
 *
 * A check in NEITHER set is not an old commit, it is a roster naming a job that
 * exists nowhere — a stale `ALL_REQUIRED_CHECKS` entry, or a job renamed in the
 * workflows without updating it. Excusing that would silently drop a gate and
 * label the drop "this commit predates them", so it stays `missing`.
 *
 * Pass null for either to skip the narrowing; null is the conservative default.
 *
 * @param {{checkRuns: Array<object>, required: string[], defined?: Set<string>|null}} input
 */
export function classifyRequiredChecks({ checkRuns, required, defined = null, currentlyDefined = null }) {
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
  const cancelled = [];
  const notApplicable = [];

  for (const name of required) {
    const run = latestByName.get(name);
    if (!run) {
      // The check could not have run here: this commit's workflows do not
      // define the job that emits it, and the trusted ref's do. Only ever
      // reached when the run is also absent, so a job that exists at this
      // commit and DID report is classified on its conclusion exactly as
      // before.
      if (defined && !defined.has(name) && (!currentlyDefined || currentlyDefined.has(name))) {
        notApplicable.push(name);
        continue;
      }
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
    if (CANCELLED_CONCLUSIONS.has(run.conclusion)) {
      cancelled.push(`${name} (${run.conclusion})`);
      continue;
    }
    if (!ACCEPTED_CONCLUSIONS.has(run.conclusion)) {
      failing.push(`${name} (${run.conclusion ?? "no conclusion"})`);
    }
  }

  // The floor. Narrowing that excuses EVERY required check has not found an old
  // commit — it has found a tree whose workflows this function could not read,
  // or a roster that matches nothing in them. Returning ok:true there would
  // deploy to production having verified no CI at all, which is strictly worse
  // than the "never reported" refusal this narrowing was added to soften.
  if (required.length > 0 && notApplicable.length === required.length) {
    return {
      missing: [...notApplicable],
      pending,
      failing,
      cancelled,
      notApplicable: [],
      ok: false,
      exhausted: true,
    };
  }

  return {
    missing,
    pending,
    failing,
    cancelled,
    notApplicable,
    exhausted: false,
    ok: !missing.length && !pending.length && !failing.length && !cancelled.length,
  };
}

/** Human-readable reason a commit is not deployable, or null when it is. */
export function describeCheckFailure({ missing, pending, failing, cancelled = [] }) {
  const parts = [];
  if (failing.length) parts.push(`failed: ${failing.join(", ")}`);
  if (pending.length) parts.push(`still running: ${pending.join(", ")}`);
  if (missing.length) parts.push(`never reported: ${missing.join(", ")}`);
  // Carries its own remedy: these did not fail, they were superseded, and a
  // re-run of that workflow run makes the commit deployable again.
  if (cancelled.length) {
    parts.push(
      `cancelled — re-run the workflow run for this commit from the Actions UI, ` +
        `then retry: ${cancelled.join(", ")}`,
    );
  }
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

/**
 * Every job id defined by the workflows in the tree at `ref`.
 *
 * A check-run's name is its job id in this repo (the convention
 * `check-doc-tables.mjs` also relies on), so this answers "could this commit
 * have produced a check run called X at all?".
 *
 * Returns null when the workflow directory cannot be read at that ref. Null
 * means "do not narrow anything" — every required check stays expected, which
 * is the conservative answer. A silent empty Set would excuse the entire
 * required list, which is the one outcome this function must never produce.
 */
export function jobIdsAtRef({ ref, git = defaultGit }) {
  let listing;
  try {
    listing = git(["ls-tree", "-r", "--name-only", ref, "--", ".github/workflows"]);
  } catch {
    return null;
  }

  const files = listing
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /\.ya?ml$/.test(line));
  if (files.length === 0) return null;

  const ids = new Set();
  for (const file of files) {
    let text;
    try {
      text = git(["show", `${ref}:${file}`]);
    } catch {
      continue;
    }
    for (const match of text.matchAll(/^  ([a-zA-Z0-9_-]+):$/gm)) ids.add(match[1]);
  }
  return ids.size > 0 ? ids : null;
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

  // Narrowed to the checks this commit's own workflows could have produced —
  // and only for checks the trusted ref still defines, so a stale roster entry
  // cannot excuse itself.
  const defined = jobIdsAtRef({ ref: sha, git });
  const currentlyDefined = jobIdsAtRef({ ref: mainRef, git });
  const verdict = classifyRequiredChecks({ checkRuns, required, defined, currentlyDefined });
  const failure = describeCheckFailure(verdict);
  if (failure) {
    if (verdict.exhausted) {
      return {
        ok: false,
        reason:
          `Not one of the ${required.length} required checks could be matched against ${sha}. ` +
          `That is not an old commit — it is a tree whose workflows could not be read, or a ` +
          `required-check roster that names nothing they define. Refusing to deploy a commit ` +
          `with no CI evidence at all.`,
      };
    }
    return { ok: false, reason: `CI is not green on ${sha} — ${failure}` };
  }

  if (verdict.notApplicable.length > 0) {
    // Said out loud, never silently. Deploying a commit predating a gate means
    // that gate never judged what is about to ship, and an operator rolling
    // back deserves to know which ones.
    logger.log?.(
      `ℹ️  ${verdict.notApplicable.length} required check(s) did not exist at ${sha} and were ` +
        `not required of it: ${verdict.notApplicable.join(", ")}. This commit predates them, so ` +
        `they never judged it.`,
    );
  }
  logger.log?.(
    `✅ All ${required.length - verdict.notApplicable.length} applicable required checks passed on ${sha}.`,
  );
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
