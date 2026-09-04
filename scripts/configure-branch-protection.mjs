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
import { ghRequest } from "./ci/lib/github.mjs";
import { ALL_REQUIRED_CHECKS } from "./ci/lib/required-checks.mjs";

// ── CLI argument parsing ────────────────────────────────────────────────────

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

// Every flag this script understands. `hasFlag` is exact-match, so any spelling
// it does not recognise simply reads as absent — and "absent" for `--verify` and
// `--dry-run` means LIVE, i.e. a governance PUT. `--verify=true` (the natural
// `=`-form of a documented flag), `--verfiy`, `--dryrun` and `--check` all
// silently applied branch protection before this guard existed.
//
// That is not a cosmetic slip: `required-checks.mjs` deliberately carries
// entries with ROLLOUT caveats saying to run this only AFTER the PR adding the
// job merges, so an accidental apply can promote a context whose job does not
// exist yet and make every open PR unmergeable until an admin undoes it by hand.
// A read-only flag that fails open to a write is the wrong direction to fail.
const KNOWN_FLAGS = new Set(["--dry-run", "--verify"]);
const KNOWN_OPTIONS = new Set(["--repo", "--token-env"]);

function assertKnownArgs(argv = process.argv.slice(2)) {
  const unknown = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (KNOWN_FLAGS.has(arg)) continue;
    if (KNOWN_OPTIONS.has(arg)) {
      i += 1; // its value is not itself an argument
      continue;
    }
    unknown.push(arg);
  }
  if (unknown.length > 0) {
    throw new Error(
      `Unrecognised argument(s): ${unknown.join(", ")}. This script WRITES branch protection ` +
        "unless --dry-run or --verify is given, and an unrecognised flag reads as neither — so " +
        "it refuses rather than applying. Valid: --dry-run, --verify, --repo <owner/repo>, " +
        "--token-env <VAR>. Note flags take no `=` (use `--repo x/y`, not `--repo=x/y`).",
    );
  }
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

async function callGitHubApi({ token, method, path, body, allowUnprotected = false }) {
  // `retry: true` is safe on every call here, including the PUT: `fetchWithRetry`
  // underneath scopes retries to idempotent methods, so a PUT still gets exactly
  // one attempt (and a longer deadline) while the reads retry a transient
  // 429/5xx. What both gain is a timeout — Node's global `fetch` has none, so a
  // hung socket would otherwise stall the run indefinitely.
  const result = await ghRequest({ token, method, path, body, retry: true });

  if (!result.ok) {
    const text = typeof result.data === "string" ? result.data : JSON.stringify(result.data);

    // A branch with no protection rule answers 404 with "Branch not protected",
    // which is a legitimate "before" state for the read-back rather than an
    // error. A 404 for a repo or branch that does not exist — or that this
    // token cannot see, which GitHub reports as 404 rather than 403 so it does
    // not leak existence — reads identically on status alone. Collapsing the
    // two would report a typo'd --repo as "this branch has no protection" and
    // then prescribe a governance PUT to fix it, so only the first is excused
    // and the body is what distinguishes them.
    if (allowUnprotected && result.status === 404 && /branch not protected/i.test(text)) {
      return null;
    }

    throw new Error(`${method} ${path} failed (${result.status}): ${text}`);
  }
  return result.data;
}

/**
 * An error's message plus its `cause`, when it has one.
 *
 * The failure this guards against is every transport error reading `fetch
 * failed` — DNS, connection refused, a TLS/CA-bundle rejection and a proxy
 * reset are indistinguishable on `.message` alone, so an expired token and a
 * broken CA bundle both end up blamed on the sandbox proxy.
 *
 * Note `ghRequest` now catches network-level rejections itself and returns
 * `{ok: false, status: 0, data: error.message}`, so what reaches here is
 * usually the Error this file constructed from that — already carrying the
 * message, and with no `cause` to unwrap. This stays because it is the
 * difference between a legible failure and a misleading one if any caller in
 * this file ever throws a raw transport error again.
 */
