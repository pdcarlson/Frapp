#!/usr/bin/env node

/**
 * API Contract Freshness Check (regenerate-and-diff)
 *
 * When a PR touches API source, this regenerates the committed contract
 * artifacts and verifies they match what's checked in:
 *   - apps/api/openapi.json        (NestJS Swagger export)
 *   - packages/api-sdk/src/types.ts (openapi-typescript output)
 *
 * This replaces the previous git-diff heuristic, which:
 *   - false-positived on contract-neutral controller edits (e.g. adding a
 *     request-scoped param decorator like @CurrentChapterId) by demanding BOTH
 *     artifacts change even when neither's content does, and
 *   - false-negatived when only one artifact needed updating.
 *
 * The export bootstraps NestJS with placeholder credentials (it only builds the
 * Swagger document — it never calls Supabase/Stripe), so no real secrets are
 * required. Shared packages must be built first (the CI job does this; locally
 * run `npx turbo run build --filter='./packages/*'`).
 */

import { execSync } from "node:child_process";

/** Artifacts that must stay in sync with API source. */
const CONTRACT_ARTIFACTS = [
  "apps/api/openapi.json",
  "packages/api-sdk/src/types.ts",
];

/**
 * A changed file is "API-related" (worth a regen) when it lives in the API
 * source tree (excluding tests and the exporter itself) or in the generated
 * artifacts / SDK package. Non-contract API files (services, repositories) are
 * included on purpose: regenerating is cheap and a clean diff still passes, so
 * we'd rather over-check than miss a contract change.
 */
function isApiRelated(filePath) {
  if (filePath.includes(".spec.") || filePath.includes(".e2e-spec.")) {
    return false;
  }
  if (filePath === "apps/api/src/export-openapi.ts") return false;
  return (
    filePath.startsWith("apps/api/src/") ||
    filePath === "apps/api/openapi.json" ||
    filePath.startsWith("packages/api-sdk/")
  );
}

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
  const ranges = base && head ? [`${base}...${head}`, `${base}..${head}`] : ["HEAD~1"];
  for (const range of ranges) {
    try {
      const output = execSync(`git diff --name-only ${range}`, {
        encoding: "utf8",
      }).trim();
      return output ? output.split("\n").map((s) => s.trim()).filter(Boolean) : [];
    } catch {
      // try next range expression
    }
  }
  // Shallow clone / initial commit — be safe and regenerate.
  return null;
}

function run(command) {
  execSync(command, {
    stdio: "inherit",
    env: {
      ...process.env,
      // Placeholders: the OpenAPI export only builds the Swagger document and
      // never calls these services. Real values are never needed. They must be
      // present in the process env up front because some modules read them at
      // import time (export-openapi.ts sets its own placeholders too late).
      // Neutral strings (no `sk_`/`whsec_` prefixes) so secret scanners don't
      // flag them.
      SUPABASE_URL: process.env.SUPABASE_URL ?? "https://placeholder.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY:
        process.env.SUPABASE_SERVICE_ROLE_KEY ?? "placeholder_value",
      SUPABASE_ANON_KEY:
        process.env.SUPABASE_ANON_KEY ?? "placeholder_value",
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY ?? "placeholder_value",
      STRIPE_WEBHOOK_SECRET:
        process.env.STRIPE_WEBHOOK_SECRET ?? "placeholder_value",
      STRIPE_PRICE_ID: process.env.STRIPE_PRICE_ID ?? "placeholder_value",
    },
  });
}

function main() {
  const base = getArg("--base");
  const head = getArg("--head");

  const changedFiles = getChangedFiles(base, head);

  // `null` => couldn't diff (shallow clone) => regenerate to be safe.
  if (changedFiles && changedFiles.length === 0) {
    console.log("API contract check passed (no files changed).");
    return;
  }
  if (changedFiles && !changedFiles.some(isApiRelated)) {
    console.log("API contract check passed (no API-related changes).");
    return;
  }

  console.log("Regenerating API contract artifacts…");
  try {
    run("npm run openapi:export -w apps/api");
    run("npm run generate -w packages/api-sdk");
  } catch (error) {
    console.error("");
    console.error("Failed to regenerate API contract artifacts.");
    console.error(
      "Ensure shared packages are built: npx turbo run build --filter='./packages/*'",
    );
    console.error(String(error?.message ?? error));
    process.exit(1);
  }

  const drift = execSync(
    `git diff --name-only -- ${CONTRACT_ARTIFACTS.join(" ")}`,
    { encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  if (drift.length === 0) {
    console.log("API contract drift check passed (artifacts are fresh).");
    return;
  }

  console.error("API contract drift check failed.");
  console.error("");
  console.error(
    "The committed contract artifacts are stale relative to the API source.",
  );
  console.error("Stale artifacts:");
  for (const file of drift) console.error(`  - ${file}`);
  console.error("");
  console.error("Fix: run the following commands and commit the results:");
  console.error("  npm run openapi:export -w apps/api");
  console.error("  npm run generate -w packages/api-sdk");
  console.error("");
  console.error("Diff:");
  execSync(`git --no-pager diff -- ${CONTRACT_ARTIFACTS.join(" ")}`, {
    stdio: "inherit",
  });
  process.exit(1);
}

main();
