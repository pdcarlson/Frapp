#!/usr/bin/env node

/**
 * Configure branch protection rules for main and production.
 *
 * Usage:
 *   GITHUB_PAT=ghp_xxx node scripts/configure-branch-protection.mjs
 *   GITHUB_PAT=ghp_xxx node scripts/configure-branch-protection.mjs --dry-run
 *   GITHUB_PAT=ghp_xxx node scripts/configure-branch-protection.mjs --repo owner/repo
 *
 * The PAT needs "repo" scope for public repos or "admin:repo" for private repos.
 *
 * Required status checks map to emitted GitHub check-run names.
 */

import { execSync } from "node:child_process";

// ── Required status checks ──────────────────────────────────────────────────
// These must match check-run names exactly as reported on PRs.

const CI_CHECKS = [
  "packages-build",
  "lint-and-typecheck",
  "api-tests",
  "api-contract-check",
  "migration-safety",
  "mobile-validate",
  "ci-scripts-tests",
];

const DOCS_CHECKS = [
  "docs-spec-sync",
];

const ALL_REQUIRED_CHECKS = [...CI_CHECKS, ...DOCS_CHECKS];

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

function resolveToken() {
  const explicitTokenEnv = getArg("--token-env");
  if (explicitTokenEnv && process.env[explicitTokenEnv]) {
    return process.env[explicitTokenEnv];
  }

  return (
    process.env.GITHUB_PAT ||
    process.env.GH_PAT ||
    process.env.GH_TOKEN ||
    process.env.GITHUB_TOKEN
  );
}

// ── GitHub API ──────────────────────────────────────────────────────────────

async function callGitHubApi({ token, method, path, body }) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
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
  const requiresApprovingReview = branch === "production";
  const requiresConversationResolution = branch === "production";
  const payload = {
    required_status_checks: {
      strict: true,
      contexts: ALL_REQUIRED_CHECKS,
    },
    enforce_admins: true,
    required_pull_request_reviews: requiresApprovingReview
      ? {
          dismiss_stale_reviews: true,
          require_code_owner_reviews: false,
          required_approving_review_count: 1,
          require_last_push_approval: false,
        }
      : null,
    restrictions: null,
    required_linear_history: true,
    allow_force_pushes: false,
    allow_deletions: false,
    block_creations: false,
    required_conversation_resolution: requiresConversationResolution,
    lock_branch: false,
    allow_fork_syncing: true,
  };

  // production has stricter policy: branch source enforcement + required review + required conversation resolution.
  if (branch === "production") {
    payload.required_status_checks.contexts = [
      ...ALL_REQUIRED_CHECKS,
      "branch-policy",
    ];
  }

  return payload;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const repoSlug = resolveRepoSlug();
  const dryRun = hasFlag("--dry-run");

  console.log(`Repository: ${repoSlug}`);
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE"}`);
  console.log("");

  for (const branch of ["main", "production"]) {
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
          "Missing GitHub token. Set one of: GITHUB_PAT, GH_PAT, GH_TOKEN, GITHUB_TOKEN.",
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
    console.log("Branch protection configured successfully for main and production.");
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Branch protection configuration failed: ${message}`);
  process.exit(1);
});
