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
 *   GITHUB_PAT=github_pat_xxx node scripts/configure-branch-protection.mjs --repo owner/repo
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

// ── Required status checks ──────────────────────────────────────────────────
// These must match check-run names exactly as reported on PRs.

const CI_CHECKS = [
  "packages-build",
  "lint-and-typecheck",
  "api-docker-build",
  "api-tests",
  "api-contract-check",
  "migration-safety",
  "mobile-validate",
  "ci-scripts-tests",
  // Secret scanning (gitleaks; ADR-13 push-protection replacement). ROLLOUT: this is
  // required only once the secret-scan job exists on the target branch and has run
  // green — otherwise every PR blocks on a missing required check.
  "secret-scan",
  // Clean-checkout guard: runs `npm ci && npm run check-types && npm run lint` with
  // no prebuilt shared packages, so a regression in turbo.json's `^build` dependency
  // fails here while every other job (which prebuilds) stays green. ROLLOUT: same
  // caveat as secret-scan — required only once the clean-checkout-typecheck job
  // exists on the target branch and has run green.
  "clean-checkout-typecheck",
  // npm audit gate (issue #618): blocks any high/critical advisory not explicitly
  // allowlisted in scripts/npm-audit-allowlist.json. ROLLOUT: same caveat as
  // secret-scan — required only once the dependency-audit job exists on the target
  // branch and has run green.
  "dependency-audit",
  // Chapter directory seed gate (issue #840): validates
  // supabase/seed/chapter_directory.csv — canonical #RRGGBB colors, real archetypes,
  // no duplicate natural keys. Required because the failure it catches is silent:
  // the accent engine answers a malformed hex with the house seed rather than an
  // error, so a bad value ships as a plausible wrong brand color. ROLLOUT: same caveat as
  // secret-scan — required only once the chapter-directory-seed job exists on the
  // target branch and has run green.
  "chapter-directory-seed",
  // Web + shared-package unit tests (apps/web, packages/hooks,
  // packages/chat-core, packages/chat-integrations). It is the ONLY suite covering
  // packages/hooks, which the consolidation work ahead edits directly, so leaving it
  // advisory means a broken shared hook merges green.
  //
  // Being path-gated does NOT stop it being required, which is the thing that looks
  // wrong here and isn't. The gate is a JOB-level `if:`, and GitHub reports a job
  // skipped by a conditional as "Success" — `success`, `skipped` and `neutral` all
  // satisfy a required check. The case that does block is a whole WORKFLOW skipped by
  // path/branch filtering, whose checks never report and sit "Pending" forever;
  // ci.yml has no workflow-level `paths:` filter, so that case cannot arise here.
  // (ADR-15 recorded the opposite belief — that path-gating a required job "needs a
  // skip→success wrapper" — which is true only of the workflow-level form.)
  // https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks
  //
  // The one real caveat from the same table: a job skipped because a `needs:` parent
  // FAILED "may not block merging". That is why `changes` is required below —
  // web-tests needs [packages-build, changes], and a required check whose parent is
  // NOT required is a hole, not a gate.
  //
  // ROLLOUT: same caveat as secret-scan. Verified green on main's latest run before
  // being listed here.
  "web-tests",
  // Required only because `web-tests` needs it. `changes` computes the path filter and
  // decides whether web-tests runs at all; on its own it asserts nothing.
  //
  // Without this entry the gate above has a hole with a real trigger. `changes` is the
  // one job in CI that calls the GitHub API (dorny/paths-filter lists the PR's files),
  // so it can fail — rate limit, API error, or the action-download failure this repo
  // has already seen once (#659) — while packages-build, which shares none of that
  // surface, goes green. web-tests is then skipped for a failed dependency, reports
  // `skipped`, and `skipped` SATISFIES a required check. Every required context would
  // be green with the only suite covering packages/hooks never having run.
  //
  // GitHub's prescribed alternative is `always()` on the dependent job plus explicit
  // `needs.*.result` assertions. Rejected: `always()` keeps running through the
  // `cancel-in-progress` cancellations ADR-15 banks on, so it would cost real minutes
  // to fix a problem one array entry fixes for a checkout and one API call.
  //
  // The general invariant, which nothing currently enforces: EVERY `needs:` parent of a
  // required check must itself be a required check. web-tests is the first job here to
  // have needed it.
  //
  // Safe to require: `changes` has no job-level `if:` (the condition is on its filter
  // STEP), so the job always runs and always reports, on both pull_request and push.
  "changes",
  // The 375px responsive floor (issue #1152). `spec/ui/web-dashboard/README.md` states
  // it as a MUST — every dashboard route renders without horizontal scroll down to
  // 375px — and `apps/web/tests/visual/responsive-floor.spec.ts` measures it per route.
  //
  // It used to run inside the advisory `web-visual-regression` and therefore could not
  // block. That job's advisory posture was about PIXEL flake: baselines drift with
  // Chromium revisions and font rendering, so blocking merges on them was the worse
  // trade. This suite stores no baseline and compares no pixels — it reads one integer
  // per route and compares it to 375 — so it has none of those failure modes and
  // inherited the exemption purely by sharing a directory. #1153 split it into its own
  // job; the snapshot job has since been deleted, and this one now runs the whole
  // `apps/web/tests/visual/` directory rather than a tagged slice of it.
  //
  // The defect it catches is a silent one and has already happened once: a shell
  // refactor dropped `min-w-0` from the content column and broke six of seven routes,
  // which nothing measured until #1142. Path-gated, same as `web-tests` above and safe
  // for the same reason; both of its `needs:` parents are required checks.
  //
  // ROLLOUT: same caveat as secret-scan — required only once the web-responsive-floor
  // job exists on the target branch and has run green.
  "web-responsive-floor",
  // Architectural boundary linting (dependency-cruiser): the API's layer direction
  // and the monorepo's app/package separation. HARD GATE from day one, which is only
  // survivable because `.dependency-cruiser-known-violations.json` grandfathers the
  // violations that existed when it landed — a baseline is what lets a gate be strict
  // immediately instead of "advisory until someone gets around to it".
  //
  // ROLLOUT: same caveat as secret-scan — required only once the dependency-cruiser
  // job exists on the target branch and has run green.
  "dependency-cruiser",
  // Vercel-parity production build (issue #1371): builds apps/web and apps/landing
  // on a `npm ci --omit=dev` tree, which is the only place in CI that executes the
  // program `next build` actually type-checks in production. Two production outages
  // came from this gap — #1331 and #1372 — and both were invisible to every other
  // check: the dev-tree jobs have the pruned packages on disk, and a Vercel preview
  // restores a build cache rather than installing cold, so a green preview is not
  // evidence about a production build.
  //
  // Required rather than advisory, and unfiltered by path: the `changes.web` filter
  // does not cover `apps/landing/**`, which is exactly the half of #1372 that went
  // unrecorded until the production deploy failed on it.
  //
  // ROLLOUT: same caveat as secret-scan — required only once the
  // web-production-build job exists on the target branch and has run green. Run
  // `npm run configure:branch-protection` AFTER the PR adding the job merges, not
  // before, or every open PR blocks on a check that does not exist yet.
  "web-production-build",
  // NOT here on purpose: `duplicate-detection` (jscpd). jscpd has no clone-level
  // baseline, so the only lever is a repo-wide duplication percentage — too coarse
  // to block a merge on, since it cannot tell one bad copy-paste from ordinary
  // drift. It runs and reports; the threshold ratchets down as consolidations land.
];

