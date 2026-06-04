#!/usr/bin/env node

/**
 * Point git at the version-controlled .githooks/ directory (husky-style, zero deps).
 * Runs via the root package.json "prepare" script on `npm install` / `npm ci`.
 *
 * Safe + fast: no-ops outside a git work tree (CI tarball installs, Docker builds
 * without `.git`, environments without `git`), and never fails the install.
 *
 * The root "prepare" script guards the call with an existsSync check so `npm ci` still
 * succeeds where scripts/ isn't even present — e.g. the API Dockerfile, which copies only
 * package manifests + src and runs `npm ci --include-workspace-root`.
 */

import { execSync } from "node:child_process";

try {
  // Only meaningful inside a git work tree.
  execSync("git rev-parse --is-inside-work-tree", { stdio: "ignore" });
} catch {
  process.exit(0);
}

try {
  execSync("git config core.hooksPath .githooks", { stdio: "ignore" });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`setup-git-hooks: could not set core.hooksPath (${message}). Skipping.`);
  process.exit(0);
}

// Best-effort: ensure the committed hook is executable (some checkouts drop the bit).
try {
  execSync("chmod +x .githooks/pre-commit", { stdio: "ignore" });
} catch {
  // Non-fatal (e.g. Windows): git on Windows runs hooks regardless of the bit.
}
