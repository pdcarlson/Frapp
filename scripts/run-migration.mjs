#!/usr/bin/env node

/**
 * Database Migration Runner for CI/CD
 *
 * Applies `supabase/migrations/` to one named environment.
 *
 * Usage:
 *   node scripts/run-migration.mjs --env staging
 *   node scripts/run-migration.mjs --env production
 *   node scripts/run-migration.mjs --env staging --dry-run
 *   node scripts/run-migration.mjs --env production --include-all   # recovery only
 *
 * Required environment variables:
 *   SUPABASE_ACCESS_TOKEN  — Supabase CLI auth token
 *   SUPABASE_PROJECT_REF   — Target project reference ID
 *   SUPABASE_DB_PASSWORD   — mandatory; without it the pinned CLI fails as
 *                            `42501: permission denied to alter role`
 *                            (supabase/cli#5091), which reads as a database
 *                            privilege problem and is not one
 *
 * ── `--env` is load-bearing, and did not used to be ─────────────────────────
 * Until #1373's follow-up this argument was validated, printed at the top of
 * the log, and then DROPPED: `main()` read only `SUPABASE_PROJECT_REF`, so
 * `--env staging` and `--env production` were byte-for-byte the same program.
 * Nothing anywhere asserted that the ref a job injected matched the environment
 * that job claimed to be. A staging workflow pointed at the production ref —
 * one wrong `env-slug:` line, one mis-scoped Infisical folder — would have
 * applied migrations to PRODUCTION while every log line said "staging", and the
 * only trace would have been the run's own output saying it was fine.
 *
 * So the ref each environment must have now lives in `ci/environments.json`,
 * and this script compares the injected ref against it and FAILS CLOSED before
 * `link` or `push` is invoked. That the file is not secret is the point: a
 * project ref grants nothing without `SUPABASE_ACCESS_TOKEN`, and naming it in
 * the repo is what makes the assertion possible at all.
 *
 * The failure is deliberately at the very top, before the Supabase CLI is even
 * located: a mismatch means the run's own idea of where it is pointing is
 * wrong, and there is no safe next step from there.
 *
 * Semantics are pure functions with an injected command runner so they can be
 * unit-tested without a database — `scripts/ci/__tests__/run-migration.test.mjs`.
 */

import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { getEnvironment, SUPABASE_PROJECT_REF_PATTERN } from "./ci/lib/environments.mjs";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

export const EXIT_OK = 0;
export const EXIT_MIGRATION_FAILED = 1;
export const EXIT_BAD_INVOCATION = 2;

// ── Argument parsing ────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const get = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  return {
    env: get("--env"),
    dryRun: argv.includes("--dry-run"),
    includeAll: argv.includes("--include-all"),
  };
}

// ── Invocation validation ───────────────────────────────────────────────────

/**
 * Everything that must hold before a single Supabase command is run.
 *
 * Returns `{ ok: true, target }` or `{ ok: false, code, message }`. Pure by
 * construction — no `process.exit`, no I/O beyond the injected environment
 * lookup — because the assertion that matters most here ("a staging label
 * cannot write to production") is exactly the one that must be provable in a
 * test rather than by reading the code and hoping.
 */
