import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EXIT_BAD_INVOCATION,
  EXIT_MIGRATION_FAILED,
  EXIT_OK,
  parseArgs,
  runMigrationCli,
  validateInvocation,
} from "../../run-migration.mjs";

// ── Doubles ─────────────────────────────────────────────────────────────────

const ENVIRONMENTS = {
  staging: {
    name: "staging",
    supabaseProjectRef: "stagingrefaaaaaa",
    supabaseProjectName: "frapp-staging",
  },
  production: {
    name: "production",
    supabaseProjectRef: "productionrefbbb",
    supabaseProjectName: "frapp-prod",
  },
};

const lookupEnvironment = (name) => {
  const found = ENVIRONMENTS[name];
  if (!found) throw new Error(`Unknown environment "${name}".`);
  return found;
};

/**
 * Records every Supabase invocation. The recording is the point: an exit code
 * alone cannot tell "refused before touching the database" from "ran `link`,
 * then failed", and those are very different outcomes for a script whose whole
 * job is deciding which database to write to.
 */
function makeSupabase({ throwOn } = {}) {
  const calls = [];
  const supabase = (args) => {
    calls.push(args.join(" "));
    if (throwOn && args.join(" ").includes(throwOn)) {
      throw new Error(`Command failed: supabase ${args.join(" ")}`);
    }
    return "";
  };
  return { supabase, calls };
}

const quiet = { log: () => {}, error: () => {} };
const readDir = () => ["20260101000000_a.sql", "20260102000000_b.sql"];

const baseEnv = (overrides = {}) => ({
  SUPABASE_ACCESS_TOKEN: "sbp_token",
  SUPABASE_PROJECT_REF: ENVIRONMENTS.staging.supabaseProjectRef,
  SUPABASE_DB_PASSWORD: "pw",
  ...overrides,
});

// ── parseArgs ───────────────────────────────────────────────────────────────

test("parseArgs reads --env, --dry-run and --include-all", () => {
  assert.deepEqual(parseArgs(["--env", "production", "--dry-run"]), {
    env: "production",
    dryRun: true,
    includeAll: false,
  });
  assert.deepEqual(parseArgs(["--env", "staging", "--include-all"]), {
    env: "staging",
    dryRun: false,
    includeAll: true,
  });
  assert.deepEqual(parseArgs([]), { env: undefined, dryRun: false, includeAll: false });
});

// ── The fence ───────────────────────────────────────────────────────────────

