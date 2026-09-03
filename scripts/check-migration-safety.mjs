#!/usr/bin/env node

import { execSync } from "node:child_process";
import { readdirSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");
const MIGRATION_FILENAME = /^\d{14}_[a-z0-9_]+\.sql$/;

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith("-")) {
    console.error(`Error: flag ${name} requires a value.`);
    process.exit(2);
  }
  return value;
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

  // Two migrations sharing the same 14-digit version prefix collide in
  // Supabase's `schema_migrations` (its primary key is the version): applying
  // the second raises a duplicate-key error, breaking `supabase start` /
  // `db reset` on a fresh DB and skipping the second file on an
  // already-migrated DB. Dedupe on the version prefix, not the full filename
  // (filenames are unique on disk, so the old filename check could never fire).
  // This is exactly the #634/#635 collision (FRA-288).
  const versions = migrationFiles.map((file) => file.slice(0, 14));
  const duplicateVersions = [
    ...new Set(
      versions.filter((version, index) => versions.indexOf(version) !== index),
    ),
  ];
  if (duplicateVersions.length > 0) {
    console.error(
      "Migration safety check failed: duplicate migration version prefix(es).",
    );
    for (const version of duplicateVersions) {
      const colliders = migrationFiles.filter((file) =>
        file.startsWith(`${version}_`),
      );
      console.error(`- ${version}: ${colliders.join(", ")}`);
    }
    console.error(
      "Each migration needs a unique 14-digit version prefix; Supabase keys schema_migrations by it.",
    );
    process.exit(1);
  }
}

/**
 * The docs a migration change must update. Declared once, and checked for
 * staleness on every run before the gate judges any PR (see
 * `validateDocManifest`).
 *
 * That inversion is the point. Hardcoded `===` paths inside a REQUIRED check
 * have two failure modes on a rename and both are bad: the gate blocks every
 * migration PR in the repository because the author updated the *renamed* file
 * and matched none of the literals, or it quietly stops requiring anything at
 * all. Checking the manifest first turns both into one loud failure that names
 * this constant, so the rename gets fixed instead of the blameless PR.
 *
 * `spec/environments/` used to be a third disjunct: touching ANY environments
 * doc satisfied the gate. Measured over the last 400 commits on `main` it was
 * dead weight rather than the leak — 28 migration commits touched a runbook
 * directly and NONE was carried by that prefix alone — so dropping it costs no
 * existing workflow. Do not read more into its removal than that.
 *
 * The ledger hole it was blamed for is still open, and it is this list's own
 * shape: either entry satisfies the gate, so a migration PR that updates only
 * the rollback playbook never touches the promotion log. That is what actually
 * happened — of those 28, nineteen touched the rollback playbook alone and two
 * the promotion runbook alone, which is how the promotion log came to hold 28
 * dated entries against 69 migrations on disk. Closing it needs per-migration
 * coverage asserted both ways, not a shorter list; #1598 tracks that.
 */
export const MIGRATION_DOCS = [
  "docs/internal/ops/DB_PROMOTION_RUNBOOK.md",
  "docs/internal/ops/DB_ROLLBACK_PLAYBOOK.md",
];

/** Does this change set update one of the docs a migration owes? */
export function satisfiesPromotionDocs(changedFiles) {
  return changedFiles.some((file) => MIGRATION_DOCS.includes(file));
}

/**
 * Declared docs that are no longer tracked — a renamed runbook lands here.
 *
 * Tracked, not merely present on disk: a `git mv` that leaves the old filename
 * behind untracked would otherwise satisfy the manifest locally and fail in
 * CI's clean checkout. `check-docs-structure.mjs` resolves its own ratchet the
 * same way, for the same reason.
 */
export function staleDocs(isTracked = tracked) {
  return MIGRATION_DOCS.filter((doc) => !isTracked(doc));
}

// Resolved from this file, never `process.cwd()`. The paths this adjudicates
// come from `git diff --name-only`, which is repo-root-relative whatever the
// cwd; resolving the manifest against the cwd instead would make the two halves
// of one decision use two different roots, and running the gate from a
// subdirectory would report every declared doc "renamed" when nothing moved.
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

function tracked(doc) {
  try {
    execSync(`git ls-files --error-unmatch -- ${JSON.stringify(doc)}`, {
      cwd: REPO_ROOT,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Fail if the manifest itself went stale. Runs UNCONDITIONALLY, from `main()`.
 *
 * It has to. Every guard in `validatePromotionDocs` — no commit range, no
 * migration touched, requirement already satisfied — is a path the renaming PR
 * itself takes, and that is precisely the PR that must not merge green. Checked
 * only there, the ratchet would stay silent through the rename and fire days
 * later on the next migration PR, blaming an author who did everything right:
 * the exact misattribution this manifest exists to prevent.
 *
 * Exit 2, not 1. In this repo 1 means "the change violates the rule" and 2 means
 * "the gate cannot do its job" — see the malformed-flag exit above, and the
 * stale-manifest exits in check-doc-tables.mjs and check-docs-structure.mjs.
 * A repo-wide blocker triaged as one author's oversight is how this gets lost.
 */
function validateDocManifest() {
  const missing = staleDocs();
  if (missing.length === 0) return;

  console.error("Migration safety check failed: MIGRATION_DOCS is stale.");
  for (const doc of missing) {
    console.error(`- ${doc} is declared but is not a tracked file.`);
  }
  console.error(
    "A promotion/rollback doc was renamed, moved or deleted without updating " +
      "MIGRATION_DOCS in scripts/check-migration-safety.mjs. Repoint the list " +
      "in the same change set as the rename — until then this REQUIRED check " +
      "blocks every migration PR in the repository.",
  );
  process.exit(2);
}

function validatePromotionDocs(base, head) {
  if (!base || !head) {
    const missing = [!base && "--base", !head && "--head"].filter(Boolean).join(" and ");
    console.log(
      `Migration safety check: ${missing} not given, skipping the promotion-docs check ` +
        "(cannot diff for a supabase/migrations/ change without a commit range).",
    );
    return;
  }

  const changedFiles = getChangedFiles(base, head);
  if (changedFiles.length === 0) return;

  const migrationChanged = changedFiles.some((file) =>
    file.startsWith("supabase/migrations/"),
  );
  if (!migrationChanged) return;

  if (satisfiesPromotionDocs(changedFiles)) return;

  // The manifest is already known good — validateDocManifest() ran first — so
  // reaching here really is the author owing a doc edit.
  console.error("Migration safety check failed.");
  console.error(
    "You changed migration files without updating promotion/rollback docs.",
  );
  console.error(
    `Update one of ${MIGRATION_DOCS.join(" or ")} in the same change set.`,
  );
  process.exit(1);
}

function main() {
  try {
    validateMigrationFiles();
    validateDocManifest();
    validatePromotionDocs(getArg("--base"), getArg("--head"));
    console.log("Migration safety check passed.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Migration safety check failed: ${message}`);
    process.exit(1);
  }
}

// Import-safe: `main()` runs only as a CLI entry point, so the unit tests can
// import MIGRATION_DOCS and the two predicates without executing the gate.
//
// realpathSync BOTH sides, per scripts/check-npm-audit.mjs: Node symlink-resolves
// the ESM entry's `import.meta.url` by default but never `process.argv[1]`, and
// with --preserve-symlinks-main it resolves neither — either asymmetry would
// silently skip main(), this REQUIRED gate exiting 0 having checked nothing.
function isInvokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isInvokedDirectly()) {
  main();
}