const DOCS_CHECKS = [
  "docs-spec-sync",
  // Doc path citations: fails when a doc cites a repo path that resolves
  // nowhere, covering the gap the `Links` gate leaves (lychee validates
  // markdown links and heading anchors, never `` `inline/code.ts` `` paths).
  // ROLLOUT: same caveat as secret-scan — required only once the doc-paths job
  // exists on the target branch and has run green. Deliberately NOT a step
  // inside docs-spec-sync: this check is whole-tree, so as a required check it
  // can block a PR over a citation in a doc that PR never touched. Keep it
  // reporting-only until that trade is accepted knowingly. Promoted 2026-08-21:
  // the trade is accepted — a stale citation blocking an unrelated PR is the
  // cheaper failure, since the alternative is citations rotting silently, which
  // is what the 40-entry allowlist and the drift this gate found both attest to.
  "doc-paths",
];

// Checks emitted by .github/workflows/migration-drift-gate.yml.
const DRIFT_CHECKS = [
  // NOT here on purpose, and it used to be: `migration-drift`. It asserts that
  // STAGING holds every migration on MAIN — a question about two things the PR
  // in front of it neither contains nor can change. As a required check it is
  // therefore not a gate, it is a repo-wide merge-freeze switch, and #1373 used
  // it as one: a single back-dated filename halted staging's apply, and every
  // open PR in the repository became unmergeable until a human intervened.
  //
  // The trade was taken knowingly when it was promoted — "it can block a PR
  // over state that PR did not cause; that is the cheaper failure". It was not
  // the cheaper failure. A check nobody can answer teaches people to route
  // around it, and its own escape hatch (drop the context by hand for the
  // duration) is a repo-admin edit to branch protection made under outage
  // pressure, which is the worst available moment to be making one.
  //
  // Detection is NOT lost, which is what makes the demotion safe rather than a
  // retreat: `.github/workflows/check-migration-drift.yml` runs the same
  // comparison daily across staging AND production and files a P1
  // `routine-state` issue that closes itself on recovery. The job also keeps
  // running and reporting on every PR — it stays visible, it just stops
  // blocking. What replaces it as a GATE is `migration-order` below: the same
  // failure class, scoped so a PR can actually answer it.

  // Does a migration this change INTRODUCES sort before a version the target
  // database has already applied? If it does, the Supabase CLI refuses rather
  // than reordering — measured against the pinned 2.77.0: exit 1, nothing
  // applied, "Found local migration files to be inserted before the last
  // migration on remote database". That is #1373, which halted staging's
  // migration deploy and, through `migration-drift`, froze the repo.
  //
  // Required, and safe to require where `migration-drift` was not, because it
  // reads only the migrations the change introduces (head minus base):
  //
  //   * a change touching no migrations introduces nothing, so the job makes
  //     ZERO network calls and cannot block a PR over unrelated state — nor
  //     put repo-wide merge availability behind the Supabase Management API;
  //   * a PR that FIXES an ordering problem turns its own check green, because
  //     the renamed file is the introduced one. `migration-drift` structurally
  //     could not do that, and that deadlock is what forced the #1369
  //     escape-hatch discussion.
  //
  // Checks staging AND production. #1373 was invisible to `migration-replay`
  // for a structural reason rather than a logical one: the replay rebuilds
  // PRODUCTION's applied state, and production had not yet applied the newer
  // migration. Staging had, and staging is where the apply refused.
  //
  // ROLLOUT: same caveat as secret-scan — required only once the
  // migration-order job exists on the target branch and has run green,
  // otherwise every PR blocks on a missing required check.
  //
  // For THIS check "has run green" is weaker evidence than usual and must not
  // be taken at face value: a run on a change that introduces no migrations
  // returns green having made ZERO network calls, so it proves the job starts,
  // not that either project can be read.
  //
  // Nor does dispatching the workflow fix that on its own — a dispatch on
  // `main` has head == base, which is that same vacuous case. So the job runs
  // `check-migration-order.mjs --probe` on a dispatch: it reads both projects
  // and prints what each holds, asserting nothing about any change. Promote
  // only after a dispatch whose step summary shows a real `newestApplied` for
  // BOTH staging and production. If the Infisical token turns out to be
  // project-scoped rather than account-level, that is where it surfaces —
  // instead of as a hard block on the first migration PR after this starts
  // blocking.
  "migration-order",
  // Do the migrations a PR adds actually APPLY to the database they are heading
  // for? Rebuilds production's currently-applied state on a disposable Supabase
  // stack and runs the pending set against it, through the same CLI path
  // `run-migration.mjs` uses for real. Read-only against production (one GET to
  // the Management API); every apply lands on the throwaway stack.
  //
  // The gap it closes: `pglite-migrations` applies the corpus from ZERO, which
  // is a different question from applying the tail to a database that is
  // already at some version, and `migration-safety` / `migration-lock-safety`
  // read the SQL without running it. Until this job existed, the first real
  // execution of an incremental production apply was the production apply.
  //
  // Required rather than advisory for the same reason `migration-drift` is: a
  // migration that cannot apply is not a style opinion, and the failure it
  // prevents is one that is discovered mid-deploy with a half-migrated
  // database. Unlike `migration-drift` it CANNOT block a PR over unrelated
  // state — it does real work only when the PR touches
  // `supabase/migrations/**`, and passes in seconds otherwise.
  //
  // ROLLOUT: same caveat as secret-scan — required only once the
  // migration-replay job exists on the target branch and has run green,
  // otherwise every PR blocks on a missing required check.
  "migration-replay",
];

