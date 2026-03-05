#!/usr/bin/env node

import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");
const MIGRATION_FILENAME = /^\d{14}_[a-z0-9_]+\.sql$/;

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function getChangedFiles(base, head) {
  if (!base || !head) return [];

  const ranges = [`${base}...${head}`, `${base}..${head}`];

  for (const range of ranges) {
    try {
      const output = execSync(`git diff --name-only ${range}`, {
        encoding: "utf8",
      }).trim();
      if (!output) return [];
      return output
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    } catch {
      // Try next range expression.
    }
  }

  try {
    execSync(`git fetch --no-tags --depth=500 origin ${base} ${head}`, {
      stdio: "ignore",
    });
  } catch {
    // Best-effort fetch; fall through to final failure message.
  }

  for (const range of ranges) {
    try {
      const output = execSync(`git diff --name-only ${range}`, {
        encoding: "utf8",
      }).trim();
      if (!output) return [];
      return output
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    } catch {
      // Try next range expression.
    }
  }

  throw new Error(
    `Unable to diff changed files for base=${base} head=${head}. Ensure checkout fetch-depth is 0 or these refs are fetched.`,
  );
}

function validateMigrationFiles() {
  const migrationFiles = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  const invalid = migrationFiles.filter((file) => !MIGRATION_FILENAME.test(file));
  if (invalid.length > 0) {
    console.error("Migration safety check failed: invalid migration filename(s).");
    for (const file of invalid) {
      console.error(`- ${file}`);
    }
    console.error(
      "Expected format: 14-digit timestamp prefix + snake_case name (e.g. 20260304120000_add_users.sql).",
    );
    process.exit(1);
  }

  const duplicates = migrationFiles.filter(
    (file, index) => migrationFiles.indexOf(file) !== index,
  );
  if (duplicates.length > 0) {
    console.error("Migration safety check failed: duplicate migration filenames.");
    for (const file of duplicates) {
      console.error(`- ${file}`);
    }
    process.exit(1);
  }
}

function validatePromotionDocs(base, head) {
  const changedFiles = getChangedFiles(base, head);
  if (changedFiles.length === 0) return;

  const migrationChanged = changedFiles.some((file) =>
    file.startsWith("supabase/migrations/"),
  );
  if (!migrationChanged) return;

  const hasPromotionDocsUpdate = changedFiles.some(
    (file) =>
      file === "docs/internal/DB_PROMOTION_RUNBOOK.md" ||
      file === "docs/internal/DB_ROLLBACK_PLAYBOOK.md" ||
      file === "spec/environments.md",
  );

  if (!hasPromotionDocsUpdate) {
    console.error("Migration safety check failed.");
    console.error(
      "You changed migration files without updating promotion/rollback docs.",
    );
    console.error(
      "Update docs/internal/DB_PROMOTION_RUNBOOK.md, docs/internal/DB_ROLLBACK_PLAYBOOK.md, or spec/environments.md in the same change set.",
    );
    process.exit(1);
  }
}

function main() {
  try {
    validateMigrationFiles();
    validatePromotionDocs(getArg("--base"), getArg("--head"));
    console.log("Migration safety check passed.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Migration safety check failed: ${message}`);
    process.exit(1);
  }
}

main();
