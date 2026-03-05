#!/usr/bin/env node

/**
 * Database Migration Runner for CI/CD
 *
 * Runs Supabase migrations against a target environment with safety checks.
 *
 * Usage:
 *   node scripts/run-migration.mjs --env staging
 *   node scripts/run-migration.mjs --env production
 *   node scripts/run-migration.mjs --env staging --dry-run
 *
 * Required environment variables:
 *   SUPABASE_ACCESS_TOKEN  — Supabase CLI auth token
 *   SUPABASE_PROJECT_REF   — Target project reference ID
 *
 * For staging:  SUPABASE_PROJECT_REF = staging project ref
 * For production: SUPABASE_PROJECT_REF = production project ref
 */

import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

function getArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function run(command, options = {}) {
  console.log(`  $ ${command}`);
  try {
    const result = execSync(command, {
      encoding: "utf8",
      stdio: options.capture ? "pipe" : "inherit",
      ...options,
    });
    return result;
  } catch (error) {
    if (options.allowFailure) {
      console.warn(`  ⚠ Command failed (non-fatal): ${error.message}`);
      return null;
    }
    throw error;
  }
}

function validateEnvironment() {
  const env = getArg("--env");
  if (!env || !["staging", "production"].includes(env)) {
    console.error("Error: --env must be 'staging' or 'production'");
    process.exit(2);
  }

  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    console.error("Error: SUPABASE_ACCESS_TOKEN environment variable is required");
    process.exit(2);
  }

  const projectRef = process.env.SUPABASE_PROJECT_REF;
  if (!projectRef) {
    console.error("Error: SUPABASE_PROJECT_REF environment variable is required");
    process.exit(2);
  }

  return { env, token, projectRef };
}

function checkPendingMigrations() {
  let migrationFiles = [];
  try {
    migrationFiles = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
  } catch {
    console.log("  No migrations directory found — nothing to migrate.");
    return [];
  }

  console.log(`  Found ${migrationFiles.length} migration file(s) in supabase/migrations/`);
  return migrationFiles;
}

function dryRun(projectRef) {
  console.log("\n── Dry Run ──────────────────────────────────────────────");
  console.log("  Checking what migrations would be applied...\n");

  // Link to the project first
  run(`npx supabase link --project-ref ${projectRef}`, { allowFailure: true });

  // Show migration status
  const output = run("npx supabase migration list", {
    capture: true,
    allowFailure: true,
  });

  if (output) {
    console.log("\n  Migration status:");
    console.log(output);
  }

  console.log("\n  Dry run complete — no changes were applied.");
}

function applyMigrations(projectRef) {
  console.log("\n── Applying Migrations ──────────────────────────────────");

  // Link to the project
  console.log("\n  Linking to Supabase project...");
  run(`npx supabase link --project-ref ${projectRef}`);

  // Push migrations
  console.log("\n  Pushing migrations...");
  run("npx supabase db push");

  console.log("\n  ✅ Migrations applied successfully.");
}

function main() {
  const { env, projectRef } = validateEnvironment();
  const isDryRun = hasFlag("--dry-run");

  console.log("══════════════════════════════════════════════════════════");
  console.log(`  Database Migration Runner`);
  console.log(`  Environment: ${env}`);
  console.log(`  Project Ref: ${projectRef.substring(0, 8)}...`);
  console.log(`  Mode: ${isDryRun ? "DRY RUN" : "LIVE"}`);
  console.log("══════════════════════════════════════════════════════════");

  const migrations = checkPendingMigrations();

  if (migrations.length === 0) {
    console.log("\n  No migrations to apply. Exiting.");
    return;
  }

  if (isDryRun) {
    dryRun(projectRef);
  } else {
    applyMigrations(projectRef);
  }
}

try {
  main();
} catch (error) {
  console.error("\n  ❌ Migration failed!");
  console.error(`  Error: ${error.message}`);
  console.error("\n  The deploy pipeline will be halted.");
  console.error("  Check the migration output above for details.");
  console.error("  Refer to docs/internal/DB_ROLLBACK_PLAYBOOK.md for recovery steps.");
  process.exit(1);
}
