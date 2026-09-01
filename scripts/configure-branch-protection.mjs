#!/usr/bin/env node

/**
 * Configure branch protection rules for `main`.
 *
 * `main` is the only long-lived branch. `production` was retired in #1340 —
 * production is deployed from `main` by `.github/workflows/deploy-production.yml`,
 * a manual dispatch that names a commit. The asymmetric `production` payload
 * this script used to write (required approving review, required conversation
 * resolution, and the extra `branch-policy` required check) went with it:
 *
 *   * `branch-policy` enforced that a PR into `production` came from `main`.
 *     Its replacement is `scripts/ci/validate-deploy-sha.mjs`, which asserts
 *     `git merge-base --is-ancestor <sha> origin/main` before any deploy.
 *   * The required approving review was the human gate on promotion. That gate
 *     moved to the `production` GitHub ENVIRONMENT's Required reviewers, where
 *     it fires at the moment of deploy rather than at a PR opened before anyone
 *     knew whether the migration applied.
 *
 * Note this script does not DELETE protection rules, so removing the
 * `production` branch's rule after deleting the branch is a manual step.
 *
 * Usage:
 *   GITHUB_PAT=github_pat_xxx node scripts/configure-branch-protection.mjs
 *   GITHUB_PAT=github_pat_xxx node scripts/configure-branch-protection.mjs --dry-run
 *   GITHUB_PAT=github_pat_xxx node scripts/configure-branch-protection.mjs --verify
 *   GITHUB_PAT=github_pat_xxx node scripts/configure-branch-protection.mjs --repo owner/repo
 *
 * Every mode reads live protection first and prints a before/after diff; a run
 * that changes nothing says so. `--verify` reads and diffs but never writes, and
 * exits non-zero on any difference — that is the mode which turns "the rollout
 * step was run" into evidence rather than a claim.
 *
 * The token may also sit in `.env.local` or `.env` at the repo root instead of being
 * exported — see resolveToken(). An exported variable still wins over the file.
 *
 * The PAT needs "repo" scope for public repos or "admin:repo" for private repos.
 *
 * Required status checks map to emitted GitHub check-run names.
 */

import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadEnvFiles } from "./lib/env-file.mjs";
import { githubHeaders } from "./ci/lib/github.mjs";
import {
  ALL_REQUIRED_CHECKS,
  CI_CHECKS,
  DOCS_CHECKS,
  DRIFT_CHECKS,
} from "./ci/lib/required-checks.mjs";

// ── CLI argument parsing ────────────────────────────────────────────────────

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function resolveRepoSlug() {
  const explicit = getArg("--repo");
  if (explicit) return explicit;

  if (process.env.GITHUB_REPOSITORY) {
    return process.env.GITHUB_REPOSITORY;
  }

  const remoteUrl = execSync("git config --get remote.origin.url", {
    encoding: "utf8",
  }).trim();

  const httpsMatch = remoteUrl.match(/github\.com[:/](.+?)\/(.+?)(?:\.git)?$/);
  if (!httpsMatch) {
    throw new Error(
      `Unable to resolve GitHub repository slug from remote: ${remoteUrl}`,
    );
  }

  return `${httpsMatch[1]}/${httpsMatch[2]}`;
}

// Resolved from this file rather than `process.cwd()`, so the token is found the
// same way whether the script runs via `npm run configure:branch-protection`
// (cwd = repo root) or by path from some subdirectory.
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

function resolveToken() {
  const explicitTokenEnv = getArg("--token-env");
  if (explicitTokenEnv && process.env[explicitTokenEnv]) {
    return process.env[explicitTokenEnv];
  }

  return (
    process.env.GITHUB_PAT ||
    process.env.GITHUB_TOKEN ||
    process.env.GH_PAT ||
    process.env.GH_TOKEN
  );
}

// ── GitHub API ──────────────────────────────────────────────────────────────