export function validateInvocation({
  args,
  env = process.env,
  lookupEnvironment = getEnvironment,
}) {
  const fail = (message) => ({ ok: false, code: EXIT_BAD_INVOCATION, message });

  if (!args.env || !["staging", "production"].includes(args.env)) {
    return fail("--env must be 'staging' or 'production'");
  }

  if (!env.SUPABASE_ACCESS_TOKEN) {
    return fail("SUPABASE_ACCESS_TOKEN environment variable is required");
  }

  const projectRef = env.SUPABASE_PROJECT_REF;
  if (!projectRef) {
    return fail("SUPABASE_PROJECT_REF environment variable is required");
  }
  if (!SUPABASE_PROJECT_REF_PATTERN.test(projectRef)) {
    return fail("SUPABASE_PROJECT_REF must be 15-20 lowercase alphanumeric characters");
  }

  // Asserted here, not left to the CLI. Without it the pinned Supabase CLI
  // cannot initialise its `cli_login_postgres` role and dies with
  // `42501: permission denied to alter role` — which reads as a privilege
  // problem on the production database and is a CLI bug (supabase/cli#5091).
  // `deploy-production.yml`'s fence already checks it for the workflow path;
  // the documented human recovery run had nothing checking it at all, so an
  // operator following the runbook mid-incident would have spent the incident
  // debugging a misleading permissions error.
  if (!env.SUPABASE_DB_PASSWORD) {
    return fail(
      "SUPABASE_DB_PASSWORD environment variable is required.\n" +
        "  The pinned Supabase CLI cannot initialise its `cli_login_postgres` role without it and\n" +
        "  fails as `42501: permission denied to alter role` — a CLI bug (supabase/cli#5091), not a\n" +
        "  privilege problem on the database. It is set in every Infisical environment; export it\n" +
        "  alongside SUPABASE_ACCESS_TOKEN when running by hand.\n" +
        "  See docs/internal/environment/ENV_REFERENCE.md.",
    );
  }

  let expected;
  try {
    expected = lookupEnvironment(args.env);
  } catch (error) {
    // A missing or malformed config is fatal rather than a soft fallback. The
    // fallback would be "trust whatever ref the environment supplied", which is
    // the exact unverified state this check exists to end — and it would fail
    // open on the one code path that writes to a production database.
    return fail(
      `Could not resolve the expected project ref for '${args.env}': ${error.message}`,
    );
  }

  if (projectRef !== expected.supabaseProjectRef) {
    return fail(
      `SUPABASE_PROJECT_REF does not match the '${args.env}' environment.\n` +
        `    Expected (ci/environments.json): ${expected.supabaseProjectRef} (${expected.supabaseProjectName})\n` +
        `    Injected (SUPABASE_PROJECT_REF): ${projectRef}\n` +
        `\n` +
        `  Refusing to run: a job labelled '${args.env}' that is pointed at another project\n` +
        `  would apply migrations to the wrong database and report success. Nothing about\n` +
        `  the label is evidence — the ref is.\n` +
        `\n` +
        `  Fix ONE of these, whichever is actually wrong:\n` +
        `    * the workflow's Infisical env-slug (production is 'prod', not 'production'), or\n` +
        `    * the SUPABASE_PROJECT_REF stored in that Infisical environment, or\n` +
        `    * ci/environments.json, if a project was legitimately rotated.`,
    );
  }

  // `--include-all` tells `supabase db push` to apply migrations that sort
  // BEFORE the newest version the remote has already applied. That is the
  // #1373 shape, and the `migration-order` gate exists to stop it reaching
  // `main` at all — so reaching for it here means something has already gone
  // wrong and a person is recovering by hand. No workflow sets it, and this
  // guard is what keeps that true rather than merely intended.
  if (args.includeAll && env.CI === "true" && env.MIGRATION_ALLOW_INCLUDE_ALL !== "true") {
    return fail(
      "--include-all is a human recovery path and no workflow sets it.\n" +
        "  It applies migrations that sort before the newest version already applied —\n" +
        "  the failure class `migration-order` and `migration-replay` exist to prevent.\n" +
        "  If a run genuinely needs it, set MIGRATION_ALLOW_INCLUDE_ALL=true deliberately\n" +
        "  and record why. See docs/internal/ops/DB_PROMOTION_RUNBOOK.md § --include-all.",
    );
  }

  return {
    ok: true,
    target: {
      env: args.env,
      projectRef,
      projectName: expected.supabaseProjectName,
      dryRun: args.dryRun,
      includeAll: args.includeAll,
    },
  };
}

// ── Supabase CLI ────────────────────────────────────────────────────────────

function quoteArg(arg) {
  return /[^\w./:-]/.test(arg) ? JSON.stringify(arg) : arg;
}

let cachedSupabaseCommand = null;

