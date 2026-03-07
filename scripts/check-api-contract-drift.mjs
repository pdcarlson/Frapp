#!/usr/bin/env node

/**
 * API Contract Freshness Check
 *
 * Verifies that any PR changing API source code also updates the committed
 * contract artifacts (openapi.json and api-sdk/types.ts).
 *
 * This script uses git diff — it does NOT bootstrap the NestJS application,
 * so it requires no Supabase/Stripe credentials and runs safely in CI.
 *
 * How it works:
 * - In PR context (--base and --head provided): diffs the PR's changed files.
 * - In push context (no args): diffs HEAD against HEAD~1.
 * - If API source files changed but contract artifacts did not, the check fails.
 */

import { execSync } from "node:child_process";

/** Paths that, when changed, indicate the API contract may have changed. */
const API_SOURCE_PATTERNS = [
  "apps/api/src/",
];

/** Generated artifacts that must be updated when API source changes. */
const CONTRACT_ARTIFACTS = [
  "apps/api/openapi.json",
  "packages/api-sdk/src/types.ts",
];

/** Paths that are API source but do NOT affect the contract (tests, configs, etc.). */
const API_SOURCE_EXCLUSIONS = [
  "apps/api/src/export-openapi.ts",
  ".spec.ts",
  ".spec.js",
  ".e2e-spec.ts",
  "apps/api/src/config/",
  "apps/api/src/infrastructure/supabase/",
];

function getArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  const value = process.argv[idx + 1];
  if (value === undefined || value.startsWith("-")) {
    console.error(`Error: flag ${name} requires a value.`);
    process.exit(2);
  }
  return value;
}

function getChangedFiles(base, head) {
  if (base && head) {
    // PR context: diff base...head
    const ranges = [`${base}...${head}`, `${base}..${head}`];
    for (const range of ranges) {
      try {
        const output = execSync(`git diff --name-only ${range}`, {
          encoding: "utf8",
        }).trim();
        if (!output) return [];
        return output.split("\n").map((s) => s.trim()).filter(Boolean);
      } catch {
        // Try next range expression
      }
    }

    // Fetch and retry
    try {
      execSync(`git fetch --no-tags --depth=500 origin ${base} ${head}`, {
        stdio: "ignore",
      });
    } catch {
      // Best-effort fetch
    }

    for (const range of ranges) {
      try {
        const output = execSync(`git diff --name-only ${range}`, {
          encoding: "utf8",
        }).trim();
        if (!output) return [];
        return output.split("\n").map((s) => s.trim()).filter(Boolean);
      } catch {
        // Try next range expression
      }
    }

    throw new Error(
      `Unable to diff changed files for base=${base} head=${head}. Ensure checkout fetch-depth is 0.`,
    );
  }

  // Push context: diff against parent commit
  try {
    const output = execSync("git diff --name-only HEAD~1", {
      encoding: "utf8",
    }).trim();
    if (!output) return [];
    return output.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    // Shallow clone or initial commit — skip check
    console.log("API contract drift check skipped (unable to determine changed files).");
    process.exit(0);
  }
}

function isApiSourceFile(filePath) {
  const matchesSource = API_SOURCE_PATTERNS.some((pattern) =>
    filePath.startsWith(pattern),
  );
  if (!matchesSource) return false;

  const isExcluded = API_SOURCE_EXCLUSIONS.some((exclusion) =>
    filePath.includes(exclusion),
  );
  return !isExcluded;
}

function isContractArtifact(filePath) {
  return CONTRACT_ARTIFACTS.some((artifact) => filePath === artifact);
}

function main() {
  const base = getArg("--base");
  const head = getArg("--head");

  const changedFiles = getChangedFiles(base, head);

  if (changedFiles.length === 0) {
    console.log("API contract drift check passed (no files changed).");
    return;
  }

  const changedApiSource = changedFiles.filter(isApiSourceFile);
  const changedArtifacts = changedFiles.filter(isContractArtifact);

  if (changedApiSource.length === 0) {
    console.log("API contract drift check passed (no API source changes).");
    return;
  }

  if (changedArtifacts.length >= CONTRACT_ARTIFACTS.length) {
    console.log("API contract drift check passed (artifacts updated).");
    return;
  }

  // API source changed but artifacts are missing from the changeset
  const missingArtifacts = CONTRACT_ARTIFACTS.filter(
    (artifact) => !changedArtifacts.includes(artifact),
  );

  console.error("API contract drift check failed.");
  console.error("");
  console.error(
    "You changed API source files but did not update the contract artifacts.",
  );
  console.error("");
  console.error("Changed API source files:");
  for (const file of changedApiSource) {
    console.error(`  - ${file}`);
  }
  console.error("");
  console.error("Missing artifact updates:");
  for (const file of missingArtifacts) {
    console.error(`  - ${file}`);
  }
  console.error("");
  console.error("Fix: run the following commands and commit the results:");
  console.error("  npm run openapi:export -w apps/api");
  console.error("  npm run generate -w packages/api-sdk");
  process.exit(1);
}

main();
