#!/usr/bin/env node

import { execSync } from "node:child_process";

const DEFAULT_REQUIRED_CHECKS = ["CI / lint-typecheck-test", "CI / build"];

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

function requiredChecks() {
  const checks = getArg("--checks");
  if (!checks) return DEFAULT_REQUIRED_CHECKS;
  return checks
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

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

function buildBranchProtectionPayload(contexts) {
  return {
    required_status_checks: {
      strict: true,
      contexts,
    },
    enforce_admins: true,
    required_pull_request_reviews: {
      dismiss_stale_reviews: true,
      require_code_owner_reviews: false,
      required_approving_review_count: 1,
      require_last_push_approval: false,
    },
    restrictions: null,
    required_linear_history: true,
    allow_force_pushes: false,
    allow_deletions: false,
    block_creations: false,
    required_conversation_resolution: true,
    lock_branch: false,
    allow_fork_syncing: true,
  };
}

async function main() {
  const repoSlug = resolveRepoSlug();
  const checks = requiredChecks();
  const dryRun = hasFlag("--dry-run");

  if (dryRun) {
    console.log("Dry-run mode enabled.");
    console.log(`Would configure branch protection for repo: ${repoSlug}`);
    console.log(`Required checks: ${checks.join(", ")}`);
    console.log("Branches: preview, main");
    return;
  }

  const token = resolveToken();
  if (!token) {
    throw new Error(
      "Missing GitHub token. Set one of: GITHUB_PAT, GH_PAT, GH_TOKEN, GITHUB_TOKEN.",
    );
  }

  const payload = buildBranchProtectionPayload(checks);
  for (const branch of ["preview", "main"]) {
    await callGitHubApi({
      token,
      method: "PUT",
      path: `/repos/${repoSlug}/branches/${branch}/protection`,
      body: payload,
    });
    console.log(`Configured branch protection for ${repoSlug}:${branch}`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Branch protection configuration failed: ${message}`);
  process.exit(1);
});