const ALL_REQUIRED_CHECKS = [...CI_CHECKS, ...DOCS_CHECKS, ...DRIFT_CHECKS];

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

async function callGitHubApi({ token, method, path, body }) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: githubHeaders({ token, hasBody: true }),
    body: body ? JSON.stringify(body) : undefined,
  });

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

  console.log(`Repository: ${repoSlug}`);
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE"}`);
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

    if (!dryRun) {
      const token = resolveToken();
      if (!token) {
        throw new Error(
          "Missing GitHub token. Set GITHUB_PAT (or one of the aliases GITHUB_TOKEN, " +
            "GH_PAT, GH_TOKEN) in the environment, or put it in .env.local or .env at the repo root.",
        );
      }

      await callGitHubApi({
        token,
        method: "PUT",
        path: `/repos/${repoSlug}/branches/${branch}/protection`,
        body: payload,
      });
      console.log(`  ✅ Branch protection configured for ${branch}`);
      console.log("");
    }
  }

  if (dryRun) {
    console.log("Dry run complete. No changes were made.");
    console.log("Remove --dry-run to apply these settings.");
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
// has no safe way to be read. `scripts/ci/validate-deploy-sha.mjs` imports
// ALL_REQUIRED_CHECKS from here on every production deploy, so this guard is now
// load-bearing on the deploy path too, not only in review. `--dry-run` does not help, because the caller doing the
// importing never passes argv at all.
const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Branch protection configuration failed: ${message}`);
    process.exit(1);
  });
}

export {
  ALL_REQUIRED_CHECKS,
  CI_CHECKS,
  DOCS_CHECKS,
  DRIFT_CHECKS,
  buildProtectionPayload,
};