function getSupabaseCommand(log) {
  if (cachedSupabaseCommand) return cachedSupabaseCommand;
  try {
    execFileSync("supabase", ["--version"], { stdio: "ignore" });
    log("  Using Supabase CLI from PATH.");
    cachedSupabaseCommand = { command: "supabase", prefixArgs: [] };
  } catch {
    log("  Supabase CLI not found on PATH. Falling back to npx supabase.");
    cachedSupabaseCommand = { command: "npx", prefixArgs: ["supabase"] };
  }
  return cachedSupabaseCommand;
}

/**
 * Default runner: invoke the real Supabase CLI. Injected in tests, which is how
 * "the mismatch fence never invokes the CLI" becomes an assertion rather than a
 * claim — a test that only checked the exit code could not tell a refusal from
 * a `link` that ran and then failed.
 */
export function createSupabaseRunner({ log = console.log } = {}) {
  return (args, { capture = false } = {}) => {
    const { command, prefixArgs } = getSupabaseCommand(log);
    const full = [command, ...prefixArgs, ...args];
    log(`  $ ${full.map(quoteArg).join(" ")}`);
    return execFileSync(command, [...prefixArgs, ...args], {
      encoding: "utf8",
      stdio: capture ? "pipe" : "inherit",
    });
  };
}

// ── Migration files ─────────────────────────────────────────────────────────

/**
 * Returns `{ ok, files }`. An unreadable directory is `ok: false`, NEVER an
 * empty list.
 *
 * The old code swallowed the error and returned `[]`, which `main()` then
 * reported as "No migrations to apply. Exiting." with exit 0. Run from anywhere
 * but the repo root — `MIGRATIONS_DIR` is relative to `process.cwd()`, so a CI
 * step with a `working-directory:`, or the documented laptop recovery run from
 * `scripts/`, does exactly that — every safety layer in this file passes, the
 * step records success, and zero migrations were applied. That is the same
 * "reports migrations applied having applied zero" outcome the entry guard
 * below and deploy-production.yml's working-tree fence both exist to prevent,
 * arriving by a third door.
 *
 * Both sibling gates already treat this state as fatal: check-migration-drift.mjs
 * refuses to report drift against an empty repository, and
 * check-migration-order.mjs calls it a broken checkout. This now agrees with them.
 */
export function readMigrationFiles(dir = MIGRATIONS_DIR, { readDir = readdirSync } = {}) {
  try {
    return { ok: true, files: readDir(dir).filter((f) => f.endsWith(".sql")).sort() };
  } catch (error) {
    return { ok: false, files: [], error: error.message };
  }
}

// ── Phases ──────────────────────────────────────────────────────────────────

function dryRun({ target, supabase, log }) {
  log("\n── Dry Run ──────────────────────────────────────────────");
  log("  Checking what migrations would be applied...\n");

  log("  Linking to Supabase project...");
  supabase(["link", "--project-ref", target.projectRef]);

  log("  Listing migration status...");
  const output = supabase(["migration", "list"], { capture: true });
  if (output) {
    log("\n  Migration status:");
    log(output);
  }

  log("\n  Dry run complete — no changes were applied.");
}

function applyMigrations({ target, supabase, log }) {
  log("\n── Applying Migrations ──────────────────────────────────");

  log("\n  Linking to Supabase project...");
  supabase(["link", "--project-ref", target.projectRef]);

  log("\n  Pushing migrations...");
  supabase(["db", "push", ...(target.includeAll ? ["--include-all"] : [])]);

  log("\n  ✅ Migrations applied successfully.");
}

// ── Entry point ─────────────────────────────────────────────────────────────

/**
 * Returns an exit code instead of calling `process.exit`, so every branch —
 * including the refusals — is reachable from a test.
 */