test("THE fence: a staging label pointed at production is refused", () => {
  // The single most important assertion in this file. Before ci/environments.json
  // existed, `--env` was validated, printed, and then dropped — `main()` used
  // only SUPABASE_PROJECT_REF, so this invocation applied migrations to
  // PRODUCTION while every log line said "staging".
  const result = validateInvocation({
    args: { env: "staging", dryRun: false, includeAll: false },
    env: baseEnv({ SUPABASE_PROJECT_REF: ENVIRONMENTS.production.supabaseProjectRef }),
    lookupEnvironment,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, EXIT_BAD_INVOCATION);
  assert.match(result.message, /does not match the 'staging' environment/);
  // Both refs named, so the operator can see WHICH is wrong without guessing.
  assert.match(result.message, /stagingrefaaaaaa/);
  assert.match(result.message, /productionrefbbb/);
});

test("THE fence, end to end: a mismatched ref never invokes the Supabase CLI", () => {
  // Exit code alone is not enough. `supabase link --project-ref <prod>` followed
  // by a failure would also exit non-zero, having already pointed the CLI at the
  // wrong project. The assertion is that NOTHING ran.
  const { supabase, calls } = makeSupabase();
  const code = runMigrationCli({
    argv: ["--env", "staging"],
    env: baseEnv({ SUPABASE_PROJECT_REF: ENVIRONMENTS.production.supabaseProjectRef }),
    supabase,
    readDir,
    lookupEnvironment,
    ...quiet,
  });
  assert.equal(code, EXIT_BAD_INVOCATION);
  assert.deepEqual(calls, []);
});

test("the reverse mismatch is refused too — production labelled, staging ref", () => {
  const { supabase, calls } = makeSupabase();
  const code = runMigrationCli({
    argv: ["--env", "production"],
    env: baseEnv({ SUPABASE_PROJECT_REF: ENVIRONMENTS.staging.supabaseProjectRef }),
    supabase,
    readDir,
    lookupEnvironment,
    ...quiet,
  });
  assert.equal(code, EXIT_BAD_INVOCATION);
  assert.deepEqual(calls, []);
});

test("a matching ref is allowed through and pushes", () => {
  const { supabase, calls } = makeSupabase();
  const code = runMigrationCli({
    argv: ["--env", "production"],
    env: baseEnv({ SUPABASE_PROJECT_REF: ENVIRONMENTS.production.supabaseProjectRef }),
    supabase,
    readDir,
    lookupEnvironment,
    ...quiet,
  });
  assert.equal(code, EXIT_OK);
  assert.deepEqual(calls, ["link --project-ref productionrefbbb", "db push"]);
});

test("an unresolvable environment config fails closed rather than trusting the label", () => {
  const { supabase, calls } = makeSupabase();
  const code = runMigrationCli({
    argv: ["--env", "staging"],
    env: baseEnv(),
    supabase,
    readDir,
    lookupEnvironment: () => {
      throw new Error("ENOENT: no such file");
    },
    ...quiet,
  });
  assert.equal(code, EXIT_BAD_INVOCATION);
  assert.deepEqual(calls, []);
});

// ── Ordinary validation, unchanged from before the fence ────────────────────

test("--env must name a real environment", () => {
  for (const env of [undefined, "prod", "PRODUCTION", "dev"]) {
    const result = validateInvocation({
      args: { env, dryRun: false, includeAll: false },
      env: baseEnv(),
      lookupEnvironment,
    });
    assert.equal(result.ok, false, `expected ${env} to be rejected`);
    assert.match(result.message, /--env must be/);
  }
});

test("a missing token or ref is refused before anything runs", () => {
  const missingToken = validateInvocation({
    args: { env: "staging", dryRun: false, includeAll: false },
    env: { SUPABASE_PROJECT_REF: ENVIRONMENTS.staging.supabaseProjectRef },
    lookupEnvironment,
  });
  assert.match(missingToken.message, /SUPABASE_ACCESS_TOKEN/);

  const missingRef = validateInvocation({
    args: { env: "staging", dryRun: false, includeAll: false },
    env: { SUPABASE_ACCESS_TOKEN: "t" },
    lookupEnvironment,
  });
  assert.match(missingRef.message, /SUPABASE_PROJECT_REF environment variable is required/);
});

test("a missing SUPABASE_DB_PASSWORD is refused before the CLI can mislead", () => {
  // Without it the pinned CLI dies as `42501: permission denied to alter role`
  // (supabase/cli#5091) — which reads as a privilege problem on the production
  // database and is not one. deploy-production.yml's fence already checked it;
  // the documented human recovery run had nothing checking it at all, so an
  // operator following the runbook mid-incident would spend the incident
  // debugging the wrong thing.
  const env = baseEnv();
  delete env.SUPABASE_DB_PASSWORD;
  const result = validateInvocation({
    args: { env: "staging", dryRun: false, includeAll: false },
    env,
    lookupEnvironment,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, EXIT_BAD_INVOCATION);
  assert.match(result.message, /SUPABASE_DB_PASSWORD/);
  assert.match(result.message, /42501/);
  assert.match(result.message, /not a\n?\s*privilege problem/);
});

test("a malformed ref is rejected on shape before it is compared", () => {
  const result = validateInvocation({
    args: { env: "staging", dryRun: false, includeAll: false },
    env: baseEnv({ SUPABASE_PROJECT_REF: "Not-A-Ref" }),
    lookupEnvironment,
  });
  assert.match(result.message, /15-20 lowercase alphanumeric/);
});

// ── --include-all ───────────────────────────────────────────────────────────

test("--include-all is refused in CI unless deliberately allowed", () => {
  // No workflow sets it, and this guard is what keeps that a fact rather than a
  // convention. It applies migrations that sort before the newest already
  // applied — the exact shape `migration-order` exists to keep off main.
  const refused = validateInvocation({
    args: { env: "production", dryRun: false, includeAll: true },
    env: baseEnv({ SUPABASE_PROJECT_REF: ENVIRONMENTS.production.supabaseProjectRef, CI: "true" }),
    lookupEnvironment,
  });
  assert.equal(refused.ok, false);
  assert.match(refused.message, /human recovery path/);

  const allowed = validateInvocation({
    args: { env: "production", dryRun: false, includeAll: true },
    env: baseEnv({
      SUPABASE_PROJECT_REF: ENVIRONMENTS.production.supabaseProjectRef,
      CI: "true",
      MIGRATION_ALLOW_INCLUDE_ALL: "true",
    }),
    lookupEnvironment,
  });
  assert.equal(allowed.ok, true);
});

test("--include-all outside CI passes the flag through to db push", () => {
  const { supabase, calls } = makeSupabase();
  const code = runMigrationCli({
    argv: ["--env", "production", "--include-all"],
    env: baseEnv({ SUPABASE_PROJECT_REF: ENVIRONMENTS.production.supabaseProjectRef }),
    supabase,
    readDir,
    lookupEnvironment,
    ...quiet,
  });
  assert.equal(code, EXIT_OK);
  assert.ok(calls.includes("db push --include-all"));
});

test("without --include-all the flag is never passed", () => {
  const { supabase, calls } = makeSupabase();
  runMigrationCli({
    argv: ["--env", "staging"],
    env: baseEnv(),
    supabase,
    readDir,
    lookupEnvironment,
    ...quiet,
  });
  assert.ok(calls.includes("db push"));
  assert.ok(!calls.some((c) => c.includes("--include-all")));
});

// ── Modes ───────────────────────────────────────────────────────────────────

test("--dry-run lists status and never pushes", () => {
  const { supabase, calls } = makeSupabase();
  const code = runMigrationCli({
    argv: ["--env", "staging", "--dry-run"],
    env: baseEnv(),
    supabase,
    readDir,
    lookupEnvironment,
    ...quiet,
  });
  assert.equal(code, EXIT_OK);
  assert.deepEqual(calls, ["link --project-ref stagingrefaaaaaa", "migration list"]);
  assert.ok(!calls.some((c) => c.startsWith("db push")));
});

test("a readable but empty migrations directory exits 0 without touching the CLI", () => {
  const { supabase, calls } = makeSupabase();
  const code = runMigrationCli({
    argv: ["--env", "staging"],
    env: baseEnv(),
    supabase,
    readDir: () => [],
    lookupEnvironment,
    ...quiet,
  });
  assert.equal(code, EXIT_OK);
  assert.deepEqual(calls, []);
});

test("an UNREADABLE migrations directory is fatal, not 'nothing to apply'", () => {
  // The third door to "reports migrations applied having applied zero".
  // MIGRATIONS_DIR is relative to process.cwd(), so a CI step with a
  // `working-directory:`, or the documented laptop recovery run from scripts/,
  // makes readdirSync throw. Swallowed, that printed "No migrations to apply"
  // and exited 0 — every fence in this file green, nothing applied, and the
  // calling workflow step recording success.
  const { supabase, calls } = makeSupabase();
  let message = "";
  const code = runMigrationCli({
    argv: ["--env", "production"],
    env: baseEnv({ SUPABASE_PROJECT_REF: ENVIRONMENTS.production.supabaseProjectRef }),
    supabase,
    readDir: () => {
      throw new Error("ENOENT: no such file or directory");
    },
    lookupEnvironment,
    log: () => {},
    error: (text) => {
      message += text;
    },
  });
  assert.equal(code, EXIT_BAD_INVOCATION);
  assert.deepEqual(calls, []);
  assert.match(message, /broken checkout or a wrong working directory/);
});

test("a failing push exits 1 rather than throwing", () => {
  const { supabase } = makeSupabase({ throwOn: "db push" });
  const code = runMigrationCli({
    argv: ["--env", "staging"],
    env: baseEnv(),
    supabase,
    readDir,
    lookupEnvironment,
    ...quiet,
  });
  assert.equal(code, EXIT_MIGRATION_FAILED);
});

test("importing this module runs no migration", () => {
  // The entry guard is load-bearing, not boilerplate: without it, any import —
  // a test, an editor, an agent reading the file — would run a migration.
  // Reaching this assertion at all proves the guard held, since the import at
  // the top of this file supplied no argv.
  assert.equal(typeof runMigrationCli, "function");
});
