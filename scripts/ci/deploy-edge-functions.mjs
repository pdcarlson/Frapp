#!/usr/bin/env node

// Deploy every Supabase Edge Function under `supabase/functions/` to one
// environment's project (#2848, ADR-26). `_deploy.yml` runs it after the
// migrations and before the API, because the API is what calls the functions:
// a new API must never reach a project whose functions are older than it.
//
// ── What it deploys ─────────────────────────────────────────────────────────
// Each directory under `supabase/functions/` that holds an `index.ts`, skipping
// `_`- and `.`-prefixed ones (the CLI's convention for shared code). Deployed
// one at a time, by name, with `--use-api`: the CLI bundles on Supabase's side,
// so the job needs no Docker image for it. Each function's `verify_jwt` comes
// from `supabase/config.toml`, which the CLI reads.
//
// ── The fence ───────────────────────────────────────────────────────────────
// The same one `run-migration.mjs` applies: the injected `SUPABASE_PROJECT_REF`
// must be the ref `.github/environments.json` names for `TARGET_ENVIRONMENT`,
// so a staging-labelled run cannot deploy to production's project.
//
// ── The credential ──────────────────────────────────────────────────────────
// `SUPABASE_FUNCTIONS_DEPLOY_TOKEN`, not `SUPABASE_ACCESS_TOKEN`. The latter is
// deliberately read-only (#2583), and deploying a function needs the Edge
// Functions read-write permission. So each Infisical environment holds a
// second scoped token with that permission alone, for its own project only
// (`docs/internal/environment/ENV_REFERENCE.md` § CD Secrets). It is handed to
// the CLI as `SUPABASE_ACCESS_TOKEN` in the child process only.
//
// Env inputs:
//   TARGET_ENVIRONMENT               — required; staging or production
//   SUPABASE_PROJECT_REF             — required; injected from Infisical
//   SUPABASE_FUNCTIONS_DEPLOY_TOKEN  — required when there is anything to deploy
//
// Unit tests: `scripts/ci/__tests__/deploy-edge-functions.test.mjs`.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { getEnvironment, SUPABASE_PROJECT_REF_PATTERN } from "./lib/environments.mjs";
import { isInvokedDirectly } from "./lib/invoked-directly.mjs";

export const FUNCTIONS_DIR = join("supabase", "functions");

/** The function names under `dir`, sorted, or none when it doesn't exist. */
export function listFunctions(dir = FUNCTIONS_DIR, { exists = existsSync, readdir = readdirSync } = {}) {
  if (!exists(dir)) return [];
  return readdir(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !/^[_.]/.test(entry.name))
    .filter((entry) => exists(join(dir, entry.name, "index.ts")))
    .map((entry) => entry.name)
    .sort();
}

/**
 * Check the inputs. Returns `{ ok: true, projectRef, token }` or
 * `{ ok: false, message }`. The token is checked only when `hasFunctions`, so
 * a commit with nothing to deploy never fails for a secret it doesn't need.
 */
export function validateInputs({ env = process.env, hasFunctions, lookupEnvironment = getEnvironment }) {
  const fail = (message) => ({ ok: false, message });
  const target = env.TARGET_ENVIRONMENT;
  if (target !== "staging" && target !== "production") {
    return fail(`TARGET_ENVIRONMENT must be 'staging' or 'production' (got ${JSON.stringify(target ?? "")}).`);
  }

  const projectRef = env.SUPABASE_PROJECT_REF ?? "";
  if (!SUPABASE_PROJECT_REF_PATTERN.test(projectRef)) {
    return fail("SUPABASE_PROJECT_REF is missing or malformed; it is injected from Infisical.");
  }
  let expected;
  try {
    expected = lookupEnvironment(target);
  } catch (error) {
    return fail(`Could not resolve the expected project ref for '${target}': ${error.message}`);
  }
  if (projectRef !== expected.supabaseProjectRef) {
    return fail(
      `SUPABASE_PROJECT_REF does not match the '${target}' environment.\n` +
        `    Expected (.github/environments.json): ${expected.supabaseProjectRef} (${expected.supabaseProjectName})\n` +
        `    Injected (SUPABASE_PROJECT_REF): ${projectRef}\n` +
        `  Refusing to deploy a '${target}' run's functions to another project.`,
    );
  }

  const token = env.SUPABASE_FUNCTIONS_DEPLOY_TOKEN ?? "";
  if (hasFunctions && !token) {
    return fail(
      `SUPABASE_FUNCTIONS_DEPLOY_TOKEN is not set in this Infisical environment.\n` +
        `  It is a Supabase access token scoped to ${expected.supabaseProjectName} alone, with the\n` +
        `  Edge Functions read-write permission and nothing else. SUPABASE_ACCESS_TOKEN cannot stand in:\n` +
        `  it is read-only by design (#2583). How to mint it:\n` +
        `  docs/internal/environment/ENV_REFERENCE.md § CD Secrets.`,
    );
  }
  return { ok: true, projectRef, token };
}

/** The CLI invocation for one function. */
export function deployArgs(name, projectRef) {
  return ["functions", "deploy", name, "--use-api", "--project-ref", projectRef];
}

/** Deploy each function in turn; stop at the first failure. Returns an exit code. */
export function deployAll({ functions, projectRef, token, env = process.env, run = spawnSync, log = console.log }) {
  for (const name of functions) {
    log(`Deploying Edge Function ${name} to ${projectRef}...`);
    const result = run("supabase", deployArgs(name, projectRef), {
      stdio: "inherit",
      env: { ...env, SUPABASE_ACCESS_TOKEN: token },
    });
    if (result.error || result.status !== 0) {
      log(`::error::Deploying Edge Function ${name} failed (${result.error?.message ?? `exit ${result.status}`}).`);
      return 1;
    }
  }
  return 0;
}

function main() {
  const functions = listFunctions();
  const checked = validateInputs({ hasFunctions: functions.length > 0 });
  if (!checked.ok) {
    console.error(`::error::${checked.message}`);
    return 1;
  }
  if (functions.length === 0) {
    console.log(`No Edge Functions under ${FUNCTIONS_DIR}/ at this commit; nothing to deploy.`);
    return 0;
  }
  const code = deployAll({ functions, projectRef: checked.projectRef, token: checked.token });
  if (code === 0) console.log(`Deployed ${functions.join(", ")}.`);
  return code;
}

if (isInvokedDirectly(import.meta.url)) {
  process.exit(main());
}