export function runMigrationCli({
  argv = process.argv.slice(2),
  env = process.env,
  supabase,
  migrationsDir = MIGRATIONS_DIR,
  readDir = readdirSync,
  lookupEnvironment = getEnvironment,
  log = console.log,
  error = console.error,
} = {}) {
  const args = parseArgs(argv);
  const validated = validateInvocation({ args, env, lookupEnvironment });

  if (!validated.ok) {
    error(`Error: ${validated.message}`);
    return validated.code;
  }

  const { target } = validated;
  const runner = supabase ?? createSupabaseRunner({ log });

  log("══════════════════════════════════════════════════════════");
  log("  Database Migration Runner");
  log(`  Environment: ${target.env} (${target.projectName})`);
  log(`  Project Ref: ${target.projectRef.substring(0, 8)}... — matches ci/environments.json`);
  log(`  Mode: ${target.dryRun ? "DRY RUN" : "LIVE"}${target.includeAll ? " + --include-all" : ""}`);
  log("══════════════════════════════════════════════════════════");

  if (target.includeAll) {
    log("");
    log("  ⚠ --include-all is set. `supabase db push` will apply migrations that sort");
    log("    BEFORE the newest version already applied to this database. Do this only as");
    log("    recovery, and only having read why the ordering is wrong in the first place:");
    log("    docs/internal/ops/DB_PROMOTION_RUNBOOK.md § --include-all.");
  }

  const migrations = readMigrationFiles(migrationsDir, { readDir });
  if (!migrations.ok) {
    error(
      `Error: could not read ${migrationsDir} (${migrations.error}).\n` +
        `  This is a broken checkout or a wrong working directory, not an empty migration set.\n` +
        `  Reporting "nothing to apply" here would exit 0 having applied nothing, and the\n` +
        `  calling step would record success. Run from the repository root.`,
    );
    return EXIT_BAD_INVOCATION;
  }
  log(`  Found ${migrations.files.length} migration file(s) in supabase/migrations/`);

  // A readable but EMPTY directory is a different thing and stays non-fatal:
  // `supabase db push` is a no-op against it, and a repo legitimately has no
  // migrations before its first one.
  if (migrations.files.length === 0) {
    log("\n  No migrations to apply. Exiting.");
    return EXIT_OK;
  }

  try {
    if (target.dryRun) {
      dryRun({ target, supabase: runner, log });
    } else {
      applyMigrations({ target, supabase: runner, log });
    }
  } catch (thrown) {
    error("\n  ❌ Migration failed!");
    error(`  Error: ${thrown.message}`);
    error("\n  The deploy pipeline will be halted.");
    error("  Check the migration output above for details.");
    error("  Refer to docs/internal/ops/DB_ROLLBACK_PLAYBOOK.md for recovery steps.");
    return EXIT_MIGRATION_FAILED;
  }

  return EXIT_OK;
}

// Only when executed directly, so tests can import the pure helpers without
// running a migration as a side effect of the import.
//
// The suffix form, NOT `import.meta.url === \`file://${process.argv[1]}\``,
// which several sibling scripts use. That comparison is string equality between
// two things that are not always spelled the same:
//
//   * a repo path containing a space gives `file:///…/my%20repo/x.mjs` on the
//     left and `/…/my repo/x.mjs` on the right — percent-encoded vs not;
//   * a checkout reached through a symlink gives a realpath-resolved
//     `import.meta.url` and an unresolved `argv[1]`.
//
// Either way the guard is false, this file runs nothing, and node exits 0. For
// a script whose whole job is applying migrations that is the worst available
// failure: the workflow step records `success`, the run summary says the
// migrations applied, and Render then deploys new code against the old schema —
// the precise "reports migrations applied having applied zero" outcome the
// working-tree fence in deploy-production.yml exists to prevent, arriving by a
// different door. The documented laptop recovery would no-op the same way.
//
// A false POSITIVE here is harmless by comparison (a file named
// `…run-migration.mjs` importing this one, which does not exist), so the guard
// is deliberately the loose one.
const invokedDirectly = process.argv[1] && process.argv[1].endsWith("run-migration.mjs");
if (invokedDirectly) {
  process.exit(runMigrationCli());
}