async function callGitHubApi({ token, method, path, body, allow404 = false }) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: githubHeaders({ token, hasBody: Boolean(body) }),
    body: body ? JSON.stringify(body) : undefined,
  });

  // A branch with no protection rule at all answers 404, which is a legitimate
  // "before" state for the read-back below rather than an error. Only the
  // reader opts into it; the PUT still treats 404 as fatal.
  if (allow404 && response.status === 404) return null;

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${method} ${path} failed (${response.status}): ${text}`);
  }

  return response.json();
}

// ── Branch protection payloads ──────────────────────────────────────────────

function buildProtectionPayload(branch) {
  return {
    required_status_checks: {
      strict: true,
      contexts: ALL_REQUIRED_CHECKS,
    },
    enforce_admins: true,
    // No required approving review on `main`, which is unchanged from before
    // #1340 — this repo's human gate is the production deploy approval, not the
    // merge. See docs/internal/ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md.
    required_pull_request_reviews: null,
    restrictions: null,
    required_linear_history: true,
    allow_force_pushes: false,
    allow_deletions: false,
    block_creations: false,
    required_conversation_resolution: false,
    lock_branch: false,
    allow_fork_syncing: true,
  };
}

// ── Reading protection back ─────────────────────────────────────────────────
//
// Until #1383 this script had exactly one API call and exactly one method: PUT.
// It printed the payload it INTENDED to write, then `✅ configured` on any 2xx —
// so a run produced a checkmark rather than evidence, and nobody could tell an
// applied change from a no-op, or notice that live protection had drifted from
// the roster.
//
// The read is deliberately shaped as pure functions over plain objects, with the
// network confined to `callGitHubApi`, because the one thing that CANNOT be
// tested from an agent session is the call itself: `api.github.com` answers 403
// through the cloud-sandbox proxy to authenticated and unauthenticated requests
// alike (ADR-20, and #1385 exists because of it). Keeping the semantics in
// functions that take a response rather than fetch one is what makes the diff
// unit-testable despite that.
//
// The GET shape is NOT the PUT shape, which is the trap here. GitHub returns the
// booleans wrapped — `enforce_admins: {enabled: true}` — where the PUT takes them
// bare, and returns required checks as both a deprecated `contexts` array and a
// newer `checks: [{context, app_id}]`. `normalizeProtection` flattens either form,
// and is run over BOTH sides so the comparison is like-for-like.

const PROTECTION_FLAGS = [
  "enforce_admins",
  "required_linear_history",
  "allow_force_pushes",
  "allow_deletions",
  "block_creations",
  "required_conversation_resolution",
  "lock_branch",
  "allow_fork_syncing",
];

/** `true` / `false` / `{enabled: true}` / absent → a plain boolean. */
function toBool(value) {
  if (value && typeof value === "object") return Boolean(value.enabled);
  return Boolean(value);
}

/**
 * Flatten either the GET response or the PUT payload into one comparable shape.
 *
 * Returns null for a branch with no protection at all (the 404 case), which is
 * distinct from a protected branch whose settings happen to be all-false.
 */
export function normalizeProtection(raw) {
  if (!raw || typeof raw !== "object") return null;

  const rsc = raw.required_status_checks;
  let requiredStatusChecks = null;
  if (rsc && typeof rsc === "object") {
    // `contexts` is the deprecated form and `checks` the current one; GitHub
    // sends both on a GET. Prefer whichever is populated so this reads either.
    const contexts =
      Array.isArray(rsc.contexts) && rsc.contexts.length > 0
        ? rsc.contexts
        : Array.isArray(rsc.checks)
          ? rsc.checks.map((check) => check?.context)
          : [];
    requiredStatusChecks = {
      strict: Boolean(rsc.strict),
      contexts: contexts.filter((name) => typeof name === "string" && name !== ""),
    };
  }

  const normalized = { required_status_checks: requiredStatusChecks };
  for (const key of PROTECTION_FLAGS) normalized[key] = toBool(raw[key]);
  // These two are "configured or not" rather than booleans — this repo writes
  // null for both, and the only thing worth diffing is whether someone added one.
  normalized.required_pull_request_reviews = raw.required_pull_request_reviews ? true : false;
  normalized.restrictions = raw.restrictions ? true : false;
  return normalized;
}

/**
 * What a PUT of `desired` would actually change about `current`.
 *
 * Required checks are compared as sets and reported as added/removed rather than
 * as a whole-array replacement, because "this run adds `migration-order`" is the
 * sentence an operator needs and "contexts: [21 items] → [22 items]" is not.
 *
 * @param {{current: object|null, desired: object}} input
 */
export function diffProtection({ current, desired }) {
  const want = normalizeProtection(desired);
  const wantContexts = want?.required_status_checks?.contexts ?? [];

  if (current === null || current === undefined) {
    return {
      unprotected: true,
      changes: [{ field: "branch protection", from: "not configured", to: "configured" }],
      contextsAdded: [...wantContexts],
      contextsRemoved: [],
    };
  }

  const have = normalizeProtection(current);
  const haveContexts = have?.required_status_checks?.contexts ?? [];

  const contextsAdded = wantContexts.filter((name) => !haveContexts.includes(name));
  const contextsRemoved = haveContexts.filter((name) => !wantContexts.includes(name));

  const changes = [];
  const haveStrict = have?.required_status_checks?.strict ?? null;
  const wantStrict = want?.required_status_checks?.strict ?? null;
  if (haveStrict !== wantStrict) {
    changes.push({ field: "required_status_checks.strict", from: haveStrict, to: wantStrict });
  }
  for (const key of [...PROTECTION_FLAGS, "required_pull_request_reviews", "restrictions"]) {
    if (have[key] !== want[key]) changes.push({ field: key, from: have[key], to: want[key] });
  }

  return { unprotected: false, changes, contextsAdded, contextsRemoved };
}

/** Whether a diff represents any change at all. The no-op test. */
export function hasProtectionDrift(diff) {
  if (!diff) return false;
  return Boolean(
    diff.unprotected ||
      diff.changes.length > 0 ||
      diff.contextsAdded.length > 0 ||
      diff.contextsRemoved.length > 0,
  );
}

/** The diff as printable lines. Empty array means no drift. */
export function formatProtectionDiff(diff) {
  if (!hasProtectionDrift(diff)) return [];
  const lines = [];
  if (diff.unprotected) {
    lines.push("  ! branch has NO protection rule — this would create one from scratch");
  }
  for (const name of diff.contextsAdded) lines.push(`  + required check   ${name}`);
  for (const name of diff.contextsRemoved) lines.push(`  - required check   ${name}`);
  for (const change of diff.changes) {
    if (change.field === "branch protection") continue;
    lines.push(`  ~ ${change.field}: ${String(change.from)} -> ${String(change.to)}`);
  }
  return lines;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  // Loading the env files HERE — at the one entry point, before anything reads
  // `process.env` — rather than at module scope, which is the constraint the
  // entry guard at the bottom of this file exists for: importing this module
  // must not do anything, and mutating `process.env` on import is exactly such
  // a side effect, reaching every other module in the process.
  //
  // It has to precede `resolveRepoSlug()` and not merely sit next to the token
  // lookup. Both the slug (`GITHUB_REPOSITORY`) and the token are read from the
  // environment, so loading between them would honour a `.env` for one and
  // silently ignore it for the other — and the failure that hides is writing
  // branch protection to whatever `origin` happens to be rather than to the
  // repository the operator named.
  //
  // Anything already in the environment still wins over the files, so exporting
  // continues to override a checked-out `.env`.
  loadEnvFiles({ dir: REPO_ROOT });

  const repoSlug = resolveRepoSlug();
  const dryRun = hasFlag("--dry-run");
  // --verify reads and diffs but never writes, and exits non-zero on any
  // difference. That is what makes the rollout step evidenceable: a CI job or a
  // human can ask "is live protection what the repo says it should be?" and get
  // an answer with an exit code instead of a checkmark.
  const verify = hasFlag("--verify");
  const driftedBranches = [];
  const unconfirmedBranches = [];

  console.log(`Repository: ${repoSlug}`);
  console.log(`Mode: ${verify ? "VERIFY (read-only)" : dryRun ? "DRY RUN" : "LIVE"}`);
  console.log("");

  for (const branch of ["main"]) {
    const payload = buildProtectionPayload(branch);
    const checks = payload.required_status_checks.contexts;

    console.log(`Branch: ${branch}`);
    console.log(`  Required checks (${checks.length}):`);
    for (const check of checks) {
      console.log(`    - ${check}`);
    }
    console.log(`  Enforce admins: ${payload.enforce_admins}`);
    if (payload.required_pull_request_reviews) {
      console.log(`  Dismiss stale reviews: ${payload.required_pull_request_reviews.dismiss_stale_reviews}`);
      console.log(`  Required approving reviews: ${payload.required_pull_request_reviews.required_approving_review_count}`);
    } else {
      console.log("  Required approving reviews: disabled");
    }
    console.log(`  Linear history: ${payload.required_linear_history}`);
    console.log(`  Force pushes: ${payload.allow_force_pushes}`);
    console.log(`  Conversation resolution required: ${payload.required_conversation_resolution}`);
    console.log("");

    // ── Read back what is actually live ────────────────────────────────────
    // Every mode reads first, including --dry-run, because the question an
    // operator actually has is "what would this change?" and the intent dump
    // above cannot answer it.
    const token = resolveToken();
    if (!token && !dryRun) {
      throw new Error(
        "Missing GitHub token. Set GITHUB_PAT (or one of the aliases GITHUB_TOKEN, " +
          "GH_PAT, GH_TOKEN) in the environment, or put it in .env.local or .env at the repo root.",
      );
    }

    let current = null;
    let readFailure = null;
    if (token) {
      try {
        current = await callGitHubApi({
          token,
          method: "GET",
          path: `/repos/${repoSlug}/branches/${branch}/protection`,
          allow404: true,
        });
      } catch (error) {
        readFailure = error instanceof Error ? error.message : String(error);
      }
    } else {
      readFailure = "no token supplied, and --dry-run does not require one";
    }

    if (readFailure) {
      // Not fatal for a dry run or an apply — the PUT is still the operation
      // that matters and it reports its own status. It IS fatal for --verify,
      // whose entire contract is answering a question about live state: an
      // unreadable answer is not a passing one.
      console.log(`  Could not read current protection: ${readFailure}`);
      console.log("  No before/after diff is available for this run.");
      console.log("");
      if (verify) {
        throw new Error(
          `--verify cannot confirm ${branch}: live protection is unreadable (${readFailure}). ` +
            "From a cloud sandbox this is expected — api.github.com answers 403 through the " +
            "proxy to authenticated and unauthenticated requests alike (ADR-20). Run this from " +
            "a machine with direct network access.",
        );
      }
    } else {
      const diff = diffProtection({ current, desired: payload });
      const lines = formatProtectionDiff(diff);
      if (lines.length === 0) {
        console.log("  No changes — live protection already matches this roster.");
      } else {
        console.log(`  Pending changes (${lines.length}):`);
        for (const line of lines) console.log(line);
        if (verify) driftedBranches.push(branch);
      }
      console.log("");
    }

    if (!dryRun && !verify) {
      await callGitHubApi({
        token,
        method: "PUT",
        path: `/repos/${repoSlug}/branches/${branch}/protection`,
        body: payload,
      });

      // Re-read rather than trusting the 2xx. A PUT that returns 200 having
      // silently dropped a context GitHub does not recognise is exactly the
      // failure a checkmark hides, and it is the reason this whole read-back
      // exists.
      let applied = null;
      let confirmFailure = null;
      try {
        applied = await callGitHubApi({
          token,
          method: "GET",
          path: `/repos/${repoSlug}/branches/${branch}/protection`,
          allow404: true,
        });
      } catch (error) {
        confirmFailure = error instanceof Error ? error.message : String(error);
      }

      if (confirmFailure) {
        console.log(`  Applied, but could not re-read to confirm: ${confirmFailure}`);
      } else {
        const residual = diffProtection({ current: applied, desired: payload });
        if (hasProtectionDrift(residual)) {
          // The PUT succeeded and the result still does not match. Do not call
          // that configured.
          console.log(`  Applied to ${branch}, but the result still differs:`);
          for (const line of formatProtectionDiff(residual)) console.log(line);
          unconfirmedBranches.push(branch);
        } else {
          console.log(`  Applied and confirmed by read-back for ${branch}.`);
        }
      }
      console.log("");
    }
  }

  if (verify) {
    if (driftedBranches.length > 0) {
      throw new Error(
        `Live branch protection does not match this roster for: ${driftedBranches.join(", ")}. ` +
          "Run `npm run configure:branch-protection` to apply it.",
      );
    }
    console.log("Verify complete. Live branch protection matches this roster.");
  } else if (dryRun) {
    console.log("Dry run complete. No changes were made.");
    console.log("Remove --dry-run to apply these settings.");
  } else if (unconfirmedBranches.length > 0) {
    throw new Error(
      `Branch protection was applied but read back differently for: ${unconfirmedBranches.join(", ")}. ` +
        "The output above shows what still differs.",
    );
  } else {
    console.log("Branch protection configured successfully for main.");
  }
}

// Entry guard, and it is load-bearing rather than boilerplate. Without it, merely
// `import()`ing this module — to read ALL_REQUIRED_CHECKS, to unit-test a helper, to
// let an editor or agent inspect it — runs main() in LIVE mode and PUTs new branch
// protection to main and production. That happened during the review of #840: an
// import intended purely to read the checks list applied a not-yet-existing required
// check to main, which would have blocked every PR until it was noticed and undone.
//
// A module that reconfigures repository governance as a side effect of being loaded
// has no safe way to be read. `--dry-run` does not help, because the caller doing
// the importing never passes argv at all.
//
// This guard USED to be load-bearing on the production deploy path as well:
// `scripts/ci/validate-deploy-sha.mjs` imported ALL_REQUIRED_CHECKS from here on
// every deploy, so the one thing standing between a deploy and a live branch-
// protection write was this `if`. #1383 removed that reason rather than adding
// another layer of care around it — the rosters moved to
// `scripts/ci/lib/required-checks.mjs`, which has no entry point to guard, and
// the deploy path imports them from there. The guard stays because this file
// still writes governance when run directly; it is simply no longer the only
// thing protecting a deploy.
const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Branch protection configuration failed: ${message}`);
    process.exit(1);
  });
}

// The rosters are NOT re-exported from here. They live in
// `scripts/ci/lib/required-checks.mjs` and consumers import them from there
// directly — a pass-through would leave exactly the coupling #1383 removed,
// with this module still on the deploy path's import graph.
export { buildProtectionPayload };