function describeError(error) {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause;
  const causeText =
    cause instanceof Error
      ? `${cause.message}${cause.code ? ` (${cause.code})` : ""}`
      : cause
        ? String(cause)
        : "";
  return causeText ? `${error.message}: ${causeText}` : error.message;
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
    // Declared `false` to match live rather than to an aspiration (#1580): this
    // roster is the repo's declaration of intent, and declaring `true` while
    // `main` reports `false` made every hand comparison — which is what a
    // branch-protection audit is — stop and re-derive why the difference did not
    // matter. That cost two sessions. See LOCK_DEPENDENT_FLAGS below for why the
    // flag is inert here and excluded from the `--verify` diff.
    allow_fork_syncing: false,
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
// network confined to `callGitHubApi`, because the call itself is the one part
// that cannot be relied on from an agent session. Reaching `api.github.com` from
// a cloud sandbox is SESSION-DEPENDENT: ADR-20 and #1385 record 403 for
// authenticated and unauthenticated requests alike, and the ADR-20 amendment of
// 2026-09-01 records this same endpoint returning 200 from a sandbox with a PAT
// loaded from `.env.local`. #680's evidence table records both on the same day.
// Do not read either observation as the general rule. Keeping the semantics in
// functions that take a response rather than fetch one is what makes the diff
// unit-testable regardless of which way a given session falls.
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

// `allow_fork_syncing` governs whether users may pull upstream changes WHILE THE
// BRANCH IS LOCKED. With `lock_branch: false` it describes a situation that
// cannot arise, and GitHub accepts the written value without persisting it. This
// payload sent `true` from 2026-08-27 (f7d03b1) until #1580, and reads of `main`
// on 2026-09-01, 2026-09-02 and 2026-09-04 all returned `false` — with
// `migration-order` (added to the roster 2026-08-30) present live in between,
// which points to an apply having run without the written value sticking, though
// an admin UI edit would look the same from here. The roster now declares
// `false` to match live (#1580), so the exemption below is what keeps a LOCKED
// branch honest rather than what hides a standing divergence.
//
// Comparing it on an unlocked branch therefore reports drift that no run can
// ever resolve, which would make `--verify` exit non-zero forever and turn an
// apply into a permanent failure. A gate nobody can satisfy is one people learn
// to route around — the same reasoning that demoted `migration-drift`. So it is
// compared only where it means something: when the branch is locked on either
// side. If `lock_branch` is ever set true, this starts being enforced again.
const LOCK_DEPENDENT_FLAGS = new Set(["allow_fork_syncing"]);

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
  const have = normalizeProtection(current);
  const wantContexts = want?.required_status_checks?.contexts ?? [];

  // `normalizeProtection` returns null for anything non-object, so testing its
  // OUTPUT rather than the raw input covers `null`, `undefined`, `""`, `false`
  // and a stray string alike. Guarding the input caught only two of those and
  // left the flag loop below dereferencing null.
  if (have === null) {
    return {
      unprotected: true,
      changes: [],
      contextsAdded: [...wantContexts],
      contextsRemoved: [],
    };
  }

  const haveContexts = have.required_status_checks?.contexts ?? [];
  const contextsAdded = wantContexts.filter((name) => !haveContexts.includes(name));
  const contextsRemoved = haveContexts.filter((name) => !wantContexts.includes(name));

  const changes = [];
  const haveStrict = have.required_status_checks?.strict ?? null;
  const wantStrict = want?.required_status_checks?.strict ?? null;
  if (haveStrict !== wantStrict) {
    changes.push({ field: "required_status_checks.strict", from: haveStrict, to: wantStrict });
  }

  const locked = Boolean(have.lock_branch) || Boolean(want?.lock_branch);
  for (const key of [...PROTECTION_FLAGS, "required_pull_request_reviews", "restrictions"]) {
    if (!locked && LOCK_DEPENDENT_FLAGS.has(key)) continue;
    if (have[key] !== want?.[key]) changes.push({ field: key, from: have[key], to: want?.[key] });
  }

  return { unprotected: false, changes, contextsAdded, contextsRemoved };
}

/** Whether a diff represents any change at all. The no-op test. */
export function hasProtectionDrift(diff) {
  if (!diff || typeof diff !== "object") return false;
  // Length-checked defensively: the `!diff` guard alone caught null and
  // undefined but still threw on any diff-shaped object missing a key.
  return Boolean(
    diff.unprotected ||
      diff.changes?.length ||
      diff.contextsAdded?.length ||
      diff.contextsRemoved?.length,
  );
}

/** The diff as printable lines. Empty array means no drift. */
export function formatProtectionDiff(diff) {
  if (!hasProtectionDrift(diff)) return [];
  const lines = [];
  if (diff.unprotected) {
    lines.push("  ! branch has NO protection rule — this would create one from scratch");
  }
  for (const name of diff.contextsAdded ?? []) lines.push(`  + required check   ${name}`);
  for (const name of diff.contextsRemoved ?? []) lines.push(`  - required check   ${name}`);
  for (const change of diff.changes ?? []) {
    lines.push(`  ~ ${change.field}: ${String(change.from)} -> ${String(change.to)}`);
  }
  return lines;
}

/**
 * The floor. A payload with no required contexts is not a configuration, it is
 * the removal of every merge gate on `main` in one PUT — and it would print as
 * an ordinary run of `- required check` lines, indistinguishable from a
 * deliberate demotion.
 *
 * `scripts/ci/validate-deploy-sha.mjs` has exactly this floor on the reading
 * side ("Narrowing that excuses EVERY required check ... would deploy to
 * production having verified no CI at all"). The writer is the half that can
 * actually destroy the gates, so it gets the same refusal.
 */
export function assertRosterFloor(contexts) {
  if (!Array.isArray(contexts) || contexts.length === 0) {
    throw new Error(
      "Refusing to apply: the required-check roster is empty, which would remove EVERY " +
        "required check from the branch. If that is genuinely intended, do it in the GitHub " +
        "UI deliberately rather than through a script whose job is to keep them in place. " +
        "Otherwise check scripts/ci/lib/required-checks.mjs — this is what a bad edit or a " +
        "failed import looks like.",
    );
  }
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

  // Before anything reads a mode: an unrecognised flag must not silently mean
  // "apply". See KNOWN_FLAGS.
  assertKnownArgs();

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
    assertRosterFloor(checks);

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
          allowUnprotected: true,
        });
      } catch (error) {
        readFailure = describeError(error);
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
        // The reason above is the reason. Do NOT restate it as the sandbox
        // proxy: a 403 through the proxy, an expired PAT, a wrong repo slug and
        // a broken CA bundle all reach here, and naming one of them as the
        // cause is how the other three get misdiagnosed.
        throw new Error(
          `--verify cannot confirm ${branch}: live protection is unreadable (${readFailure}). ` +
            "An unreadable answer is not a passing one, so this fails rather than reporting a " +
            "match. If the cause is a 403 with no GitHub response headers, that is the sandbox " +
            "egress proxy and the read has to happen from a machine with direct network access " +
            "(ADR-20, and its 2026-09-01 amendment — reachability is session-dependent).",
        );
      }
    } else {
      const diff = diffProtection({ current, desired: payload });
      if (!hasProtectionDrift(diff)) {
        console.log("  No changes — live protection already matches this roster.");
      } else {
        const lines = formatProtectionDiff(diff);
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
          allowUnprotected: true,
        });
      } catch (error) {
        confirmFailure = describeError(error);
      }

      if (confirmFailure) {
        // Falling through to "configured successfully" here would be the exact
        // checkmark-without-evidence this read-back exists to remove: the PUT
        // returned 2xx, and 2xx was never the thing in question.
        console.log(`  Applied, but could not re-read to confirm: ${confirmFailure}`);
        unconfirmedBranches.push(branch);
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
          "Applying is a human step with an admin PAT: ask for `npm run configure:branch-protection` " +
          "to be run. Do not run it from an agent session — with no flags it is a live PUT of the " +
          "whole payload, and `--dry-run` without the `--` separator is swallowed by npm and applies.",
      );
    }
    console.log("Verify complete. Live branch protection matches this roster.");
  } else if (dryRun) {
    console.log("Dry run complete. No changes were made.");
    console.log("Remove --dry-run to apply these settings.");
  } else if (unconfirmedBranches.length > 0) {
    throw new Error(
      `Branch protection was applied but NOT confirmed for: ${unconfirmedBranches.join(", ")}. ` +
        "The output above shows either what still differs, or why the confirming read failed. " +
        "The PUT itself succeeded — this is about whether the result matches what was written.",
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
export { assertKnownArgs, buildProtectionPayload };
